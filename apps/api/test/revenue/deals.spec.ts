import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createUser, anonymous, loginAgent } from '../helpers';
import { buildKit, closeWon, createDeal, idem, makeLead, recordPayment, wonDeal, collect, type RevenueKit } from './kit';

let k: RevenueKit;
beforeAll(async () => { k = await buildKit(); });
afterAll(async () => { await k.close(); });

const outbox = (aggregateId: string, eventType: string) => k.prisma.outboxEvent.findMany({ where: { aggregateId, eventType } });

describe('deal creation', () => {
  it('creates an OPEN deal in INR for the lead owner, with status history, audit and an outbox event', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const res = await createDeal(k, k.agents.execA1, lead.id, { amount: '45000.50' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ stage: 'OPEN', amount: '45000.50', currency: 'INR', ownerId: k.fx.execA1.id, dealType: 'NEW', programId: k.program.id });
    const id = res.body.data.id;
    expect(await k.prisma.dealStatusHistory.count({ where: { dealId: id, newStage: 'OPEN' } })).toBe(1);
    expect(await k.prisma.auditLog.count({ where: { entityId: id, action: 'deal.created' } })).toBe(1);
    expect(await outbox(id, 'deal.created')).toHaveLength(1);
    // Decimal(14,2) is stored exactly
    const row = await k.prisma.deal.findUniqueOrThrow({ where: { id } });
    expect(row.amount.toFixed(2)).toBe('45000.50');
  });

  it('validates money: zero, negative, 3 decimals, non-INR and garbage are rejected', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    for (const amount of ['0', '0.00', '-5', '10.123', 'abc', '']) {
      const r = await createDeal(k, k.agents.execA1, lead.id, { amount });
      expect(r.status, `amount=${amount}`).toBe(400);
    }
    expect((await createDeal(k, k.agents.execA1, lead.id, { amount: '100.00', currency: 'USD' })).status).toBe(400);
  });

  it('blocks a second open deal for the same lead and program, and replays an Idempotency-Key', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const key = idem();
    const a = await createDeal(k, k.agents.execA1, lead.id, {}, key);
    const b = await createDeal(k, k.agents.execA1, lead.id, {}, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(b.body.data.replayed).toBe(true);
    const dup = await createDeal(k, k.agents.execA1, lead.id, {});
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_OPEN_DEAL');
    expect(await k.prisma.deal.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it('upsell needs a won lead and the from-program; a new deal needs an open lead', async () => {
    const open = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const r1 = await createDeal(k, k.agents.execA1, open.id, { dealType: 'UPSELL', fromProgramId: k.program2.id });
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('LEAD_NOT_ELIGIBLE');
    expect((await createDeal(k, k.agents.execA1, open.id, { dealType: 'UPSELL' })).status).toBe(400);
    const won = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id, { status: 'WON', stageCategory: 'WON' });
    const r2 = await createDeal(k, k.agents.execA1, won.id, { dealType: 'UPSELL', fromProgramId: k.program2.id, amount: '20000' });
    expect(r2.status).toBe(201);
    expect(r2.body.data).toMatchObject({ dealType: 'UPSELL', fromProgramId: k.program2.id });
    const r3 = await createDeal(k, k.agents.execA1, won.id, { amount: '20000' });
    expect(r3.status).toBe(422);
    const lost = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id, { status: 'LOST', stageCategory: 'LOST' });
    expect((await createDeal(k, k.agents.execA1, lost.id)).status).toBe(422);
  });

  it('cannot create on a peer\'s or another org\'s lead (404), nor without a session', async () => {
    const peerLead = await makeLead(k, k.fx.execA2.id, k.fx.teamA.id);
    expect((await createDeal(k, k.agents.execA1, peerLead.id)).status).toBe(404);
    const org2 = await createOrg(k.prisma);
    const other = await createUser(k.prisma, org2, { roles: ['SALES_EXECUTIVE'] });
    const foreign = await k.prisma.lead.create({ data: { organizationId: org2.id, fullName: '[TEST] foreign', assignedToId: other.id, status: 'PROPOSAL_NEGOTIATION', stageCategory: 'OPEN' } });
    expect((await createDeal(k, k.agents.managerA, foreign.id)).status).toBe(404);
    expect((await createDeal(k, k.agents.founder, foreign.id)).status).toBe(404);
    expect((await anonymous(k.t.app).post(`/leads/${peerLead.id}/deals`).send({ programId: k.program.id, amount: '1.00' })).status).toBe(401);
    // a manager may create for a team member's lead; the sibling team's manager may not
    expect((await createDeal(k, k.agents.managerA, peerLead.id)).status).toBe(201);
    const bLead = await makeLead(k, k.fx.execB1.id, k.fx.teamB.id);
    expect((await createDeal(k, k.agents.managerA, bLead.id)).status).toBe(404);
  });
});

describe('high-value deals (DEC-027)', () => {
  it('flags above the program threshold, records a blocker with notified users, escalates to the Founder above 2x, and lets the blocker be resolved', async () => {
    const set = await k.agents.founder.patch(`/revenue/programs/${k.program2.id}/threshold`).send({ highValueThreshold: '100000.00' });
    expect(set.status).toBe(200);
    expect((await k.agents.teamLead.patch(`/revenue/programs/${k.program2.id}/threshold`).send({ highValueThreshold: '1.00' })).status).toBe(403);

    const l1 = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const below = await createDeal(k, k.agents.execA1, l1.id, { programId: k.program2.id, amount: '100000.00' });
    expect(below.body.data.isHighValue).toBe(false);

    const l2 = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const hv = await createDeal(k, k.agents.execA1, l2.id, { programId: k.program2.id, amount: '150000.00' });
    expect(hv.body.data).toMatchObject({ isHighValue: true, escalationLevel: 1, highValueThreshold: '100000.00' });
    const id = hv.body.data.id;
    const detail = await k.agents.execA1.get(`/deals/${id}`);
    expect(detail.body.data.blockers).toHaveLength(1);
    expect(detail.body.data.blockers[0]).toMatchObject({ kind: 'HIGH_VALUE', resolvedAt: null });
    expect(detail.body.data.blockers[0].escalatedToIds).toContain(k.fx.teamLead.id);
    expect(detail.body.data.blockers[0].escalatedToIds).not.toContain(k.fx.founder.id);
    expect(await outbox(id, 'deal.high_value_flagged')).toHaveLength(1);
    const notes = await k.prisma.outboxEvent.findMany({ where: { aggregateId: id, eventType: 'notification.requested' } });
    expect(notes.length).toBeGreaterThan(0);

    // raising the amount above 2x escalates to the Founder (new blocker, level 2)
    const up = await k.agents.execA1.patch(`/deals/${id}`).send({ amount: '250000.00' });
    expect(up.status).toBe(200);
    expect(up.body.data).toMatchObject({ escalationLevel: 2, isHighValue: true });
    const d2 = await k.agents.execA1.get(`/deals/${id}`);
    expect(d2.body.data.blockers.some((b: { escalatedToIds: string[] }) => b.escalatedToIds.includes(k.fx.founder.id))).toBe(true);

    // manual blocker + resolution tracked
    const esc = await k.agents.execA1.post(`/deals/${id}/escalate`).send({ note: 'Learner wants a payment holiday', requestedHelp: 'Call the learner with me' });
    expect(esc.status).toBe(201);
    const res = await k.agents.teamLead.post(`/deals/${id}/blockers/${esc.body.data.id}/resolve`).send({ resolution: 'Agreed 2 installments' });
    expect(res.status).toBe(200);
    expect(res.body.data.resolvedAt).not.toBeNull();
    const again = await k.agents.teamLead.post(`/deals/${id}/blockers/${esc.body.data.id}/resolve`).send({ resolution: 'again please' });
    expect(again.status).toBe(409);
  });

  it('falls back to "top 10% of recent open deals" only with enough data and never invents a threshold', async () => {
    const org = await createOrg(k.prisma);
    const tl = await createUser(k.prisma, org, { roles: ['SALES_TEAM_LEAD'] });
    const ex = await createUser(k.prisma, org, { roles: ['SALES_EXECUTIVE'], managerId: tl.id });
    const prog = await k.prisma.program.create({ data: { organizationId: org.id, code: 'HV', name: '[TEST] HV' } });
    const ag = await loginAgent(k.t.app, ex);
    const mk = async (amount: string) => {
      const lead = await k.prisma.lead.create({ data: { organizationId: org.id, fullName: '[TEST] x', assignedToId: ex.id, status: 'PROPOSAL_NEGOTIATION', stageCategory: 'OPEN' } });
      return ag.post(`/leads/${lead.id}/deals`).send({ programId: prog.id, amount });
    };
    const first = await mk('9999999.00');
    expect(first.body.data.isHighValue).toBe(false); // no sample, no threshold
    for (let i = 1; i <= 12; i += 1) await mk(String(i * 1000));
    const big = await mk('500000.00');
    expect(big.body.data.isHighValue).toBe(true);
    const small = await mk('1000.00');
    expect(small.body.data.isHighValue).toBe(false);
  });
});

describe('deal close: one transaction', () => {
  it('closing won books an immutable sale, advances the lead with status history, creates follow-up tasks and expected payments, and emits events', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const d = await createDeal(k, k.agents.execA1, lead.id, { amount: '60000.00' });
    const id = d.body.data.id;
    const res = await closeWon(k.agents.execA1, id, { finalAmount: '55000.00', paymentPlan: [{ amount: '20000.00', dueDate: '2026-10-20' }, { amount: '35000.00', dueDate: '2026-11-20' }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ stage: 'WON', replayed: false, amount: '55000.00' });
    // Closed-Won is NOT paid
    expect(res.body.data.money).toMatchObject({ saleValue: '55000.00', collected: '0.00', amountDue: '55000.00', refunded: '0.00', netCollections: '0.00', pendingVerification: '0.00' });

    const record = await k.prisma.salesRecord.findUniqueOrThrow({ where: { dealId: id }, include: { credits: true } });
    expect(record.saleValue.toFixed(2)).toBe('55000.00');
    expect(record.credits).toHaveLength(1);
    expect(record.credits[0]).toMatchObject({ userId: k.fx.execA1.id });
    expect(record.credits[0]!.sharePct.toFixed(2)).toBe('100.00');
    expect(record.credits[0]!.amount.toFixed(2)).toBe('55000.00');

    const lead2 = await k.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(lead2).toMatchObject({ status: 'WON', stageCategory: 'WON' });
    expect(lead2.wonValue!.toFixed(2)).toBe('55000.00');
    const hist = await k.prisma.leadStatusHistory.findMany({ where: { leadId: lead.id, newStatus: 'WON' } });
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ oldStatus: 'PROPOSAL_NEGOTIATION', changedById: k.fx.execA1.id });

    const payments = await k.prisma.payment.findMany({ where: { dealId: id }, orderBy: { dueDate: 'asc' } });
    expect(payments.map((p) => [p.status, p.amount.toFixed(2)])).toEqual([['EXPECTED', '20000.00'], ['EXPECTED', '35000.00']]);
    const tasks = await k.prisma.task.findMany({ where: { leadId: lead.id, status: 'OPEN' } });
    expect(tasks.map((t) => t.type).sort()).toEqual(['FOLLOW_UP', 'ONBOARDING']);
    expect(tasks.every((t) => t.assignedToId === k.fx.execA1.id)).toBe(true);

    expect(await outbox(id, 'deal.closed')).toHaveLength(1);
    expect(await k.prisma.outboxEvent.count({ where: { aggregateId: lead.id, eventType: 'lead.won' } })).toBe(1);
    expect(await k.prisma.auditLog.count({ where: { entityId: id, action: 'deal.closed' } })).toBe(1);
    expect(await k.prisma.dealStatusHistory.count({ where: { dealId: id, newStage: 'WON' } })).toBe(1);
    const closed = (await outbox(id, 'deal.closed'))[0]!;
    expect(closed.payload).toMatchObject({ outcome: 'WON', saleValue: '55000.00', currency: 'INR', creditedOwners: [{ userId: k.fx.execA1.id, sharePct: '100.00' }] });
  });

  it('is idempotent: closing twice (also concurrently) leaves one sale record and one set of side effects', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const d = await createDeal(k, k.agents.execA1, lead.id);
    const id = d.body.data.id;
    const rs = await Promise.all(Array.from({ length: 5 }, () => closeWon(k.agents.execA1, id)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(rs.filter((r) => r.body.data.replayed === false)).toHaveLength(1);
    expect(await k.prisma.salesRecord.count({ where: { dealId: id } })).toBe(1);
    expect(await k.prisma.payment.count({ where: { dealId: id } })).toBe(1);
    expect(await k.prisma.task.count({ where: { leadId: lead.id, type: 'ONBOARDING' } })).toBe(1);
    expect(await outbox(id, 'deal.closed')).toHaveLength(1);
    const again = await closeWon(k.agents.execA1, id);
    expect(again.body.data.replayed).toBe(true);
  });

  it.each(['after_lead_transition', 'after_sales_record', 'after_payments', 'after_tasks'] as const)('rolls back everything when a failure is injected %s', async (step) => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const d = await createDeal(k, k.agents.execA1, lead.id, { amount: '70000.00' });
    const id = d.body.data.id;
    const before = await k.prisma.outboxEvent.count({ where: { organizationId: k.fx.org.id } });
    k.fault.current = (s) => { if (s === step) throw new Error(`injected failure ${s}`); };
    const res = await closeWon(k.agents.execA1, id, { finalAmount: '70000.00' });
    k.fault.current = () => undefined;
    expect(res.status).toBe(500);
    const deal = await k.prisma.deal.findUniqueOrThrow({ where: { id } });
    expect(deal.stage).toBe('OPEN');
    expect(deal.closedAt).toBeNull();
    expect(await k.prisma.salesRecord.count({ where: { dealId: id } })).toBe(0);
    expect(await k.prisma.payment.count({ where: { dealId: id } })).toBe(0);
    expect(await k.prisma.task.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await k.prisma.leadStatusHistory.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await k.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: 'PROPOSAL_NEGOTIATION', stageCategory: 'OPEN', wonValue: null });
    expect(await k.prisma.dealStatusHistory.count({ where: { dealId: id, newStage: 'WON' } })).toBe(0);
    expect(await k.prisma.outboxEvent.count({ where: { organizationId: k.fx.org.id } })).toBe(before);
    expect(await k.prisma.auditLog.count({ where: { entityId: id, action: 'deal.closed' } })).toBe(0);
    // and the deal can still be closed afterwards
    expect((await closeWon(k.agents.execA1, id, { finalAmount: '70000.00' })).status).toBe(200);
  });

  it('a lead that cannot legally reach WON blocks the close (409) and nothing changes', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id, { status: 'NEW' });
    const d = await createDeal(k, k.agents.execA1, lead.id);
    const res = await closeWon(k.agents.execA1, d.body.data.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect((await k.prisma.deal.findUniqueOrThrow({ where: { id: d.body.data.id } })).stage).toBe('OPEN');
  });

  it('validates the payment plan and the credit split', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const id = (await createDeal(k, k.agents.execA1, lead.id)).body.data.id;
    const bad = await closeWon(k.agents.execA1, id, { paymentPlan: [{ amount: '10000.00', dueDate: '2026-11-01' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('PAYMENT_PLAN_MISMATCH');
    const split = [{ userId: k.fx.execA1.id, sharePct: '60' }, { userId: k.fx.execA2.id, sharePct: '30' }];
    const notHundred = await closeWon(k.agents.teamLead, id, { credits: split });
    expect(notHundred.body.error.code).toBe('CREDIT_SPLIT_INVALID');
    const execSplit = await closeWon(k.agents.execA1, id, { credits: [{ userId: k.fx.execA1.id, sharePct: '50' }, { userId: k.fx.execA2.id, sharePct: '50' }] });
    expect(execSplit.status).toBe(403);
    expect(execSplit.body.error.code).toBe('SPLIT_REQUIRES_TEAM_LEAD');
    const crossOrg = await closeWon(k.agents.teamLead, id, { credits: [{ userId: k.fx.execA1.id, sharePct: '50' }, { userId: '11111111-1111-4111-8111-111111111111', sharePct: '50' }] });
    expect(crossOrg.status).toBe(422);
    const good = await closeWon(k.agents.teamLead, id, { finalAmount: '33333.33', credits: [{ userId: k.fx.execA1.id, sharePct: '33.33' }, { userId: k.fx.execA2.id, sharePct: '33.33' }, { userId: k.fx.managerA.id, sharePct: '33.34' }] });
    expect(good.status).toBe(200);
    const credits = await k.prisma.salesCredit.findMany({ where: { salesRecord: { dealId: id } } });
    expect(credits.reduce((a, c) => a.plus(c.amount), credits[0]!.amount.minus(credits[0]!.amount)).toFixed(2)).toBe('33333.33');
  });

  it('closing lost moves the lead to Lost with the reason; unknown reasons are rejected', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const id = (await createDeal(k, k.agents.execA1, lead.id)).body.data.id;
    const bad = await k.agents.execA1.post(`/deals/${id}/close`).send({ outcome: 'LOST', lostReason: 'NOT_A_REASON' });
    expect(bad.status).toBe(422);
    expect((await k.prisma.deal.findUniqueOrThrow({ where: { id } })).stage).toBe('OPEN');
    const ok = await k.agents.execA1.post(`/deals/${id}/close`).send({ outcome: 'LOST', lostReason: 'PRICE' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ stage: 'LOST', lostReason: 'PRICE' });
    expect(await k.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: 'LOST', lostReason: 'PRICE' });
    // reopen: executives cannot, managers can; the lead is reopened through the CRM machine
    expect((await k.agents.execA1.post(`/deals/${id}/reopen`).send({ reason: 'Learner called back' })).status).toBe(403);
    const re = await k.agents.managerA.post(`/deals/${id}/reopen`).send({ reason: 'Learner called back' });
    expect(re.status).toBe(200);
    expect(re.body.data.stage).toBe('OPEN');
    expect((await k.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).stageCategory).toBe('OPEN');
  });

  it('a won deal cannot be reopened or closed lost', async () => {
    const w = await wonDeal(k);
    expect((await k.agents.managerA.post(`/deals/${w.dealId}/reopen`).send({ reason: 'trying to undo a sale' })).status).toBe(409);
    expect((await k.agents.execA1.post(`/deals/${w.dealId}/close`).send({ outcome: 'LOST', lostReason: 'PRICE' })).status).toBe(409);
  });
});

describe('deal updates', () => {
  it('moves through the pipeline in order, rejects illegal moves and stale versions, and refuses edits after close', async () => {
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    const created = await createDeal(k, k.agents.execA1, lead.id);
    const id = created.body.data.id;
    const n = await k.agents.execA1.patch(`/deals/${id}`).send({ stage: 'NEGOTIATION', reason: 'Price discussion' });
    expect(n.status).toBe(200);
    expect(n.body.data.stage).toBe('NEGOTIATION');
    const back = await k.agents.execA1.patch(`/deals/${id}`).send({ stage: 'OPEN' });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe('INVALID_TRANSITION');
    const stale = await k.agents.execA1.patch(`/deals/${id}`).send({ amount: '51000.00', version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const fine = await k.agents.execA1.patch(`/deals/${id}`).send({ amount: '51000.00', version: n.body.data.version, expectedCloseOn: '2026-10-30' });
    expect(fine.body.data).toMatchObject({ amount: '51000.00', expectedCloseOn: '2026-10-30' });
    expect(await k.prisma.dealStatusHistory.count({ where: { dealId: id } })).toBe(2);
    await closeWon(k.agents.execA1, id);
    const afterClose = await k.agents.execA1.patch(`/deals/${id}`).send({ amount: '1.00' });
    expect(afterClose.status).toBe(409);
    expect(afterClose.body.error.code).toBe('DEAL_CLOSED');
  });
});

describe('historical sale amounts are immutable; corrections are adjustment records', () => {
  it('the database refuses UPDATE and DELETE of a sales record, its credits and the status history', async () => {
    const w = await wonDeal(k);
    await expect(k.prisma.$executeRaw`UPDATE sales_records SET sale_value = 1 WHERE deal_id = ${w.dealId}::uuid`).rejects.toThrow(/immutable/);
    await expect(k.prisma.$executeRaw`DELETE FROM sales_records WHERE deal_id = ${w.dealId}::uuid`).rejects.toThrow();
    await expect(k.prisma.$executeRaw`UPDATE sales_credits SET amount = 1 WHERE organization_id = ${k.fx.org.id}::uuid`).rejects.toThrow(/immutable/);
    await expect(k.prisma.$executeRaw`DELETE FROM deal_status_history WHERE deal_id = ${w.dealId}::uuid`).rejects.toThrow();
    const rec = await k.prisma.salesRecord.findUniqueOrThrow({ where: { dealId: w.dealId } });
    expect(rec.saleValue.toFixed(2)).toBe('50000.00');
  });

  it('editing the open-deal amount after close is impossible through the API; an adjustment changes the NET sale but never the stored original', async () => {
    const w = await wonDeal(k);
    const exec = await k.agents.execA1.post(`/deals/${w.dealId}/adjustments`).send({ kind: 'DISCOUNT', delta: '-5000.00', reason: 'Late discount granted' });
    expect(exec.status).toBe(403); // executives do not hold sales-adjustments:create
    // Team Lead proposes: PENDING and NOT yet counted
    const tl = await k.agents.teamLead.post(`/deals/${w.dealId}/adjustments`).send({ kind: 'DISCOUNT', delta: '-5000.00', reason: 'Late discount granted' });
    expect(tl.status).toBe(201);
    expect(tl.body.data.status).toBe('PENDING');
    let d = await k.agents.execA1.get(`/deals/${w.dealId}`);
    expect(d.body.data.money.saleValue).toBe('50000.00');
    // the proposer cannot approve; Finance can; a decision is final
    expect((await k.agents.teamLead.post(`/deals/${w.dealId}/adjustments/${tl.body.data.id}/decision`).send({ decision: 'approve' })).status).toBe(403);
    const ap = await k.agents.finance.post(`/deals/${w.dealId}/adjustments/${tl.body.data.id}/decision`).send({ decision: 'approve', note: 'ok' });
    expect(ap.status).toBe(200);
    expect((await k.agents.finance.post(`/deals/${w.dealId}/adjustments/${tl.body.data.id}/decision`).send({ decision: 'reject' })).status).toBe(409);
    d = await k.agents.execA1.get(`/deals/${w.dealId}`);
    expect(d.body.data.money).toMatchObject({ saleValue: '45000.00', originalSaleValue: '50000.00', adjustmentsTotal: '-5000.00', amountDue: '45000.00' });
    expect(d.body.data.salesRecord.saleValue).toBe('50000.00');
    // adjustments are immutable in the database
    await expect(k.prisma.$executeRaw`UPDATE sale_adjustments SET delta = 0.01 WHERE id = ${tl.body.data.id}::uuid`).rejects.toThrow(/immutable/);
    // Founder adjustments take effect immediately; the sale cannot go negative
    const f = await k.agents.founder.post(`/deals/${w.dealId}/adjustments`).send({ kind: 'CORRECTION', delta: '1000.50', reason: 'Add-on materials' });
    expect(f.body.data.status).toBe('APPROVED');
    const neg = await k.agents.founder.post(`/deals/${w.dealId}/adjustments`).send({ kind: 'CORRECTION', delta: '-999999.00', reason: 'Way too much' });
    expect(neg.status).toBe(422);
    const alloc = await k.prisma.saleAdjustment.findUniqueOrThrow({ where: { id: f.body.data.id } });
    expect(alloc.creditAllocations).toEqual([{ userId: w.ownerId, amount: '1000.50' }]);
  });

  it('cancelling a sale is Founder/Finance only, blocked while refunds are live, and sets the deal CANCELLED with a reversing adjustment', async () => {
    const w = await wonDeal(k);
    expect((await k.agents.teamLead.post(`/deals/${w.dealId}/adjustments`).send({ kind: 'CANCELLATION', reason: 'Learner withdrew' })).status).toBe(403);
    await collect(k, w.dealId);
    const rf = await k.agents.execA1.post('/refunds').send({ dealId: w.dealId, amount: '1000.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Learner request' });
    expect(rf.status).toBe(201);
    const blocked = await k.agents.founder.post(`/deals/${w.dealId}/adjustments`).send({ kind: 'CANCELLATION', reason: 'Learner withdrew' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('REFUND_IN_PROGRESS');
    const w2 = await wonDeal(k);
    const c = await k.agents.finance.post(`/deals/${w2.dealId}/adjustments`).send({ kind: 'CANCELLATION', reason: 'Learner withdrew before payment' });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ status: 'APPROVED', delta: '-50000.00' });
    const d = await k.agents.founder.get(`/deals/${w2.dealId}`);
    expect(d.body.data.stage).toBe('CANCELLED');
    expect(d.body.data.money.saleValue).toBe('0.00');
    expect(d.body.data.money.originalSaleValue).toBe('50000.00');
    void recordPayment;
  });
});

describe('listing and pipeline', () => {
  it('pipeline summary and list are scoped; the list paginates', async () => {
    const a = await k.agents.execA1.get('/deals').query({ limit: 2 });
    expect(a.status).toBe(200);
    expect(a.body.data.length).toBeLessThanOrEqual(2);
    expect(a.body.data.every((d: { ownerId: string }) => d.ownerId === k.fx.execA1.id)).toBe(true);
    expect(a.body.meta.pagination.limit).toBe(2);
    const p = await k.agents.execA1.get('/deals/pipeline');
    expect(p.status).toBe(200);
    expect(p.body.data.map((x: { stage: string }) => x.stage)).toEqual(['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING', 'WON', 'LOST', 'CANCELLED']);
    const lead = await makeLead(k, k.fx.execA1.id, k.fx.teamA.id);
    await createDeal(k, k.agents.execA1, lead.id);
    const forLead = await k.agents.execA1.get(`/leads/${lead.id}/deals`);
    expect(forLead.body.data).toHaveLength(1);
  });
});
