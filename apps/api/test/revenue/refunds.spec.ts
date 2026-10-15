import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, loginAgent } from '../helpers';
import { buildKit, collect, idem, wonDeal, type RevenueKit } from './kit';

let k: RevenueKit;
beforeAll(async () => { k = await buildKit(); });
afterAll(async () => { await k.close(); });

async function collectedDeal(amount = '50000.00') {
  const w = await wonDeal(k, { amount });
  const payId = await collect(k, w.dealId, amount);
  return { ...w, payId };
}
const request = (agent: typeof k.agents.execA1, dealId: string, over: Record<string, unknown> = {}, key?: string) => {
  const r = agent.post('/refunds');
  if (key) r.set('Idempotency-Key', key);
  return r.send({ dealId, amount: '10000.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Learner asked to cancel enrolment', ...over });
};
const review = (id: string, agent = k.agents.managerA) => agent.post(`/refunds/${id}/review`).send({ note: 'Checked with the learner', recommendation: 'APPROVE' });
const approve = (id: string, agent = k.agents.finance, body: Record<string, unknown> = {}) => agent.post(`/refunds/${id}/approve`).send({ reason: 'Within policy', ...body });
const processIt = (id: string, ref = `RFND-${Math.random().toString(36).slice(2, 10)}`, agent = k.agents.finance) => agent.post(`/refunds/${id}/process`).send({ externalRef: ref, method: 'BANK_TRANSFER' });

describe('refund lifecycle', () => {
  it('requested -> reviewed -> approved -> processed -> reconciled, each step with actor, role, timestamp and reason; net collections drop only when processed', async () => {
    const w = await collectedDeal();
    const req = await request(k.agents.execA1, w.dealId, { amount: '12000.00' });
    expect(req.status).toBe(201);
    const id = req.body.data.id;
    expect(req.body.data).toMatchObject({ status: 'REQUESTED', amount: '12000.00', requested: { id: k.fx.execA1.id, role: 'SALES_EXECUTIVE' } });

    const rv = await review(id);
    expect(rv.body.data).toMatchObject({ status: 'REVIEWED', reviewed: { id: k.fx.managerA.id, role: 'SALES_MANAGER' }, recommendation: 'APPROVE', reviewNote: 'Checked with the learner' });
    let money = (await k.agents.execA1.get(`/deals/${w.dealId}`)).body.data.money;
    expect(money).toMatchObject({ collected: '50000.00', refunded: '0.00', netCollections: '50000.00', refundOpenRequests: '12000.00' });

    const ap = await approve(id, k.agents.finance, { approvedAmount: '10000.00' });
    expect(ap.body.data).toMatchObject({ status: 'APPROVED', amount: '12000.00', approvedAmount: '10000.00', approved: { id: k.fx.finance.id, role: 'FINANCE' }, approvalReason: 'Within policy' });
    money = (await k.agents.execA1.get(`/deals/${w.dealId}`)).body.data.money;
    expect(money).toMatchObject({ refunded: '0.00', netCollections: '50000.00', refundApprovedNotProcessed: '10000.00' }); // approved != paid out

    const pr = await processIt(id, 'RFND-HAPPY-1');
    expect(pr.body.data).toMatchObject({ status: 'PROCESSED', processedAmount: '10000.00', externalRef: 'RFND-HAPPY-1', processed: { id: k.fx.finance.id, role: 'FINANCE' }, processMethod: 'BANK_TRANSFER' });
    money = (await k.agents.execA1.get(`/deals/${w.dealId}`)).body.data.money;
    expect(money).toMatchObject({ collected: '50000.00', refunded: '10000.00', netCollections: '40000.00', refundApprovedNotProcessed: '0.00' });

    const rc = await k.agents.finance.post(`/refunds/${id}/reconcile`).send({ statementRef: 'HDFC-OCT-REF' });
    expect(rc.body.data).toMatchObject({ status: 'RECONCILED', statementRef: 'HDFC-OCT-REF', reconciled: { id: k.fx.finance.id } });

    const detail = await k.agents.founder.get(`/refunds/${id}`);
    expect(detail.body.data.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['REQUESTED', 'REVIEWED', 'APPROVED', 'PROCESSED', 'RECONCILED']);
    for (const e of detail.body.data.events) {
      expect(e.actorId).toBeTruthy();
      expect(e.actorRole).toBeTruthy();
      expect(new Date(e.at).getTime()).toBeGreaterThan(0);
    }
    expect(detail.body.data.events[0].reason).toBe('Learner asked to cancel enrolment');
    // separate timestamps / actors for requested, approved, processed
    expect(detail.body.data.requested.at && detail.body.data.approved.at && detail.body.data.processed.at).toBeTruthy();
    expect(detail.body.data.requested.id).not.toBe(detail.body.data.approved.id);
    // every step audited
    for (const a of ['refund.requested', 'refund.reviewed', 'refund.approved', 'refund.processed', 'refund.reconciled']) expect(await k.prisma.auditLog.count({ where: { entityId: id, action: a } }), a).toBe(1);
  });

  it('publishes the refund.approved / refund.processed contract (superset of the incentive-clawback payload)', async () => {
    const w = await collectedDeal();
    const id = (await request(k.agents.execA1, w.dealId, { amount: '5000.00', paymentId: w.payId })).body.data.id;
    await review(id);
    await approve(id);
    await processIt(id, 'RFND-EVT-1');
    const approved = await k.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: id, eventType: 'refund.approved' } });
    expect(approved.payload).toMatchObject({ refundId: id, organizationId: k.fx.org.id, dealId: w.dealId, paymentId: w.payId, requestedAmount: '5000.00', approvedAmount: '5000.00', amount: '5000.00', approvedById: k.fx.finance.id, attributedUserId: w.ownerId, creditedOwners: [{ userId: w.ownerId, sharePct: '100.00' }], currency: 'INR' });
    const processed = await k.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: id, eventType: 'refund.processed' } });
    const p = processed.payload as Record<string, unknown>;
    expect(p).toMatchObject({ refundId: id, organizationId: k.fx.org.id, dealId: w.dealId, paymentId: w.payId, attributedUserId: w.ownerId, amount: '5000.00', currency: 'INR', externalRef: 'RFND-EVT-1' });
    expect(typeof p.processedAt).toBe('string');
    expect(typeof p.paymentCollectedAt).toBe('string'); // from the refunded payment's verification time
    expect(await k.prisma.outboxEvent.count({ where: { aggregateId: id, eventType: 'refund.approved' } })).toBe(1);
  });

  it('never moves money by itself: processing records a Finance statement and touches no payment row', async () => {
    const w = await collectedDeal();
    const before = await k.prisma.payment.findMany({ where: { dealId: w.dealId }, orderBy: { id: 'asc' } });
    const id = (await request(k.agents.execA1, w.dealId)).body.data.id;
    await review(id);
    await approve(id);
    await processIt(id);
    const after = await k.prisma.payment.findMany({ where: { dealId: w.dealId }, orderBy: { id: 'asc' } });
    expect(after.map((p) => [p.id, p.status, p.amount.toFixed(2), p.version])).toEqual(before.map((p) => [p.id, p.status, p.amount.toFixed(2), p.version]));
    expect(await k.prisma.payment.count({ where: { dealId: w.dealId, amount: { lt: 0 } } })).toBe(0);
  });
});

describe('illegal transitions are refused', () => {
  it.each([
    ['approve a requested refund', async (id: string) => approve(id)],
    ['process a requested refund', async (id: string) => processIt(id)],
    ['reject a requested refund', async (id: string) => k.agents.finance.post(`/refunds/${id}/reject`).send({ reason: 'no way' })],
    ['reconcile a requested refund', async (id: string) => k.agents.finance.post(`/refunds/${id}/reconcile`).send({ statementRef: 'S-1' })],
    ['cancel a requested refund', async (id: string) => k.agents.finance.post(`/refunds/${id}/cancel`).send({ reason: 'nope nope' })],
  ])('cannot %s', async (_n, act) => {
    const w = await collectedDeal();
    const id = (await request(k.agents.execA1, w.dealId)).body.data.id;
    const r = await act(id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_TRANSITION');
    expect((await k.prisma.refund.findUniqueOrThrow({ where: { id } })).status).toBe('REQUESTED');
  });

  it('terminal and later states stay put: no re-approval, no reject after approve, no cancel after process, no withdraw after review, rejected is final', async () => {
    const w = await collectedDeal();
    const a = (await request(k.agents.execA1, w.dealId, { amount: '1000.00' })).body.data.id;
    await review(a);
    expect((await k.agents.execA1.post(`/refunds/${a}/withdraw`).send({ reason: 'changed my mind' })).status).toBe(409);
    await approve(a);
    expect((await approve(a)).status).toBe(409);
    expect((await k.agents.finance.post(`/refunds/${a}/reject`).send({ reason: 'too late now' })).status).toBe(409);
    await processIt(a);
    expect((await k.agents.finance.post(`/refunds/${a}/cancel`).send({ reason: 'too late now' })).status).toBe(409);
    expect((await processIt(a)).status).toBe(409);

    const b = (await request(k.agents.execA1, w.dealId, { amount: '1000.00' })).body.data.id;
    await review(b);
    const rj = await k.agents.founder.post(`/refunds/${b}/reject`).send({ reason: 'Outside the refund window' });
    expect(rj.body.data).toMatchObject({ status: 'REJECTED', rejected: { id: k.fx.founder.id, role: 'FOUNDER_CEO' }, rejectionReason: 'Outside the refund window' });
    expect((await approve(b)).status).toBe(409);
    await expect(k.prisma.refund.update({ where: { id: b }, data: { reason: 'tamper' } })).rejects.toThrow(/terminal/);
  });

  it('withdraw (requester or Team Lead) and cancel-after-approval work and are recorded', async () => {
    const w = await collectedDeal();
    const a = (await request(k.agents.execA1, w.dealId, { amount: '1000.00' })).body.data.id;
    expect((await k.agents.execA2.post(`/refunds/${a}/withdraw`).send({ reason: 'not mine to withdraw' })).status).toBe(404);
    const wd = await k.agents.execA1.post(`/refunds/${a}/withdraw`).send({ reason: 'Learner changed their mind' });
    expect(wd.body.data).toMatchObject({ status: 'WITHDRAWN', closedReason: 'Learner changed their mind' });
    const b = (await request(k.agents.execA1, w.dealId, { amount: '1000.00' })).body.data.id;
    await review(b);
    await approve(b);
    const cn = await k.agents.founder.post(`/refunds/${b}/cancel`).send({ reason: 'Learner resumed the course' });
    expect(cn.body.data.status).toBe('CANCELLED');
  });

  it('concurrent approvals: exactly one wins', async () => {
    const w = await collectedDeal();
    const id = (await request(k.agents.execA1, w.dealId)).body.data.id;
    await review(id);
    const rs = await Promise.all([approve(id), approve(id, k.agents.founder), approve(id), approve(id, k.agents.founder), approve(id)]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await k.prisma.outboxEvent.count({ where: { aggregateId: id, eventType: 'refund.approved' } })).toBe(1);
    expect(await k.prisma.refundEvent.count({ where: { refundId: id, toStatus: 'APPROVED' } })).toBe(1);
  });
});

describe('authority (DEC-019) and separation of duties', () => {
  it('executives cannot review, approve or process; managers/team leads review but do not approve; the Founder approves but does not process', async () => {
    const w = await collectedDeal();
    const id = (await request(k.agents.execA1, w.dealId)).body.data.id;
    expect((await review(id, k.agents.execA1)).status).toBe(403);
    expect((await review(id, k.agents.founder)).status).toBe(200);
    for (const who of ['execA1', 'managerA', 'teamLead', 'hr', 'admin'] as const) expect((await approve(id, k.agents[who])).status, `approve by ${who}`).toBe(403);
    expect((await processIt(id, 'R-X', k.agents.founder)).status).toBe(403);
    expect((await approve(id, k.agents.founder)).status).toBe(200);
    for (const who of ['execA1', 'managerA', 'teamLead', 'founder', 'hr', 'admin'] as const) expect((await processIt(id, 'R-Y', k.agents[who])).status, `process by ${who}`).toBe(403);
    expect((await k.agents.managerA.post(`/refunds/${id}/reconcile`).send({ statementRef: 'S-2' })).status).toBe(403);
  });

  it('nobody reviews, approves or rejects a refund they requested', async () => {
    const w = await collectedDeal();
    const id = (await request(k.agents.founder, w.dealId)).body.data.id; // the Founder may request
    const selfReview = await review(id, k.agents.founder);
    expect(selfReview.status).toBe(403);
    expect(selfReview.body.error.code).toBe('SEPARATION_OF_DUTIES');
    expect((await review(id, k.agents.teamLead)).status).toBe(200);
    const selfApprove = await approve(id, k.agents.founder);
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error.code).toBe('SEPARATION_OF_DUTIES');
    expect((await k.agents.founder.post(`/refunds/${id}/reject`).send({ reason: 'rejecting my own' })).status).toBe(403);
    expect((await approve(id, k.agents.finance)).status).toBe(200);
  });

  it('refunds above the configured threshold need the Founder specifically', async () => {
    const w = await collectedDeal();
    expect((await k.agents.founder.patch('/revenue/settings').send({ refundFounderThreshold: '5000.00' })).status).toBe(200);
    try {
      const id = (await request(k.agents.execA1, w.dealId, { amount: '8000.00' })).body.data.id;
      await review(id);
      const f = await approve(id, k.agents.finance);
      expect(f.status).toBe(403);
      expect(f.body.error.code).toBe('FOUNDER_APPROVAL_REQUIRED');
      expect((await approve(id, k.agents.finance, { approvedAmount: '5000.00' })).status).toBe(200);
      const id2 = (await request(k.agents.execA1, w.dealId, { amount: '8000.00' })).body.data.id;
      await review(id2);
      expect((await approve(id2, k.agents.founder)).status).toBe(200);
    } finally {
      await k.agents.founder.patch('/revenue/settings').send({ refundFounderThreshold: null });
    }
  });
});

describe('amount rules', () => {
  it('cannot exceed verified collections minus refunds already committed; unverified money is not refundable', async () => {
    const w = await wonDeal(k);
    const none = await request(k.agents.execA1, w.dealId, { amount: '1.00' });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('REFUND_EXCEEDS_COLLECTED');
    await collect(k, w.dealId, '30000.00');
    const over = await request(k.agents.execA1, w.dealId, { amount: '30000.01' });
    expect(over.status).toBe(422);
    expect(over.body.error.details.refundable).toBe('30000.00');
    expect((await request(k.agents.execA1, w.dealId, { amount: '20000.00' })).status).toBe(201);
    const second = await request(k.agents.execA1, w.dealId, { amount: '10000.01' });
    expect(second.status).toBe(422);
    expect(second.body.error.details.refundable).toBe('10000.00');
    expect((await request(k.agents.execA1, w.dealId, { amount: '10000.00' })).status).toBe(201);
    for (const amount of ['0', '-1', '1.234', 'abc']) expect((await request(k.agents.execA1, w.dealId, { amount })).status).toBe(400);
  });

  it('concurrent requests cannot jointly exceed the collected amount', async () => {
    const w = await collectedDeal('20000.00');
    const rs = await Promise.all(Array.from({ length: 6 }, () => request(k.agents.execA1, w.dealId, { amount: '9000.00' })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
    expect(rs.filter((r) => r.status === 422)).toHaveLength(4);
  });

  it('the approved amount cannot exceed the requested amount; the refund must be tied to a verified payment of that deal', async () => {
    const w = await collectedDeal();
    const id = (await request(k.agents.execA1, w.dealId, { amount: '2000.00' })).body.data.id;
    await review(id);
    const big = await approve(id, k.agents.finance, { approvedAmount: '2000.01' });
    expect(big.status).toBe(422);
    expect(big.body.error.code).toBe('APPROVED_EXCEEDS_REQUESTED');
    const other = await collectedDeal();
    expect((await request(k.agents.execA1, w.dealId, { amount: '100.00', paymentId: other.payId })).status).toBe(404);
    const unverified = await wonDeal(k);
    const rec = await k.agents.managerA.post('/collections').send({ dealId: unverified.dealId, amount: '5000.00', method: 'UPI', externalTransactionRef: `UTR-${idem()}`, paidAt: new Date().toISOString() });
    await collect(k, unverified.dealId, '5000.00');
    expect((await request(k.agents.execA1, unverified.dealId, { amount: '100.00', paymentId: rec.body.data.id })).status).toBe(422);
  });

  it('a duplicate external payout reference is rejected', async () => {
    const w = await collectedDeal();
    const mk = async () => { const id = (await request(k.agents.execA1, w.dealId, { amount: '1000.00' })).body.data.id; await review(id); await approve(id); return id; };
    const a = await mk();
    const b = await mk();
    expect((await processIt(a, 'RFND-SAME')).status).toBe(200);
    const dup = await processIt(b, 'RFND-SAME');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_REFUND_REF');
    expect((await k.prisma.refund.findUniqueOrThrow({ where: { id: b } })).status).toBe('APPROVED');
  });

  it('idempotent request replays; a processed refund amount is frozen in the database', async () => {
    const w = await collectedDeal();
    const key = idem();
    const a = await request(k.agents.execA1, w.dealId, { amount: '1500.00' }, key);
    const b = await request(k.agents.execA1, w.dealId, { amount: '1500.00' }, key);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await k.prisma.refund.count({ where: { dealId: w.dealId } })).toBe(1);
    expect((await request(k.agents.execA1, w.dealId, { amount: '1.00' }, key)).status).toBe(422);
    const id = a.body.data.id;
    await review(id);
    await approve(id);
    await processIt(id);
    await expect(k.prisma.refund.update({ where: { id }, data: { processedAmount: '1.00' } })).rejects.toThrow(/cannot change/);
  });
});

describe('role-scoped refund visibility', () => {
  it('own / team / org scopes, summary-only Student Success, no cross-org or HR access', async () => {
    const mine = await collectedDeal();
    const peer = await wonDeal(k, { ownerKey: 'execA2' });
    await collect(k, peer.dealId);
    const sib = await wonDeal(k, { ownerKey: 'execB1' });
    await collect(k, sib.dealId);
    const rMine = (await request(k.agents.execA1, mine.dealId)).body.data.id;
    const rPeer = (await request(k.agents.execA2, peer.dealId)).body.data.id;
    const rSib = (await request(k.agents.execB1, sib.dealId)).body.data.id;
    const ids = async (agent: typeof k.agents.execA1) => new Set(((await agent.get('/refunds').query({ limit: 100 })).body.data as Array<{ id: string }>).map((r) => r.id));
    const e1 = await ids(k.agents.execA1);
    expect([e1.has(rMine), e1.has(rPeer), e1.has(rSib)]).toEqual([true, false, false]);
    const mA = await ids(k.agents.managerA);
    expect([mA.has(rMine), mA.has(rPeer), mA.has(rSib)]).toEqual([true, true, false]);
    const fin = await ids(k.agents.finance);
    expect([fin.has(rMine), fin.has(rPeer), fin.has(rSib)]).toEqual([true, true, true]);
    expect((await k.agents.execA1.get(`/refunds/${rPeer}`)).status).toBe(404);
    expect((await k.agents.managerA.get(`/refunds/${rSib}`)).status).toBe(404);
    expect((await k.agents.execA1.post(`/refunds/${rPeer}/withdraw`).send({ reason: 'poking at a peer' })).status).toBe(404);
    expect((await review(rSib, k.agents.managerA)).status).toBe(404);
    expect((await k.agents.hr.get('/refunds')).status).toBe(403);
    expect((await k.agents.admin.get('/refunds')).status).toBe(403);

    const ss = await createUser(k.prisma, k.fx.org, { roles: ['STUDENT_SUCCESS'] });
    const ssAgent = await loginAgent(k.t.app, ss);
    const list = await ssAgent.get('/refunds').query({ limit: 100 });
    expect(list.status).toBe(200);
    const row = (list.body.data as Array<Record<string, unknown>>).find((r) => r.id === rMine)!;
    expect(Object.keys(row).sort()).toEqual(['currency', 'dealId', 'id', 'reasonCategory', 'requestedAt', 'status']);
  });
});
