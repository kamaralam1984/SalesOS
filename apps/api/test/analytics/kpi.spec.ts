import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers';
import { buildAnalyticsFixture, type AnalyticsFixture } from './fixture';
import { agents, kpi } from './kit';
import { KPI_IDS } from '../../src/modules/reporting/kpi/registry';

/**
 * Every expected value below is HAND-COMPUTED from test/analytics/fixture.ts (July 2026, IST). The comment next to each assertion shows the arithmetic.
 */
let t: TestApp;
let f: AnalyticsFixture;
let A: Awaited<ReturnType<typeof agents>>;

beforeAll(async () => {
  t = await createTestApp();
  f = await buildAnalyticsFixture(t.prisma);
  A = await agents(t, f);
}, 120_000);
afterAll(async () => t.close());

const v = (r: { value: string | null }) => r.value;

describe('registry', () => {
  it('has every dictionary KPI (33) plus the Blueprint call/forecast extras, all with full definitions', async () => {
    expect(KPI_IDS.length).toBeGreaterThanOrEqual(38);
    const defs = (await A.admin.get('/kpis/definitions')).body.data as Array<Record<string, unknown>>;
    expect(defs.length).toBe(KPI_IDS.length);
    for (const d of defs) {
      for (const k of ['id', 'name', 'definition', 'numerator', 'denominator', 'window', 'exclusions', 'tables', 'rounding', 'owner', 'refresh', 'zeroDenominator', 'formula', 'implementation', 'approvalStatus']) expect(d[k], `${d.id}.${k}`).toBeTruthy();
      expect(d.approvalStatus).toBe('PROPOSED_DEFAULT_AWAITING_OWNER_APPROVAL');
    }
  });
});

describe('Founder (organisation scope): every KPI reconciles to the fixture', () => {
  it('KPI-REV-001: (225,000 booked net of adjustments - 13,000 approved refunds) / 300,000 target', async () => {
    const r = await kpi(A.founder, 'KPI-REV-001');
    expect(r.numerator).toBe('212000.00'); // 100,000 + (60,000-5,000) + 50,000 + 20,000 - 10,000 - 3,000 ; D5 (00:30 IST Aug 1) excluded
    expect(r.denominator).toBe('300000.00');
    expect(r.value).toBe('70.7'); // 212000/300000 = 70.666..
    expect(r.currency).toBe('INR');
    expect(r.dateRange).toMatchObject({ from: '2026-07-01', to: '2026-07-31', timezone: 'Asia/Kolkata' });
    expect(r.freshness.kind).toBe('LIVE');
    expect(r.definition.approvalStatus).toBe('PROPOSED_DEFAULT_AWAITING_OWNER_APPROVAL');
  });
  it('KPI-REV-002: (160,000 verified - 3,000 processed refund) / 150,000 collection target', async () => {
    const r = await kpi(A.founder, 'KPI-REV-002');
    expect(r.numerator).toBe('157000.00'); // 60,000 + 30,000 (reconciled) + 50,000 + 20,000 ; RECORDED/EXPECTED and the Aug-2 payment excluded
    expect(r.value).toBe('104.7'); // 157000/150000 = 104.666..
  });
  it('KPI-REV-003 / TEA-001 / TEA-002 / REV-004', async () => {
    const r3 = await kpi(A.founder, 'KPI-REV-003');
    expect([r3.numerator, r3.denominator, r3.value]).toEqual(['212000.00', '300000.00', '70.7']); // managers A+B subtrees hold all 212,000; 150,000+150,000
    const t1 = await kpi(A.founder, 'KPI-TEA-001');
    expect([t1.numerator, t1.denominator, t1.value]).toEqual(['141.3', '2', '70.7']); // A 140000/150000=93.3 ; B 72000/150000=48.0 ; (93.3+48.0)/2=70.65 -> 70.7
    const t2 = await kpi(A.founder, 'KPI-TEA-002');
    expect([t2.numerator, t2.denominator, t2.value]).toEqual(['274.0', '4', '68.5']); // 137.5 + 42.9 + 65.0 + 28.6 = 274.0 ; /4
    const e = await kpi(A.founder, 'KPI-REV-004');
    expect([e.numerator, e.denominator, e.value]).toEqual(['4', '10', '40.0']); // D1..D4 = 4 enrolments (D5 outside July) / target 10
  });
  it('KPI-SAL-001..004', async () => {
    const c = await kpi(A.founder, 'KPI-SAL-001');
    expect([c.numerator, c.denominator, c.value]).toEqual(['2', '10', '20.0']); // eligible: L1-L6, L8-L10, L12 (L7 NOT_ELIGIBLE, L11 merged); won within 60d: L1, L8 (L5 won after 70 days)
    expect((c.breakdown as { wonInRange: number }).wonInRange).toBe(2);
    const w = await kpi(A.founder, 'KPI-SAL-002');
    expect([w.numerator, w.denominator, w.value]).toEqual(['1', '4', '25.0']); // attended L1, L2, L9, L12 ; only L1 bought within 30 days after
    const d = await kpi(A.founder, 'KPI-SAL-003');
    expect([d.numerator, d.denominator, d.value]).toEqual(['1', '2', '50.0']); // L8 bought BEFORE the demo (not attributed), L5 after
    const a = await kpi(A.founder, 'KPI-SAL-004');
    expect([a.numerator, a.denominator, a.value]).toEqual(['225000.00', '4', '56250']);
  });
  it('KPI-SAL-005: accuracy 1-|F-A|/A with WAPE and bias, from the period-start snapshot', async () => {
    const r = await kpi(A.founder, 'KPI-SAL-005');
    expect([r.numerator, r.denominator, r.value]).toEqual(['12000.00', '212000.00', '94.3']); // F 200,000 vs A 212,000
    const b = r.breakdown as { wapePct: string; biasPct: string; wapePeriods: number; errorMetric: string };
    expect(b.biasPct).toBe('-5.7');
    expect(b.wapePct).toBe('14.1'); // (12,000 + 28,000) / (212,000 + 72,000) ; June A = 80,000 - 8,000 refund
    expect(b.wapePeriods).toBe(2);
    expect(b.errorMetric).toContain('1 - |F - A| / A');
    expect(r.isEstimate).toBe(true);
  });
  it('KPI-SAL-006: weekly forecast is the stored snapshot, labelled an estimate', async () => {
    const r = await kpi(A.founder, 'KPI-SAL-006', '?asOf=2026-07-15');
    expect(r.value).toBe('55000.00');
    expect(r.isEstimate).toBe(true);
    expect(r.caution).toMatch(/estimate/i);
  });
  it('calls: attempts, completed, connected and unique clients are separate measures with their source', async () => {
    const p = await kpi(A.founder, 'KPI-PRD-001');
    expect(p.value).toBe('11'); // 12 attempts in July (the 00:30 IST Aug-1 call is out) - 1 FAILED
    expect(p.breakdown).toMatchObject({ callAttempts: 12, callsCompleted: 11, connectedCalls: 6, uniqueClientsCalled: 9, bySource: { MANUAL: 11, PROVIDER: 1, DEVICE: 0 } });
    expect(p.dataSource).toContain('MANUAL 11');
    expect(p.dataSource).toContain('PROVIDER 1');
    expect(v(await kpi(A.founder, 'KPI-PRD-006'))).toBe('12');
    const conn = await kpi(A.founder, 'KPI-PRD-007');
    expect([conn.value, conn.denominator]).toEqual(['6', '12']); // CONNECTED c1,c6,c12 + CALLBACK c5 + LOST c8 + WON c9
    const u = await kpi(A.founder, 'KPI-PRD-008');
    expect([u.value, u.denominator]).toEqual(['9', '12']);
  });
  it('KPI-PRD-002 / EXC-005: follow-ups', async () => {
    const r = await kpi(A.founder, 'KPI-PRD-002');
    expect(r.value).toBe('5'); // t1,t2,t6,t8,t9 completed in July (t4 is a CALL task, t5 cancelled)
    expect([r.numerator, r.denominator]).toEqual(['3', '6']); // due in July & judgeable: t1,t2,t3,t6,t7,t8 ; on time: t1,t6,t8
    expect(r.breakdown).toMatchObject({ completedLate: 1, overdueStillOpen: 2, onTimePct: '50.0' });
    const c = await kpi(A.founder, 'KPI-EXC-005');
    expect([c.numerator, c.denominator, c.value]).toEqual(['3', '6', '50.0']);
  });
  it('KPI-PRD-003 CRM compliance, PRD-004 response time, PRD-005 ageing', async () => {
    const c = await kpi(A.founder, 'KPI-PRD-003');
    expect([c.numerator, c.denominator, c.value]).toEqual(['3', '6', '50.0']); // eligible OPEN: L2,L4,L6,L9,L10,L12 ; compliant: L2,L4,L10
    expect(c.breakdown).toMatchObject({ failing: { noOwner: 1, noNextAction: 2, missingRequiredFields: 1, noRecentActivity: 3 } });
    const r = await kpi(A.founder, 'KPI-PRD-004');
    expect(r.value).toBe('20'); // working minutes [30 (L1), 60 (L2: 30 before 19:00 + 30 after 09:00), 5, 20 (L4 over a Sunday), 20 (L8 from assignment)] -> median 20
    expect(r.breakdown).toMatchObject({ medianMinutes: 20, p90Minutes: 60, notYetResponded: 6 });
    const g = await kpi(A.founder, 'KPI-PRD-005');
    expect([g.value, g.denominator]).toEqual(['3', '6']); // stale (>7 days idle): L6, L9, L12 of 6 active
  });
  it('exceptions: unassigned 1, no-next-action 2, overdue tasks 2, new leads 11', async () => {
    expect(v(await kpi(A.founder, 'KPI-EXC-001'))).toBe('1'); // L12
    expect(v(await kpi(A.founder, 'KPI-EXC-002'))).toBe('2'); // L9, L12 (L4 has open task t10, L6 has open task t7)
    expect(v(await kpi(A.founder, 'KPI-EXC-003'))).toBe('2'); // t3, t7 (t10 is due in 2099)
    expect(v(await kpi(A.founder, 'KPI-EXC-004'))).toBe('11'); // 12 created in July minus the merged L11
  });
  it('team KPIs: productivity components, attrition, engagement, coaching hours', async () => {
    const p = await kpi(A.founder, 'KPI-TEA-003');
    expect([p.value, p.numerator, p.denominator]).toEqual(['0.1', '11', '108']); // 11 completed calls / (4 executives x 27 working days of July)
    expect(p.breakdown).toMatchObject({ executives: 4, workingDays: 27, callsPerExecutive: '2.8', followUpsCompletedPerExecutive: '1.3', conversionsPerExecutive: '0.5', revenuePerExecutive: '53000.00' });
    const at = await kpi(A.founder, 'KPI-TEA-004');
    expect([at.value, at.numerator, at.denominator]).toEqual(['23.5', '2', '8.5']); // exits 2 (TRANSFER excluded) / ((10+7)/2)
    expect(at.breakdown).toMatchObject({ voluntary: 1, involuntary: 1, headcountStart: 10, headcountEnd: 7 });
    const en = await kpi(A.founder, 'KPI-TEA-005');
    expect([en.value, en.numerator, en.denominator]).toEqual(['84', '42', '10']); // 42/10 = 4.2 of 5 ; the 3-response survey is suppressed
    expect((en.breakdown as { surveysSuppressed: number }).surveysSuppressed).toBe(1);
    const co = await kpi(A.founder, 'KPI-TEA-006');
    expect([co.value, co.numerator]).toEqual(['3.3', '195']); // 60+45+30 + 30+30 (the scheduled 1:1 is excluded) = 195 min = 3.25 h
  });
  it('process KPIs: SOP adoption, dashboard accuracy', async () => {
    const s = await kpi(A.founder, 'KPI-PRO-001');
    expect([s.numerator, s.denominator, s.value]).toEqual(['5', '15', '33.3']); // 11 users x doc1 + 4 executives x doc2 = 15 required ; 5 acknowledgements
    const d = await kpi(A.founder, 'KPI-PRO-002');
    expect([d.numerator, d.denominator, d.value]).toEqual(['17', '18', '94.4']); // runs 8/8 and 9/10
    expect((d.breakdown as { timeliness: { lagMinutes: number } }).timeliness.lagMinutes).toBeGreaterThan(0);
  });
  it('CX KPIs', async () => {
    const c = await kpi(A.founder, 'KPI-CX-001');
    expect([c.numerator, c.denominator, c.value]).toEqual(['23', '6', '3.8']);
    expect(c.breakdown).toMatchObject({ satisfiedPct: '66.7', nps: 25, npsResponses: 4 });
    expect(c.caution).toBeNull();
    const e = await kpi(A.founder, 'KPI-CX-004');
    expect([e.numerator, e.denominator, e.value]).toEqual(['9', '2', '4.5']);
    expect(e.caution).toMatch(/Only 2 responses/);
    expect(e.breakdown).toMatchObject({ excludedOutsideWindow: 1 });
    const k = await kpi(A.founder, 'KPI-CX-003');
    expect([k.numerator, k.denominator, k.value]).toEqual(['2', '4', '50.0']);
    expect(k.breakdown).toMatchObject({ slaAdherencePct: '50.0', meanHoursToResolve: 36, medianHoursToResolve: 36, stillOpen: 2 });
    const r = await kpi(A.founder, 'KPI-CX-002');
    expect([r.numerator, r.denominator, r.value]).toEqual(['33.3', '100.0', '33.3']); // like-for-like CBAX: July 2 refunds / 3 enrolments = 66.7% vs June 1/1 = 100%
    expect(r.breakdown).toMatchObject({ currentRatePct: '66.7', previousRatePct: '100.0', likeForLikePrograms: 1 });
  });
  it('Founder support KPIs', async () => {
    const a = await kpi(A.founder, 'KPI-FND-001');
    expect([a.numerator, a.denominator, a.value]).toEqual(['2', '4', '50.0']);
    expect(a.breakdown).toMatchObject({ completedLate: 1, overdueNotCompleted: 1 });
    const q = await kpi(A.founder, 'KPI-FND-002');
    expect([q.numerator, q.denominator, q.value]).toEqual(['175', '2', '88']); // (100+75)/2 = 87.5 ; the v2 correction is ignored
    expect(q.breakdown).toMatchObject({ meanFounderRating: 4, ratedReports: 1 });
    const tm = await kpi(A.founder, 'KPI-FND-003');
    expect([tm.numerator, tm.denominator, tm.value]).toEqual(['1', '3', '33.3']);
    expect(tm.breakdown).toMatchObject({ late: 1, missingStillDraft: 1 });
  });
});
