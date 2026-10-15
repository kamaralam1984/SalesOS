import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildKit, createDeal, makeLead, type RevenueKit } from './kit';

let k: RevenueKit;
beforeAll(async () => { k = await buildKit(); });
afterAll(async () => { await k.close(); });

const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);

async function openDeal(owner: 'execA1' | 'execA2' | 'execB1', amount: string, stage: 'OPEN' | 'NEGOTIATION' | 'PAYMENT_PENDING', expectedCloseOn: string | null, leadStatus = 'PROPOSAL_NEGOTIATION') {
  const lead = await makeLead(k, k.fx[owner].id, owner === 'execB1' ? k.fx.teamB.id : k.fx.teamA.id, { status: leadStatus });
  const d = await createDeal(k, k.agents[owner], lead.id, { amount, ...(expectedCloseOn ? { expectedCloseOn } : {}) });
  expect(d.status).toBe(201);
  if (stage !== 'OPEN') expect((await k.agents[owner].patch(`/deals/${d.body.data.id}`).send({ stage })).status).toBe(200);
  return d.body.data.id as string;
}

describe('stage-weighted forecast (DEC-030)', () => {
  it('preview and stored snapshots follow the documented method and are labelled as estimates', async () => {
    const k2 = await buildKit();
    try {
      const today = todayIst();
      const mk = async (owner: 'execA1' | 'execA2', amount: string, stage: 'OPEN' | 'NEGOTIATION' | 'PAYMENT_PENDING', when: string | null, leadStatus = 'PROPOSAL_NEGOTIATION') => {
        const lead = await makeLead(k2, k2.fx[owner].id, k2.fx.teamA.id, { status: leadStatus });
        const d = await createDeal(k2, k2.agents[owner], lead.id, { amount, ...(when ? { expectedCloseOn: when } : {}) });
        if (stage !== 'OPEN') await k2.agents[owner].patch(`/deals/${d.body.data.id}`).send({ stage });
        return d.body.data.id as string;
      };
      // current month window: choose the last day of the IST month for the scheduled deals
      const [y, m] = today.split('-').map(Number) as [number, number];
      const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      await mk('execA1', '100000.00', 'NEGOTIATION', monthEnd);
      await mk('execA1', '50000.00', 'PAYMENT_PENDING', monthEnd);
      await mk('execA2', '80000.00', 'OPEN', monthEnd, 'DEMO_ATTENDED');
      await mk('execA2', '30000.00', 'NEGOTIATION', null); // unscheduled: reported, not forecast
      await mk('execA2', '20000.00', 'NEGOTIATION', addDays(monthEnd, 5)); // beyond the period: not included
      // a booked sale today: 40,000
      const lead = await makeLead(k2, k2.fx.execA1.id, k2.fx.teamA.id);
      const won = await createDeal(k2, k2.agents.execA1, lead.id, { amount: '40000.00' });
      await k2.agents.execA1.post(`/deals/${won.body.data.id}/close`).send({ outcome: 'WON', finalAmount: '40000.00' });

      const pv = await k2.agents.teamLead.get('/forecasts/preview').query({ periodType: 'MONTH', anchor: today });
      expect(pv.status).toBe(200);
      const p = pv.body.data;
      expect(p).toMatchObject({ method: 'STAGE_WEIGHTED_V1', isEstimate: true, stored: false, scope: 'ORG', currency: 'INR', bookedToDate: '40000.00', weightedPipeline: '130500.00', unweightedPipeline: '230000.00', total: '170500.00' });
      expect(p.label).toMatch(/ESTIMATE/);
      expect(p.unscheduled).toEqual({ count: 1, amount: '30000.00' });
      expect(p.byStage.map((s: { stage: string }) => s.stage).sort()).toEqual(['NEGOTIATION', 'PAYMENT_PENDING', 'DEMO_ATTENDED'].sort());

      const c = await k2.agents.teamLead.post('/forecasts').send({ periodType: 'MONTH', anchor: today, kind: 'PERIOD_START' });
      expect(c.status).toBe(201);
      const snap = c.body.data.snapshot;
      expect(snap).toMatchObject({ kind: 'PERIOD_START', isEstimate: true, total: '170500.00', bookedToDate: '40000.00', weightedPipeline: '130500.00' });
      expect(snap.inputs).toMatchObject({ method: 'STAGE_WEIGHTED_V1', scope: 'ORG', asOf: today });
      expect(snap.inputs.probabilities).toMatchObject({ NEGOTIATION: '0.60' });

      // the pipeline moves on, the snapshot does not
      const extra = await mk('execA1', '1000000.00', 'PAYMENT_PENDING', monthEnd);
      void extra;
      const again = await k2.agents.teamLead.get(`/forecasts/${c.body.data.forecast.id}/snapshots`);
      expect(again.body.data.snapshots).toHaveLength(1);
      expect(again.body.data.snapshots[0].total).toBe('170500.00');
      // a second period-start snapshot is refused; ad-hoc ones are appended
      expect((await k2.agents.teamLead.post('/forecasts').send({ periodType: 'MONTH', anchor: today, kind: 'PERIOD_START' })).status).toBe(409);
      const adhoc = await k2.agents.teamLead.post('/forecasts').send({ periodType: 'MONTH', anchor: today });
      expect(adhoc.status).toBe(201);
      expect(adhoc.body.data.forecast.id).toBe(c.body.data.forecast.id);
      expect(adhoc.body.data.snapshot.total).toBe('1020500.00'); // 170500 + 1,000,000 * 0.85
      const all = await k2.agents.founder.get(`/forecasts/${c.body.data.forecast.id}/snapshots`);
      expect(all.body.data.snapshots.map((s: { total: string }) => s.total)).toEqual(['1020500.00', '170500.00']);

      // immutable in the database
      const row = await k2.prisma.forecastSnapshot.findFirstOrThrow({ where: { forecastId: c.body.data.forecast.id, kind: 'PERIOD_START' } });
      await expect(k2.prisma.forecastSnapshot.update({ where: { id: row.id }, data: { total: '1.00' } })).rejects.toThrow(/immutable/);
      await expect(k2.prisma.forecastSnapshot.delete({ where: { id: row.id } })).rejects.toThrow(/immutable/);
      expect(await k2.prisma.outboxEvent.count({ where: { aggregateId: c.body.data.forecast.id, eventType: 'forecast.snapshot_taken' } })).toBe(2);

      // the open period shows no accuracy yet (never a fake number)
      const list = await k2.agents.teamLead.get('/forecasts');
      expect(list.body.data[0].accuracy).toMatchObject({ periodClosed: false, accuracyPct: null });
      expect(list.body.data[0].latest.isEstimate).toBe(true);
    } finally {
      await k2.close();
    }
  });

  it('weekly forecasts use Monday-Sunday weeks', async () => {
    const pv = await k.agents.founder.get('/forecasts/preview').query({ periodType: 'WEEK', anchor: '2026-10-15' });
    expect(pv.body.data).toMatchObject({ periodStart: '2026-10-12', periodEnd: '2026-10-18', periodType: 'WEEK' });
    expect((await k.agents.founder.get('/forecasts/preview').query({ periodType: 'YEAR' })).status).toBe(400);
  });

  it('accuracy and WAPE come from the period-start snapshot versus the actual booked revenue of the closed period', async () => {
    const k2 = await buildKit();
    try {
      // two closed past months with stored snapshots and known actuals, written directly (the API only snapshots "now")
      const owner = k2.fx.execA1.id;
      const mkMonth = async (start: string, end: string, forecastTotal: string, actual: string | null) => {
        const f = await k2.prisma.forecast.create({ data: { organizationId: k2.fx.org.id, periodType: 'MONTH', periodStart: new Date(`${start}T00:00:00Z`), periodEnd: new Date(`${end}T00:00:00Z`), scopeKey: 'ORG', method: 'STAGE_WEIGHTED_V1', params: {}, createdById: k2.fx.teamLead.id } });
        await k2.prisma.forecastSnapshot.create({ data: { organizationId: k2.fx.org.id, forecastId: f.id, kind: 'PERIOD_START', takenById: k2.fx.teamLead.id, total: forecastTotal, bookedToDate: '0', weightedPipeline: forecastTotal, unweightedPipeline: forecastTotal, breakdown: {}, inputs: {} } });
        if (actual) {
          const lead = await makeLead(k2, owner, k2.fx.teamA.id, { status: 'WON', stageCategory: 'WON' });
          const deal = await k2.prisma.deal.create({ data: { organizationId: k2.fx.org.id, leadId: lead.id, programId: k2.program.id, ownerId: owner, teamId: k2.fx.teamA.id, stage: 'WON', amount: actual, closedAt: new Date(`${start}T10:00:00Z`), createdById: owner } });
          const rec = await k2.prisma.salesRecord.create({ data: { organizationId: k2.fx.org.id, dealId: deal.id, leadId: lead.id, programId: k2.program.id, dealType: 'NEW', saleValue: actual, closedAt: new Date(`${start}T10:00:00Z`), createdById: owner } });
          await k2.prisma.salesCredit.create({ data: { salesRecordId: rec.id, organizationId: k2.fx.org.id, userId: owner, sharePct: '100', amount: actual } });
        }
        return f.id;
      };
      await mkMonth('2026-07-01', '2026-07-31', '90000.00', '100000.00'); // 90.0% accuracy, bias -10.0
      await mkMonth('2026-08-01', '2026-08-31', '300000.00', '200000.00'); // 50.0%, bias +50.0
      await mkMonth('2026-06-01', '2026-06-30', '500000.00', null); // actual 0 -> no accuracy, never 100%
      const r = await k2.agents.founder.get('/forecasts/accuracy').query({ periodType: 'MONTH', last: 6 });
      expect(r.status).toBe(200);
      const by = Object.fromEntries(r.body.data.periods.map((p: { periodStart: string }) => [p.periodStart, p]));
      expect(by['2026-07-01']).toMatchObject({ forecast: '90000.00', actual: '100000.00', accuracyPct: '90.0', biasPct: '-10.0', periodClosed: true, basis: 'PERIOD_START_SNAPSHOT' });
      expect(by['2026-08-01']).toMatchObject({ accuracyPct: '50.0', biasPct: '50.0' });
      expect(by['2026-06-01']).toMatchObject({ actual: '0.00', accuracyPct: null });
      expect(r.body.data.wapePct).toBe('36.7'); // (10000 + 100000) / 300000 over the two periods with actuals
      expect(r.body.data.errorMetrics.accuracy).toMatch(/1 - \|F - A\| \/ A/);
    } finally {
      await k2.close();
    }
  });
});

describe('forecast access', () => {
  it('Team Lead / Founder org-wide, manager team-scoped, executives and HR denied, Finance summary only', async () => {
    const today = todayIst();
    await openDeal('execA1', '10000.00', 'NEGOTIATION', today);
    const tlSnap = (await k.agents.teamLead.post('/forecasts').send({ periodType: 'WEEK', anchor: today })).body.data;
    const mgrSnap = (await k.agents.managerA.post('/forecasts').send({ periodType: 'WEEK', anchor: today })).body.data;
    const sibSnap = (await k.agents.managerB.post('/forecasts').send({ periodType: 'WEEK', anchor: today })).body.data;
    expect(tlSnap.forecast.scope).toBe('ORG');
    expect(mgrSnap.forecast.scope).toBe('TEAM');
    // the manager's forecast only counts his team's pipeline
    expect(mgrSnap.snapshot.byOwner.every((o: { ownerId: string }) => [k.fx.execA1.id, k.fx.execA2.id].includes(o.ownerId))).toBe(true);
    expect(sibSnap.snapshot.byOwner.some((o: { ownerId: string }) => o.ownerId === k.fx.execA1.id)).toBe(false);
    const ids = async (agent: typeof k.agents.teamLead) => new Set(((await agent.get('/forecasts').query({ periodType: 'WEEK', limit: 100 })).body.data as Array<{ id: string }>).map((f) => f.id));
    const mA = await ids(k.agents.managerA);
    expect([mA.has(mgrSnap.forecast.id), mA.has(tlSnap.forecast.id), mA.has(sibSnap.forecast.id)]).toEqual([true, false, false]);
    expect((await ids(k.agents.founder)).has(sibSnap.forecast.id)).toBe(true);
    expect((await k.agents.managerA.get(`/forecasts/${sibSnap.forecast.id}/snapshots`)).status).toBe(404);
    expect((await k.agents.managerA.get(`/forecasts/${tlSnap.forecast.id}/snapshots`)).status).toBe(404);
    for (const who of ['execA1', 'hr', 'admin'] as const) expect((await k.agents[who].get('/forecasts')).status, who).toBe(403);
    expect((await k.agents.execA1.post('/forecasts').send({ periodType: 'WEEK' })).status).toBe(403);
    const fin = await k.agents.finance.get(`/forecasts/${tlSnap.forecast.id}/snapshots`);
    expect(fin.status).toBe(200);
    expect(fin.body.data.snapshots[0].byOwner).toEqual([]);
    expect(fin.body.data.snapshots[0].inputs).toBeNull();
    expect(fin.body.data.snapshots[0].total).toBeTruthy();
    expect((await k.agents.finance.post('/forecasts').send({ periodType: 'WEEK' })).status).toBe(403);
  });
});
