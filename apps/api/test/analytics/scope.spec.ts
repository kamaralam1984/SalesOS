import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createTestApp, loginAgent, type TestApp } from '../helpers';
import { buildAnalyticsFixture, type AnalyticsFixture } from './fixture';
import { agents, kpi } from './kit';

let t: TestApp;
let f: AnalyticsFixture;
let A: Awaited<ReturnType<typeof agents>>;

beforeAll(async () => {
  t = await createTestApp();
  f = await buildAnalyticsFixture(t.prisma);
  A = await agents(t, f);
}, 120_000);
afterAll(async () => t.close());

const Q = '?from=2026-07-01&to=2026-07-31';

describe('Manager A sees only their own team (hand-computed from the fixture)', () => {
  it('revenue / collections / team KPIs', async () => {
    const r = await kpi(A.mA, 'KPI-REV-001');
    expect([r.numerator, r.denominator, r.value]).toEqual(['140000.00', '150000.00', '93.3']); // A1 110,000 + A2 30,000 ; manager A target (children are not double counted)
    expect(r.filters.scopeLevel).toBe('team');
    const c = await kpi(A.mA, 'KPI-REV-002');
    expect([c.value, c.numerator, c.nullReason]).toEqual([null, '110000.00', 'NO_TARGET']); // 60,000 + 50,000 verified; no collection target allocated to the team -> dash, not 0%
    expect(c.value).toBeNull();
    const t1 = await kpi(A.mA, 'KPI-TEA-001');
    expect([t1.numerator, t1.denominator, t1.value]).toEqual(['93.3', '1', '93.3']);
    const t2 = await kpi(A.mA, 'KPI-TEA-002');
    expect([t2.numerator, t2.denominator, t2.value]).toEqual(['180.4', '2', '90.2']); // (137.5 + 42.9)/2
    const avg = await kpi(A.mA, 'KPI-SAL-004');
    expect([avg.numerator, avg.denominator, avg.value]).toEqual(['150000.00', '2', '75000']);
    const fc = await kpi(A.mA, 'KPI-SAL-005');
    expect(fc.value).toBeNull();
    expect(fc.nullReason).toBe('NO_SNAPSHOT'); // org forecasts are not the manager's forecast
  });
  it('CRM / productivity KPIs', async () => {
    const c = await kpi(A.mA, 'KPI-SAL-001');
    expect([c.numerator, c.denominator, c.value]).toEqual(['1', '6', '16.7']); // L1-L6 (L7 not eligible) ; L1 won
    const w = await kpi(A.mA, 'KPI-SAL-002');
    expect([w.numerator, w.denominator, w.value]).toEqual(['1', '2', '50.0']);
    const d = await kpi(A.mA, 'KPI-SAL-003');
    expect([d.numerator, d.denominator, d.value]).toEqual(['1', '1', '100.0']);
    const calls = await kpi(A.mA, 'KPI-PRD-001');
    expect(calls.value).toBe('7');
    expect(calls.breakdown).toMatchObject({ callAttempts: 8, connectedCalls: 4, uniqueClientsCalled: 6 });
    const fu = await kpi(A.mA, 'KPI-PRD-002');
    expect([fu.value, fu.numerator, fu.denominator]).toEqual(['3', '2', '5']);
    expect((fu.breakdown as { onTimePct: string }).onTimePct).toBe('40.0');
    expect((await kpi(A.mA, 'KPI-EXC-001')).value).toBe('0'); // the unassigned lead is not in the manager's scope
    expect((await kpi(A.mA, 'KPI-EXC-002')).value).toBe('0');
    expect((await kpi(A.mA, 'KPI-EXC-003')).value).toBe('2');
    expect((await kpi(A.mA, 'KPI-EXC-004')).value).toBe('7'); // L1-L7
    const comp = await kpi(A.mA, 'KPI-PRD-003');
    expect([comp.numerator, comp.denominator, comp.value]).toEqual(['2', '3', '66.7']);
    const p = await kpi(A.mA, 'KPI-TEA-003');
    expect([p.value, p.numerator, p.denominator]).toEqual(['0.1', '7', '54']);
  });
  it('people / CX KPIs', async () => {
    expect((await kpi(A.mA, 'KPI-TEA-006')).numerator).toBe('135'); // 60 + 45 + one 30-min 1:1 held by manager A
    const sop = await kpi(A.mA, 'KPI-PRO-001');
    expect([sop.numerator, sop.denominator, sop.value]).toEqual(['3', '5', '60.0']);
    const csat = await kpi(A.mA, 'KPI-CX-001');
    expect([csat.numerator, csat.denominator, csat.value]).toEqual(['16', '4', '4.0']);
    expect(csat.caution).toMatch(/Only 4 responses/);
    const refund = await kpi(A.mA, 'KPI-CX-002');
    expect([refund.numerator, refund.denominator, refund.value]).toEqual(['0.0', '100.0', '0.0']); // P1: July 1/1 vs June 1/1 -> no reduction
    expect((await kpi(A.mA, 'KPI-CX-003')).denominator).toBe('3'); // complaints opened in July owned by A1/A2: #1, #2, #6 (#4 closed as invalid)
  });
  it('HR-grade aggregates are restricted below organisation scope; Founder-only KPIs are forbidden', async () => {
    for (const id of ['KPI-TEA-004', 'KPI-TEA-005', 'KPI-PRO-002']) {
      const r = (await A.mA.get(`/kpis?ids=${id}&from=2026-07-01&to=2026-07-31`)).body.data.results[0];
      expect(r.status, id).toBe('RESTRICTED');
      expect(r.value).toBeNull();
    }
    const fnd = (await A.mA.get('/kpis?ids=KPI-FND-002,KPI-FND-003&from=2026-07-01&to=2026-07-31')).body.data.results;
    expect(fnd.map((r: { status: string }) => r.status)).toEqual(['FORBIDDEN', 'FORBIDDEN']);
    expect((await A.mA.get('/kpis/KPI-FND-002' + Q)).status).toBe(403);
  });
});

describe('Executive sees only their own work', () => {
  it('Exec A1 / A2 numbers', async () => {
    const r = await kpi(A.a1, 'KPI-REV-001');
    expect([r.numerator, r.denominator, r.value]).toEqual(['110000.00', '80000.00', '137.5']); // 100,000 + 20,000 (40% of D3) - 10,000 refund ; values above 100 are allowed
    const calls = await kpi(A.a1, 'KPI-PRD-001');
    expect(calls.value).toBe('4');
    expect(calls.breakdown).toMatchObject({ callAttempts: 5, connectedCalls: 2, uniqueClientsCalled: 4 }); // 5 attempts on 4 clients
    const conv = await kpi(A.a1, 'KPI-SAL-001');
    expect([conv.numerator, conv.denominator, conv.value]).toEqual(['1', '4', '25.0']);
    expect((await kpi(A.a2, 'KPI-REV-001')).value).toBe('42.9'); // 30,000 / 70,000
    expect((await kpi(A.a1, 'KPI-TEA-002')).value).toBe('137.5');
  });
  it('an executive cannot read peers, other teams, or organisation-only KPIs', async () => {
    const other = await kpi(A.a1, 'KPI-PRD-006', `${Q}&ownerId=${f.ids.b1}`);
    expect(other.value).toBe('0'); // intersect with own scope = nothing, never B1's 2 attempts
    const team = await kpi(A.a1, 'KPI-PRD-006', `${Q}&teamId=${f.ids.tB}`);
    expect(team.value).toBe('0');
    expect((await A.a1.get('/kpis/KPI-TEA-004' + Q)).body.data.status).toBe('RESTRICTED');
    expect((await A.a1.get('/kpis/KPI-SAL-005' + Q)).status).toBe(403); // no forecasts:view
    expect((await A.a1.get('/reports/team-performance' + Q)).body.data.rows.map((r: { name: string }) => r.name)).toEqual([f.execA1.name]);
  });
});

describe('filters can only narrow scope', () => {
  it('manager A: filtering to another team or to a stranger yields nothing, filtering to own team changes nothing', async () => {
    expect((await kpi(A.mA, 'KPI-PRD-006', `${Q}&teamId=${f.ids.tB}`)).value).toBe('0');
    expect((await kpi(A.mA, 'KPI-PRD-006', `${Q}&ownerId=${f.ids.b2}`)).value).toBe('0');
    expect((await kpi(A.mA, 'KPI-PRD-006', `${Q}&teamId=${f.ids.tA}`)).value).toBe('8');
    expect((await kpi(A.mA, 'KPI-PRD-006', `${Q}&ownerId=${f.ids.a2}`)).value).toBe('3');
    const nar = await kpi(A.mA, 'KPI-SAL-001', `${Q}&ownerId=${f.ids.b1}`);
    expect([nar.value, nar.nullReason, nar.denominator]).toEqual([null, 'ZERO_DENOMINATOR', '0']);
  });
  it('founder: team filter narrows to that team (same numbers manager A sees)', async () => {
    expect((await kpi(A.founder, 'KPI-PRD-006', `${Q}&teamId=${f.ids.tA}`)).value).toBe('8');
    expect((await kpi(A.founder, 'KPI-REV-001', `${Q}&ownerId=${f.ids.a1}`)).numerator).toBe('110000.00');
  });
  it('program and source filters apply to the cohort', async () => {
    const s1 = await kpi(A.founder, 'KPI-SAL-001', `${Q}&sourceId=${f.ids.sources.S1}`);
    expect([s1.numerator, s1.denominator, s1.value]).toEqual(['2', '6', '33.3']); // Meta Ads: L1,L2,L5,L8,L10,L12 ; L1, L8 won
    const p1 = await kpi(A.founder, 'KPI-SAL-001', `${Q}&programId=${f.ids.programs.P1}`);
    expect([p1.numerator, p1.denominator, p1.value]).toEqual(['2', '6', '33.3']); // CBAX: L1,L2,L4,L5,L8,L12
    const rev = await kpi(A.founder, 'KPI-REV-001', `${Q}&programId=${f.ids.programs.P2}`);
    expect(rev.numerator).toBe('50000.00'); // only D3
    expect(rev.filters.applied).toEqual({ programId: f.ids.programs.P2 });
  });
  it('a filter a KPI does not support is reported as ignored, never silently applied', async () => {
    const r = await kpi(A.founder, 'KPI-TEA-004', `${Q}&programId=${f.ids.programs.P2}`);
    expect(r.filters.ignored).toContain('programId');
    expect(r.filters.applied).toEqual({});
  });
  it('invalid or unknown query parameters are rejected, not ignored', async () => {
    expect((await A.founder.get('/kpis/KPI-REV-001?teamId=not-a-uuid')).status).toBe(400);
    expect((await A.founder.get('/kpis/KPI-REV-001?scope=org')).status).toBe(400);
    expect((await A.founder.get('/kpis/KPI-REV-001?from=2026-07-31&to=2026-07-01')).status).toBe(400);
    expect((await A.founder.get('/kpis/KPI-NOPE-001')).status).toBe(404);
  });
});

describe('cross-organisation isolation and secondary roles', () => {
  it('another organisation sees none of this data, and cannot use this organisation ids as filters', async () => {
    const other = await buildOrgFixture(t.prisma);
    const o = await loginAgent(t.app, other.founder);
    expect((await o.get('/kpis/KPI-PRD-006' + Q)).body.data.value).toBe('0');
    expect((await o.get('/kpis/KPI-REV-001' + Q)).body.data.nullReason).toBe('NO_TARGET');
    expect((await o.get(`/kpis/KPI-PRD-006${Q}&teamId=${f.ids.tA}`)).body.data.value).toBe('0');
    expect((await o.get(`/kpis/KPI-PRD-006${Q}&ownerId=${f.ids.a1}`)).body.data.value).toBe('0');
    const dash = (await o.get('/dashboard/ceo' + Q)).body.data;
    expect(JSON.stringify(dash)).not.toContain(f.org.id);
    expect(JSON.stringify(dash)).not.toContain(f.execA1.name);
  });
  it('Admin has no business data: no KPI values, no business dashboards, definitions only', async () => {
    expect((await A.admin.get('/kpis' + Q)).status).toBe(403);
    expect((await A.admin.get('/kpis/KPI-REV-001' + Q)).status).toBe(403);
    expect((await A.admin.get('/dashboard/ceo')).status).toBe(403);
    expect((await A.admin.get('/dashboard/team-lead')).status).toBe(403);
    expect((await A.admin.get('/dashboard/manager')).status).toBe(403);
    expect((await A.admin.get('/reports/revenue')).status).toBe(403);
    expect((await A.admin.get('/reports/follow-ups')).status).toBe(403);
    expect((await A.admin.get('/kpis/definitions')).status).toBe(200);
    const health = await A.admin.get('/dashboard/admin');
    expect(health.status).toBe(200);
    expect(health.body.data.businessData).toBe(false);
    const text = JSON.stringify(health.body.data);
    for (const word of ['lead', 'revenue', 'deal', 'refund', 'complaint', 'salary']) expect(text.toLowerCase(), word).not.toContain(`"${word}`);
  });
  it('Finance (summary scope) gets organisation aggregates but no per-person rows', async () => {
    const r = await kpi(A.finance, 'KPI-REV-002');
    expect(r.value).toBe('104.7');
    expect(r.filters.scopeLevel).toBe('summary');
    const rev = (await A.finance.get('/reports/revenue?from=2026-07-01&to=2026-07-31&by=owner')).body.data;
    expect(rev.meta.detailWithheld).toBe(false); // revenue is not person-level by program ...
    expect(rev.rows.every((row: { group: string }) => row.group === 'Hidden')).toBe(true); // ... but owner names are withheld at summary scope
    const t2 = await kpi(A.finance, 'KPI-TEA-002');
    expect(JSON.stringify(t2.breakdown)).not.toContain(f.execA1.name);
    expect((await A.finance.get('/reports/team-performance' + Q)).status).toBe(403);
  });
  it('HR sees the attrition and engagement aggregates but not revenue detail', async () => {
    expect((await kpi(A.hr, 'KPI-TEA-004')).value).toBe('23.5');
    expect((await kpi(A.hr, 'KPI-TEA-005')).value).toBe('84');
    expect((await A.hr.get('/kpis/KPI-PRD-006' + Q)).status).toBe(403); // no calls:view
  });
});
