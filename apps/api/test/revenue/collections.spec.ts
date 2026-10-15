import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildKit, collect, createDeal, idem, makeLead, recordPayment, wonDeal, type RevenueKit } from './kit';

let k: RevenueKit;
beforeAll(async () => { k = await buildKit(); });
afterAll(async () => { await k.close(); });

const count = (dealId: string, status?: string) => k.prisma.payment.count({ where: { dealId, ...(status ? { status: status as 'VERIFIED' } : {}), externalTransactionRef: { not: null } } });

describe('recording payments', () => {
  it('records against a Closed-Won sale only, in the deal currency, and credits nothing until Finance verifies', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const open = (await createDeal(k, k.agents.execA1, lead.id)).body.data.id;
    const r = await recordPayment(k, k.agents.managerA, open);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DEAL_NOT_WON');

    const w = await wonDeal(k);
    const rec = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '20000.00' });
    expect(rec.status).toBe(201);
    expect(rec.body.data).toMatchObject({ status: 'RECORDED', amount: '20000.00', currency: 'INR', provider: 'MANUAL' });
    const d = await k.agents.execA1.get(`/deals/${w.dealId}`);
    expect(d.body.data.money).toMatchObject({ collected: '0.00', pendingVerification: '20000.00', amountDue: '50000.00' });
    expect((await recordPayment(k, k.agents.managerA, w.dealId, { currency: 'USD' })).status).toBe(400);
    expect((await recordPayment(k, k.agents.managerA, w.dealId, { amount: '0' })).status).toBe(400);
    expect((await recordPayment(k, k.agents.managerA, w.dealId, { externalTransactionRef: 'x' })).status).toBe(400);
  });

  it('executives (view only) and out-of-scope managers cannot record', async () => {
    const w = await wonDeal(k);
    expect((await recordPayment(k, k.agents.execA1, w.dealId)).status).toBe(403);
    expect((await recordPayment(k, k.agents.managerB, w.dealId)).status).toBe(404);
    expect((await recordPayment(k, k.agents.hr, w.dealId)).status).toBe(403);
  });

  it('turns an EXPECTED installment into the RECORDED payment and keeps the plan row', async () => {
    const w = await wonDeal(k, { plan: [{ amount: '20000.00', dueDate: '2026-11-01' }, { amount: '30000.00', dueDate: '2026-12-01' }] });
    const exp = await k.prisma.payment.findMany({ where: { dealId: w.dealId }, orderBy: { dueDate: 'asc' } });
    const rec = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '19999.00', expectedPaymentId: exp[0]!.id });
    expect(rec.status).toBe(201);
    expect(rec.body.data.id).toBe(exp[0]!.id);
    expect(rec.body.data).toMatchObject({ status: 'RECORDED', amount: '19999.00', expectedAmount: '20000.00' });
    expect(await k.prisma.payment.count({ where: { dealId: w.dealId } })).toBe(2);
    expect((await recordPayment(k, k.agents.managerA, w.dealId, { expectedPaymentId: exp[0]!.id })).status).toBe(409);
  });
});

describe('duplicate credit is impossible', () => {
  it('a repeated external transaction reference is rejected with 409 and gives no credit', async () => {
    const w = await wonDeal(k);
    const a = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '10000.00', externalTransactionRef: 'UTR-DUP-001' });
    expect(a.status).toBe(201);
    const b = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '10000.00', externalTransactionRef: 'UTR-DUP-001' });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('DUPLICATE_PAYMENT');
    expect(b.body.error.details.existingPaymentId).toBe(a.body.data.id);
    expect(await count(w.dealId)).toBe(1);
    // the same reference on another deal is also a duplicate within the provider
    const w2 = await wonDeal(k);
    expect((await recordPayment(k, k.agents.managerA, w2.dealId, { externalTransactionRef: 'UTR-DUP-001' })).status).toBe(409);
    // a different provider namespace is a different payment
    expect((await recordPayment(k, k.agents.managerA, w2.dealId, { externalTransactionRef: 'UTR-DUP-001', provider: 'RAZORPAY', amount: '5000.00' })).status).toBe(201);
    // the database enforces it too
    await expect(k.prisma.payment.create({ data: { organizationId: k.fx.org.id, dealId: w.dealId, ownerId: w.ownerId, status: 'RECORDED', amount: '1.00', provider: 'MANUAL', externalTransactionRef: 'UTR-DUP-001' } })).rejects.toThrow(/Unique constraint/);
  });

  it('concurrent requests with the same Idempotency-Key and reference create exactly one payment', async () => {
    const w = await wonDeal(k);
    const key = idem();
    const body = { amount: '15000.00', externalTransactionRef: 'UTR-CONC-1' };
    const rs = await Promise.all(Array.from({ length: 12 }, () => recordPayment(k, k.agents.managerA, w.dealId, body, key)));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.body.data.id)).size).toBe(1);
    expect(rs.filter((r) => r.body.data.replayed === false)).toHaveLength(1);
    expect(await count(w.dealId)).toBe(1);
    // same key with a different payload is refused
    const clash = await recordPayment(k, k.agents.managerA, w.dealId, { ...body, amount: '99.00' }, key);
    expect(clash.status).toBe(422);
    expect(clash.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('concurrent requests with the same reference but different keys produce one payment and 409s', async () => {
    const w = await wonDeal(k);
    const rs = await Promise.all(Array.from({ length: 10 }, () => recordPayment(k, k.agents.managerA, w.dealId, { amount: '7000.00', externalTransactionRef: 'UTR-CONC-2' }, idem())));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await count(w.dealId)).toBe(1);
  });

  it('concurrent verification credits the payment once', async () => {
    const w = await wonDeal(k);
    const rec = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '50000.00' });
    const rs = await Promise.all(Array.from({ length: 8 }, () => k.agents.finance.post(`/collections/${rec.body.data.id}/verify`).send({})));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    const d = await k.agents.execA1.get(`/deals/${w.dealId}`);
    expect(d.body.data.money).toMatchObject({ collected: '50000.00', amountDue: '0.00', overCollected: '0.00' });
    expect(await k.prisma.outboxEvent.count({ where: { aggregateId: rec.body.data.id, eventType: 'payment.verified' } })).toBe(1);
    expect(await k.prisma.paymentEvent.count({ where: { paymentId: rec.body.data.id, toStatus: 'VERIFIED' } })).toBe(1);
  });
});

describe('verification is a Finance permission with separation of duties', () => {
  it('only Finance verifies; managers, founder, executives and HR cannot', async () => {
    const w = await wonDeal(k);
    const rec = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '1000.00' });
    for (const who of ['managerA', 'teamLead', 'founder', 'execA1', 'hr', 'admin'] as const) {
      expect((await k.agents[who].post(`/collections/${rec.body.data.id}/verify`).send({})).status, who).toBe(403);
    }
    const ok = await k.agents.finance.post(`/collections/${rec.body.data.id}/verify`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'VERIFIED', verifiedById: k.fx.finance.id });
    expect(await k.prisma.auditLog.count({ where: { entityId: rec.body.data.id, action: 'payment.verified' } })).toBe(1);
  });

  it('the recorder cannot verify their own payment (Finance recording is verified by someone else)', async () => {
    const w = await wonDeal(k);
    const rec = await recordPayment(k, k.agents.finance, w.dealId, { amount: '1000.00' });
    expect(rec.status).toBe(201);
    const v = await k.agents.finance.post(`/collections/${rec.body.data.id}/verify`).send({});
    expect(v.status).toBe(403);
    expect(v.body.error.code).toBe('SEPARATION_OF_DUTIES');
  });

  it('a confirmed amount outside the tolerance is rejected; rejecting records the reason and the payment can be corrected', async () => {
    const w = await wonDeal(k);
    const rec = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '25000.00' });
    const mm = await k.agents.finance.post(`/collections/${rec.body.data.id}/verify`).send({ confirmedAmount: '24000.00' });
    expect(mm.status).toBe(422);
    expect(mm.body.error.code).toBe('AMOUNT_MISMATCH');
    const rj = await k.agents.finance.post(`/collections/${rec.body.data.id}/reject`).send({ reason: 'Bank shows 24000 received' });
    expect(rj.status).toBe(200);
    expect(rj.body.data).toMatchObject({ status: 'REJECTED', rejectReason: 'Bank shows 24000 received' });
    expect((await k.agents.finance.post(`/collections/${rec.body.data.id}/verify`).send({})).status).toBe(409);
    const fix = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '24000.00', expectedPaymentId: rec.body.data.id, externalTransactionRef: rec.body.data.externalTransactionRef });
    expect(fix.status).toBe(201);
    expect(fix.body.data).toMatchObject({ id: rec.body.data.id, status: 'RECORDED', amount: '24000.00' });
    expect((await k.agents.finance.post(`/collections/${rec.body.data.id}/verify`).send({})).status).toBe(200);
    const detail = await k.agents.finance.get(`/collections/${rec.body.data.id}`);
    expect(detail.body.data.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['RECORDED', 'REJECTED', 'RECORDED', 'VERIFIED']);
  });

  it('refuses to verify a payment that would collect more than the sale value', async () => {
    const w = await wonDeal(k);
    const a = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '40000.00' });
    const b = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '40000.00' });
    expect((await k.agents.finance.post(`/collections/${a.body.data.id}/verify`).send({})).status).toBe(200);
    const over = await k.agents.finance.post(`/collections/${b.body.data.id}/verify`).send({});
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('OVERPAYMENT');
    expect((await k.prisma.payment.findUniqueOrThrow({ where: { id: b.body.data.id } })).status).toBe('RECORDED');
    const d = await k.agents.execA1.get(`/deals/${w.dealId}`);
    expect(d.body.data.money.collected).toBe('40000.00');
  });
});

describe('reconciliation', () => {
  it('matches statement lines to verified payments, locks them, and reports every mismatch honestly', async () => {
    const w = await wonDeal(k);
    const ok = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '10000.00', externalTransactionRef: 'STMT-OK' });
    const wrong = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '10000.00', externalTransactionRef: 'STMT-AMT' });
    const unverified = await recordPayment(k, k.agents.managerA, w.dealId, { amount: '10000.00', externalTransactionRef: 'STMT-UNV' });
    for (const p of [ok, wrong]) await k.agents.finance.post(`/collections/${p.body.data.id}/verify`).send({});
    const run = await k.agents.finance.post('/collections/reconciliation/run').send({
      statementRef: 'HDFC-2026-10',
      lines: [{ externalTransactionRef: 'STMT-OK', amount: '10000.00' }, { externalTransactionRef: 'STMT-AMT', amount: '9000.00' }, { externalTransactionRef: 'STMT-UNV', amount: '10000.00' }, { externalTransactionRef: 'STMT-NONE', amount: '1.00' }],
    });
    expect(run.status).toBe(200);
    expect(run.body.data.matchedCount).toBe(1);
    expect(run.body.data.unmatched.map((u: { reason: string }) => u.reason).sort()).toEqual(['AMOUNT_MISMATCH', 'NOT_FOUND', 'NOT_VERIFIED_RECORDED']);
    const locked = await k.prisma.payment.findUniqueOrThrow({ where: { id: ok.body.data.id } });
    expect(locked).toMatchObject({ status: 'RECONCILED', statementRef: 'HDFC-2026-10' });
    // idempotent re-run: already reconciled is reported, not double-processed
    const again = await k.agents.finance.post('/collections/reconciliation/run').send({ statementRef: 'HDFC-2026-10', lines: [{ externalTransactionRef: 'STMT-OK', amount: '10000.00' }] });
    expect(again.body.data.matchedCount).toBe(0);
    expect(again.body.data.unmatched[0].reason).toBe('ALREADY_RECONCILED');
    // reconciled payments are locked in the database and cannot be reversed
    await expect(k.prisma.payment.update({ where: { id: ok.body.data.id }, data: { amount: '1.00' } })).rejects.toThrow(/locked/);
    expect((await k.agents.finance.post(`/collections/${ok.body.data.id}/reverse`).send({ reason: 'trying to undo' })).status).toBe(409);
    void unverified;
  });

  it('reversal needs Finance/Founder and a reason, and removes the collection', async () => {
    const w = await wonDeal(k);
    const id = await collect(k, w.dealId, '50000.00');
    expect((await k.agents.managerA.post(`/collections/${id}/reverse`).send({ reason: 'bounced cheque' })).status).toBe(403);
    expect((await k.agents.finance.post(`/collections/${id}/reverse`).send({ reason: 'x' })).status).toBe(400);
    const rv = await k.agents.finance.post(`/collections/${id}/reverse`).send({ reason: 'cheque bounced at bank' });
    expect(rv.status).toBe(200);
    expect(rv.body.data.status).toBe('REVERSED');
    const d = await k.agents.execA1.get(`/deals/${w.dealId}`);
    expect(d.body.data.money).toMatchObject({ collected: '0.00', amountDue: '50000.00' });
  });
});

describe('totals reconcile against fixtures', () => {
  it('reconciliation totals equal the hand-computed fixture sums (isolated organisation)', async () => {
    const k2 = await buildKit();
    try {
      const mk = async (amount: string) => {
        const lead = await makeLead(k2, k2.fx.execA1.id, k2.fx.teamA.id);
        const d = await createDeal(k2, k2.agents.execA1, lead.id, { amount });
        const c = await k2.agents.execA1.post(`/deals/${d.body.data.id}/close`).send({ outcome: 'WON', finalAmount: amount });
        expect(c.status).toBe(200);
        return d.body.data.id as string;
      };
      const d1 = await mk('100000.00');
      const d2 = await mk('50000.50');
      const d3 = await mk('25000.25');
      const pay = async (dealId: string, amount: string, verify: boolean) => {
        const r = await recordPayment(k2, k2.agents.managerA, dealId, { amount });
        if (verify) expect((await k2.agents.finance.post(`/collections/${r.body.data.id}/verify`).send({})).status).toBe(200);
        return r.body.data.id as string;
      };
      const p1 = await pay(d1, '60000.00', true);
      await pay(d1, '40000.00', true);
      await pay(d2, '30000.25', true);
      await pay(d2, '10000.00', false); // pending verification
      await pay(d3, '25000.25', true);
      await k2.agents.finance.post('/collections/reconciliation/run').send({ statementRef: 'S1', paymentIds: [p1] });
      // a processed refund on d1 and an approved-but-unprocessed refund on d3
      const rf = await k2.agents.execA1.post('/refunds').send({ dealId: d1, amount: '5000.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Learner asked for a refund' });
      await k2.agents.managerA.post(`/refunds/${rf.body.data.id}/review`).send({ note: 'Verified with learner', recommendation: 'APPROVE' });
      await k2.agents.finance.post(`/refunds/${rf.body.data.id}/approve`).send({ reason: 'approved' });
      expect((await k2.agents.finance.post(`/refunds/${rf.body.data.id}/process`).send({ externalRef: 'RFND-1', method: 'BANK_TRANSFER' })).status).toBe(200);
      // an approved discount adjustment on d2
      await k2.agents.founder.post(`/deals/${d2}/adjustments`).send({ kind: 'DISCOUNT', delta: '-0.50', reason: 'Rounding concession agreed' });

      const rec = await k2.agents.finance.get('/collections/reconciliation').query({ view: 'unreconciled' });
      expect(rec.status).toBe(200);
      expect(rec.body.data.totals).toMatchObject({
        currency: 'INR',
        bookedSales: '175000.25', // 100000 + 50000.50 + 25000.25 - 0.50 adjustment
        collectedVerified: '155000.50', // 60000 + 40000 + 30000.25 + 25000.25
        reconciled: '60000.00',
        verifiedAwaitingReconciliation: '95000.50',
        pendingVerification: '10000.00',
        refundedProcessed: '5000.00',
        netCollections: '150000.50',
        outstandingDue: '19999.75', // 175000.25 - 155000.50
        saleCount: 3,
      });
      expect(rec.body.data.totals.collectionPct).toBe('88.6');
      expect(rec.body.data.items.every((p: { status: string }) => p.status === 'VERIFIED')).toBe(true);
      expect(rec.body.data.items).toHaveLength(3);
      const mm = await k2.agents.finance.get('/collections/reconciliation').query({ view: 'deal-mismatch' });
      const flags = Object.fromEntries(mm.body.data.items.map((i: { dealId: string; flag: string }) => [i.dealId, i.flag]));
      expect(flags[d2]).toBe('PENDING_VERIFICATION');
      expect(flags[d1]).toBeUndefined(); // fully collected
      const dup = await k2.agents.finance.get('/collections/reconciliation').query({ view: 'duplicates' });
      expect(dup.status).toBe(200);
    } finally {
      await k2.close();
    }
  });

  it('flags suspected duplicate credits (same deal, amount and day, different references)', async () => {
    const k3 = await buildKit();
    try {
      const lead = await makeLead(k3, k3.fx.execA1.id, k3.fx.teamA.id);
      const d = await createDeal(k3, k3.agents.execA1, lead.id, { amount: '20000.00' });
      await k3.agents.execA1.post(`/deals/${d.body.data.id}/close`).send({ outcome: 'WON', finalAmount: '20000.00' });
      await recordPayment(k3, k3.agents.managerA, d.body.data.id, { amount: '5000.00', externalTransactionRef: 'UTR-AAA-111' });
      await recordPayment(k3, k3.agents.managerA, d.body.data.id, { amount: '5000.00', externalTransactionRef: 'UTR-AAA-112' });
      const dup = await k3.agents.finance.get('/collections/reconciliation').query({ view: 'duplicates' });
      expect(dup.body.data.items).toHaveLength(1);
      expect(dup.body.data.items[0]).toMatchObject({ count: 2, amount: '5000.00' });
    } finally {
      await k3.close();
    }
  });
});

describe('role-scoped collection visibility', () => {
  it('executives see their own; manager sees own team only; sibling manager, peer executive, HR/admin and other orgs see nothing', async () => {
    const mine = await wonDeal(k, { ownerKey: 'execA1' });
    const peer = await wonDeal(k, { ownerKey: 'execA2' });
    const sibling = await wonDeal(k, { ownerKey: 'execB1' });
    const ids = async (agent: typeof k.agents.execA1) => {
      const r = await agent.get('/collections').query({ limit: 100, status: 'EXPECTED' });
      expect(r.status).toBe(200);
      return new Set((r.body.data as Array<{ dealId: string }>).map((p) => p.dealId));
    };
    const e1 = await ids(k.agents.execA1);
    expect(e1.has(mine.dealId)).toBe(true);
    expect(e1.has(peer.dealId)).toBe(false);
    expect(e1.has(sibling.dealId)).toBe(false);
    const mA = await ids(k.agents.managerA);
    expect(mA.has(mine.dealId) && mA.has(peer.dealId)).toBe(true);
    expect(mA.has(sibling.dealId)).toBe(false);
    const fin = await ids(k.agents.finance);
    expect(fin.has(mine.dealId) && fin.has(sibling.dealId)).toBe(true);
    expect((await k.agents.hr.get('/collections')).status).toBe(403);
    expect((await k.agents.admin.get('/collections')).status).toBe(403);
    const payment = await k.prisma.payment.findFirstOrThrow({ where: { dealId: sibling.dealId } });
    expect((await k.agents.execA1.get(`/collections/${payment.id}`)).status).toBe(404);
    expect((await k.agents.managerA.get(`/collections/${payment.id}`)).status).toBe(404);
    expect((await k.agents.execB1.get(`/collections/${payment.id}`)).status).toBe(200);
  });

  it('the daily series splits verified from unverified money by day', async () => {
    const w = await wonDeal(k);
    await collect(k, w.dealId, '30000.00');
    await recordPayment(k, k.agents.managerA, w.dealId, { amount: '2000.00' });
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const r = await k.agents.finance.get('/collections/daily').query({ from: today, to: today });
    expect(r.status).toBe(200);
    expect(r.body.data.series).toHaveLength(1);
    expect(Number(r.body.data.series[0].verified.replace('.', ''))).toBeGreaterThanOrEqual(3000000);
    expect(r.body.data.totals.unverified).not.toBe('0.00');
    expect(r.body.data.byProgram.length).toBeGreaterThan(0);
  });
});
