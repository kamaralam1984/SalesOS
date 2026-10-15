import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { directDeps, processImportJob } from '@salesos/crm-core';
import { crmKit, uniq, uniqPhone, type CrmKit } from './kit';

let k: CrmKit;
beforeAll(async () => { k = await crmKit(); });
afterAll(async () => { await k.close(); });

const deps = directDeps();
const csvOf = (rows: string[][], header = ['Name', 'Phone', 'Email', 'Interest']) => [header, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
const upload = (who: typeof k.a.managerA, csv: string, query = '', key?: string) => {
  const req = who.post(`/leads/import${query}`).set('Content-Type', 'text/csv');
  return (key ? req.set('Idempotency-Key', key) : req).send(csv);
};
const run = (jobId: string) => processImportJob(k.t.prisma, deps, jobId, { workerId: 'test' });

describe('CSV import', () => {
  it('previews mapping and problems without creating anything', async () => {
    const csv = csvOf([[uniq('A'), uniqPhone(), '', 'HIGH']]);
    const r = await k.a.managerA.post('/leads/import/preview').set('Content-Type', 'text/csv').send(csv);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ totalRows: 1, problems: [] });
    expect(r.body.data.mapping.fullName).toBe(0);
    const bad = await k.a.managerA.post('/leads/import/preview').set('Content-Type', 'text/csv').send('foo,bar\n1,2');
    expect(bad.body.data.problems.join(' ')).toMatch(/name column/);
  });

  it('runs asynchronously: QUEUED + outbox event on upload, worker processes with progress, row-level errors and a downloadable report', async () => {
    const good = [uniq('Good'), uniqPhone()];
    const rows = [
      [good[0]!, good[1]!, 'good@example.com', 'HIGH'],
      ['', uniqPhone(), '', ''], // missing name
      [uniq('NoContact'), '', '', ''], // missing phone+email
      [uniq('BadEmail'), uniqPhone(), 'not-an-email', ''],
      [uniq('BadInterest'), uniqPhone(), '', 'EXTREME'],
      [uniq('RawPhone'), '12ab', '', ''], // flagged raw, still imported with a warning
    ];
    const up = await upload(k.a.managerA, csvOf(rows), '?fileName=leads.csv');
    expect(up.status).toBe(201);
    const jobId = up.body.data.id as string;
    expect(up.body.data).toMatchObject({ status: 'QUEUED', totalRows: 6, processedRows: 0 });
    expect(await k.t.prisma.outboxEvent.count({ where: { eventType: 'import.requested', aggregateId: jobId } })).toBe(1);
    expect(await k.t.prisma.lead.count({ where: { importJobId: jobId } })).toBe(0); // nothing happens in the request

    const res = await run(jobId);
    expect(res.status).toBe('COMPLETED_WITH_ERRORS');
    const job = await k.a.managerA.get(`/leads/import/${jobId}`);
    expect(job.body.data).toMatchObject({ status: 'COMPLETED_WITH_ERRORS', totalRows: 6, processedRows: 6, createdRows: 2, errorRows: 4, progressPercent: 100 });
    const errs = await k.a.managerA.get(`/leads/import/${jobId}/errors?includeWarnings=false`);
    expect(errs.body.data.map((e: { rowNumber: number; code: string }) => [e.rowNumber, e.code])).toEqual([[3, 'MISSING_NAME'], [4, 'MISSING_CONTACT'], [5, 'INVALID_EMAIL'], [6, 'INVALID_INTEREST']]);
    expect(errs.body.data[0].severity).toBe('ERROR');
    expect(errs.body.data[0].rawRow.Phone).toBeTruthy();
    const all = await k.a.managerA.get(`/leads/import/${jobId}/errors`);
    expect(all.body.data.some((e: { code: string; severity: string }) => e.code === 'WARN_PHONE_FLAGGED' && e.severity === 'WARNING')).toBe(true);
    const csv = await k.a.managerA.get(`/leads/import/${jobId}/errors?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe('row,severity,code,field,message,original_values');
    expect(csv.text).toContain('MISSING_NAME');
    const created = await k.t.prisma.lead.findMany({ where: { importJobId: jobId } });
    expect(created).toHaveLength(2);
    expect(created.find((l) => l.fullName === good[0])?.phoneE164).toMatch(/^\+91/);
    expect(created.every((l) => l.createdById === k.fx.managerA.id)).toBe(true);
  });

  it('IDEMPOTENT: re-uploading the same file (or retrying with the same key) returns the same job and creates 0 new rows', async () => {
    const csv = csvOf([[uniq('Idem1'), uniqPhone(), '', ''], [uniq('Idem2'), uniqPhone(), '', '']]);
    const a = await upload(k.a.managerA, csv);
    const jobId = a.body.data.id as string;
    await run(jobId);
    expect(await k.t.prisma.lead.count({ where: { importJobId: jobId } })).toBe(2);
    const b = await upload(k.a.managerA, csv); // same content hash
    expect(b.body.data.id).toBe(jobId);
    expect(b.body.meta.idempotentReplay).toBe(true);
    const keyed1 = await upload(k.a.managerA, csv, '', 'my-key');
    const keyed2 = await upload(k.a.managerA, csv, '', 'my-key');
    expect(keyed2.body.data.id).toBe(keyed1.body.data.id);
    await run(keyed1.body.data.id);
    await run(jobId); // already complete: no-op
    expect(await k.t.prisma.importJob.count({ where: { organizationId: k.fx.org.id, id: { in: [jobId, keyed1.body.data.id] } } })).toBe(2);
    // a retry of the completed job only fills what is missing => still 2 rows for the job
    const retry = await k.a.founder.post(`/leads/import/${jobId}/retry`).send({});
    expect(retry.status).toBe(200);
    await run(jobId);
    expect(await k.t.prisma.lead.count({ where: { importJobId: jobId } })).toBe(2);
    expect(await k.t.prisma.lead.count({ where: { organizationId: k.fx.org.id, importRowKey: { startsWith: `${jobId}:` } } })).toBe(2);
  });

  it('flags duplicates inside the file and against existing leads instead of merging or dropping them', async () => {
    const phone = uniqPhone();
    const existing = await k.a.execA1.post('/leads').send({ fullName: '[TEST] Existing', phone });
    expect(existing.status).toBe(201);
    const csv = csvOf([['[TEST] Same Person', phone, '', ''], ['[TEST] Same Person', phone, '', '']]);
    const up = await upload(k.a.managerA, csv);
    await run(up.body.data.id);
    const job = await k.a.managerA.get(`/leads/import/${up.body.data.id}`);
    expect(job.body.data.createdRows).toBe(2);
    expect(job.body.data.duplicateRows).toBe(2);
    const cands = await k.t.prisma.duplicateCandidate.findMany({ where: { organizationId: k.fx.org.id, status: 'OPEN', OR: [{ lead: { phoneE164: `+91${phone}` } }] } });
    expect(cands.length).toBeGreaterThanOrEqual(3); // existing-vs-row1, existing-vs-row2, row1-vs-row2
    expect(cands.every((c) => c.matchType === 'PHONE_EXACT')).toBe(true);
  });

  it('assignment options: fixed assignee (validated against the team scope) and round-robin', async () => {
    const outside = await upload(k.a.managerA, csvOf([[uniq('X'), uniqPhone(), '', '']]), `?options=${encodeURIComponent(JSON.stringify({ assignment: 'user', assigneeId: k.fx.execB1.id }))}`);
    expect(outside.status).toBe(404);
    const inside = await upload(k.a.managerA, csvOf([[uniq('X'), uniqPhone(), '', ''], [uniq('Y'), uniqPhone(), '', '']]), `?options=${encodeURIComponent(JSON.stringify({ assignment: 'user', assigneeId: k.fx.execA2.id }))}`);
    expect(inside.status).toBe(201);
    await run(inside.body.data.id);
    const leads = await k.t.prisma.lead.findMany({ where: { importJobId: inside.body.data.id } });
    expect(leads.every((l) => l.assignedToId === k.fx.execA2.id)).toBe(true);
    expect(await k.t.prisma.leadAssignment.count({ where: { leadId: { in: leads.map((l) => l.id) }, method: 'IMPORT' } })).toBe(2);
    const rr = await upload(k.a.managerA, csvOf([[uniq('R'), uniqPhone(), '', '']]), `?options=${encodeURIComponent(JSON.stringify({ assignment: 'round_robin' }))}`);
    expect(rr.status).toBe(201);
  });

  it('validates the upload: empty, no rows, unsupported type, oversized rows, JSON body works for small files', async () => {
    expect((await upload(k.a.managerA, '')).status).toBe(422);
    expect((await upload(k.a.managerA, 'Name,Phone')).status).toBe(422);
    expect((await k.a.managerA.post('/leads/import').set('Content-Type', 'application/xml').send('<a/>')).status).toBe(415);
    const json = await k.a.managerA.post('/leads/import').send({ fileName: 'small.csv', csv: csvOf([[uniq('J'), uniqPhone(), '', '']]), options: {} });
    expect(json.status).toBe(201);
  });

  it('visibility: managers see their own jobs; another team manager and executives cannot read them', async () => {
    const up = await upload(k.a.managerA, csvOf([[uniq('V'), uniqPhone(), '', '']]));
    const id = up.body.data.id as string;
    expect((await k.a.managerA.get(`/leads/import/${id}`)).status).toBe(200);
    expect((await k.a.managerB.get(`/leads/import/${id}`)).status).toBe(404);
    expect((await k.a.managerB.get(`/leads/import/${id}/errors`)).status).toBe(404);
    expect((await k.a.execA1.get(`/leads/import/${id}`)).status).toBe(403);
    expect((await k.a.founder.get(`/leads/import/${id}`)).status).toBe(200);
    const list = await k.a.managerB.get('/leads/import');
    expect(list.body.data.some((j: { id: string }) => j.id === id)).toBe(false);
  });

  it('a failed job can be retried by an admin/founder after the cause is fixed', async () => {
    const up = await upload(k.a.managerA, csvOf([[uniq('Retry'), uniqPhone(), '', '']]));
    const id = up.body.data.id as string;
    await k.t.prisma.importJob.update({ where: { id }, data: { status: 'FAILED', lastError: 'boom' } });
    expect((await k.a.managerA.post(`/leads/import/${id}/retry`).send({})).status).toBe(403);
    const r = await k.a.admin.post(`/leads/import/${id}/retry`).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('QUEUED');
    expect((await run(id)).status).toBe('COMPLETED');
  });
});
