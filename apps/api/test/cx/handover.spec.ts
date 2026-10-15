import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHandoverFromTrigger } from '@salesos/cx-core';
import { createTestApp, type TestApp } from '../helpers';
import { buildCxFixture, buildOtherOrg, createLead, FULL_HANDOVER, type CxFixture } from './helpers';

let t: TestApp;
let fx: CxFixture;
let other: Awaited<ReturnType<typeof buildOtherOrg>>;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildCxFixture(t);
  other = await buildOtherOrg(t);
});
afterAll(async () => { await t.close(); });

/** A WON lead + WON deal owned by execA1 (real revenue rows so the trigger can pre-fill from the deal and payments). */
async function wonSale(opts: { verifiedPayment?: number } = {}) {
  const lead = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id, { programId: fx.program.id, status: 'WON', stageCategory: 'WON', wonAt: new Date(), preferredLanguage: 'hi' });
  const deal = await t.prisma.deal.create({ data: { organizationId: fx.org.id, leadId: lead.id, programId: fx.program.id, ownerId: fx.execA1.id, teamId: fx.teamA.id, stage: 'WON', amount: '20000.00', currency: 'INR', closedAt: new Date(), createdById: fx.execA1.id } });
  if (opts.verifiedPayment) {
    await t.prisma.payment.create({ data: { organizationId: fx.org.id, dealId: deal.id, ownerId: fx.execA1.id, teamId: fx.teamA.id, status: 'VERIFIED', amount: String(opts.verifiedPayment), paidAt: new Date(), verifiedAt: new Date() } });
  }
  return { lead, deal };
}
const trigger = (eventType: string, payload: Record<string, unknown>) => createHandoverFromTrigger(t.prisma, { id: randomUUID(), eventType, organizationId: fx.org.id, payload });

describe('handover creation from the deal-won contract', () => {
  it('deal.closed (WON) creates a DRAFT pre-filled from deal, lead and verified payments, idempotently', async () => {
    const { lead, deal } = await wonSale({ verifiedPayment: 5000 });
    const ev = { id: randomUUID(), eventType: 'deal.closed', organizationId: fx.org.id, payload: { dealId: deal.id, leadId: lead.id, programId: fx.program.id, outcome: 'WON', ownerId: fx.execA1.id, saleValue: '20000.00', currency: 'INR' } };
    const r = await createHandoverFromTrigger(t.prisma, ev);
    expect(r.created).toBe(true);
    const h = await t.prisma.handoverRecord.findFirstOrThrow({ where: { dealId: deal.id } });
    expect(h.status).toBe('DRAFT');
    expect(h.ownerId).toBe(fx.execA1.id);
    expect(h.learnerName).toBe(lead.fullName);
    expect(h.languagePreference).toBe('HI');
    expect(h.programName).toBe(fx.program.name);
    expect(h.amountPaid?.toString()).toBe('5000');
    expect(h.amountDue?.toString()).toBe('15000');
    expect(h.paymentVerified).toBe(true);
    expect(h.consents).toBeNull(); // consent is NEVER pre-filled
    expect(h.promisesMade).toBeNull();
    // replay of the same outbox event, a second deal.won for the same deal, and the CRM lead.won all collapse to ONE handover
    expect((await createHandoverFromTrigger(t.prisma, ev)).created).toBe(false);
    expect((await trigger('deal.won', { dealId: deal.id, leadId: lead.id })).created).toBe(false);
    expect((await trigger('lead.won', { leadId: lead.id, assignedToId: fx.execA1.id })).created).toBe(false);
    expect(await t.prisma.handoverRecord.count({ where: { organizationId: fx.org.id, leadId: lead.id } })).toBe(1);
    const created = await t.prisma.outboxEvent.count({ where: { aggregateId: h.id, eventType: 'handover.created' } });
    expect(created).toBe(1);
  });

  it('lead.won first, then deal.closed attaches the deal id to the same handover', async () => {
    const { lead, deal } = await wonSale();
    const a = await trigger('lead.won', { leadId: lead.id, assignedToId: fx.execA1.id, programId: fx.program.id, value: '20000.00', currency: 'INR' });
    expect(a.created).toBe(true);
    const b = await trigger('deal.closed', { dealId: deal.id, leadId: lead.id, outcome: 'WON', ownerId: fx.execA1.id });
    expect(b).toMatchObject({ created: false, reason: 'ATTACHED_DEAL' });
    const rows = await t.prisma.handoverRecord.findMany({ where: { leadId: lead.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dealId).toBe(deal.id);
  });

  it('lead.won and deal.closed consumed CONCURRENTLY still produce exactly one handover (DB-enforced), enriched from the deal', async () => {
    const { lead, deal } = await wonSale({ verifiedPayment: 4000 });
    await t.prisma.lead.update({ where: { id: lead.id }, data: { programId: null } }); // lead.won alone has no programme
    const results = await Promise.all([
      trigger('lead.won', { leadId: lead.id, assignedToId: fx.execA1.id, value: '20000.00', currency: 'INR' }),
      trigger('deal.closed', { dealId: deal.id, leadId: lead.id, outcome: 'WON', ownerId: fx.execA1.id, saleValue: '20000.00', programId: fx.program.id }),
    ]);
    expect(results.filter((r) => r.created).length).toBe(1);
    const rows = await t.prisma.handoverRecord.findMany({ where: { organizationId: fx.org.id, leadId: lead.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dealId).toBe(deal.id);
    expect(rows[0]!.programName).toBe(fx.program.name);
    expect(rows[0]!.amountPaid?.toString()).toBe('4000');
    // the guard really is in the database: a second open handover for the same learner is refused even by a raw insert
    await expect(t.prisma.handoverRecord.create({ data: { organizationId: fx.org.id, leadId: lead.id, ownerId: fx.execA1.id } })).rejects.toThrow(/Unique constraint|handover_one_open_per_lead/);
    // ...but a new sale AFTER the first handover completed is allowed
    await t.prisma.handoverRecord.update({ where: { id: rows[0]!.id }, data: { status: 'COMPLETED' } });
    const again = await t.prisma.handoverRecord.create({ data: { organizationId: fx.org.id, leadId: lead.id, ownerId: fx.execA1.id } });
    expect(again.id).toBeTruthy();
  });

  it('ignores LOST closes and events without a reference or owner', async () => {
    const { lead, deal } = await wonSale();
    expect(await trigger('deal.closed', { dealId: deal.id, leadId: lead.id, outcome: 'LOST', ownerId: fx.execA1.id })).toMatchObject({ created: false, reason: 'NOT_WON' });
    expect(await trigger('deal.closed', { outcome: 'WON' })).toMatchObject({ created: false, reason: 'NO_REFERENCE' });
    const unowned = await createLead(t.prisma, fx.org.id, fx.execA1, null, { assignedToId: null });
    expect(await trigger('lead.won', { leadId: unowned.id })).toMatchObject({ created: false, reason: 'NO_OWNER' });
    expect(await createHandoverFromTrigger(t.prisma, { id: randomUUID(), eventType: 'deal.closed', organizationId: null, payload: {} })).toMatchObject({ reason: 'NO_ORGANIZATION' });
  });
});

describe('Student Success handover journey (journey 10) and checklist enforcement', () => {
  it('blocks submission while required fields are missing (lists them), then submit -> acknowledge -> info/resubmit -> complete', async () => {
    const { lead, deal } = await wonSale({ verifiedPayment: 5000 });
    await trigger('deal.closed', { dealId: deal.id, leadId: lead.id, outcome: 'WON', ownerId: fx.execA1.id, saleValue: '20000.00' });
    const h = await t.prisma.handoverRecord.findFirstOrThrow({ where: { dealId: deal.id } });

    // Student Success cannot even see a DRAFT
    expect((await fx.agents.ss.get(`/handovers/${h.id}`)).status).toBe(404);
    expect(((await fx.agents.ss.get('/handovers?limit=100')).body.data as { id: string }[]).map((x) => x.id)).not.toContain(h.id);

    // incomplete: promises/goals/notes/objections/consents missing
    const blocked = await fx.agents.execA1.post(`/handovers/${h.id}/submit`).send({});
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('HANDOVER_INCOMPLETE');
    expect(blocked.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['promisesMade', 'goals', 'objections', 'specialNotes', 'consents']));
    expect((await t.prisma.handoverRecord.findUniqueOrThrow({ where: { id: h.id } })).status).toBe('DRAFT');
    const view = (await fx.agents.execA1.get(`/handovers/${h.id}`)).body.data;
    expect(view.complete).toBe(false);
    expect(view.missing).toContain('goals');

    // partial update still blocked
    const upd = await fx.agents.execA1.patch(`/handovers/${h.id}`).send({ promisesMade: 'Weekly mentor call', goals: 'Launch offer', objections: 'None', specialNotes: 'Evenings only' });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect((await fx.agents.execA1.post(`/handovers/${h.id}/submit`).send({})).status).toBe(422); // consents still missing
    // withdrawn consent also blocks
    await fx.agents.execA1.patch(`/handovers/${h.id}`).send({ consents: { dataSharing: false } });
    expect((await fx.agents.execA1.post(`/handovers/${h.id}/submit`).send({})).status).toBe(422);
    await fx.agents.execA1.patch(`/handovers/${h.id}`).send({ consents: { dataSharing: true, contact: true } });

    // the other sales exec / the other team's manager cannot submit it
    expect((await fx.agents.execA2.post(`/handovers/${h.id}/submit`).send({})).status).toBe(404);
    expect((await fx.agents.managerB.post(`/handovers/${h.id}/submit`).send({})).status).toBe(404);

    const sub = await fx.agents.execA1.post(`/handovers/${h.id}/submit`).send({});
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.data.status).toBe('SUBMITTED');
    expect(sub.body.data.ackDueAt).toBeTruthy();
    // already submitted: edit / re-submit rejected
    expect((await fx.agents.execA1.patch(`/handovers/${h.id}`).send({ goals: 'changed' })).status).toBe(409);
    expect((await fx.agents.execA1.post(`/handovers/${h.id}/submit`).send({})).status).toBe(409);
    // pending alert: Student Success is told through the outbox
    const submitted = await t.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: h.id, eventType: 'handover.submitted' } });
    expect((submitted.payload as { notifyRoles: string[] }).notifyRoles).toEqual(['STUDENT_SUCCESS']);

    // Student Success sees the minimum handover data, in the inbox, and NOT the sales/lead identifiers
    const inbox = (await fx.agents.ss.get('/handovers?pending=true&limit=100')).body.data as Array<Record<string, unknown>>;
    const mine = inbox.find((x) => x.id === h.id)!;
    expect(mine).toBeTruthy();
    expect(mine.learnerName).toBe(lead.fullName);
    expect(mine.languagePreference).toBe('HI');
    expect(mine.dealId).toBeUndefined();
    expect(mine.leadId).toBeUndefined();
    expect(JSON.stringify(mine)).not.toContain(lead.email!);

    // only Student Success may act on the receiving side
    expect((await fx.agents.execA1.post(`/handovers/${h.id}/acknowledge`).send({})).status).toBe(403);
    expect((await fx.agents.managerA.post(`/handovers/${h.id}/request-info`).send({ questions: 'x y z' })).status).toBe(403);
    // request info -> INFO_REQUESTED + a CRM task for the sales owner
    const info = await fx.agents.ss.post(`/handovers/${h.id}/request-info`).send({ questions: 'Which batch did the learner choose?' });
    expect(info.status).toBe(200);
    expect(info.body.data.status).toBe('INFO_REQUESTED');
    const task = await t.prisma.task.findFirst({ where: { leadId: lead.id, ruleKey: 'HANDOVER_INFO_REQUESTED' } });
    expect(task?.assignedToId).toBe(fx.execA1.id);
    // sales fixes + resubmits
    expect((await fx.agents.execA1.patch(`/handovers/${h.id}`).send({ specialNotes: 'Batch B, evenings' })).status).toBe(200);
    expect((await fx.agents.execA1.post(`/handovers/${h.id}/submit`).send({})).body.data.status).toBe('SUBMITTED');
    // acknowledge
    const ack = await fx.agents.ss.post(`/handovers/${h.id}/acknowledge`).send({});
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect(ack.body.data.status).toBe('ACKNOWLEDGED');
    expect(ack.body.data.receivingOwnerName).toBe(fx.ss.name);
    // illegal: acknowledge twice, complete without note
    expect((await fx.agents.ss.post(`/handovers/${h.id}/acknowledge`).send({})).status).toBe(409);
    expect((await fx.agents.ss.post(`/handovers/${h.id}/complete`).send({})).status).toBe(400);
    const done = await fx.agents.ss.post(`/handovers/${h.id}/complete`).send({ note: 'Onboarding call done, batch B' });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');
    // terminal
    expect((await fx.agents.ss.post(`/handovers/${h.id}/request-info`).send({ questions: 'more?' })).status).toBe(409);
    // enrolment-experience survey is scheduled on completion
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId: h.id, eventType: 'survey.requested' } })).toBe(1);
    // audit trail for each step
    const actions = (await t.prisma.auditLog.findMany({ where: { entityType: 'handover', entityId: h.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['handover.created', 'handover.submitted', 'handover.info_requested', 'handover.acknowledged', 'handover.completed']));
  });

  it('manual creation: needs a WON sale, is idempotent per deal, scoped to the seller', async () => {
    const open = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id);
    expect((await fx.agents.execA1.post('/handovers').send({ leadId: open.id })).status).toBe(422);
    const { lead, deal } = await wonSale();
    const r = await fx.agents.execA1.post('/handovers').send({ dealId: deal.id, ...FULL_HANDOVER, programName: undefined });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe('DRAFT');
    expect(r.body.data.promisesMade).toBe(FULL_HANDOVER.promisesMade);
    expect(r.body.data.learnerName).toBe(FULL_HANDOVER.learnerName); // user data wins over the pre-fill
    const dup = await fx.agents.execA1.post('/handovers').send({ dealId: deal.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('HANDOVER_EXISTS');
    // another team's exec / SS cannot create
    const w2 = await wonSale();
    expect((await fx.agents.execB1.post('/handovers').send({ dealId: w2.deal.id })).status).toBe(404);
    expect((await fx.agents.ss.post('/handovers').send({ dealId: w2.deal.id })).status).toBe(403);
    void lead;
  });
});

describe('data minimisation and isolation', () => {
  it('Student Success sees handover data only; Marketing/Operations/Community get no handover content; cross-team and cross-org are isolated', async () => {
    const { lead, deal } = await wonSale();
    const r = await fx.agents.execA1.post('/handovers').send({ dealId: deal.id, ...FULL_HANDOVER });
    const id = r.body.data.id as string;
    await fx.agents.execA1.post(`/handovers/${id}/submit`).send({});

    // SS: relationship view is summary-only (no phone/email/notes/calls/deals)
    const rel = await fx.agents.ss.get(`/cx/relationships/${lead.id}`);
    expect(rel.status).toBe(200);
    expect(rel.body.data.mode).toBe('summary');
    expect(rel.body.data.timeline).toEqual([]);
    const flat = JSON.stringify(rel.body.data);
    expect(flat).not.toContain(lead.email!);
    expect(flat).not.toContain(lead.phoneE164!);
    expect(rel.body.data.lead.email).toBeUndefined();
    // the CRM lead endpoints give Student Success and Marketing the minimum projection too (no phone, e-mail, notes)
    for (const a of [fx.agents.ss, fx.agents.marketing]) {
      const l = await a.get(`/leads/${lead.id}`);
      expect(l.status).toBe(200);
      expect(l.body.data.phone).toBeUndefined();
      expect(l.body.data.email).toBeUndefined();
      expect(JSON.stringify(l.body.data)).not.toContain(lead.phoneE164!);
      expect(JSON.stringify(l.body.data)).not.toContain(lead.email!);
    }
    // Marketing / Community: no handover, no relationship, no complaints
    for (const a of [fx.agents.marketing, fx.agents.community]) {
      expect((await a.get('/handovers')).status).toBe(403);
      expect((await a.get(`/handovers/${id}`)).status).toBe(403);
      expect((await a.get(`/cx/relationships/${lead.id}`)).status).toBe(403);
    }
    // Operations holds handover:view at summary: status-only projection
    const ops = await fx.agents.ops.get(`/handovers/${id}`);
    expect(ops.status).toBe(200);
    expect(ops.body.data.minimumData).toBe(true);
    expect(ops.body.data.learnerName).toBeUndefined();
    expect(ops.body.data.learnerContact).toBeUndefined();
    expect(ops.body.data.promisesMade).toBeUndefined();
    // team isolation
    expect((await fx.agents.execB1.get(`/handovers/${id}`)).status).toBe(404);
    expect((await fx.agents.managerB.get(`/handovers/${id}`)).status).toBe(404);
    expect((await fx.agents.execA2.get(`/handovers/${id}`)).status).toBe(404);
    expect((await fx.agents.managerA.get(`/handovers/${id}`)).status).toBe(200);
    expect((await fx.agents.teamLead.get(`/handovers/${id}`)).status).toBe(200);
    // org isolation
    expect((await other.agent.get(`/handovers/${id}`)).status).toBe(404);
    expect((await other.agent.post(`/handovers/${id}/acknowledge`).send({})).status).toBe(403); // Founder holds no acknowledge permission
    // template endpoint
    const tpl = await fx.agents.execA1.get('/handovers/template');
    expect(tpl.body.data.requiredFields).toContain('consents');
  });

  it('required fields are configurable (settings) and drive the block', async () => {
    const patch = await fx.agents.founder.patch('/cx/settings').send({ handover: { requiredFields: ['learnerName', 'learnerContact'] } });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const { lead, deal } = await wonSale();
    await trigger('deal.closed', { dealId: deal.id, leadId: lead.id, outcome: 'WON', ownerId: fx.execA1.id });
    const h = await t.prisma.handoverRecord.findFirstOrThrow({ where: { dealId: deal.id } });
    expect((await fx.agents.execA1.post(`/handovers/${h.id}/submit`).send({})).status).toBe(200);
    // exec cannot change settings; reset for other tests
    expect((await fx.agents.execA1.patch('/cx/settings').send({ handover: { ackSlaHours: 1 } })).status).toBe(403);
    expect((await fx.agents.founder.patch('/cx/settings').send({ handover: { requiredFields: ['nonsense'] } })).status).toBe(400);
    await t.prisma.cxSetting.deleteMany({ where: { organizationId: fx.org.id } });
  });
});
