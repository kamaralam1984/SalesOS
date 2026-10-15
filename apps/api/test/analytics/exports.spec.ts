import ExcelJS from 'exceljs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createUser, createTestApp, loginAgent, anonymous, type TestApp } from '../helpers';
import { ExportRunner } from '../../src/modules/reporting/exports/exports.service';
import { neutralise, toCsv } from '../../src/modules/reporting/exports/writers';
import { buildAnalyticsFixture, type AnalyticsFixture } from './fixture';
import { agents, Q } from './kit';

let t: TestApp;
let f: AnalyticsFixture;
let A: Awaited<ReturnType<typeof agents>>;

beforeAll(async () => {
  t = await createTestApp();
  f = await buildAnalyticsFixture(t.prisma);
  A = await agents(t, f);
}, 120_000);
afterAll(async () => t.close());
afterEach(() => {
  delete process.env.EXPORT_MAX_ROWS_CSV;
  delete process.env.EXPORT_SYNC_ROWS;
});

const body = { report: 'team-performance', format: 'CSV', params: { from: '2026-07-01', to: '2026-07-31' } };
const csvOf = async (a: typeof A.founder, id: string) => {
  const r = await a.get(`/reports/exports/${id}/download`).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  return r;
};

describe('POST /reports/exports', () => {
  it('creates a CSV, downloads it, and audits create / complete / download with filters and row count', async () => {
    const res = await A.founder.post('/reports/exports').send(body);
    expect(res.status).toBe(201);
    const e = res.body.data;
    expect(e).toMatchObject({ status: 'READY', format: 'CSV', report: 'team-performance', scopeLevel: 'org', truncated: false, downloadable: true });
    expect(e.rowCount).toBeGreaterThanOrEqual(7);
    expect(e.appliedFilters).toMatchObject({ window: { from: '2026-07-01', to: '2026-07-31' } });
    const dl = await csvOf(A.founder, e.id);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('text/csv');
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['cache-control']).toContain('no-store');
    const text = (dl.body as Buffer).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM for Excel
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toContain('Revenue (net)');
    expect(lines.length - 1).toBe(e.rowCount);
    expect(text).toContain(f.execA1.name);

    const audits = await t.prisma.auditLog.findMany({ where: { organizationId: f.org.id, entityId: e.id }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual(['export.created', 'export.completed', 'export.downloaded']);
    expect(audits[0]!.actorId).toBe(f.founder.id);
    expect(audits[0]!.metadata).toMatchObject({ report: 'team-performance', format: 'CSV', scopeLevel: 'org', filters: { window: { from: '2026-07-01' } } });
    expect(audits[1]!.metadata).toMatchObject({ rowCount: e.rowCount, truncated: false });
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain('+9199');
  });

  it('creates an XLSX with the report sheet and an About sheet listing scope, filters and definitions', async () => {
    const res = await A.founder.post('/reports/exports').send({ ...body, report: 'revenue', format: 'XLSX', params: { from: '2026-07-01', to: '2026-07-31', by: 'program' } });
    expect(res.status).toBe(201);
    const dl = await csvOf(A.founder, res.body.data.id);
    expect(dl.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((dl.body as Buffer) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Report', 'About']);
    const ws = wb.getWorksheet('Report')!;
    expect(ws.getRow(1).values).toEqual(expect.arrayContaining(['Program', 'Net revenue']));
    const rows = ws.getRows(2, ws.rowCount - 1)!.map((r) => r.values as unknown[]);
    expect(rows.some((r) => r.includes(162000))).toBe(true); // CBAX net revenue, numeric cell
    const about = wb.getWorksheet('About')!;
    const text = about.getRows(1, about.rowCount)!.map((r) => (r.values as unknown[]).join(' | ')).join('\n');
    expect(text).toContain('Scope level applied by the server | org');
    expect(text).toContain('KPI-REV-001');
    expect(text).toContain('Empty cells');
  });

  it('is permission-checked on the server: executives, HR and Admin are refused, nothing is queued', async () => {
    const before = await t.prisma.reportExport.count({ where: { organizationId: f.org.id } });
    for (const who of [A.a1, A.hr, A.admin]) expect((await who.post('/reports/exports').send(body)).status, who.user.email).toBe(403);
    expect((await anonymous(t.app).post('/reports/exports').send(body)).status).toBe(401);
    expect(await t.prisma.reportExport.count({ where: { organizationId: f.org.id } })).toBe(before);
  });

  it('respects the report permissions too: Finance may export revenue (summary scope, owner names hidden) but not team performance', async () => {
    expect((await A.finance.post('/reports/exports').send({ ...body, report: 'team-performance' })).status).toBe(403);
    const ok = await A.finance.post('/reports/exports').send({ ...body, report: 'revenue', params: { from: '2026-07-01', to: '2026-07-31', by: 'owner' } });
    expect(ok.status).toBe(201);
    expect(ok.body.data.scopeLevel).toBe('summary');
    const text = ((await csvOf(A.finance, ok.body.data.id)).body as Buffer).toString('utf8');
    expect(text).not.toContain(f.execA1.name);
    expect(text).toContain('Hidden');
  });

  it('a manager export contains only their team (scope is applied server side and recorded)', async () => {
    const res = await A.mA.post('/reports/exports').send({ ...body, params: { ...body.params, ownerId: f.ids.b1 } }); // a filter outside scope must not widen it
    expect(res.status).toBe(201);
    const text = ((await csvOf(A.mA, res.body.data.id)).body as Buffer).toString('utf8');
    expect(text).not.toContain(f.execB1.name);
    expect(res.body.data.rowCount).toBe(0);
    const own = await A.mA.post('/reports/exports').send(body);
    const t2 = ((await csvOf(A.mA, own.body.data.id)).body as Buffer).toString('utf8');
    expect(t2).toContain(f.execA1.name);
    expect(t2).not.toContain(f.execB1.name);
    expect(own.body.data.scopeLevel).toBe('team');
  });

  it('validates input strictly', async () => {
    expect((await A.founder.post('/reports/exports').send({ ...body, format: 'PDF' })).status).toBe(400);
    expect((await A.founder.post('/reports/exports').send({ ...body, report: 'salaries' })).status).toBe(400);
    expect((await A.founder.post('/reports/exports').send({ ...body, extra: 1 })).status).toBe(400);
    expect((await A.founder.post('/reports/exports').send({ ...body, maxRows: 0 })).status).toBe(400);
  });
});

describe('row caps and large exports', () => {
  it('stops at the row cap and says so (truncated = true, in the record and in the audit)', async () => {
    process.env.EXPORT_MAX_ROWS_CSV = '3';
    const res = await A.founder.post('/reports/exports').send(body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'READY', rowCount: 3, rowCap: 3, truncated: true });
    const text = ((await csvOf(A.founder, res.body.data.id)).body as Buffer).toString('utf8');
    expect(text.trim().split('\r\n').length).toBe(4);
    const audit = await t.prisma.auditLog.findFirst({ where: { entityId: res.body.data.id, action: 'export.completed' } });
    expect(audit!.metadata).toMatchObject({ rowCount: 3, truncated: true });
  });

  it('large exports are queued and produced by the background runner (claim with lease), then downloadable', async () => {
    process.env.EXPORT_SYNC_ROWS = '2';
    const res = await A.founder.post('/reports/exports').send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('QUEUED');
    expect((await A.founder.get(`/reports/exports/${res.body.data.id}/download`)).status).toBe(409); // not ready yet
    const done = await t.app.get(ExportRunner).tick();
    expect(done).toBeGreaterThanOrEqual(1);
    const st = (await A.founder.get(`/reports/exports/${res.body.data.id}`)).body.data;
    expect(st.status).toBe('READY');
    expect(st.rowCount).toBeGreaterThanOrEqual(7);
    expect((await csvOf(A.founder, res.body.data.id)).status).toBe(200);
    expect(await t.app.get(ExportRunner).tick()).toBe(0); // idempotent: nothing left to claim
  });

  it('permission is re-checked when the queued file is generated: a deactivated requester gets nothing', async () => {
    process.env.EXPORT_SYNC_ROWS = '1';
    const u = await createUser(t.prisma, f.org, { roles: ['SALES_MANAGER'], managerId: f.ids.tl });
    const agent = await loginAgent(t.app, u);
    const res = await agent.post('/reports/exports').send({ ...body, report: 'conversions' });
    expect(res.status).toBe(201);
    if (res.body.data.status === 'QUEUED') {
      await t.prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
      await t.app.get(ExportRunner).tick();
      const row = await t.prisma.reportExport.findUnique({ where: { id: res.body.data.id } });
      expect(row!.status).toBe('FAILED');
      expect(row!.error).toMatch(/no longer active/);
      expect(row!.content).toBeNull();
    }
  });
});

describe('download authorisation', () => {
  it('only the requester can read an export; others get 404, anonymous 401, expired 410', async () => {
    const res = await A.founder.post('/reports/exports').send(body);
    const id = res.body.data.id as string;
    expect((await A.tl.get(`/reports/exports/${id}/download`)).status).toBe(404);
    expect((await A.tl.get(`/reports/exports/${id}`)).status).toBe(404);
    expect((await anonymous(t.app).get(`/reports/exports/${id}/download`)).status).toBe(401);
    const list = (await A.founder.get('/reports/exports')).body.data as Array<{ id: string }>;
    expect(list.some((x) => x.id === id)).toBe(true);
    expect(((await A.tl.get('/reports/exports')).body.data as Array<{ id: string }>).some((x) => x.id === id)).toBe(false);
    await t.prisma.reportExport.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await A.founder.get(`/reports/exports/${id}/download`)).status).toBe(410);
  });
});

describe('spreadsheet injection', () => {
  it('neutralises formulas in text cells (CSV and XLSX)', () => {
    expect(neutralise('=HYPERLINK("http://evil")')).toBe('\'=HYPERLINK("http://evil")');
    expect(neutralise('+1+1')).toBe("'+1+1");
    expect(neutralise('-2')).toBe("'-2");
    expect(neutralise('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralise('Asha Rao')).toBe('Asha Rao');
    const csv = toCsv({ columns: [{ key: 'n', label: 'Name', type: 'text' }, { key: 'v', label: 'Value', type: 'number' }], rows: [{ n: '=cmd|\' /C calc\'!A0', v: -5 }, { n: 'a,"b"', v: null }] }).toString('utf8');
    expect(csv).toContain("'=cmd|");
    expect(csv).toContain('"a,""b"""'); // RFC 4180 quoting
    expect(csv).toContain(',-5'); // numbers are not mangled
  });
  it('a hostile user name never becomes a live formula in an export', async () => {
    await createUser(t.prisma, f.org, { roles: ['SALES_EXECUTIVE'], managerId: f.ids.mB, name: '=1+1' });
    const res = await A.founder.post('/reports/exports').send(body);
    const text = ((await csvOf(A.founder, res.body.data.id)).body as Buffer).toString('utf8');
    expect(text).not.toMatch(/(^|,|\r\n)=1\+1/);
    expect(text).toContain("'=1+1");
  });
});

describe('saved filters', () => {
  it('are per user, validated, and never widen scope when applied', async () => {
    const created = await A.mA.post('/reports/saved-filters').send({ name: 'Other team', target: 'team-performance', filters: { ownerId: f.ids.b1 }, isDefault: true });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await A.mA.get('/reports/saved-filters?target=team-performance')).body.data.map((x: { id: string }) => x.id)).toContain(id);
    expect(((await A.mB.get('/reports/saved-filters')).body.data as Array<{ id: string }>).some((x) => x.id === id)).toBe(false);
    expect((await A.mB.delete(`/reports/saved-filters/${id}`)).status).toBe(404);
    expect((await A.mA.post('/reports/saved-filters').send({ name: 'Other team', target: 'team-performance', filters: {} })).status).toBe(409);
    expect((await A.mA.post('/reports/saved-filters').send({ name: 'x', target: 'Bad Target', filters: {} })).status).toBe(400);
    const applied = (await A.mA.get(`/reports/team-performance${Q}&ownerId=${f.ids.b1}`)).body.data; // applying the saved filter
    expect(applied.rows).toEqual([]);
    expect((await A.mA.delete(`/reports/saved-filters/${id}`)).status).toBe(200);
  });
});
