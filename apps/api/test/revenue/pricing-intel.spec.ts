import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, loginAgent } from '../helpers';
import { buildKit, wonDeal, type RevenueKit } from './kit';

let k: RevenueKit;
beforeAll(async () => { k = await buildKit(); });
afterAll(async () => { await k.close(); });

describe('pricing / offer proposals with controlled approval', () => {
  it('draft -> submitted -> approved by the Founder appends a price version with full history; historic sales are untouched', async () => {
    const sold = await wonDeal(k, { amount: '50000.00' });
    const create = await k.agents.teamLead.post('/proposals').send({ type: 'PRICE_CHANGE', programId: k.program.id, title: 'Raise Program One to 60k', rationale: 'Demand is strong and competitors charge more', proposedAmount: '60000.00' });
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    expect(create.body.data).toMatchObject({ status: 'DRAFT', proposedAmount: '60000.00', currentAmount: null, currency: 'INR', createdByName: k.fx.teamLead.name });
    // a draft cannot be decided
    expect((await k.agents.founder.post(`/proposals/${id}/decision`).send({ decision: 'approve' })).status).toBe(409);
    expect((await k.agents.teamLead.post(`/proposals/${id}/submit`)).body.data.status).toBe('SUBMITTED');
    // only the Founder decides
    for (const who of ['teamLead', 'managerA', 'finance', 'execA1', 'hr'] as const) expect((await k.agents[who].post(`/proposals/${id}/decision`).send({ decision: 'approve' })).status, who).toBe(403);
    const ok = await k.agents.founder.post(`/proposals/${id}/decision`).send({ decision: 'approve', note: 'Go ahead from next month' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'APPROVED', decidedByName: k.fx.founder.name, decisionNote: 'Go ahead from next month' });
    expect(ok.body.data.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['DRAFT', 'SUBMITTED', 'APPROVED']);
    expect(ok.body.data.history.every((h: { actorId: string; actorRole: string }) => h.actorId && h.actorRole)).toBe(true);
    expect((await k.agents.founder.post(`/proposals/${id}/decision`).send({ decision: 'reject' })).status).toBe(409);

    const prices = await k.agents.finance.get('/pricing/prices');
    expect(prices.body.data.find((p: { programId: string }) => p.programId === k.program.id)).toMatchObject({ amount: '60000.00', currency: 'INR', proposalId: id });
    // the next proposal sees the current price
    const next = await k.agents.teamLead.post('/proposals').send({ type: 'DISCOUNT', programId: k.program.id, title: 'Festive discount', rationale: 'Diwali offer to lift enrolments', proposedAmount: '54000.00', submit: true });
    expect(next.body.data).toMatchObject({ status: 'SUBMITTED', currentAmount: '60000.00' });
    // history of sales is not rewritten
    const rec = await k.prisma.salesRecord.findUniqueOrThrow({ where: { dealId: sold.dealId } });
    expect(rec.saleValue.toFixed(2)).toBe('50000.00');
    // price versions are append-only in the database
    const hist = await k.agents.founder.get(`/pricing/programs/${k.program.id}/prices`);
    expect(hist.body.data).toHaveLength(1);
    await expect(k.prisma.programPrice.update({ where: { id: hist.body.data[0].id }, data: { amount: '1.00' } })).rejects.toThrow(/immutable/);
    await expect(k.prisma.pricingProposalEvent.deleteMany({ where: { proposalId: id } })).rejects.toThrow(/immutable/);
    // a rejected proposal changes no price
    expect((await k.agents.founder.post(`/proposals/${next.body.data.id}/decision`).send({ decision: 'reject', note: 'Margins too thin' })).body.data.status).toBe('REJECTED');
    expect((await k.agents.finance.get('/pricing/prices')).body.data.find((p: { programId: string }) => p.programId === k.program.id).amount).toBe('60000.00');
    expect(await k.prisma.auditLog.count({ where: { entityId: id, action: { startsWith: 'proposal.' } } })).toBe(3);
  });

  it('validates inputs and visibility: price change needs program and price; Finance views but cannot create; executives see nothing', async () => {
    expect((await k.agents.teamLead.post('/proposals').send({ type: 'PRICE_CHANGE', title: 'No price', rationale: 'Missing the amount entirely' })).status).toBe(400);
    expect((await k.agents.teamLead.post('/proposals').send({ type: 'OFFER', title: 'x', rationale: 'too short' })).status).toBe(400);
    expect((await k.agents.finance.post('/proposals').send({ type: 'OFFER', title: 'Bundle offer', rationale: 'Finance cannot author proposals' })).status).toBe(403);
    expect((await k.agents.finance.get('/proposals')).status).toBe(200);
    expect((await k.agents.execA1.get('/proposals')).status).toBe(403);
    expect((await k.agents.managerA.get('/pricing/prices')).status).toBe(403);
    const mine = await k.agents.teamLead.post('/proposals').send({ type: 'OFFER', title: 'Early bird offer', rationale: 'Early bird to fill the next cohort' });
    expect((await k.agents.teamLead.post(`/proposals/${mine.body.data.id}/withdraw`).send({})).body.data.status).toBe('WITHDRAWN');
    expect((await k.agents.teamLead.post(`/proposals/${mine.body.data.id}/submit`)).status).toBe(409);
    expect((await k.agents.teamLead.get(`/proposals/${'11111111-1111-4111-8111-111111111111'}`)).status).toBe(404);
  });

  it('the program list is available to sales roles for deal forms', async () => {
    const r = await k.agents.execA1.get('/revenue/programs');
    expect(r.status).toBe(200);
    expect(r.body.data.map((p: { id: string }) => p.id)).toContain(k.program.id);
    expect(r.body.data[0].highValueThreshold).toBeUndefined();
    expect((await k.agents.hr.get('/revenue/programs')).status).toBe(403);
  });
});

describe('market / competitor / learner feedback and growth opportunities', () => {
  const entry = (kind: string, over: Record<string, unknown> = {}) => ({ kind, category: 'Pricing', title: 'Competitor X runs a 40% sale', notes: 'Three prospects mentioned it on calls this week', ...over });

  it('records entries with category, source and status; scoping follows the role', async () => {
    const a = await k.agents.execA1.post('/feedback').send(entry('COMPETITOR', { competitor: 'Competitor X', source: 'Sales call', evidenceUrl: 'https://example.com/offer' }));
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ kind: 'COMPETITOR', status: 'NEW', competitor: 'Competitor X', createdByName: k.fx.execA1.name });
    const peer = await k.agents.execA2.post('/feedback').send(entry('MARKET', { title: 'Learners ask for Hindi cohorts' }));
    const sib = await k.agents.execB1.post('/feedback').send(entry('LEARNER', { title: 'Learner praises mentors' }));
    const ids = async (agent: typeof k.agents.execA1, q: Record<string, unknown> = {}) => new Set(((await agent.get('/feedback').query({ limit: 100, ...q })).body.data as Array<{ id: string }>).map((e) => e.id));
    const e1 = await ids(k.agents.execA1);
    expect([e1.has(a.body.data.id), e1.has(peer.body.data.id), e1.has(sib.body.data.id)]).toEqual([true, false, false]);
    const mA = await ids(k.agents.managerA);
    expect([mA.has(a.body.data.id), mA.has(peer.body.data.id), mA.has(sib.body.data.id)]).toEqual([true, true, false]);
    const tl = await ids(k.agents.teamLead);
    expect(tl.has(sib.body.data.id) && tl.has(a.body.data.id)).toBe(true);
    expect((await ids(k.agents.teamLead, { kind: 'COMPETITOR' })).has(peer.body.data.id)).toBe(false);
    expect((await k.agents.execA1.post('/feedback').send(entry('NOPE'))).status).toBe(400);
    expect((await k.agents.execA1.post('/feedback').send(entry('MARKET', { evidenceUrl: 'not a url' }))).status).toBe(400);
    expect((await k.agents.hr.get('/feedback')).status).toBe(403);
    expect((await k.agents.hr.post('/feedback').send(entry('MARKET'))).status).toBe(403);
  });

  it('status changes: author or manager only; links to a proposal', async () => {
    const e = (await k.agents.execA1.post('/feedback').send(entry('MARKET', { title: 'Price sensitivity in tier-2 cities' }))).body.data;
    expect((await k.agents.execA2.patch(`/feedback/${e.id}`).send({ status: 'REVIEWED' })).status).toBe(404);
    expect((await k.agents.execA1.patch(`/feedback/${e.id}`).send({ status: 'REVIEWED' })).body.data.status).toBe('REVIEWED');
    const prop = (await k.agents.teamLead.post('/proposals').send({ type: 'OFFER', title: 'Tier-2 offer', rationale: 'Respond to price sensitivity in tier-2' })).body.data;
    const linked = await k.agents.managerA.patch(`/feedback/${e.id}`).send({ proposalId: prop.id, status: 'ACTIONED' });
    expect(linked.status).toBe(200);
    expect(linked.body.data).toMatchObject({ proposalId: prop.id, status: 'ACTIONED' });
    expect((await k.agents.teamLead.get(`/proposals/${prop.id}`)).body.data.feedback.map((f: { id: string }) => f.id)).toEqual([e.id]);
    expect((await k.agents.execA1.patch(`/feedback/${e.id}`).send({ proposalId: '11111111-1111-4111-8111-111111111111' })).status).toBe(404);
    expect((await k.agents.execA1.patch(`/feedback/${e.id}`).send({})).status).toBe(400);
  });

  it('Marketing and Student Success add org-level learner/market intelligence and read it', async () => {
    const mk = await createUser(k.prisma, k.fx.org, { roles: ['MARKETING'] });
    const agent = await loginAgent(k.t.app, mk);
    const r = await agent.post('/feedback').send(entry('MARKET', { title: 'Webinar attendees want weekend slots' }));
    expect(r.status).toBe(201);
    const seen = new Set(((await agent.get('/feedback').query({ limit: 100 })).body.data as Array<{ id: string }>).map((x) => x.id));
    expect(seen.size).toBeGreaterThan(1); // org scope: sees other people's entries too
  });

  it('growth opportunity tracker: type, estimate, owner, status, scoped', async () => {
    const g = await k.agents.managerA.post('/growth-opportunities').send({ type: 'CHANNEL', title: 'WhatsApp communities', description: 'Seed learner communities on WhatsApp for referrals', estimatedValue: '500000.00' });
    expect(g.status).toBe(201);
    expect(g.body.data).toMatchObject({ type: 'CHANNEL', status: 'IDEA', estimatedValue: '500000.00', currency: 'INR', isEstimate: true, ownerId: k.fx.managerA.id });
    const own = await k.agents.execA1.post('/growth-opportunities').send({ type: 'SEGMENT', title: 'Working women re-skilling', description: 'A new segment worth testing in the next webinar' });
    expect(own.body.data.estimatedValue).toBeNull();
    // delegating ownership: manager may assign within the team, an executive may not assign others
    const assigned = await k.agents.managerA.post('/growth-opportunities').send({ type: 'OTHER', title: 'Alumni referral drive', description: 'Referral rewards for alumni who bring peers', ownerId: k.fx.execA1.id });
    expect(assigned.body.data.ownerId).toBe(k.fx.execA1.id);
    expect((await k.agents.execA1.post('/growth-opportunities').send({ type: 'OTHER', title: 'Alumni referral drive', description: 'Assign to peer should fail', ownerId: k.fx.execA2.id })).status).toBe(404);
    const up = await k.agents.managerA.patch(`/growth-opportunities/${g.body.data.id}`).send({ status: 'PILOT' });
    expect(up.body.data.status).toBe('PILOT');
    expect((await k.agents.execA2.patch(`/growth-opportunities/${g.body.data.id}`).send({ status: 'DROPPED' })).status).toBe(404);
    const list = await k.agents.execA1.get('/growth-opportunities');
    const ids = (list.body.data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(own.body.data.id);
    expect(ids).not.toContain(g.body.data.id);
    expect((await k.agents.teamLead.get('/growth-opportunities').query({ type: 'CHANNEL' })).body.data.map((x: { id: string }) => x.id)).toContain(g.body.data.id);
    expect((await k.agents.hr.get('/growth-opportunities')).status).toBe(403);
  });
});

describe('strategy plans and revenue settings', () => {
  it('plans and initiatives are managed by Team Lead / Founder and visible to managers and above only', async () => {
    const p = await k.agents.teamLead.post('/strategy-plans').send({ title: 'Q4 enrolment push', summary: 'Concentrate on webinar-to-demo conversion and referrals', status: 'ACTIVE' });
    expect(p.status).toBe(201);
    const i = await k.agents.teamLead.post(`/strategy-plans/${p.body.data.id}/initiatives`).send({ title: 'Weekly demo blitz', ownerId: k.fx.managerA.id, dueOn: '2026-12-15' });
    expect(i.status).toBe(201);
    expect(i.body.data.initiatives).toHaveLength(1);
    const upd = await k.agents.teamLead.patch(`/strategy-initiatives/${i.body.data.initiatives[0].id}`).send({ status: 'IN_PROGRESS' });
    expect(upd.body.data.initiatives[0].status).toBe('IN_PROGRESS');
    expect((await k.agents.managerA.get('/strategy-plans')).status).toBe(200);
    expect((await k.agents.execA1.get('/strategy-plans')).status).toBe(403);
    expect((await k.agents.managerA.post('/strategy-plans').send({ title: 'Mine', summary: 'Managers cannot author company strategy' })).status).toBe(403);
    expect((await k.agents.finance.get('/strategy-plans')).status).toBe(403);
  });

  it('settings: readable by sales leadership, Founder-only edits, validated and audited', async () => {
    const g = await k.agents.managerA.get('/revenue/settings');
    expect(g.status).toBe(200);
    expect(g.body.data).toMatchObject({ fiscalYearStartMonth: 4, stageProbabilitiesAreDefaults: true, defaultPaymentDueDays: 7, currency: 'INR' });
    expect(g.body.data.stageProbabilities).toMatchObject({ NEGOTIATION: '0.60', PAYMENT_PENDING: '0.85' });
    expect((await k.agents.teamLead.patch('/revenue/settings').send({ paymentTolerance: '1.00' })).status).toBe(403);
    expect((await k.agents.founder.patch('/revenue/settings').send({ stageProbabilities: { NEGOTIATION: '1.5' } })).status).toBe(400);
    expect((await k.agents.founder.patch('/revenue/settings').send({ defaultHighValueThreshold: '-1' })).status).toBe(400);
    const set = await k.agents.founder.patch('/revenue/settings').send({ stageProbabilities: { NEGOTIATION: '0.5' }, defaultPaymentDueDays: 10 });
    expect(set.body.data).toMatchObject({ stageProbabilitiesAreDefaults: false, defaultPaymentDueDays: 10 });
    expect(set.body.data.stageProbabilities.NEGOTIATION).toBe('0.5');
    expect(await k.prisma.auditLog.count({ where: { organizationId: k.fx.org.id, action: 'org.settings_changed', entityType: 'revenue_settings' } })).toBeGreaterThan(0);
    await k.agents.founder.patch('/revenue/settings').send({ stageProbabilities: { NEGOTIATION: '0.60' }, defaultPaymentDueDays: 7 });
  });
});
