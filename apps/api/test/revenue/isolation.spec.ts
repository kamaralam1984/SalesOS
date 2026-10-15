import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RefundProcessedPayload } from '@salesos/shared-types';
import { createUser, loginAgent } from '../helpers';
import { buildKit, collect, makeLead, createDeal, wonDeal, type RevenueKit } from './kit';

let k: RevenueKit;
let k2: RevenueKit;
beforeAll(async () => { k = await buildKit(); k2 = await buildKit(); });
afterAll(async () => { await k.close(); await k2.close(); });

describe('role-scoped deal visibility', () => {
  it('executive: own only. peer executive: 404. manager: own team, sibling team 404. cross-org: 404 for every verb', async () => {
    const mine = await wonDeal(k, { ownerKey: 'execA1' });
    const peer = await wonDeal(k, { ownerKey: 'execA2' });
    const sibling = await wonDeal(k, { ownerKey: 'execB1' });
    const foreign = await wonDeal(k2, { ownerKey: 'execA1' });
    const ids = async (agent: typeof k.agents.execA1) => new Set(((await agent.get('/deals').query({ limit: 100 })).body.data as Array<{ id: string }>).map((d) => d.id));
    const ex = await ids(k.agents.execA1);
    expect([ex.has(mine.dealId), ex.has(peer.dealId), ex.has(sibling.dealId), ex.has(foreign.dealId)]).toEqual([true, false, false, false]);
    const mg = await ids(k.agents.managerA);
    expect([mg.has(mine.dealId), mg.has(peer.dealId), mg.has(sibling.dealId)]).toEqual([true, true, false]);
    const mgB = await ids(k.agents.managerB);
    expect([mgB.has(mine.dealId), mgB.has(sibling.dealId)]).toEqual([false, true]);
    for (const who of ['teamLead', 'founder', 'finance'] as const) {
      const all = await ids(k.agents[who]);
      expect([all.has(mine.dealId), all.has(peer.dealId), all.has(sibling.dealId), all.has(foreign.dealId)], who).toEqual([true, true, true, false]);
    }
    for (const who of ['hr', 'admin'] as const) expect((await k.agents[who].get('/deals')).status, who).toBe(403);

    const verbs = (agent: typeof k.agents.execA1, id: string) => [
      () => agent.get(`/deals/${id}`),
      () => agent.patch(`/deals/${id}`).send({ note: 'poking' }),
      () => agent.post(`/deals/${id}/close`).send({ outcome: 'LOST', lostReason: 'PRICE' }),
      () => agent.post(`/deals/${id}/escalate`).send({ note: 'not my deal' }),
      () => agent.post(`/deals/${id}/reopen`).send({ reason: 'not my deal' }),
    ];
    for (const [who, deal] of [['execA1', peer.dealId], ['execA1', sibling.dealId], ['managerA', sibling.dealId], ['managerB', mine.dealId], ['execA2', mine.dealId], ['execB1', mine.dealId]] as const) {
      for (const req of verbs(k.agents[who], deal)) expect((await req()).status, `${who} on ${deal}`).toBe(404);
    }
    for (const req of verbs(k2.agents.founder, mine.dealId)) expect((await req()).status, 'other org').toBe(404);
    for (const req of verbs(k.agents.founder, foreign.dealId)) expect((await req()).status, 'other org').toBe(404);
    expect((await k.agents.execA1.get(`/leads/${peer.leadId}/deals`)).body.data).toEqual([]);
    expect((await k2.agents.founder.get(`/leads/${mine.leadId}/deals`)).body.data).toEqual([]);
    // none of the probing changed anything
    expect((await k.prisma.deal.findUniqueOrThrow({ where: { id: peer.dealId } })).stage).toBe('WON');
  });

  it('pipeline counts and amounts are scoped to the caller', async () => {
    const e = await k.agents.execA1.get('/deals/pipeline');
    const all = await k.agents.founder.get('/deals/pipeline');
    const won = (r: typeof e) => r.body.data.find((x: { stage: string }) => x.stage === 'WON');
    expect(won(e).count).toBeGreaterThan(0);
    expect(won(all).count).toBeGreaterThan(won(e).count);
    expect(Number(won(all).amount.replace('.', ''))).toBeGreaterThan(Number(won(e).amount.replace('.', '')));
  });

  it('Student Success sees a minimum-data projection (no amounts, money, lead identity or notes)', async () => {
    const w = await wonDeal(k);
    await collect(k, w.dealId);
    const ss = await createUser(k.prisma, k.fx.org, { roles: ['STUDENT_SUCCESS'] });
    const agent = await loginAgent(k.t.app, ss);
    const list = await agent.get('/deals').query({ limit: 100 });
    expect(list.status).toBe(200);
    const row = (list.body.data as Array<Record<string, unknown>>).find((d) => d.id === w.dealId)!;
    expect(row).toMatchObject({ amount: null, money: null, leadName: null, note: null, stage: 'WON' });
    const detail = await agent.get(`/deals/${w.dealId}`);
    expect(detail.body.data.money).toBeNull();
    expect(detail.body.data.payments).toBeUndefined();
    expect((await agent.get('/collections')).status).toBe(403);
    expect((await agent.post(`/deals/${w.dealId}/close`).send({ outcome: 'LOST', lostReason: 'PRICE' })).status).toBe(403);
    const pipe = await agent.get('/deals/pipeline');
    expect(pipe.body.data.every((s: { amount: unknown }) => s.amount === null)).toBe(true);
  });

  it('deal detail only embeds payments/refunds the caller may read', async () => {
    const w = await wonDeal(k);
    await collect(k, w.dealId);
    const exec = await k.agents.execA1.get(`/deals/${w.dealId}`);
    expect(exec.body.data.payments.map((p: { status: string }) => p.status).sort()).toEqual(['EXPECTED', 'VERIFIED']); // the planned installment stays visible next to the verified payment
    expect(exec.body.data.payments.find((p: { status: string }) => p.status === 'VERIFIED')).toMatchObject({ amount: '50000.00' });
    expect(exec.body.data.money.collected).toBe('50000.00');
    const fin = await k.agents.finance.get(`/deals/${w.dealId}`);
    expect(fin.body.data.salesRecord.credits[0].userId).toBe(w.ownerId);
    expect(fin.body.data.history.length).toBeGreaterThan(1);
  });

  it('admin and HR hold no revenue permission (DEC-032): every revenue read is denied', async () => {
    for (const who of ['admin', 'hr'] as const) {
      for (const path of ['/deals', '/collections', '/refunds', '/targets', '/forecasts', '/proposals', '/feedback', '/growth-opportunities', '/strategy-plans', '/revenue/programs']) {
        expect((await k.agents[who].get(path)).status, `${who} GET ${path}`).toBe(403);
      }
    }
  });
});

describe('cross-organisation isolation of money records', () => {
  it('payments and refunds from another organisation are unreachable even with a valid id', async () => {
    const f = await wonDeal(k2);
    const payId = await collect(k2, f.dealId);
    const rf = await k2.agents.execA1.post('/refunds').send({ dealId: f.dealId, amount: '100.00', reasonCategory: 'OTHER', reason: 'cross org probe test' });
    expect(rf.status).toBe(201);
    expect((await k.agents.finance.post(`/collections/${payId}/verify`).send({})).status).toBe(404);
    expect((await k.agents.finance.post(`/collections/${payId}/reverse`).send({ reason: 'cross org probe' })).status).toBe(404);
    expect((await k.agents.finance.post('/collections/reconciliation/run').send({ statementRef: 'X-ORG', paymentIds: [payId] })).body.data.matchedCount).toBe(0);
    for (const agent of [k.agents.founder, k.agents.finance, k.agents.teamLead]) {
      expect((await agent.get(`/collections/${payId}`)).status).toBe(404);
      expect((await agent.get(`/refunds/${rf.body.data.id}`)).status).toBe(404);
    }
    for (const agent of [k.agents.founder, k.agents.teamLead]) {
      expect((await agent.post('/collections').send({ dealId: f.dealId, amount: '1.00', method: 'UPI', externalTransactionRef: 'CROSS-ORG-1', paidAt: new Date().toISOString() })).status).toBe(404);
      expect((await agent.post('/refunds').send({ dealId: f.dealId, amount: '1.00', reasonCategory: 'OTHER', reason: 'cross org probe test' })).status).toBe(404);
    }
    expect((await k.agents.founder.post(`/refunds/${rf.body.data.id}/approve`).send({ reason: 'cross org' })).status).toBe(404);
    expect((await k.agents.finance.post(`/refunds/${rf.body.data.id}/process`).send({ externalRef: 'X-ORG-1', method: 'UPI' })).status).toBe(404);
    expect(await k.prisma.payment.count({ where: { externalTransactionRef: 'CROSS-ORG-1' } })).toBe(0);
    // the same external reference may exist independently in two organisations
    const mine = await wonDeal(k);
    const r1 = await k.agents.managerA.post('/collections').send({ dealId: mine.dealId, amount: '1000.00', method: 'UPI', externalTransactionRef: 'SHARED-REF-1', paidAt: new Date().toISOString() });
    const r2 = await k2.agents.managerA.post('/collections').send({ dealId: f.dealId, amount: '1000.00', method: 'UPI', externalTransactionRef: 'SHARED-REF-1', paidAt: new Date().toISOString() });
    expect([r1.status, r2.status]).toEqual([201, 201]);
  });
});

describe('event contracts', () => {
  it('refund.processed is assignable to the people module RefundProcessedPayload (incentive clawback consumer)', async () => {
    const w = await wonDeal(k);
    await collect(k, w.dealId);
    const id = (await k.agents.execA1.post('/refunds').send({ dealId: w.dealId, amount: '2500.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Learner request for refund' })).body.data.id;
    await k.agents.managerA.post(`/refunds/${id}/review`).send({ note: 'Verified with learner', recommendation: 'APPROVE' });
    await k.agents.finance.post(`/refunds/${id}/approve`).send({ reason: 'Approved per policy' });
    await k.agents.finance.post(`/refunds/${id}/process`).send({ externalRef: 'CONTRACT-1', method: 'UPI' });
    const ev = await k.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: id, eventType: 'refund.processed' } });
    const p = ev.payload as unknown as RefundProcessedPayload;
    const contract: RefundProcessedPayload = { refundId: p.refundId, organizationId: p.organizationId, dealId: p.dealId, paymentId: p.paymentId, attributedUserId: p.attributedUserId, amount: p.amount, currency: p.currency, processedAt: p.processedAt, paymentCollectedAt: p.paymentCollectedAt };
    expect(contract).toMatchObject({ refundId: id, organizationId: k.fx.org.id, dealId: w.dealId, attributedUserId: w.ownerId, amount: '2500.00', currency: 'INR' });
    expect(Number.isNaN(Date.parse(contract.processedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(contract.paymentCollectedAt ?? ''))).toBe(false);
    expect(ev.aggregateType).toBe('refund');
    void makeLead; void createDeal;
  });
});
