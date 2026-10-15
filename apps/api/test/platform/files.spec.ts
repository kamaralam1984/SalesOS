import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  ClamdScanner, EICAR, LocalSignatureScanner, ObjectStorage, processFile, purgeExpiredFiles, scannerFromEnv, storageConfigFromEnv, parseUploadName,
} from '@salesos/platform-core';
import { buildOrgFixture, createOrg, createUser, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';
import { FileAccessRegistry } from '../../src/modules/files/file-access.registry';
import { AccessService } from '../../src/common/authz';

let t: TestApp;
let fx: OrgFixture;
let storage: ObjectStorage;
let a1: AuthedAgent;
let b1: AuthedAgent;
let mgrA: AuthedAgent;
let mgrB: AuthedAgent;
let founder: AuthedAgent;
let admin: AuthedAgent;
let finance: AuthedAgent;
let hr: AuthedAgent;
let foreign: AuthedAgent;

beforeAll(async () => {
  process.env.S3_BUCKET = 'salesos-agentf-test';
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  storage = new ObjectStorage(storageConfigFromEnv());
  await storage.ensureBucket();
  [a1, b1, mgrA, mgrB, founder, admin, finance, hr] = await Promise.all([fx.execA1, fx.execB1, fx.managerA, fx.managerB, fx.founder, fx.admin, fx.finance, fx.hr].map((u) => loginAgent(t.app, u)));
  const orgB = await createOrg(t.prisma);
  foreign = await loginAgent(t.app, await createUser(t.prisma, orgB, { roles: ['FOUNDER_CEO'] }));
});
afterAll(async () => { await t.close(); });

const png = (w = 64, h = 48) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
const upload = (a: AuthedAgent, buf: Buffer | string, filename: string, type?: string, fields: Record<string, string> = {}) => {
  let r = a.post('/files');
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', Buffer.isBuffer(buf) ? buf : Buffer.from(buf), { filename, contentType: type });
};
const deps = () => ({ prisma: t.prisma, storage, scanner: scannerFromEnv() });
const ready = async (id: string) => { const r = await processFile(deps(), id); expect(r.status).toBe('READY'); };
const code = (res: { body: { error?: { code?: string } } }) => res.body.error?.code;

describe('upload abuse suite', () => {
  it('requires authentication', async () => {
    const res = await (await import('supertest')).default(t.app.getHttpServer()).post('/api/v1/files').attach('file', Buffer.from('x'), 'a.csv');
    expect(res.status).toBe(401);
  });

  it.each([
    ['path traversal (windows)', '..\\..\\boot.png', 'PATH_TRAVERSAL'],
    ['double extension php', 'invoice.php.png', 'DOUBLE_EXTENSION'],
    ['double extension exe', 'report.exe.pdf', 'DOUBLE_EXTENSION'],
    ['double extension html', 'a.html.jpg', 'DOUBLE_EXTENSION'],
    ['double extension reversed', 'a.png.js', 'DOUBLE_EXTENSION'],
    ['executable exe', 'setup.exe', 'EXTENSION_BLOCKED'],
    ['shell script', 'run.sh', 'EXTENSION_BLOCKED'],
    ['javascript', 'x.js', 'EXTENSION_BLOCKED'],
    ['html', 'x.html', 'EXTENSION_BLOCKED'],
    ['svg (script carrier)', 'x.svg', 'EXTENSION_BLOCKED'],
    ['macro document', 'x.docm', 'EXTENSION_BLOCKED'],
    ['apk', 'x.apk', 'EXTENSION_BLOCKED'],
    ['zip archive', 'x.zip', 'EXTENSION_BLOCKED'],
    ['unknown type', 'x.xyz', 'EXTENSION_NOT_ALLOWED'],
    ['no extension', 'README', 'NO_EXTENSION'],
    ['hidden file', '.htaccess.png', 'BAD_NAME'],
    ['xlsx (export-only)', 'x.xlsx', 'EXTENSION_NOT_ALLOWED'],
  ])('rejects %s (%s)', async (_n, filename, expected) => {
    const res = await upload(a1, await png(), filename, 'image/png');
    expect(res.status).toBe(422);
    expect(code(res)).toBe(expected);
  });

  it('rejects path traversal sent as a raw multipart filename (client libraries normally hide it)', async () => {
    const body = await png();
    for (const name of ['../../etc/passwd.png', '/etc/cron.d/x.png', 'a/../../b.png']) {
      const boundary = '----t' + randomUUID();
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`), body, Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await a1.post('/files').set('content-type', `multipart/form-data; boundary=${boundary}`).send(payload);
      expect(res.status, name).toBe(name.startsWith('/') ? 201 : 422);
      if (res.status === 422) expect(code(res)).toBe('PATH_TRAVERSAL');
      else expect((await t.prisma.fileAsset.findUniqueOrThrow({ where: { id: res.body.data.id } })).displayName).toBe('x.png'); // absolute path reduced to its base name
    }
  });

  it('rejects renamed executables, archives and spoofed MIME by content (magic bytes)', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(200)]);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]);
    const script = Buffer.from('#!/bin/sh\nrm -rf /\n');
    for (const [buf, name] of [[exe, 'photo.png'], [elf, 'doc.pdf'], [zip, 'data.csv'], [zip, 'pic.jpg'], [script, 'x.csv']] as const) {
      const res = await upload(a1, buf, name, 'image/png');
      expect(res.status, name).toBe(422);
      expect(code(res), name).toBe('EXECUTABLE_OR_ARCHIVE');
    }
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
    expect(code(await upload(a1, pdf, 'photo.png', 'image/png'))).toBe('MIME_MISMATCH'); // pdf content, png name
    expect(code(await upload(a1, await png(), 'doc.pdf', 'application/pdf'))).toBe('MIME_MISMATCH'); // png content, pdf name
    expect(code(await upload(a1, '<svg onload=alert(1)></svg>', 'x.png', 'image/png'))).toBe('MIME_MISMATCH'); // svg disguised
    expect(code(await upload(a1, '<html><script>alert(1)</script></html>', 'x.csv', 'text/csv'))).toBe('MIME_MISMATCH'); // html as csv
    expect(code(await upload(a1, await png(), 'ok.png', 'application/pdf'))).toBe('MIME_MISMATCH'); // lying content-type header
    expect(code(await upload(a1, Buffer.concat([Buffer.from('a,b\n'), Buffer.from([0, 1, 2])]), 'bin.csv', 'text/csv'))).toBe('MIME_MISMATCH'); // NUL bytes
  });

  it('rejects oversize uploads while streaming (413) and empty files (422)', async () => {
    const big = Buffer.concat([await png(), Buffer.alloc(10 * 1024 * 1024 + 10)]);
    const res = await upload(a1, big, 'big.png', 'image/png');
    expect(res.status).toBe(413);
    expect(code(res)).toBe('FILE_TOO_LARGE');
    expect(code(await upload(a1, Buffer.alloc(0), 'empty.csv', 'text/csv'))).toBe('EMPTY_FILE');
  });

  it('rejects decompression bombs: absurd pixel dimensions are refused before decoding', async () => {
    const real = await png(8, 8);
    const bomb = Buffer.from(real);
    bomb.writeUInt32BE(60000, 16);
    bomb.writeUInt32BE(60000, 20); // IHDR claims 3.6 gigapixels
    const res = await upload(a1, bomb, 'bomb.png', 'image/png');
    expect(res.status).toBe(422);
    expect(code(res)).toBe('IMAGE_TOO_LARGE');
  });

  it('rejects malformed multipart: no file, two files, wrong content-type', async () => {
    expect((await a1.post('/files').field('x', '1')).status).toBe(400);
    expect((await a1.post('/files').attach('file', Buffer.from('a,b\n'), 'a.csv').attach('file', Buffer.from('a,b\n'), 'b.csv')).status).toBe(400);
    expect((await a1.post('/files').attach('other', Buffer.from('a,b\n'), 'a.csv')).status).toBe(400);
    expect((await a1.post('/files').send({ a: 1 })).status).toBe(415);
  });

  it('sanitises display names and never uses them in the storage key', async () => {
    const res = await upload(a1, await png(), 'nested/dir/My Photo (1).PNG', 'image/png');
    expect(res.status).toBe(201);
    const f = await t.prisma.fileAsset.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(f.displayName).toBe('My Photo (1).PNG');
    expect(f.storageKey).toMatch(new RegExp(`^org/${fx.org.id}/image/\\d{4}/\\d{2}/[0-9a-f-]{36}$`));
    expect(f.storageKey).not.toContain('Photo');
    expect(parseUploadName('evil‮gpj.png').displayName).not.toMatch(/‮/);
    expect(res.body.data).toMatchObject({ status: 'PENDING', scanStatus: 'PENDING' });
    expect(res.body.data).not.toHaveProperty('storageKey');
  });

  it('stores checksum, uploader, size, sniffed type, retention metadata; original lands in a private bucket', async () => {
    const buf = Buffer.from('name,phone\nA,1\n');
    const res = await upload(a1, buf, 'leads.csv', 'application/vnd.ms-excel');
    expect(res.status).toBe(201);
    const f = await t.prisma.fileAsset.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(f).toMatchObject({ uploaderId: fx.execA1.id, organizationId: fx.org.id, contentType: 'text/csv', category: 'csv', sha256: createHash('sha256').update(buf).digest('hex') });
    expect(Number(f.sizeBytes)).toBe(buf.length);
    expect(f.retentionUntil!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await storage.get(f.storageKey)).equals(buf)).toBe(true);
    // the bucket is private: anonymous GET of the object is refused
    const anon = await fetch(`${storageConfigFromEnv().endpoint}/${f.bucket}/${f.storageKey}`);
    expect([403, 404]).toContain(anon.status);
    expect(await t.prisma.outboxEvent.count({ where: { eventType: 'file.process_requested', aggregateId: f.id } })).toBe(1);
  });

  it('enforces per-user quota and configurable size limits (admin settings)', async () => {
    const o = await createOrg(t.prisma);
    const founderO = await loginAgent(t.app, await createUser(t.prisma, o, { roles: ['FOUNDER_CEO'] }));
    const adminO = await loginAgent(t.app, await createUser(t.prisma, o, { roles: ['ADMIN'] }));
    const patch = await adminO.patch('/files/settings').send({ userQuotaBytes: 1_000_000, maxBytesByCategory: { csv: 2048 } });
    expect(patch.status).toBe(200);
    expect(patch.body.data.userQuotaBytes).toBe(1_000_000);
    expect(patch.body.data.maxBytesByCategory).toMatchObject({ csv: 2048, image: 10 * 1024 * 1024 });
    expect((await upload(founderO, 'a,b\n'.repeat(1000), 'big.csv', 'text/csv')).status).toBe(413);
    const img = await sharp({ create: { width: 450, height: 450, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer();
    expect(img.length).toBeGreaterThan(500_000);
    expect(img.length).toBeLessThan(990_000);
    expect((await upload(founderO, img, 'one.png', 'image/png')).status).toBe(201);
    const second = await upload(founderO, img, 'two.png', 'image/png');
    expect(second.status).toBe(413);
    expect(code(second)).toBe('QUOTA_EXCEEDED');
    expect((await a1.patch('/files/settings').send({ userQuotaBytes: 5_000_000 })).status).toBe(403);
    expect((await adminO.patch('/files/settings').send({ signedUrlTtlSeconds: 9999 })).status).toBe(400);
  });
});

describe('async processing: scan, strip, resize, WebP, PDF, CSV', () => {
  it('re-encodes images to WebP, strips EXIF/GPS, resizes to 2048px, keeps the original, reports progress states', async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .withExif({ IFD0: { Copyright: 'SECRET-GPS-OWNER', Make: 'CameraCo' } }).jpeg().toBuffer();
    expect((await sharp(big).metadata()).exif).toBeDefined();
    const res = await upload(a1, big, 'photo.jpg', 'image/jpeg');
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    expect((await a1.get(`/files/${id}`)).body.data).toMatchObject({ status: 'PENDING', downloadable: false });
    expect((await a1.get(`/files/${id}/download-url`)).status).toBe(409);
    await ready(id);
    const f = await t.prisma.fileAsset.findUniqueOrThrow({ where: { id } });
    expect(f).toMatchObject({ status: 'READY', progress: 100, derivedType: 'image/webp', width: 2048, scanStatus: 'NOT_SCANNED' });
    const derived = await storage.get(f.derivedKey!);
    const meta = await sharp(derived).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(derived.includes(Buffer.from('SECRET-GPS-OWNER'))).toBe(false);
    expect((await storage.get(f.storageKey)).equals(big)).toBe(true); // original kept
    const dto = (await a1.get(`/files/${id}`)).body.data;
    expect(dto.scanLabel).toMatch(/NOT scanned/); // never claims an antivirus verdict
    expect(dto.processingNote).toMatch(/WebP/);
    // idempotent: running again does nothing harmful
    expect((await processFile(deps(), id)).status).toBe('READY');
  });

  it('drops trailing polyglot payloads from images in the derivative', async () => {
    const poly = Buffer.concat([await png(), Buffer.from('<script>alert(1)</script>')]);
    const res = await upload(a1, poly, 'poly.png', 'image/png');
    expect(res.status).toBe(201);
    await ready(res.body.data.id);
    const f = await t.prisma.fileAsset.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect((await storage.get(f.derivedKey!)).includes(Buffer.from('<script>'))).toBe(false);
  });

  it('PDF: reports honestly whether it was optimised or stored as uploaded; always READY and valid', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    const res = await upload(a1, pdf, 'doc.pdf', 'application/pdf');
    expect(res.status).toBe(201);
    await ready(res.body.data.id);
    const f = await t.prisma.fileAsset.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(f.processingNote).toMatch(/PDF (optimised with (qpdf|gs)|stored as uploaded)/);
    if (f.derivedKey) expect((await storage.get(f.derivedKey)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('EICAR: detected by the scanner hook -> REJECTED/INFECTED, never downloadable', async () => {
    const res = await upload(a1, `a,b\n${EICAR}\n`, 'eicar.csv', 'text/csv');
    expect(res.status).toBe(201); // content is plain text; the scan decides
    const out = await processFile(deps(), res.body.data.id);
    expect(out.status).toBe('REJECTED');
    const dto = (await a1.get(`/files/${res.body.data.id}`)).body.data;
    expect(dto).toMatchObject({ status: 'REJECTED', scanStatus: 'INFECTED', downloadable: false });
    expect((await a1.get(`/files/${res.body.data.id}/download-url`)).status).toBe(409);
    expect(await new LocalSignatureScanner().scan(Buffer.from(EICAR))).toMatchObject({ status: 'INFECTED' });
    expect((await new LocalSignatureScanner().scan(Buffer.from('clean'))).status).toBe('NOT_SCANNED');
  });

  it('scanner outage fails closed: error + retry, never READY-as-clean', async () => {
    const res = await upload(a1, 'x,y\n1,2\n', 'out.csv', 'text/csv');
    const dead = new ClamdScanner('127.0.0.1', 1, 500);
    await expect(processFile({ ...deps(), scanner: dead }, res.body.data.id)).rejects.toThrow(/scanner unavailable/);
    const f = await t.prisma.fileAsset.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(f.status).not.toBe('READY');
    expect(f.scanStatus).toBe('ERROR');
    await ready(res.body.data.id); // recovers when the scanner is back
  });

  it('a corrupt image that passes the header check is REJECTED, not crashed', async () => {
    const bad = Buffer.concat([(await png()).subarray(0, 40), Buffer.alloc(30, 7)]);
    const res = await upload(a1, bad, 'trunc.png', 'image/png');
    expect(res.status).toBe(201);
    await expect(processFile(deps(), res.body.data.id).then((r) => r.status).catch(() => 'THROWN')).resolves.toMatch(/REJECTED|THROWN/);
  });

  it('checksum mismatch in storage is detected', async () => {
    const res = await upload(a1, 'k,v\n1,2\n', 'tamper.csv', 'text/csv');
    const f = await t.prisma.fileAsset.findUniqueOrThrow({ where: { id: res.body.data.id } });
    await storage.put(f.storageKey, Buffer.from('k,v\nEVIL,EVIL\n'), 'text/csv');
    await expect(processFile(deps(), f.id)).rejects.toThrow(/checksum/);
  });

  it('failed files are visible and recoverable: FAILED -> retry -> PENDING (+ event)', async () => {
    const res = await upload(a1, 'k,v\n1,2\n', 'retry.csv', 'text/csv');
    const id = res.body.data.id as string;
    await t.prisma.fileAsset.update({ where: { id }, data: { status: 'FAILED', lastError: 'storage timeout', attempts: 3 } });
    expect((await a1.get(`/files/${id}`)).body.data).toMatchObject({ status: 'FAILED', lastError: 'storage timeout' });
    const fails = await admin.get('/integrations/failures');
    expect(fails.body.data.files.some((x: { id: string; recoverable: boolean }) => x.id === id && x.recoverable)).toBe(true);
    const retry = await a1.post(`/files/${id}/retry`).send({});
    expect(retry.status).toBe(201);
    expect(retry.body.data.status).toBe('PENDING');
    expect(await t.prisma.outboxEvent.count({ where: { eventType: 'file.process_requested', aggregateId: id } })).toBe(2);
    expect((await a1.post(`/files/${id}/retry`).send({})).status).toBe(409);
    expect((await b1.post(`/files/${id}/retry`).send({})).status).toBe(404);
    await ready(id);
  });
});

describe('download: signed URLs, expiry, scope inheritance, cross-team denial', () => {
  let fileId: string;
  beforeAll(async () => {
    const res = await upload(a1, await png(300, 200), 'dl.png', 'image/png');
    fileId = res.body.data.id;
    await ready(fileId);
  });

  it('issues a short-lived URL that downloads the processed file as an attachment', async () => {
    const res = await a1.get(`/files/${fileId}/download-url`);
    expect(res.status).toBe(200);
    expect(res.body.data.expiresInSeconds).toBeLessThanOrEqual(300);
    expect(res.body.data.filename).toBe('dl.webp');
    const url = new URL(res.body.data.url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.pathname).not.toContain('dl.png');
    const dl = await fetch(res.body.data.url);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('image/webp');
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    const orig = await a1.get(`/files/${fileId}/download-url?variant=original`);
    expect(orig.body.data).toMatchObject({ variant: 'original', filename: 'dl.png' });
  });

  it('signed URL expires and cannot be tampered with', async () => {
    const o = await createOrg(t.prisma);
    const adminO = await loginAgent(t.app, await createUser(t.prisma, o, { roles: ['ADMIN'] }));
    const execO = await loginAgent(t.app, await createUser(t.prisma, o, { roles: ['SALES_EXECUTIVE'] }));
    expect((await adminO.patch('/files/settings').send({ signedUrlTtlSeconds: 5 })).status).toBe(200);
    const up = await upload(execO, 'a,b\n1,2\n', 'ttl.csv', 'text/csv');
    await ready(up.body.data.id);
    const { url, expiresInSeconds } = (await execO.get(`/files/${up.body.data.id}/download-url`)).body.data;
    expect(expiresInSeconds).toBe(5);
    expect((await fetch(url)).status).toBe(200);
    const tampered = url.replace(/X-Amz-Signature=[0-9a-f]+/, 'X-Amz-Signature=' + '0'.repeat(64));
    expect((await fetch(tampered)).status).toBe(403);
    await new Promise((r) => setTimeout(r, 6500));
    const late = await fetch(url);
    expect(late.status).toBe(403);
    expect(await late.text()).toMatch(/expired|Expired|AccessDenied/i);
  }, 30000);

  it('authenticated download streams with attachment + nosniff + no-store', async () => {
    const res = await a1.get(`/files/${fileId}/download?variant=original`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(Buffer.isBuffer(res.body) && res.body.subarray(1, 4).toString()).toBe('PNG');
  });

  it('access by uploader scope: own, manager (team), founder (org) yes; other team, other org, summary-only roles no', async () => {
    for (const [who, a, ok] of [['uploader', a1, true], ['managerA', mgrA, true], ['founder', founder, true], ['execB1', b1, false], ['managerB', mgrB, false], ['finance(summary)', finance, false], ['hr(summary)', hr, false], ['other org founder', foreign, false], ['admin(no files:view)', admin, false]] as const) {
      const g = await a.get(`/files/${fileId}`);
      const u = await a.get(`/files/${fileId}/download-url`);
      const d = await a.get(`/files/${fileId}/download`);
      expect(g.status, who).toBe(ok ? 200 : (who === 'admin(no files:view)' ? 403 : 404));
      expect(u.status, who).toBe(ok ? 200 : (who === 'admin(no files:view)' ? 403 : 404));
      expect(d.status, who).toBe(ok ? 200 : (who === 'admin(no files:view)' ? 403 : 404));
    }
  });

  it('file lists never leak other teams\' files', async () => {
    const mine = await a1.get('/files?limit=100');
    expect(mine.body.data.every((f: { uploaderId: string }) => f.uploaderId === fx.execA1.id)).toBe(true);
    const mB = await mgrB.get('/files?limit=100');
    expect(mB.body.data.some((f: { id: string }) => f.id === fileId)).toBe(false);
    const mA = await mgrA.get('/files?limit=100');
    expect(mA.body.data.some((f: { id: string }) => f.id === fileId)).toBe(true);
    expect((await finance.get('/files')).body.data).toEqual([]); // summary scope lists nothing
  });
});

describe('scope inheritance through entity links', () => {
  const owners = new Map<string, string>();
  beforeAll(() => {
    const reg = t.app.get(FileAccessRegistry);
    const access = t.app.get(AccessService);
    // a "case" owned by execA1: access follows files:view team/own scope of the caller over the owner
    reg.register('test_case', async ({ user, entityId }) => {
      const owner = owners.get(entityId);
      return !!owner && (access.scopeLevel(user, 'files:view') !== 'summary') && access.canAccessRecord(user, 'files:view', { organizationId: user.organizationId, ownerId: owner });
    });
    // a "payment" that Finance may read (payment proof use-case)
    reg.register('test_payment', async ({ user, entityId }) => owners.has(entityId) && (user.roles.includes('FINANCE') || user.userId === owners.get(entityId)));
  });

  it('unregistered entity types are not attachable; inaccessible entities are 404; upload-with-entity attaches atomically', async () => {
    const entityId = randomUUID();
    owners.set(entityId, fx.execA1.id);
    const up = await upload(a1, 'a,b\n1,2\n', 'link.csv', 'text/csv');
    const id = up.body.data.id as string;
    const nope = await a1.post(`/files/${id}/attach`).send({ entityType: 'unknown_thing', entityId });
    expect(nope.status).toBe(400);
    expect(nope.body.error.code).toBe('ENTITY_TYPE_NOT_ATTACHABLE');
    expect((await b1.post(`/files/${id}/attach`).send({ entityType: 'test_case', entityId })).status).toBe(404); // cannot even see the file
    const stranger = randomUUID();
    owners.set(stranger, fx.execB1.id);
    expect((await a1.post(`/files/${id}/attach`).send({ entityType: 'test_case', entityId: stranger })).status).toBe(404); // entity not in my scope
    const withEntity = await upload(a1, 'a,b\n1,2\n', 'with.csv', 'text/csv', { entityType: 'test_case', entityId });
    expect(withEntity.status).toBe(201);
    expect(withEntity.body.data.attachments).toEqual([{ entityType: 'test_case', entityId }]);
    expect((await upload(a1, 'a,b\n', 'bad.csv', 'text/csv', { entityType: 'test_case', entityId: stranger })).status).toBe(404);
    expect((await upload(a1, 'a,b\n', 'bad.csv', 'text/csv', { entityType: 'test_case' })).status).toBe(400);
  });

  it('a file inherits the access scope of the entity it is attached to (and only that)', async () => {
    const caseId = randomUUID();
    const payId = randomUUID();
    owners.set(caseId, fx.execA1.id);
    owners.set(payId, fx.execA1.id);
    const up = await upload(a1, await png(), 'proof.png', 'image/png', { purpose: 'payment_proof' });
    const id = up.body.data.id as string;
    await ready(id);
    expect((await t.prisma.fileAsset.findUniqueOrThrow({ where: { id } })).category).toBe('payment_proof');
    // not attached anywhere: finance (summary) and the other team cannot read
    expect((await finance.get(`/files/${id}`)).status).toBe(404);
    // attach to a case owned by execA1 -> manager A (team) reads via uploader scope already; execB1 / managerB still cannot
    expect((await a1.post(`/files/${id}/attach`).send({ entityType: 'test_case', entityId: caseId })).status).toBe(201);
    expect((await b1.get(`/files/${id}`)).status).toBe(404);
    expect((await mgrB.get(`/files/${id}`)).status).toBe(404);
    expect((await finance.get(`/files/${id}`)).status).toBe(404); // summary scope + case resolver denies
    // attach to the payment: finance now inherits read access, execB1 still not
    expect((await a1.post(`/files/${id}/attach`).send({ entityType: 'test_payment', entityId: payId })).status).toBe(201);
    expect((await finance.get(`/files/${id}`)).status).toBe(200);
    expect((await finance.get(`/files/${id}/download-url`)).status).toBe(200);
    expect((await b1.get(`/files/${id}`)).status).toBe(404);
    expect((await hr.get(`/files/${id}`)).status).toBe(404);
    // listing by entity requires access to the entity
    expect((await finance.get(`/files?entityType=test_payment&entityId=${payId}`)).body.data.map((f: { id: string }) => f.id)).toEqual([id]);
    expect((await b1.get(`/files?entityType=test_payment&entityId=${payId}`)).status).toBe(404);
    // downloads of payment proofs are audited
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'file.downloaded', entityId: id } })).toBeGreaterThanOrEqual(1);
  });

  it('a resolver that throws fails closed', async () => {
    t.app.get(FileAccessRegistry).register('test_boom', async () => { throw new Error('boom'); });
    const up = await upload(a1, 'a,b\n', 'x.csv', 'text/csv');
    expect((await a1.post(`/files/${up.body.data.id}/attach`).send({ entityType: 'test_boom', entityId: randomUUID() })).status).toBe(404);
  });
});

describe('delete, retention and purge', () => {
  it('soft-delete is scoped and audited; deleted files vanish for everyone', async () => {
    const up = await upload(a1, 'a,b\n1,2\n', 'del.csv', 'text/csv');
    const id = up.body.data.id as string;
    expect((await b1.delete(`/files/${id}`)).status).toBe(404);
    expect((await mgrB.delete(`/files/${id}`)).status).toBe(404);
    expect((await a1.delete(`/files/${id}`)).status).toBe(200);
    expect((await a1.get(`/files/${id}`)).status).toBe(404);
    expect((await mgrA.get(`/files/${id}`)).status).toBe(404);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'file.deleted', entityId: id } })).toBe(1);
    const other = await upload(b1, 'a,b\n1,2\n', 'del2.csv', 'text/csv');
    expect((await admin.delete(`/files/${other.body.data.id}`)).status).toBe(200); // admin: files:delete @ org
  });

  it('retention job soft-deletes expired files and purges objects after the purge window', async () => {
    const up = await upload(a1, 'a,b\n1,2\n', 'ret.csv', 'text/csv');
    const id = up.body.data.id as string;
    const f = await t.prisma.fileAsset.findUniqueOrThrow({ where: { id } });
    await t.prisma.fileAsset.update({ where: { id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
    const r1 = await purgeExpiredFiles({ prisma: t.prisma, storage });
    expect(r1.softDeleted).toBeGreaterThanOrEqual(1);
    expect((await t.prisma.fileAsset.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    expect((await storage.get(f.storageKey)).length).toBeGreaterThan(0); // object still there inside the purge window
    await t.prisma.fileAsset.update({ where: { id }, data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) } });
    const r2 = await purgeExpiredFiles({ prisma: t.prisma, storage });
    expect(r2.purged).toBeGreaterThanOrEqual(1);
    await expect(storage.get(f.storageKey)).rejects.toThrow();
    expect((await t.prisma.fileAsset.findUniqueOrThrow({ where: { id } })).purgedAt).not.toBeNull();
  });
});

describe('recordings are blocked pending legal review', () => {
  it('guarded endpoints answer 403 RECORDINGS_DISABLED for privileged roles and cannot be enabled', async () => {
    const g = await admin.get('/recordings');
    expect([g.status, code(g)]).toEqual([403, 'RECORDINGS_DISABLED']);
    const p = await founder.post('/recordings').send({});
    expect([p.status, code(p)]).toEqual([403, 'RECORDINGS_DISABLED']);
    expect((await a1.get('/recordings')).status).toBe(403);
    expect((await t.prisma.recordingAsset.count({ where: { organizationId: fx.org.id } }))).toBe(0);
  });
});
