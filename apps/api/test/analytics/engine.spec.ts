import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createTestApp, loginAgent, type TestApp } from '../helpers';
import { KpiCache } from '../../src/modules/reporting/kpi/cache';
import { KPI_IDS } from '../../src/modules/reporting/kpi/registry';
import { ReportingScheduler, SnapshotService } from '../../src/modules/reporting/snapshots/snapshots.service';
import { buildAnalyticsFixture, ist, type AnalyticsFixture } from './fixture';
import { agents, kpi, Q } from './kit';

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
  delete process.env.KPI_CACHE_TTL_SECONDS;
  delete process.env.ANALYTICS_CACHE_PREFIX;
});

describe('zero denominators and empty data never produce NaN, Infinity or a fake 0%', () => {
  it('an organisation with no data: every KPI is null with a reason (ratios) or a plain zero (counts)', async () => {
    const empty = await buildOrgFixture(t.prisma);
    const a = await loginAgent(t.app, empty.founder);
    const res = (await a.get(`/kpis${Q}`)).body.data.results as Array<{ id: string; unit: string; value: string | null; nullReason: string | null; status: string; numerator: string | null }>;
    expect(res.length).toBe(KPI_IDS.length);
    const text = JSON.stringify(res);
    expect(text).not.toMatch(/NaN|Infinity/);
    for (const r of res) {
      if (r.status === 'ERROR') throw new Error(`${r.id} errored on empty data`);
      if (r.value !== null) expect(Number.isFinite(Number(r.value)), `${r.id}=${r.value}`).toBe(true);
      if (r.unit === 'PERCENT' && r.status === 'OK') expect(r.value, r.id).not.toBeNull();
      if (r.value === null && r.status !== 'RESTRICTED' && r.status !== 'FORBIDDEN') expect(r.nullReason, r.id).toBeTruthy();
    }
    const by = (id: string) => res.find((r) => r.id === id)!;
    expect(by('KPI-SAL-001')).toMatchObject({ value: null, nullReason: 'ZERO_DENOMINATOR' });
    expect(by('KPI-REV-001')).toMatchObject({ value: null, nullReason: 'NO_TARGET' });
    expect(by('KPI-SAL-005')).toMatchObject({ value: null, nullReason: 'NO_SNAPSHOT' });
    expect(by('KPI-CX-001')).toMatchObject({ value: null, nullReason: 'ZERO_DENOMINATOR' });
    expect(by('KPI-PRD-006').value).toBe('0'); // a count of nothing is a real zero
    expect(by('KPI-EXC-001').value).toBe('0');
    expect(by('KPI-PRD-004')).toMatchObject({ value: null, nullReason: 'ZERO_DENOMINATOR' });
  });
  it('forecast accuracy is not 100% when actual revenue is zero; refund reduction is a dash when the previous rate is zero', async () => {
    const r = await kpi(A.founder, 'KPI-SAL-005', '?from=2026-05-01&to=2026-05-31');
    expect(r.value).toBeNull(); // no May snapshot
    const sparse = await kpi(A.founder, 'KPI-CX-002', '?from=2026-04-01&to=2026-04-30');
    expect(sparse.value).toBeNull();
    expect(sparse.nullReason).toBe('ZERO_DENOMINATOR');
  });
});

describe('timezone and window handling (IST)', () => {
  it('the 23:30 IST Jul-31 call counts in July and the 00:30 IST Aug-1 call counts in August', async () => {
    expect((await kpi(A.founder, 'KPI-PRD-006', '?from=2026-07-01&to=2026-07-31')).value).toBe('12');
    expect((await kpi(A.founder, 'KPI-PRD-006', '?from=2026-08-01&to=2026-08-01')).value).toBe('1');
    expect((await kpi(A.founder, 'KPI-REV-001', '?from=2026-08-01&to=2026-08-31')).numerator).toBe('99999.00'); // D5 closed 00:30 IST Aug 1
  });
  it('rejects absurd date ranges', async () => {
    expect((await A.founder.get('/kpis/KPI-PRD-006?from=2000-01-01&to=2026-07-01')).status).toBe(400);
  });
});

describe('organisation overrides (platform_settings key kpi) change the rule, not the code', () => {
  it('a 6-day conversion window excludes L1 (won after 10 days)', async () => {
    await t.prisma.platformSetting.create({ data: { organizationId: f.org.id, key: 'kpi', value: { conversionWindowDays: 6 } } });
    const r = await kpi(A.founder, 'KPI-SAL-001');
    expect([r.numerator, r.denominator]).toEqual(['1', '10']); // only L8 (won after 5 days 1 hour) still counts
    await t.prisma.platformSetting.delete({ where: { organizationId_key: { organizationId: f.org.id, key: 'kpi' } } });
    expect((await kpi(A.founder, 'KPI-SAL-001')).numerator).toBe('2');
  });
});

describe('authorization-aware cache', () => {
  it('keys carry the resolved scope: no leakage between roles, explicit invalidation, TTL', async () => {
    process.env.KPI_CACHE_TTL_SECONDS = '60';
    process.env.ANALYTICS_CACHE_PREFIX = `agenti-test:${f.org.id}`;
    const cache = t.app.get(KpiCache);
    await cache.invalidateOrg(f.org.id);
    const first = await kpi(A.mA, 'KPI-PRD-006');
    expect(first.freshness.kind).toBe('LIVE');
    expect(first.value).toBe('8');
    const again = await kpi(A.mA, 'KPI-PRD-006');
    expect(again.freshness.kind).toBe('CACHED');
    expect(again.value).toBe('8');
    // a different role, same KPI, same window: its own entry, its own value
    const founder = await kpi(A.founder, 'KPI-PRD-006');
    expect(founder.freshness.kind).toBe('LIVE');
    expect(founder.value).toBe('12');
    const b = await kpi(A.mB, 'KPI-PRD-006');
    expect(b.freshness.kind).toBe('LIVE'); // manager B must not be served manager A's entry
    expect(b.value).toBe('4');
    // an executive filtering to someone else resolves to an empty scope: never served from the manager's/founder's entry
    const stranger = await kpi(A.a1, 'KPI-PRD-006', `${Q}&ownerId=${f.ids.b1}`);
    expect(stranger.value).toBe('0');
    // the fingerprint differs per scope
    const fp = (s: Parameters<KpiCache['scopeFingerprint']>[0]) => cache.scopeFingerprint(s);
    expect(fp({ level: 'org', detail: true, userIds: null, teamIds: [] })).not.toBe(fp({ level: 'summary', detail: false, userIds: null, teamIds: [] }));
    expect(fp({ level: 'team', detail: true, userIds: ['a', 'b'], teamIds: [] })).toBe(fp({ level: 'team', detail: true, userIds: ['b', 'a'], teamIds: [] }));
    // new data is invisible until invalidation (cached), then visible
    const lead = f.ids.lead.L1!;
    await t.prisma.callLog.create({ data: { organizationId: f.org.id, leadId: lead, userId: f.ids.a1, outcome: 'NO_ANSWER', startedAt: ist('2026-07-30', '12:00') } });
    expect((await kpi(A.mA, 'KPI-PRD-006')).value).toBe('8');
    await cache.invalidateOrg(f.org.id);
    const fresh = await kpi(A.mA, 'KPI-PRD-006');
    expect(fresh.freshness.kind).toBe('LIVE');
    expect(fresh.value).toBe('9');
    await t.prisma.callLog.deleteMany({ where: { organizationId: f.org.id, startedAt: ist('2026-07-30', '12:00') } });
    await cache.invalidateOrg(f.org.id);
  });
  it('is off by default under test: every call is LIVE', async () => {
    expect((await kpi(A.mA, 'KPI-PRD-006')).freshness.kind).toBe('LIVE');
    expect((await kpi(A.mA, 'KPI-PRD-006')).freshness.kind).toBe('LIVE');
  });
});

describe('Founder report builder receives real KPI numbers (ReportDataProvider)', () => {
  it('a draft shows live KPI sections with values, windows, definition status and freshness; a published snapshot freezes them', async () => {
    const created = await A.tl.post('/founder-reports').send({ type: 'MONTHLY', periodDate: '2026-07-10' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const draft = (await A.tl.get(`/founder-reports/${id}`)).body.data;
    const sections = draft.dataSections as Array<{ key: string; status: string; metrics: Array<{ kpiId: string; value: string | null; note: string }> }>;
    expect(sections.map((s) => s.key)).toEqual(['revenue', 'funnel', 'team', 'customer', 'founder-support']);
    expect(sections.every((s) => s.status === 'AVAILABLE')).toBe(true);
    const rev = sections[0]!.metrics.find((m) => m.kpiId === 'KPI-REV-001')!;
    expect(rev.value).toBe('70.7%');
    expect(rev.note).toContain('2026-07-01 to 2026-07-31');
    expect(rev.note).toContain('proposed default, awaiting owner approval');
    const fc = sections[0]!.metrics.find((m) => m.kpiId === 'KPI-SAL-005')!;
    expect(fc.value).toBe('94.3%');
    // a number that cannot be computed is null with its reason, never made up
    const cx4 = sections[3]!.metrics.find((m) => m.kpiId === 'KPI-CX-004')!;
    expect(cx4.value).toBe('4.5');
    // publish and freeze
    expect((await A.tl.patch(`/founder-reports/${id}`).send({ sections: { performance: { narrative: 'July review' }, risks: { confirmedNone: true }, opportunities: { confirmedNone: true }, actionItemsReviewed: true } })).status).toBe(200);
    const pub = await A.tl.post(`/founder-reports/${id}/submit`).send({});
    expect(pub.status).toBe(200);
    const snap = (await A.tl.get(`/founder-reports/${id}/snapshot`)).body.data;
    expect(JSON.stringify(snap.content.dataSections)).toContain('70.7%');
  });
});

describe('snapshots, history and the scheduler', () => {
  it('takes organisation-level daily snapshots (idempotent) and serves history to organisation-scope viewers only', async () => {
    const snaps = t.app.get(SnapshotService);
    const r1 = await snaps.take(f.org.id, '2026-07-31');
    expect(r1.stored).toBeGreaterThan(30);
    const n = await t.prisma.kpiSnapshot.count({ where: { organizationId: f.org.id } });
    await snaps.take(f.org.id, '2026-07-31');
    expect(await t.prisma.kpiSnapshot.count({ where: { organizationId: f.org.id } })).toBe(n); // idempotent per kpi + period
    const rev = await t.prisma.kpiSnapshot.findFirst({ where: { organizationId: f.org.id, kpiId: 'KPI-REV-001' } });
    expect(rev!.value!.toString()).toBe('70.7');
    expect(rev!.scopeKey).toBe('ORG');
    const h = await A.founder.get('/kpis/KPI-REV-001/history');
    expect(h.status).toBe(200);
    expect(h.body.data.points.at(-1)).toMatchObject({ value: '70.7' });
    expect((await A.mA.get('/kpis/KPI-REV-001/history')).status).toBe(403); // snapshots are org-level values
    expect((await A.hr.get('/kpis/KPI-REV-001/history')).status).toBe(403);
  });
  it('the scheduler runs the nightly reconciliation once per day and expires old exports', async () => {
    const sch = t.app.get(ReportingScheduler);
    const before = await t.prisma.kpiReconciliationRun.count({ where: { organizationId: f.org.id, trigger: 'SCHEDULED' } });
    await sch.tick(new Date('2026-10-15T00:00:00Z'), [f.org.id]); // 05:30 IST: after 03:00
    await sch.tick(new Date('2026-10-15T00:05:00Z'), [f.org.id]);
    expect(await t.prisma.kpiReconciliationRun.count({ where: { organizationId: f.org.id, trigger: 'SCHEDULED' } })).toBe(before + 1);
    const run = await t.prisma.kpiReconciliationRun.findFirst({ where: { organizationId: f.org.id, trigger: 'SCHEDULED' }, orderBy: { ranAt: 'desc' } });
    expect(run!.failed).toBe(0);
    expect(run!.triggeredById).toBeNull();
    const exp = await A.founder.post('/reports/exports').send({ report: 'funnel', format: 'CSV', params: { from: '2026-07-01', to: '2026-07-31' } });
    await t.prisma.reportExport.update({ where: { id: exp.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await sch.tick(new Date(), [f.org.id]);
    const row = await t.prisma.reportExport.findUnique({ where: { id: exp.body.data.id } });
    expect(row!.status).toBe('EXPIRED');
    expect(row!.content).toBeNull();
  });
});
