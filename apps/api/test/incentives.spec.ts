import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from './helpers';

let t: TestApp;
let fx: OrgFixture;
let A: Record<'founder' | 'teamLead' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'admin' | 'hr' | 'finance', AuthedAgent>;
let policyId: string;
let recId: string;

// Fixture numbers only; the product ships NO default rates (DEC-015).
const policyBody = { name: '[TEST] policy', structure: { basis: 'COLLECTION', slabs: [{ minPct: 80, maxPct: 100, ratePct: 1 }, { minPct: 100, maxPct: null, ratePct: 2 }], clawbackWindowDays: 30, cap: null } };
const inputs = { target: 1000, collections: 1100, refunds: 0 };
const now = new Date();
// current calendar month (policies take effect when approved, so earlier periods are not covered)
const period = {
  periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
  periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
};
const trans = (a: AuthedAgent, id: string, body: object) => a.post(`/incentives/recommendations/${id}/transition`).send(body);

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  A = {
    founder: await loginAgent(t.app, fx.founder), teamLead: await loginAgent(t.app, fx.teamLead), managerA: await loginAgent(t.app, fx.managerA), managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1), execA2: await loginAgent(t.app, fx.execA2), execB1: await loginAgent(t.app, fx.execB1),
    admin: await loginAgent(t.app, fx.admin), hr: await loginAgent(t.app, fx.hr), finance: await loginAgent(t.app, fx.finance),
  };
});
afterAll(async () => { await t.close(); });

describe('incentive policy', () => {
  it('starts as POLICY_NOT_CONFIGURED and refuses recommendations (409)', async () => {
    expect((await A.founder.get('/incentives/policies')).body.data.state).toBe('POLICY_NOT_CONFIGURED');
    const res = await A.managerA.post('/incentives/recommendations').send({ employeeId: fx.execA1.id, ...period, inputs });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POLICY_NOT_CONFIGURED');
  });

  it('is drafted by Founder/Team Lead and approved by the Founder only; admin sees nothing', async () => {
    expect((await A.managerA.post('/incentives/policies').send(policyBody)).status).toBe(403);
    expect((await A.admin.get('/incentives/policies')).status).toBe(403);
    const empty = await A.teamLead.post('/incentives/policies').send({ name: '[TEST] empty', structure: { basis: 'REVENUE' } });
    expect(empty.status).toBe(201);
    expect((await A.founder.post(`/incentives/policies/${empty.body.data.id}/approve`).send({})).status).toBe(422); // nothing configured
    const res = await A.teamLead.post('/incentives/policies').send(policyBody);
    policyId = res.body.data.id;
    expect((await A.teamLead.post(`/incentives/policies/${policyId}/approve`).send({})).status).toBe(403);
    expect((await A.hr.post(`/incentives/policies/${policyId}/approve`).send({})).status).toBe(403);
    expect((await A.founder.post(`/incentives/policies/${policyId}/approve`).send({})).body.data.status).toBe('APPROVED');
    const audit = await t.prisma.auditLog.findFirst({ where: { entityId: policyId, action: 'incentive.policy_approved' } });
    expect(audit?.actorId).toBe(fx.founder.id);
  });

  it('approved policy versions are immutable; a newer approved version supersedes the old', async () => {
    const res = await A.teamLead.patch(`/incentives/policies/${policyId}`).send({ name: 'changed' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POLICY_IMMUTABLE');
    const v2 = await A.teamLead.post('/incentives/policies').send({ ...policyBody, name: '[TEST] policy v3' });
    await A.founder.post(`/incentives/policies/${v2.body.data.id}/approve`).send({});
    const list = (await A.founder.get('/incentives/policies')).body.data;
    expect(list.policies.filter((p: { status: string }) => p.status === 'APPROVED')).toHaveLength(1);
    expect(list.policies.find((p: { id: string }) => p.id === policyId).status).toBe('SUPERSEDED');
  });
});

describe('incentive recommendation workflow', () => {
  it('Manager creates for own team only; engine result is stored with an immutable inputs snapshot', async () => {
    expect((await A.managerA.post('/incentives/recommendations').send({ employeeId: fx.execB1.id, ...period, inputs })).status).toBe(404);
    expect((await A.execA1.post('/incentives/recommendations').send({ employeeId: fx.execA1.id, ...period, inputs })).status).toBe(403);
    expect((await A.managerA.post('/incentives/recommendations').send({ employeeId: fx.execA1.id, ...period })).status).toBe(422); // no provider -> INPUTS_REQUIRED
    const res = await A.managerA.post('/incentives/recommendations').send({ employeeId: fx.execA1.id, ...period, inputs });
    expect(res.status).toBe(201);
    recId = res.body.data.id;
    expect(res.body.data).toMatchObject({ status: 'CALCULATED', computedAmount: '22', inputSource: 'MANUAL', snapshotVersion: 1 });
    expect(res.body.data.inputs).toMatchObject(inputs);
    expect(res.body.data.breakdown.achievementPct).toBe('110.00');
    expect((await A.managerA.post('/incentives/recommendations').send({ employeeId: fx.execA1.id, ...period, inputs })).status).toBe(409);
  });

  it('rejects illegal transitions at every step', async () => {
    expect((await trans(A.founder, recId, { to: 'APPROVED' })).status).toBe(409); // CALCULATED -> APPROVED
    expect((await A.finance.post(`/incentives/recommendations/${recId}/mark-paid`).send({ reference: 'UTR123' })).status).toBe(409);
    expect((await trans(A.managerA, recId, { to: 'CLAWBACK_PROPOSED' })).status).toBe(400);
    expect((await trans(A.execA1, recId, { to: 'SUBMITTED' })).status).toBe(403);
  });

  it('submit -> (manager cannot approve) -> Founder approves with override rules', async () => {
    expect((await trans(A.managerA, recId, { to: 'SUBMITTED', comments: 'Strong month' })).body.data.status).toBe('SUBMITTED');
    expect((await trans(A.managerA, recId, { to: 'APPROVED' })).status).toBe(403);
    expect((await trans(A.teamLead, recId, { to: 'APPROVED' })).status).toBe(403);
    expect((await trans(A.hr, recId, { to: 'APPROVED' })).status).toBe(403);
    const over = await trans(A.founder, recId, { to: 'APPROVED', approvedAmount: 50 });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('OVERRIDE_REASON_REQUIRED');
    const ok = await trans(A.founder, recId, { to: 'APPROVED', approvedAmount: 50, overrideReason: 'Exceptional enrolment quality' });
    expect(ok.body.data).toMatchObject({ status: 'APPROVED', approvedAmount: '50', overrideReason: 'Exceptional enrolment quality' });
  });

  it('hold/release by Finance or Founder; only Finance marks paid; payout never executes in SalesOS', async () => {
    expect((await trans(A.managerA, recId, { to: 'ON_HOLD', reason: 'refund window open' })).status).toBe(403);
    expect((await trans(A.finance, recId, { to: 'ON_HOLD', reason: 'refund window open' })).body.data.status).toBe('ON_HOLD');
    expect((await A.finance.post(`/incentives/recommendations/${recId}/mark-paid`).send({ reference: 'UTR123' })).status).toBe(409); // held
    expect((await trans(A.founder, recId, { to: 'RELEASED' })).body.data.status).toBe('APPROVED');
    expect((await A.founder.post(`/incentives/recommendations/${recId}/mark-paid`).send({ reference: 'UTR123' })).status).toBe(403);
    expect((await A.teamLead.post(`/incentives/recommendations/${recId}/mark-paid`).send({ reference: 'UTR123' })).status).toBe(403);
    const paid = await A.finance.post(`/incentives/recommendations/${recId}/mark-paid`).send({ reference: 'UTR123' });
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({ status: 'PAID', paymentReference: 'UTR123' });
    expect((await trans(A.founder, recId, { to: 'APPROVED' })).status).toBe(409);
    expect((await trans(A.founder, recId, { to: 'REJECTED', reason: 'too late to reject' })).status).toBe(409);
  });

  it('audits every step with the acting user and emits outbox events', async () => {
    const audit = await t.prisma.auditLog.findMany({ where: { entityId: recId, entityType: 'incentive_recommendation' }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => [a.action, a.actorId])).toEqual([
      ['incentive.calculated', fx.managerA.id], ['incentive.submitted', fx.managerA.id], ['incentive.approved', fx.founder.id], ['incentive.held', fx.finance.id], ['incentive.released', fx.founder.id], ['incentive.paid', fx.finance.id],
    ]);
    const events = await t.prisma.outboxEvent.findMany({ where: { aggregateId: recId } });
    expect(events.map((e) => e.eventType).sort()).toEqual(['incentive.approved', 'incentive.calculated', 'incentive.held', 'incentive.paid', 'incentive.released', 'incentive.submitted']);
    const history = (await A.founder.get(`/incentives/recommendations/${recId}`)).body.data.history;
    expect(history.map((h: { to: string }) => h.to)).toEqual(['CALCULATED', 'SUBMITTED', 'APPROVED', 'ON_HOLD', 'APPROVED', 'PAID']);
  });

  it('visibility: employee gets a status-only projection of their own; others, other teams and admin are denied', async () => {
    const mine = (await A.execA1.get('/incentives/recommendations')).body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'PAID', statusOnly: true });
    expect(mine[0]).not.toHaveProperty('computedAmount');
    expect(mine[0]).not.toHaveProperty('inputs');
    expect((await A.execA1.get(`/incentives/recommendations/${recId}`)).body.data.statusOnly).toBe(true);
    expect((await A.execA2.get(`/incentives/recommendations/${recId}`)).status).toBe(404);
    expect((await A.managerB.get(`/incentives/recommendations/${recId}`)).status).toBe(404);
    expect((await A.managerA.get(`/incentives/recommendations/${recId}`)).body.data.computedAmount).toBe('22');
    expect((await A.finance.get(`/incentives/recommendations/${recId}`)).body.data.statusOnly).toBe(false);
    expect((await A.admin.get('/incentives/recommendations')).status).toBe(403);
  });

  it('reject is terminal; recalculation creates a new snapshot version; a rejected period can be redone', async () => {
    const mk = async () => (await A.managerA.post('/incentives/recommendations').send({ employeeId: fx.execA2.id, ...period, inputs })).body.data.id;
    const id = await mk();
    await trans(A.managerA, id, { to: 'SUBMITTED' });
    const re = await trans(A.managerA, id, { to: 'CALCULATED', reason: 'Collections corrected', inputs: { ...inputs, collections: 900 } });
    expect(re.body.data).toMatchObject({ status: 'CALCULATED', snapshotVersion: 2, computedAmount: '9' });
    await trans(A.managerA, id, { to: 'SUBMITTED' });
    expect((await trans(A.founder, id, { to: 'REJECTED', reason: 'x' })).status).toBe(400);
    expect((await trans(A.founder, id, { to: 'REJECTED', reason: 'Quality concerns on two deals' })).body.data.status).toBe('REJECTED');
    expect((await trans(A.managerA, id, { to: 'SUBMITTED' })).status).toBe(409);
    expect((await trans(A.founder, id, { to: 'APPROVED' })).status).toBe(409);
    expect(await mk()).toBeTruthy();
  });

  it('clawback adjustments are decided by the Founder or Finance and never auto-applied', async () => {
    await t.prisma.incentiveRecommendation.update({ where: { id: recId }, data: { status: 'CLAWBACK_PROPOSED' } });
    const adj = await t.prisma.incentiveAdjustment.create({ data: { organizationId: fx.org.id, recommendationId: recId, employeeId: fx.execA1.id, refundId: '22222222-2222-4222-8222-222222222222', proposedAmount: '10.00' } });
    expect((await A.managerA.get('/incentives/adjustments')).body.data).toHaveLength(1);
    expect((await trans(A.managerA, recId, { to: 'ADJUSTED', adjustmentId: adj.id, decidedAmount: 10 })).status).toBe(403);
    const res = await trans(A.finance, recId, { to: 'ADJUSTED', adjustmentId: adj.id, decidedAmount: 8 });
    expect(res.body.data.status).toBe('ADJUSTED');
    expect(res.body.data.adjustments[0]).toMatchObject({ status: 'APPLIED', decidedAmount: '8' });
    expect((await trans(A.founder, recId, { to: 'WAIVED', adjustmentId: adj.id, reason: 'too late' })).status).toBe(409); // terminal
  });
});
