import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { DEFAULT_FILES_SETTINGS, getSetting, type FilesSettings } from '../settings';
import { FileRejected } from './policy';
import type { FileScanner } from './scan';
import type { ObjectStorage } from './storage';

export interface ProcessDeps {
  prisma: PrismaClient;
  storage: ObjectStorage;
  scanner: FileScanner;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

async function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'ignore' });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', () => { clearTimeout(t); resolve({ code: -1 }); });
    p.on('exit', (code) => { clearTimeout(t); resolve({ code }); });
  });
}

let toolCache: 'qpdf' | 'gs' | null | undefined;
async function pdfTool(): Promise<'qpdf' | 'gs' | null> {
  if (toolCache !== undefined) return toolCache;
  toolCache = null;
  for (const t of ['qpdf', 'gs'] as const) {
    const r = await run(t, ['--version'], 5000);
    if (r.code === 0) { toolCache = t; break; }
  }
  return toolCache;
}

/** Optimise a PDF only when a safe tool exists; keep the original when the result is not valid or not smaller. */
export async function optimisePdf(original: Buffer): Promise<{ buf: Buffer | null; note: string }> {
  const tool = await pdfTool();
  if (!tool) return { buf: null, note: 'PDF stored as uploaded: no optimiser (qpdf/ghostscript) is installed' };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'salesos-pdf-'));
  try {
    const inp = path.join(dir, 'in.pdf');
    const out = path.join(dir, 'out.pdf');
    await writeFile(inp, original);
    const args = tool === 'qpdf'
      ? ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', inp, out]
      : ['-sDEVICE=pdfwrite', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-dPDFSETTINGS=/ebook', `-sOutputFile=${out}`, inp];
    const r = await run(tool, args, 30_000);
    if (r.code !== 0 && !(tool === 'qpdf' && r.code === 3)) return { buf: null, note: `PDF stored as uploaded: ${tool} failed (exit ${r.code})` };
    const optimised = await readFile(out).catch(() => null);
    if (!optimised || optimised.subarray(0, 5).toString('latin1') !== '%PDF-') return { buf: null, note: `PDF stored as uploaded: ${tool} output was not a valid PDF` };
    if (optimised.length >= original.length) return { buf: null, note: `PDF stored as uploaded: ${tool} could not make it smaller` };
    return { buf: optimised, note: `PDF optimised with ${tool} (${original.length} -> ${optimised.length} bytes)` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface ProcessOutcome {
  status: 'READY' | 'REJECTED';
  note: string;
}

async function progress(deps: ProcessDeps, id: string, status: 'SCANNING' | 'PROCESSING', pct: number) {
  await deps.prisma.fileAsset.update({ where: { id }, data: { status, progress: pct } });
}

/**
 * Async pipeline: scan -> (image strip/resize/WebP | pdf optimise | csv check) -> READY. Throws on transient problems
 * (storage, scanner outage) so the caller can retry; permanent content problems end in REJECTED. The original is never
 * replaced; derivatives live under `<key>.derived`.
 */
export async function processFile(deps: ProcessDeps, fileId: string): Promise<ProcessOutcome> {
  const { prisma, storage, scanner } = deps;
  const f = await prisma.fileAsset.findUnique({ where: { id: fileId } });
  if (!f || f.deletedAt) return { status: 'REJECTED', note: 'file missing or deleted' };
  if (f.status === 'READY' || f.status === 'REJECTED') return { status: f.status, note: f.processingNote ?? '' };
  const settings: FilesSettings = await getSetting(prisma, f.organizationId, 'files', DEFAULT_FILES_SETTINGS);

  await progress(deps, f.id, 'SCANNING', 10);
  const original = await storage.get(f.storageKey);
  const sum = createHash('sha256').update(original).digest('hex');
  if (sum !== f.sha256) throw new Error('stored object checksum mismatch');

  const verdict = await scanner.scan(original);
  if (verdict.status === 'ERROR') {
    await prisma.fileAsset.update({ where: { id: f.id }, data: { scanStatus: 'ERROR', scanDetail: verdict.detail } });
    throw new Error(`scanner unavailable: ${verdict.detail}`); // fail closed + retry
  }
  if (verdict.status === 'INFECTED') {
    await prisma.fileAsset.update({ where: { id: f.id }, data: { status: 'REJECTED', scanStatus: 'INFECTED', scanDetail: verdict.detail, progress: 100, processingNote: 'Rejected: malware signature detected', retentionUntil: new Date(Date.now() + settings.retentionDays.temp * 86_400_000) } });
    return { status: 'REJECTED', note: 'malware signature detected' };
  }
  await prisma.fileAsset.update({ where: { id: f.id }, data: { scanStatus: verdict.status, scanDetail: verdict.detail } });

  await progress(deps, f.id, 'PROCESSING', 40);
  let note = '';
  const data: Record<string, unknown> = {};
  try {
    if (f.contentType.startsWith('image/')) {
      const img = sharp(original, { limitInputPixels: settings.maxImagePixels, failOn: 'error' });
      const meta = await img.metadata();
      if (!meta.width || !meta.height) throw new FileRejected('IMAGE_INVALID', 'image has no dimensions');
      if (meta.width * meta.height > settings.maxImagePixels) throw new FileRejected('IMAGE_TOO_LARGE', 'image exceeds the pixel limit');
      const out = await sharp(original, { limitInputPixels: settings.maxImagePixels, failOn: 'error' })
        .rotate() // auto-orient, then metadata (EXIF/GPS/ICC) is dropped because withMetadata() is not called
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      const derivedKey = `${f.storageKey}.derived`;
      await storage.put(derivedKey, out.data, 'image/webp');
      Object.assign(data, { derivedKey, derivedType: 'image/webp', derivedSize: BigInt(out.data.length), width: out.info.width, height: out.info.height });
      note = `Image re-encoded to WebP (metadata removed, max 2048px); original kept`;
    } else if (f.contentType === 'application/pdf') {
      const r = await optimisePdf(original);
      if (r.buf) {
        const derivedKey = `${f.storageKey}.derived`;
        await storage.put(derivedKey, r.buf, 'application/pdf');
        Object.assign(data, { derivedKey, derivedType: 'application/pdf', derivedSize: BigInt(r.buf.length) });
      }
      note = r.note;
    } else if (f.contentType === 'text/csv') {
      const text = original.toString('utf8');
      let rows = 0;
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) rows++;
      if (rows > settings.maxCsvRows) throw new FileRejected('CSV_TOO_MANY_ROWS', `CSV has more than ${settings.maxCsvRows} rows`);
      note = `CSV validated (${rows} lines); never executed`;
    }
  } catch (e) {
    if (e instanceof FileRejected || (e instanceof Error && /Input image exceeds pixel limit|unsupported image format|Input buffer contains unsupported/i.test(e.message))) {
      const msg = e instanceof Error ? e.message : 'rejected';
      await prisma.fileAsset.update({ where: { id: f.id }, data: { status: 'REJECTED', progress: 100, processingNote: `Rejected: ${msg}`, retentionUntil: new Date(Date.now() + settings.retentionDays.temp * 86_400_000) } });
      return { status: 'REJECTED', note: msg };
    }
    throw e;
  }
  await prisma.fileAsset.update({ where: { id: f.id }, data: { ...data, status: 'READY', progress: 100, processingNote: note, lastError: null } });
  deps.log?.info({ fileId: f.id, note }, 'file processed');
  return { status: 'READY', note };
}

/** Purge job: remove objects for soft-deleted files past retention, and temp/rejected files past their retention. */
export async function purgeExpiredFiles(deps: Pick<ProcessDeps, 'prisma' | 'storage' | 'log'>, now = new Date()): Promise<{ purged: number; softDeleted: number }> {
  const { prisma, storage } = deps;
  // 1. retention reached -> soft delete (audited by the caller through the returned ids is not needed: system action)
  const expiring = await prisma.fileAsset.findMany({ where: { deletedAt: null, retentionUntil: { lte: now } }, select: { id: true, organizationId: true }, take: 500 });
  for (const e of expiring) {
    await prisma.fileAsset.update({ where: { id: e.id }, data: { deletedAt: now } });
    await prisma.auditLog.create({ data: { id: randomUUID(), organizationId: e.organizationId, actorId: null, action: 'file.retention_expired', entityType: 'file', entityId: e.id, metadata: {} } });
  }
  // 2. soft-deleted for longer than purgeAfterDays -> remove objects
  const doomed = await prisma.fileAsset.findMany({ where: { deletedAt: { not: null }, purgedAt: null }, take: 500 });
  let purged = 0;
  for (const f of doomed) {
    const s: FilesSettings = await getSetting(prisma, f.organizationId, 'files', DEFAULT_FILES_SETTINGS);
    if (f.deletedAt!.getTime() + s.purgeAfterDays * 86_400_000 > now.getTime()) continue;
    await storage.delete(f.storageKey);
    if (f.derivedKey) await storage.delete(f.derivedKey);
    await prisma.fileAsset.update({ where: { id: f.id }, data: { purgedAt: now } });
    await prisma.auditLog.create({ data: { id: randomUUID(), organizationId: f.organizationId, actorId: null, action: 'file.purged', entityType: 'file', entityId: f.id, metadata: {} } });
    purged++;
  }
  return { purged, softDeleted: expiring.length };
}
