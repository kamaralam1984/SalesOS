import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CRM_FAULT_INJECTOR } from '../../src/modules/crm/crm.support';
import { createLead, crmKit, future, type CrmKit } from './kit';

let k: CrmKit;
let failAt: string | null = null;
beforeAll(async () => {
  k = await crmKit({
    customize: (b) =>
      b.overrideProvider(CRM_FAULT_INJECTOR).useValue((step: string) => {
        if (failAt === step) throw new Error(`injected failure at ${step}`);
      }),
  });
});
afterAll(async () => { await k.close(); });

const call = (leadId: string, body: Record<string, unknown>, who = k.a.execA1) => who.post(`/leads/${leadId}/calls`).send(body);
const tasksOf = (leadId: string) => k.t.prisma.task.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } });

describe('disposition validation', () => {
  it('CONNECTED needs interest + next action; CALLBACK needs a time; LOST needs a reason; WON needs a value; source cannot be supplied', async () => {
    const l = await createLead(k.a.execA1);
    expect((await call(l.id, { outcome: 'CONNECTED' })).status).toBe(400);
    expect((await call(l.id, { outcome: 'CONNECTED', interestLevel: 'HIGH' })).status).toBe(400);
    expect((await call(l.id, { outcome: 'CALLBACK' })).status).toBe(400);
    expect((await call(l.id, { outcome: 'LOST' })).status).toBe(400);
    expect((await call(l.id, { outcome: 'WON' })).status).toBe(400);
    expect((await call(l.id, { outcome: 'NO_ANSWER', source: 'PROVIDER' })).status).toBe(400);
    expect((await call(l.id, { outcome: 'NO_ANSWER', nextActionAt: '2020-01-01T00:00:00Z' })).status).toBe(400);
    expect(await k.t.prisma.callLog.count({ where: { leadId: l.id } })).toBe(0);
  });
});

describe('automation per outcome (DEC-026)', () => {
  it('NO_ANSWER creates a retry task +3 working hours, moves NEW to CONTACT_ATTEMPTED, labels the call MANUAL and NEVER marks the lead lost', async () => {
    const l = await createLead(k.a.execA1);
    const r = await call(l.id, { outcome: 'NO_ANSWER' });
    expect(r.status).toBe(201);
    expect(r.body.data.call.source).toBe('MANUAL');
    expect(r.body.data.lead.status).toBe('CONTACT_ATTEMPTED');
    expect(r.body.data.statusChanges).toEqual([{ from: 'NEW', to: 'CONTACT_ATTEMPTED' }]);
    const t = (await tasksOf(l.id)).filter((x) => x.ruleKey === 'NO_ANSWER_RETRY');
    expect(t).toHaveLength(1);
    expect(t[0]!.dueAt.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
    const hist = await k.t.prisma.leadStatusHistory.findMany({ where: { leadId: l.id } });
    expect(hist.some((h) => h.callLogId === r.body.data.call.id)).toBe(true);
  });

  it('NO_ANSWER repeated up to the total cap goes to manager review and is never auto-Lost', async () => {
    const l = await createLead(k.a.execA1);
    for (let i = 0; i < 5; i++) expect((await call(l.id, { outcome: 'NO_ANSWER' })).status).toBe(201);
    const row = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(row.stageCategory).toBe('OPEN');
    expect(row.status).not.toBe('LOST');
    expect(row.noAnswerCount).toBe(5);
    const ex = await k.t.prisma.leadException.findMany({ where: { leadId: l.id, resolvedAt: null } });
    expect(ex.map((e) => e.kind)).toContain('MANAGER_REVIEW');
    const review = (await tasksOf(l.id)).filter((x) => x.type === 'MANAGER_REVIEW');
    expect(review).toHaveLength(1);
    expect(review[0]!.assignedToId).toBe(k.fx.managerA.id);
    expect(await k.t.prisma.leadStatusHistory.count({ where: { leadId: l.id, newCategory: 'LOST' } })).toBe(0);
  });

  it('BUSY honours the requested callback time exactly; without one it defaults to +1 working hour', async () => {
    const l = await createLead(k.a.execA1);
    const at = future(26 * 60);
    const r = await call(l.id, { outcome: 'BUSY', callbackAt: at });
    expect(r.status).toBe(201);
    const t = (await tasksOf(l.id)).find((x) => x.ruleKey === 'BUSY_CALLBACK')!;
    expect(t.dueAt.toISOString()).toBe(new Date(at).toISOString());
    expect(t.type).toBe('CALLBACK');
    const l2 = await createLead(k.a.execA1);
    await call(l2.id, { outcome: 'BUSY' });
    const t2 = (await tasksOf(l2.id)).find((x) => x.ruleKey === 'BUSY_CALLBACK')!;
    expect(t2.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('SWITCHED_OFF schedules a delayed retry; 3 consecutive go to manager review; a connected call resets the counter', async () => {
    const l = await createLead(k.a.execA1);
    for (let i = 0; i < 2; i++) await call(l.id, { outcome: 'SWITCHED_OFF' });
    expect(await k.t.prisma.leadException.count({ where: { leadId: l.id, kind: 'MANAGER_REVIEW', resolvedAt: null } })).toBe(0);
    const third = await call(l.id, { outcome: 'SWITCHED_OFF' });
    expect(third.body.meta.warnings.join(' ')).toMatch(/manager review/);
    expect(await k.t.prisma.leadException.count({ where: { leadId: l.id, kind: 'MANAGER_REVIEW', resolvedAt: null } })).toBe(1);
    const retries = (await tasksOf(l.id)).filter((x) => x.ruleKey === 'SWITCHED_OFF_RETRY');
    expect(retries).toHaveLength(3);
    expect(retries[0]!.dueAt.getTime()).toBeGreaterThan(Date.now() + 8 * 3600_000);
    const ok = await call(l.id, { outcome: 'CONNECTED', interestLevel: 'MEDIUM', nextActionAt: future(120) });
    expect(ok.status).toBe(201);
    const row = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(row.consecutiveSwitchedOff).toBe(0);
    expect(row.status).toBe('CONNECTED');
    expect(await k.t.prisma.leadException.count({ where: { leadId: l.id, kind: 'MANAGER_REVIEW', resolvedAt: null } })).toBe(0);
  });

  it('CALLBACK creates a HIGH priority pinned task at the requested time', async () => {
    const l = await createLead(k.a.execA1);
    const at = future(300);
    const r = await call(l.id, { outcome: 'CALLBACK', callbackAt: at });
    expect(r.status).toBe(201);
    const t = (await tasksOf(l.id)).find((x) => x.ruleKey === 'CALLBACK')!;
    expect(t.priority).toBe('HIGH');
    expect(t.isPinned).toBe(true);
    expect(t.type).toBe('CALLBACK');
    expect(t.dueAt.toISOString()).toBe(new Date(at).toISOString());
    const ws = await k.a.execA1.get('/leads/workspace');
    expect(ws.body.data.pinnedTasks.some((p: { id: string }) => p.id === t.id)).toBe(true);
  });

  it('CONNECTED walks NEW to CONNECTED with one history row per hop, records interest/objection/next action and completes the linked task', async () => {
    const l = await createLead(k.a.execA1);
    const first = (await tasksOf(l.id))[0]!;
    const r = await call(l.id, { outcome: 'CONNECTED', interestLevel: 'HIGH', objectionCategory: 'PRICE', notes: 'Wants a discount', nextActionAt: future(2 * 24 * 60), nextActionType: 'DEMO', taskId: first.id });
    expect(r.status).toBe(201);
    expect(r.body.data.statusChanges.map((s: { to: string }) => s.to)).toEqual(['CONTACT_ATTEMPTED', 'CONNECTED']);
    const done = await k.t.prisma.task.findUniqueOrThrow({ where: { id: first.id } });
    expect(done.status).toBe('DONE');
    const open = await k.t.prisma.task.findMany({ where: { leadId: l.id, status: 'OPEN' } });
    expect(open).toHaveLength(1);
    expect(open[0]!.type).toBe('DEMO');
    const row = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(row.interestLevel).toBe('HIGH');
    expect(row.nextActionAt?.getTime()).toBe(open[0]!.dueAt.getTime());
    const list = await k.a.execA1.get(`/leads/${l.id}/calls`);
    expect(list.body.data[0].objectionCategory).toBe('PRICE');
    expect(list.body.data[0].callNotes[0].summary).toBe('Wants a discount');
    expect(list.body.data[0].sourceLabel).toMatch(/MANUAL/);
  });

  it('LOST requires a reason, cancels open tasks, preserves history and schedules reactivation', async () => {
    const l = await createLead(k.a.execA1);
    const r = await call(l.id, { outcome: 'LOST', lostReason: 'BAD_TIMING' });
    expect(r.status).toBe(201);
    expect(r.body.data.lead.stageCategory).toBe('LOST');
    expect(await k.t.prisma.task.count({ where: { leadId: l.id, status: 'OPEN' } })).toBe(0);
    const e = await k.t.prisma.reactivationEntry.findFirstOrThrow({ where: { leadId: l.id } });
    expect(e.eligibleFrom.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(e.eligibleFrom.getTime()).toBeLessThan(Date.now() + 31 * 86_400_000);
    const noReactivate = await createLead(k.a.execA1);
    await call(noReactivate.id, { outcome: 'LOST', lostReason: 'NOT_ELIGIBLE' });
    expect(await k.t.prisma.reactivationEntry.count({ where: { leadId: noReactivate.id } })).toBe(0);
  });

  it('WON records value/date, resolves follow-ups and creates an onboarding task', async () => {
    const l = await createLead(k.a.execA1);
    const r = await call(l.id, { outcome: 'WON', wonValue: 49999 });
    expect(r.status).toBe(201);
    expect(r.body.data.statusChanges.map((s: { to: string }) => s.to)).toEqual(['CONTACT_ATTEMPTED', 'CONNECTED', 'PROPOSAL_NEGOTIATION', 'WON']);
    const row = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(row.stageCategory).toBe('WON');
    expect(row.wonValue?.toString()).toBe('49999');
    expect(row.wonAt).toBeTruthy();
    const open = await k.t.prisma.task.findMany({ where: { leadId: l.id, status: 'OPEN' } });
    expect(open.map((t) => t.type)).toEqual(['ONBOARDING']);
    expect((await k.t.prisma.outboxEvent.count({ where: { eventType: 'lead.won', aggregateId: l.id } }))).toBe(1);
    // a won lead cannot be won/lost again
    expect((await call(l.id, { outcome: 'LOST', lostReason: 'PRICE' })).body.error.code).toBe('INVALID_TRANSITION');
  });

  it('FAILED is a valid outcome (retry task optional)', async () => {
    const l = await createLead(k.a.execA1);
    const r = await call(l.id, { outcome: 'FAILED' });
    expect(r.status).toBe(201);
    expect((await tasksOf(l.id)).filter((t) => t.ruleKey === 'FAILED_RETRY')).toHaveLength(0);
    const r2 = await call(l.id, { outcome: 'FAILED', nextActionAt: future(90) });
    expect(r2.status).toBe(201);
    expect((await tasksOf(l.id)).filter((t) => t.ruleKey === 'FAILED_RETRY')).toHaveLength(1);
  });

  it('automation is configurable per team: a team override changes the NO_ANSWER retry delay', async () => {
    const put = await k.a.founder.post('/automation-rules').send({ ruleKey: 'NO_ANSWER', teamId: k.fx.teamA.id, config: { retryDelayWorkingMinutes: 30, maxAttemptsPerDay: 3, maxAttemptsTotal: 5 } });
    expect(put.status).toBe(201);
    const bad = await k.a.founder.post('/automation-rules').send({ ruleKey: 'NO_ANSWER', teamId: k.fx.teamA.id, config: { retryDelayWorkingMinutes: -1 } });
    expect(bad.status).toBe(422);
    const l = await createLead(k.a.execA1);
    await call(l.id, { outcome: 'NO_ANSWER' });
    const t = (await tasksOf(l.id)).find((x) => x.ruleKey === 'NO_ANSWER_RETRY')!;
    // 30 working minutes (+ possibly rolling to the next opening outside working hours): at most the next working morning
    expect(t.dueAt.getTime()).toBeGreaterThan(Date.now());
    const rules = await k.a.founder.get('/automation-rules');
    expect(rules.body.data.find((r: { teamId: string; ruleKey: string }) => r.teamId === k.fx.teamA.id && r.ruleKey === 'NO_ANSWER').config.retryDelayWorkingMinutes).toBe(30);
    // cleanup so other tests keep the defaults
    await k.t.prisma.automationRule.deleteMany({ where: { organizationId: k.fx.org.id } });
  });
});

describe('transaction atomicity: call + task + status history in ONE transaction', () => {
  for (const step of ['after_call_insert', 'after_status_change', 'after_task_insert']) {
    it(`a failure at ${step} rolls back the call, tasks, status history, counters and outbox events`, async () => {
      const l = await createLead(k.a.execA1);
      const before = {
        calls: await k.t.prisma.callLog.count({ where: { leadId: l.id } }),
        tasks: await k.t.prisma.task.count({ where: { leadId: l.id } }),
        hist: await k.t.prisma.leadStatusHistory.count({ where: { leadId: l.id } }),
        events: await k.t.prisma.outboxEvent.count({ where: { organizationId: k.fx.org.id } }),
        audits: await k.t.prisma.auditLog.count({ where: { organizationId: k.fx.org.id, action: 'call.created' } }),
        lead: await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } }),
      };
      failAt = step;
      const r = await call(l.id, { outcome: 'NO_ANSWER' });
      failAt = null;
      expect(r.status).toBe(500);
      expect(await k.t.prisma.callLog.count({ where: { leadId: l.id } })).toBe(before.calls);
      expect(await k.t.prisma.task.count({ where: { leadId: l.id } })).toBe(before.tasks);
      expect(await k.t.prisma.leadStatusHistory.count({ where: { leadId: l.id } })).toBe(before.hist);
      expect(await k.t.prisma.outboxEvent.count({ where: { organizationId: k.fx.org.id } })).toBe(before.events);
      expect(await k.t.prisma.auditLog.count({ where: { organizationId: k.fx.org.id, action: 'call.created' } })).toBe(before.audits);
      const after = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
      expect(after.status).toBe('NEW');
      expect(after.callAttemptCount).toBe(0);
      expect(after.version).toBe(before.lead.version);
      // and the same request succeeds once the fault is gone (nothing was half-applied)
      const retry = await call(l.id, { outcome: 'NO_ANSWER' });
      expect(retry.status).toBe(201);
    });
  }

  it('Idempotency-Key makes a retried disposition return the same call without a second task', async () => {
    const l = await createLead(k.a.execA1);
    const key = `call-${Math.random()}`;
    const r1 = await k.a.execA1.post(`/leads/${l.id}/calls`).set('Idempotency-Key', key).send({ outcome: 'NO_ANSWER' });
    const r2 = await k.a.execA1.post(`/leads/${l.id}/calls`).set('Idempotency-Key', key).send({ outcome: 'NO_ANSWER' });
    expect(r1.status).toBe(201);
    expect(r2.body.data.call.id).toBe(r1.body.data.call.id);
    expect(await k.t.prisma.callLog.count({ where: { leadId: l.id } })).toBe(1);
    expect((await tasksOf(l.id)).filter((t) => t.ruleKey === 'NO_ANSWER_RETRY')).toHaveLength(1);
  });
});
