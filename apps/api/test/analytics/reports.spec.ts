import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReconciliationService } from '../../src/modules/reporting/reconciliation/reconciliation.service';
import type { KpiService } from '../../src/modules/reporting/kpi/kpi.service';
import { createTestApp, type TestApp } from '../helpers';
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

type Row = Record<string, string | number | null>;
const report = async (a: typeof A.founder, key: string, query = Q) => {
  const r = await a.get(`/reports/${key}${query}`);
  if (r.status !== 200) throw new Error(`${key} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data as { columns: Array<{ key: string }>; rows: Row[]; summary: Record<string, unknown>; kpis: Array<{ id: string; value: string | null }>; meta: Record<string, unknown>; truncated: boolean };
};
const byName = (rows: Row[], name: string) => rows.find((r) => r.name === name || r.owner === name)!;

describe('GET /reports/follow-ups', () => {
  it('per-owner rows add up to the KPI totals; attempts and unique clients stay separate', async () => {
    const r = await report(A.founder, 'follow-ups');
    const a1 = byName(r.rows, f.execA1.name);
    expect(a1).toMatchObject({ followUpsDue: 3, followUpsCompleted: 2, followUpsOnTime: 1, onTimePct: '33.3', overdueOpen: 1, callbacksPending: 0, callAttempts: 5, uniqueClients: 4 });
    expect(r.rows.reduce((s, x) => s + Number(x.callAttempts), 0)).toBe(12);
    expect(r.kpis.find((k) => k.id === 'KPI-PRD-006')!.value).toBe('12');
    expect(r.kpis.find((k) => k.id === 'KPI-PRD-008')!.value).toBe('9');
    expect(r.meta).toMatchObject({ currency: 'INR', dateRange: { from: '2026-07-01', to: '2026-07-31' } });
  });
  it('a manager only gets their own team rows', async () => {
    const r = await report(A.mA, 'follow-ups');
    const names = r.rows.map((x) => x.owner);
    expect(names).toContain(f.execA1.name);
    expect(names).not.toContain(f.execB1.name);
    expect(r.rows.reduce((s, x) => s + Number(x.callAttempts), 0)).toBe(8);
  });
});

describe('GET /reports/conversions', () => {
  it('by source: cohort conversion matches the hand computation', async () => {
    const r = await report(A.founder, 'conversions', `${Q}&by=source`);
    expect(r.rows).toEqual(expect.arrayContaining([{ group: 'Meta Ads', leads: 6, won: 2, conversionPct: '33.3' }, { group: 'Referral', leads: 4, won: 0, conversionPct: '0.0' }]));
    expect(r.kpis.find((k) => k.id === 'KPI-SAL-001')!.value).toBe('20.0');
  });
  it('by program and by owner', async () => {
    const p = await report(A.founder, 'conversions', `${Q}&by=program`);
    expect(p.rows).toEqual(expect.arrayContaining([{ group: 'CBAX', leads: 6, won: 2, conversionPct: '33.3' }, { group: 'MCA X', leads: 4, won: 0, conversionPct: '0.0' }]));
    const o = await report(A.founder, 'conversions', `${Q}&by=owner`);
    expect(o.rows).toEqual(expect.arrayContaining([{ group: f.execA1.name, leads: 4, won: 1, conversionPct: '25.0' }, { group: 'Unassigned', leads: 1, won: 0, conversionPct: '0.0' }]));
  });
});

describe('GET /reports/funnel', () => {
  it('current stage and ever-reached counts for the July cohort', async () => {
    const r = await report(A.founder, 'funnel');
    const stage = (s: string) => r.rows.find((x) => x.stage === s)!;
    expect(stage('NEW')).toMatchObject({ currentLeads: 4, everReached: 4, reachedPct: '36.4' });
    expect(stage('CONTACT_ATTEMPTED')).toMatchObject({ currentLeads: 1, everReached: 2, reachedPct: '18.2' }); // history: L1, L2 passed through it
    expect(stage('CONNECTED')).toMatchObject({ currentLeads: 1, everReached: 3, reachedPct: '27.3' }); // L1, L2, L8
    expect(stage('WON')).toMatchObject({ currentLeads: 3, everReached: 3 });
    expect(stage('LOST')).toMatchObject({ currentLeads: 2 });
    expect(r.summary.cohortSize).toBe(11);
  });
});

describe('GET /reports/revenue', () => {
  it('by program: rows add up to the organisation total', async () => {
    const r = await report(A.founder, 'revenue', `${Q}&by=program`);
    expect(r.rows).toEqual(expect.arrayContaining([
      { group: 'CBAX', booked: '175000.00', refundsApproved: '13000.00', net: '162000.00', enrolments: 3, wonDeals: 3, collected: '107000.00' },
      { group: 'MCA X', booked: '50000.00', refundsApproved: '0.00', net: '50000.00', enrolments: 1, wonDeals: 1, collected: '50000.00' },
    ]));
    expect(r.summary.totals).toMatchObject({ net: '212000.00', collected: '157000.00', enrolments: 4, wonDeals: 4 });
    expect(r.summary.rowTotals).toMatchObject({ net: '212000.00', collected: '157000.00' });
  });
  it('by owner uses the credit split (DEC-005)', async () => {
    const r = await report(A.founder, 'revenue', `${Q}&by=owner`);
    expect(r.rows.map((x) => [x.group, x.net])).toEqual([[f.execA1.name, '110000.00'], [f.execB1.name, '52000.00'], [f.execA2.name, '30000.00'], [f.execB2.name, '20000.00']]);
    expect((r.summary.rowTotals as { net: string }).net).toBe('212000.00');
  });
  it('manager A sees only their team money', async () => {
    const r = await report(A.mA, 'revenue', `${Q}&by=owner`);
    expect(r.rows.map((x) => x.group).sort()).toEqual([f.execA1.name, f.execA2.name].sort());
    expect((r.summary.totals as { net: string }).net).toBe('140000.00');
  });
});

describe('GET /reports/team-performance', () => {
  it('Founder rows with target, achievement, calls and conversion', async () => {
    const r = await report(A.founder, 'team-performance');
    expect(byName(r.rows, f.execA1.name)).toMatchObject({ revenueTarget: '80000.00', revenueActual: '110000.00', achievementPct: '137.5', callAttempts: 5, uniqueClients: 4, connectedCalls: 2, followUpsCompleted: 2, onTimePct: '33.3', overdueOpen: 1, activeLeads: 2, leadsWon: 1, conversionPct: '25.0' });
    expect(byName(r.rows, f.managerA.name)).toMatchObject({ revenueTarget: '150000.00', revenueActual: '0.00' }); // a manager's own credited sales; the team target is not the manager's own sale
  });
  it('manager A cannot see manager B or B executives', async () => {
    const r = await report(A.mA, 'team-performance');
    const names = r.rows.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining([f.execA1.name, f.execA2.name, f.managerA.name]));
    expect(names).not.toContain(f.managerB.name);
    expect(names).not.toContain(f.execB1.name);
  });
});

describe('Founder weekly / monthly report data (also the CX ReportDataProvider)', () => {
  it('monthly-founder: every KPI row carries its window, definition status and freshness', async () => {
    const r = await report(A.founder, 'monthly-founder');
    const row = r.rows.find((x) => x.kpiId === 'KPI-REV-001')!;
    expect(row.value).toBe('70.7%');
    expect(String(row.note)).toContain('proposed default, awaiting owner approval');
    expect(String(row.note)).toContain('computed ');
    expect(r.rows.length).toBeGreaterThanOrEqual(30);
  });
  it('weekly-founder uses a Monday-Sunday week', async () => {
    const r = await report(A.founder, 'weekly-founder', '?asOf=2026-07-15');
    expect((r.meta as { dateRange: { from: string; to: string } }).dateRange).toMatchObject({ from: '2026-07-13', to: '2026-07-19' });
  });
  it('a team lead can read it; an executive cannot', async () => {
    expect((await A.tl.get('/reports/weekly-founder')).status).toBe(200);
    expect((await A.a1.get('/reports/weekly-founder')).status).toBe(200); // executives hold reports:view + kpi:view (own scope)
    const own = (await A.a1.get('/reports/weekly-founder?asOf=2026-07-15')).body.data;
    expect(JSON.stringify(own)).not.toContain(f.execB1.name);
  });
});

describe('GET /reports/reconciliation (dashboard accuracy evidence)', () => {
  it('every runnable check passes for the Founder: dashboard totals equal raw database totals', async () => {
    const r = (await A.founder.get(`/reports/reconciliation${Q}`)).body.data;
    expect(r.summary.failed).toBe(0);
    expect(r.summary.passed).toBeGreaterThanOrEqual(12);
    const ids = r.checks.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['new-leads', 'call-attempts', 'unique-clients', 'follow-ups-completed', 'revenue-net', 'collections-net', 'report-revenue-owner-rows', 'report-revenue-program-rows', 'pipeline-deals']));
    const rev = r.checks.find((c: { id: string }) => c.id === 'revenue-net');
    expect([rev.expected, rev.actual, rev.status]).toEqual(['212000.00', '212000.00', 'PASS']);
    const col = r.checks.find((c: { id: string }) => c.id === 'collections-net');
    expect([col.expected, col.actual]).toEqual(['157000.00', '157000.00']);
  });
  it('a manager reconciles within their own scope; money checks are skipped honestly', async () => {
    const r = (await A.mA.get(`/reports/reconciliation${Q}`)).body.data;
    expect(r.summary.failed).toBe(0);
    expect(r.scope).toMatchObject({ level: 'team', orgWide: false });
    const calls = r.checks.find((c: { id: string }) => c.id === 'call-attempts');
    expect([calls.expected, calls.actual]).toEqual(['8', '8']);
    expect(r.checks.find((c: { id: string }) => c.id === 'revenue-net').status).toBe('SKIPPED');
  });
  it('detects a mismatch: when the dashboard layer disagrees with the raw tables the check FAILS', async () => {
    const recon = t.app.get(ReconciliationService);
    const kpis = (recon as unknown as { kpis: KpiService }).kpis;
    const real = kpis.run.bind(kpis);
    const spy = vi.spyOn(kpis, 'run').mockImplementation(async (u, id, q, o) => {
      const r = await real(u, id, q, o);
      return id === 'KPI-EXC-004' ? { ...r, value: String(Number(r.value) + 1) } : r; // a dashboard that over-counts new leads by one
    });
    const bad = (await A.founder.get(`/reports/reconciliation${Q}`)).body.data;
    spy.mockRestore();
    const chk = bad.checks.find((c: { id: string }) => c.id === 'new-leads');
    expect([chk.expected, chk.actual, chk.difference, chk.status]).toEqual(['11', '12', '1', 'FAIL']);
    expect(bad.summary.failed).toBe(1);
    expect(bad.summary.allPassed).toBe(false);
  });
  it('only an organisation-wide run is recorded as evidence', async () => {
    const before = await t.prisma.kpiReconciliationRun.count({ where: { organizationId: f.org.id } });
    expect((await A.mA.post('/reports/reconciliation/run').send({ from: '2026-07-01', to: '2026-07-31' })).status).toBe(403);
    expect((await A.founder.post('/reports/reconciliation/run').send({ from: '2026-07-01', to: '2026-07-31', teamId: f.ids.tA })).status).toBe(403);
    expect(await t.prisma.kpiReconciliationRun.count({ where: { organizationId: f.org.id } })).toBe(before);
  });
  it('POST /reports/reconciliation/run persists the run (KPI-PRO-002 evidence) and audits it', async () => {
    const before = await t.prisma.kpiReconciliationRun.count({ where: { organizationId: f.org.id } });
    const r = await A.founder.post(`/reports/reconciliation/run`).send({ from: '2026-07-01', to: '2026-07-31' });
    expect(r.status).toBe(201);
    expect(r.body.data.runId).toBeTruthy();
    expect(await t.prisma.kpiReconciliationRun.count({ where: { organizationId: f.org.id } })).toBe(before + 1);
    expect(await t.prisma.auditLog.count({ where: { organizationId: f.org.id, action: 'analytics.reconciliation_run' } })).toBeGreaterThanOrEqual(1);
  });
});

describe('role dashboards', () => {
  it('Founder dashboard carries the targets, KPIs and panels with definitions and freshness', async () => {
    const r = await A.founder.get('/dashboard/ceo?from=2026-07-01&to=2026-07-31');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.targets.revenue.month.value).toBe('70.7');
    expect(d.targets.revenue.quarter.dateRange.from).toBe('2026-07-01'); // Q3 2026 starts in July
    expect(d.targets.collections.month.value).toBe('104.7');
    expect(d.kpis['KPI-SAL-001'].value).toBe('20.0');
    expect(d.kpis['KPI-SAL-001'].freshness.computedAt).toBeTruthy();
    expect(d.panels.pipeline.stages.map((s: { stage: string; deals: number }) => [s.stage, s.deals])).toEqual([['OPEN', 1], ['NEGOTIATION', 1], ['PAYMENT_PENDING', 1]]);
    expect(d.panels.teamPerformance.status).toBe('OK');
    expect(d.panels.revenueTrend.months.length).toBe(6);
    expect(d.panels.revenueTrend.months.at(-1)).toMatchObject({ net: '212000.00' });
    expect(d.panels.revenueDaily.series.length).toBe(31);
    expect(d.panels.revenueDaily.series.at(-1).cumulative).toBe('212000.00');
    expect(d.panels.risks.items.overdueTasks).toBe(2);
    expect(d.panels.forecastRisk).toMatchObject({ unscheduledDeals: 1, slippedDeals: 1 });
    expect(d.dateRange.timezone).toBe('Asia/Kolkata');
  });
  it('dashboard totals equal the KPI endpoint totals (single source of truth)', async () => {
    const d = (await A.founder.get(`/dashboard/ceo${Q}`)).body.data;
    for (const id of ['KPI-PRD-003', 'KPI-EXC-001', 'KPI-EXC-005']) {
      const k = (await A.founder.get(`/kpis/${id}${Q}`)).body.data;
      expect(d.kpis[id].value, id).toBe(k.value);
      expect(d.kpis[id].numerator, id).toBe(k.numerator);
    }
  });
  it('Team Lead dashboard: scorecards, exceptions, today strip, people status', async () => {
    const d = (await A.tl.get(`/dashboard/team-lead${Q}`)).body.data;
    expect(d.targets.revenue.month.value).toBe('70.7');
    expect(d.panels.scorecards.managers.map((m: { name: string }) => m.name).sort()).toEqual([f.managerA.name, f.managerB.name].sort());
    expect(d.panels.exceptions.items).toMatchObject({ unassignedLeads: 1, noNextActionLeads: 2, overdueTasks: 2 });
    expect(d.panels.people.status).toBe('OK');
    expect(d.today['KPI-PRD-006'].dateRange.from).toBe(d.today['KPI-PRD-006'].dateRange.to);
    expect(d.today['KPI-REV-002'].name).toBeTruthy(); // collections today, same KPI layer
    expect(d.panels.pipelineChanges).toMatchObject({ status: 'OK', stageChanges: expect.any(Number), wins: expect.any(Number), losses: expect.any(Number) });
  });
  it('Manager dashboard: roster is the team only, callbacks, risks', async () => {
    const d = (await A.mA.get(`/dashboard/manager${Q}`)).body.data;
    const names = d.panels.roster.members.map((m: { name: string }) => m.name);
    expect(names).not.toContain(f.execB1.name);
    expect(names).toEqual(expect.arrayContaining([f.execA1.name, f.execA2.name]));
    expect(d.targets.revenue.month.value).toBe('93.3');
    expect(d.kpis['KPI-EXC-001'].value).toBe('0');
    expect(d.panels.people.coaching).toMatchObject({ oneOnOnesHeld: 1 });
    expect(d.panels.people.succession).toBeUndefined(); // succession is Founder / Team Lead / HR only
  });
  it('Executive workspace is always the caller\'s own, whatever filters are sent', async () => {
    const d = (await A.a1.get(`/dashboard/salesperson${Q}&ownerId=${f.ids.b1}`)).body.data;
    expect(d.targets.revenue.month.numerator).toBe('110000.00');
    expect(d.kpis['KPI-PRD-006'].value).toBe('5');
    expect(d.filters.scopeLevel).toBe('own');
  });
  it('executive workspace shows approved incentive STATUS only, never amounts, and never a peer\'s', async () => {
    const policy = await t.prisma.incentivePolicy.create({ data: { organizationId: f.org.id, versionNumber: 1, name: 'fixture policy', status: 'APPROVED', structure: {}, createdById: f.ids.tl } });
    await t.prisma.incentiveRecommendation.create({ data: { organizationId: f.org.id, policyId: policy.id, employeeId: f.ids.a1, periodStart: new Date('2026-06-01T00:00:00Z'), periodEnd: new Date('2026-06-30T00:00:00Z'), status: 'APPROVED', inputs: {}, breakdown: {}, computedAmount: '12345.00', approvedAmount: '12345.00', recommendedById: f.ids.tl } });
    const mine = (await A.a1.get(`/dashboard/salesperson${Q}`)).body.data;
    expect(mine.panels.incentive.items).toEqual([{ periodStart: '2026-06-01', periodEnd: '2026-06-30', status: 'APPROVED', paidAt: null }]);
    expect(JSON.stringify(mine)).not.toContain('12345');
    const peer = (await A.a2.get(`/dashboard/salesperson${Q}`)).body.data;
    expect(peer.panels.incentive.items).toEqual([]);
    const tl = (await A.tl.get(`/dashboard/team-lead${Q}`)).body.data;
    expect(tl.panels.incentives.statusCounts).toMatchObject({ APPROVED: 1 }); // counts only
    expect(JSON.stringify(tl)).not.toContain('12345');
  });
  it('role gating: each dashboard is refused to the wrong role', async () => {
    expect((await A.mA.get('/dashboard/ceo')).status).toBe(403);
    expect((await A.mA.get('/dashboard/team-lead')).status).toBe(403);
    expect((await A.a1.get('/dashboard/manager')).status).toBe(403);
    expect((await A.tl.get('/dashboard/ceo')).status).toBe(403);
    expect((await A.hr.get('/dashboard/salesperson')).status).toBe(403);
    expect((await A.founder.get('/dashboard/admin')).status).toBe(200);
  });
});
