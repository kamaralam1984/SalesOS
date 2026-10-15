import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, importOptionsSchema, parseCsv, previewCsv, resolveTeamId, toCsv, type ImportField, type Tx } from '@salesos/crm-core';
import { CRM_EVENTS } from '@salesos/shared-types';
import type { Prisma } from '@prisma/client';
import { importJsonBodySchema, importOptionsInputSchema, importRawQuerySchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { CrmSupport } from '../crm.support';

export interface RawImport {
  csv: string;
  fileName: string | null;
  options: ReturnType<typeof importOptionsInputSchema.parse>;
}

/** Reads a bounded raw text/csv (or JSON) body. Bodies >100kb are not parsed by the global JSON parser. */
export async function readImportBody(req: Request): Promise<RawImport> {
  const ctype = (req.headers['content-type'] ?? '').toLowerCase();
  if (ctype.includes('application/json')) {
    const parsed = importJsonBodySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    return { csv: parsed.data.csv, fileName: parsed.data.fileName ?? null, options: parsed.data.options };
  }
  if (!ctype.includes('text/csv') && !ctype.includes('text/plain')) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send the file as text/csv or JSON {csv, options}', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_IMPORT_BYTES) {
        reject(new AppError('PAYLOAD_TOO_LARGE', `CSV exceeds ${MAX_IMPORT_BYTES / 1024 / 1024} MB`, 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  const q = importRawQuerySchema.safeParse(req.query);
  if (!q.success) throw new AppError('VALIDATION_ERROR', 'Invalid query', 400);
  let options: RawImport['options'];
  try {
    options = importOptionsInputSchema.parse(q.data.options ? JSON.parse(q.data.options) : {});
  } catch {
    throw new AppError('VALIDATION_ERROR', 'options must be valid JSON matching the import options schema', 400);
  }
  return { csv: Buffer.concat(chunks).toString('utf8'), fileName: q.data.fileName ?? null, options };
}

@Injectable()
export class ImportsService {
  constructor(private readonly s: CrmSupport) {}

  preview(raw: RawImport) {
    if (!raw.csv.trim()) throw new AppError('VALIDATION_ERROR', 'The file is empty', 422);
    return previewCsv(raw.csv, raw.options.mapping as Partial<Record<ImportField, string>>, raw.options.template);
  }

  async create(user: Principal, raw: RawImport, headerKey?: string) {
    if (!raw.csv.trim()) throw new AppError('VALIDATION_ERROR', 'The file is empty', 422);
    const options = importOptionsSchema.parse(raw.options);
    const prev = previewCsv(raw.csv, options.mapping, options.template);
    if (prev.problems.length) throw new AppError('VALIDATION_ERROR', prev.problems.join('; '), 422, prev.problems);
    if (prev.totalRows === 0) throw new AppError('VALIDATION_ERROR', 'The file has no data rows', 422);
    if (prev.totalRows > MAX_IMPORT_ROWS) throw new AppError('VALIDATION_ERROR', `Too many rows (max ${MAX_IMPORT_ROWS})`, 422);
    const org = user.organizationId;
    if (options.sourceId && !(await this.s.prisma.leadSource.findFirst({ where: { id: options.sourceId, organizationId: org } }))) throw new AppError('VALIDATION_ERROR', 'Unknown lead source', 422);
    if (options.programId && !(await this.s.prisma.program.findFirst({ where: { id: options.programId, organizationId: org } }))) throw new AppError('VALIDATION_ERROR', 'Unknown program', 422);
    const teamId = await resolveTeamId(this.s.prisma as unknown as Tx, org, user.userId);
    if (options.assignment === 'user') {
      if (!options.assigneeId) throw new AppError('VALIDATION_ERROR', 'assigneeId is required for assignment=user', 422);
      await this.s.assertAssignable(user, 'leads:import', options.assigneeId);
    }
    if (options.assignment === 'round_robin' && !teamId) throw new AppError('VALIDATION_ERROR', 'Round-robin import needs the importer to belong to a team', 422);
    // Idempotency: an explicit header, else a content hash (same file + same options + same user => same job).
    const hash = createHash('sha256').update(raw.csv).update(JSON.stringify(options)).digest('hex');
    const key = headerKey ? `hdr:${headerKey.slice(0, 120)}` : `auto:${hash}`;
    const existing = await this.s.prisma.importJob.findFirst({ where: { organizationId: org, createdById: user.userId, idempotencyKey: key } });
    if (existing) return ok(this.ser(existing), { warnings: ['An identical import already exists; returning it (no rows were duplicated)'], idempotentReplay: true });
    try {
      const job = await this.s.tx(async (tx) => {
        const j = await tx.importJob.create({ data: { organizationId: org, createdById: user.userId, teamId, idempotencyKey: key, fileName: raw.fileName, totalRows: prev.totalRows, options: options as unknown as Prisma.InputJsonValue, rawCsv: raw.csv } });
        await this.s.deps.audit(tx, { organizationId: org, actorId: user.userId, action: 'import.created', entityType: 'import_job', entityId: j.id, metadata: { rows: prev.totalRows, fileName: raw.fileName, assignment: options.assignment } });
        await this.s.deps.publish(tx, { eventType: CRM_EVENTS.IMPORT_REQUESTED, aggregateType: 'import_job', aggregateId: j.id, organizationId: org, payload: { jobId: j.id }, idempotencyKey: `import.requested:${j.id}:0` });
        return j;
      });
      return ok(this.ser(job));
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const ex = await this.s.prisma.importJob.findFirst({ where: { organizationId: org, idempotencyKey: key } });
        if (ex && ex.createdById === user.userId) return ok(this.ser(ex), { idempotentReplay: true });
        throw new AppError('IDEMPOTENCY_CONFLICT', 'This idempotency key was used by someone else', 409);
      }
      throw e;
    }
  }

  private ser(j: { id: string; status: string; fileName: string | null; totalRows: number; processedRows: number; createdRows: number; duplicateRows: number; skippedRows: number; errorRows: number; attempts: number; lastError: string | null; createdById: string; createdAt: Date; startedAt: Date | null; finishedAt: Date | null }) {
    return {
      id: j.id,
      status: j.status,
      fileName: j.fileName,
      totalRows: j.totalRows,
      processedRows: j.processedRows,
      progressPercent: j.totalRows ? Math.min(100, Math.round((j.processedRows / j.totalRows) * 100)) : 0,
      createdRows: j.createdRows,
      duplicateRows: j.duplicateRows,
      skippedRows: j.skippedRows,
      errorRows: j.errorRows,
      attempts: j.attempts,
      lastError: j.lastError,
      createdById: j.createdById,
      createdAt: j.createdAt.toISOString(),
      startedAt: j.startedAt?.toISOString() ?? null,
      finishedAt: j.finishedAt?.toISOString() ?? null,
    };
  }

  private async load(user: Principal, id: string, permission: 'imports:view' | 'imports:manage') {
    const job = await this.s.prisma.importJob.findFirst({ where: { id, organizationId: user.organizationId } });
    await this.s.access.assertRecordAccess(user, permission, job && { organizationId: job.organizationId, ownerId: job.createdById, teamId: job.teamId }, 'Import job');
    return job!;
  }

  async list(user: Principal, q: { limit?: number; cursor?: string; page?: number }) {
    const where = await this.s.access.scopedWhere(user, { permission: 'imports:view', ownerField: 'createdById', teamField: 'teamId' });
    const rows = await this.s.prisma.importJob.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return ok((res.data as typeof rows).map((j) => this.ser(j)), res.meta);
  }

  async get(user: Principal, id: string) {
    return this.ser(await this.load(user, id, 'imports:view'));
  }

  async errors(user: Principal, id: string, q: { limit?: number; cursor?: string; page?: number; includeWarnings?: boolean }) {
    await this.load(user, id, 'imports:view');
    const where: Prisma.ImportErrorWhereInput = { jobId: id, ...(q.includeWarnings === false ? { NOT: { code: { startsWith: 'WARN_' } } } : {}) };
    const rows = await this.s.prisma.importError.findMany({ where, orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return ok((res.data as typeof rows).map((e) => ({ id: e.id, rowNumber: e.rowNumber, severity: e.code.startsWith('WARN_') ? 'WARNING' : 'ERROR', code: e.code, field: e.field, message: e.message, rawRow: e.rawRow })), res.meta);
  }

  /** Full downloadable report (CSV): one line per error/warning with the original row values. */
  async errorsCsv(user: Principal, id: string): Promise<string> {
    await this.load(user, id, 'imports:view');
    const rows = await this.s.prisma.importError.findMany({ where: { jobId: id }, orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }], take: 50_000 });
    return toCsv([['row', 'severity', 'code', 'field', 'message', 'original_values'], ...rows.map((e) => [e.rowNumber, e.code.startsWith('WARN_') ? 'WARNING' : 'ERROR', e.code, e.field, e.message, JSON.stringify(e.rawRow)])]);
  }

  async retry(user: Principal, id: string) {
    const job = await this.load(user, id, 'imports:manage');
    if (['QUEUED', 'RUNNING'].includes(job.status) && (!job.lockedUntil || job.lockedUntil > new Date())) throw new AppError('INVALID_STATE', 'The import is still running', 409);
    if (!job.rawCsv) throw new AppError('INVALID_STATE', 'The original file is no longer stored; upload it again', 409);
    const updated = await this.s.tx(async (tx) => {
      // rows already created are protected by import_row_key: the retry only creates what is missing
      await tx.importError.deleteMany({ where: { jobId: id } });
      const j = await tx.importJob.update({ where: { id }, data: { status: 'QUEUED', processedRows: 0, lastError: null, finishedAt: null, lockedUntil: null } });
      await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'import.retried', entityType: 'import_job', entityId: id, metadata: { attempt: j.attempts + 1 } });
      await this.s.deps.publish(tx, { eventType: CRM_EVENTS.IMPORT_REQUESTED, aggregateType: 'import_job', aggregateId: id, organizationId: user.organizationId, payload: { jobId: id }, idempotencyKey: `import.requested:${id}:${j.attempts + 1}` });
      return j;
    });
    return this.ser(updated);
  }
}

export { notFound, parseCsv };
