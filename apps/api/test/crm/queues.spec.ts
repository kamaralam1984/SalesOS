import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { directDeps, queueOwnerDeactivation } from '@salesos/crm-core';
import { createLead, createUser, crmKit, future, uniqPhone, type CrmKit } from './kit';

let k: CrmKit;
beforeAll(async () => { k = await crmKit(); });
afterAll(async () => { await k.close(); });

describe('exception queue: every active lead has an owner AND a next action, or it is visible', () => {
  it('lists unowned leads, leads without a next action, manager-review and unattended leads with counts, scoped to the team', async () => {
    const unowned = (await k.a.managerA.post('/leads').send({ fullName: '[TEST] ex unowned', phone: uniqPhone() })).body.data.lead;
    const noAction = await createLead(k.a.execA1);
    const t = await k.t.prisma.task.findFirstOrThrow({ where: { leadId: noAction.id } });
    await k.a.execA1.post(`/tasks/${t.id}/complete`).send({});
    const bTeam = await createLead(k.a.execB1);
    await k.a.execB1.post(`/tasks/${(await k.t.prisma.task.findFirstOrThrow({ where: { leadId: bTeam.id } })).id}/complete`).send({});

    const mgr = await k.a.managerA.get('/leads/exceptions?limit=100');
    expect(mgr.status).toBe(200);
    const ids = mgr.body.data.map((e: { lead: { id: string }; kind: string }) => `${e.lead.id}:${e.kind}`);
    expect(ids).toContain(`${unowned.id}:NO_OWNER`);
    expect(ids).toContain(`${noAction.id}:NO_NEXT_ACTION`);
    expect(ids.some((x: string) => x.startsWith(bTeam.id))).toBe(false); // other team's manager only
    expect(mgr.body.meta.counts.NO_OWNER).toBeGreaterThanOrEqual(1);
    const other = await k.a.managerB.get('/leads/exceptions?limit=100');
    expect(other.body.data.some((e: { lead: { id: string } }) => e.lead.id === bTeam.id)).toBe(true);
    expect(other.body.data.some((e: { lead: { id: string } }) => e.lead.id === noAction.id)).toBe(false);
    const filtered = await k.a.managerA.get('/leads/exceptions?kind=NO_OWNER&limit=100');
    expect(filtered.body.data.every((e: { kind: string }) => e.kind === 'NO_OWNER')).toBe(true);

    // an executive sees only exceptions on their own leads
    const own = await k.a.execA1.get('/leads/exceptions?limit=100');
    expect(own.body.data.every((e: { lead: { assignedTo: { id: string } | null } }) => e.lead.assignedTo?.id === k.fx.execA1.id)).toBe(true);
    // fixing the cause clears the exception automatically
    await k.a.execA1.post(`/leads/${noAction.id}/tasks`).send({ title: 'next', dueAt: future(120) });
    const after = await k.a.managerA.get('/leads/exceptions?limit=100');
    expect(after.body.data.some((e: { lead: { id: string }; kind: string }) => e.lead.id === noAction.id && e.kind === 'NO_NEXT_ACTION')).toBe(false);
  });

  it('managers can acknowledge manager-review exceptions (audited) but not auto-managed ones', async () => {
    const l = await createLead(k.a.execA1);
    for (let i = 0; i < 3; i++) await k.a.execA1.post(`/leads/${l.id}/calls`).send({ outcome: 'SWITCHED_OFF' });
    const ex = await k.t.prisma.leadException.findFirstOrThrow({ where: { leadId: l.id, kind: 'MANAGER_REVIEW', resolvedAt: null } });
    expect((await k.a.execA1.post(`/leads/exceptions/${ex.id}/resolve`).send({ note: 'self ack' })).status).toBe(403);
    expect((await k.a.managerB.post(`/leads/exceptions/${ex.id}/resolve`).send({ note: 'not mine ack' })).status).toBe(404);
    expect((await k.a.managerA.post(`/leads/exceptions/${ex.id}/resolve`).send({ note: 'called the client myself' })).status).toBe(200);
    expect((await k.t.prisma.leadException.findUniqueOrThrow({ where: { id: ex.id } })).resolvedAt).toBeTruthy();
    expect(await k.t.prisma.auditLog.count({ where: { entityId: l.id, action: 'exception.resolved' } })).toBe(1);
    const auto = await k.t.prisma.leadException.create({ data: { organizationId: k.fx.org.id, leadId: l.id, kind: 'NO_OWNER', openKey: `${l.id}:NO_OWNER` } });
    expect((await k.a.managerA.post(`/leads/exceptions/${auto.id}/resolve`).send({ note: 'try to hide it' })).status).toBe(409);
    await k.t.prisma.leadException.delete({ where: { id: auto.id } });
  });
});

describe('deactivated owner -> reassignment queue -> bulk reassignment', () => {
  it('deactivating a user publishes user.deactivated; the CRM handler queues every open lead and task once; managers bulk-assign with a reason and full history', async () => {
    const ex = await createUser(k.t.prisma, k.fx.org, { roles: ['SALES_EXECUTIVE'], managerId: k.fx.managerA.id });
    await k.t.prisma.teamMembership.create({ data: { teamId: k.fx.teamA.id, userId: ex.id } });
    const agent = await (await import('./kit')).loginAgent(k.app, ex);
    const leads = [await createLead(agent), await createLead(agent), await createLead(agent)];
    const lost = await createLead(agent);
    await agent.post(`/leads/${lost.id}/calls`).send({ outcome: 'LOST', lostReason: 'PRICE' });
    const taskCount = await k.t.prisma.task.count({ where: { assignedToId: ex.id, status: 'OPEN' } });

    const deact = await k.a.admin.post(`/users/${ex.id}/deactivate`).send({});
    expect(deact.status).toBe(200);
    const ev = await k.t.prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'user.deactivated', aggregateId: ex.id } });
    // the worker consumes this event; here we run the very same handler core it calls (worker tests cover the BullMQ path)
    const payload = ev.payload as { organizationId: string; managerId: string | null };
    const r1 = await queueOwnerDeactivation(k.t.prisma, directDeps(), { organizationId: k.fx.org.id, userId: ex.id, eventId: ev.id, managerId: payload.managerId });
    const r2 = await queueOwnerDeactivation(k.t.prisma, directDeps(), { organizationId: k.fx.org.id, userId: ex.id, eventId: ev.id, managerId: payload.managerId });
    expect(r1).toEqual({ leads: 3, tasks: taskCount });
    expect(r2).toEqual({ leads: 0, tasks: 0 }); // idempotent

    const q = await k.a.managerA.get('/reassignment-queue?limit=100');
    const mine = q.body.data.filter((e: { previousOwner: { id: string } }) => e.previousOwner.id === ex.id);
    expect(mine.filter((e: { lead: unknown; task: unknown }) => e.lead && !e.task)).toHaveLength(3);
    expect(mine.filter((e: { task: unknown }) => e.task)).toHaveLength(taskCount);
    expect(mine.every((e: { reason: string }) => e.reason === 'OWNER_DEACTIVATED')).toBe(true);
    expect((await k.a.managerB.get('/reassignment-queue?limit=100')).body.data.filter((e: { previousOwner: { id: string } }) => e.previousOwner.id === ex.id)).toHaveLength(0);
    // the leads are flagged in the exception queue
    const exq = await k.a.managerA.get('/leads/exceptions?kind=OWNER_DEACTIVATED&limit=100');
    expect(leads.every((l) => exq.body.data.some((e: { lead: { id: string } }) => e.lead.id === l.id))).toBe(true);

    // bulk assign: target must be inside the manager's team, reason mandatory
    const entryIds = mine.map((e: { id: string }) => e.id);
    expect((await k.a.managerA.post('/reassignment-queue/bulk-assign').send({ entryIds, toUserId: k.fx.execB1.id, reason: 'cross team' })).status).toBe(404);
    expect((await k.a.managerA.post('/reassignment-queue/bulk-assign').send({ entryIds, toUserId: k.fx.execA2.id })).status).toBe(400);
    expect((await k.a.managerA.post('/reassignment-queue/bulk-assign').send({ entryIds, toUserId: ex.id, reason: 'to the leaver' })).status).toBe(422);
    const res = await k.a.managerA.post('/reassignment-queue/bulk-assign').send({ entryIds, toUserId: k.fx.execA2.id, reason: 'owner left the company' });
    expect(res.status).toBe(200);
    expect(res.body.data.resolved).toBe(entryIds.length);
    for (const l of leads) {
      const row = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
      expect(row.assignedToId).toBe(k.fx.execA2.id);
      const hist = await k.t.prisma.leadAssignment.findFirstOrThrow({ where: { leadId: l.id, method: 'REASSIGNMENT_QUEUE' } });
      expect(hist).toMatchObject({ fromUserId: ex.id, toUserId: k.fx.execA2.id, changedById: k.fx.managerA.id, reason: 'owner left the company' });
    }
    expect(await k.t.prisma.task.count({ where: { assignedToId: ex.id, status: 'OPEN' } })).toBe(0);
    expect(await k.t.prisma.leadException.count({ where: { leadId: { in: leads.map((l) => l.id) }, kind: 'OWNER_DEACTIVATED', resolvedAt: null } })).toBe(0);
    expect((await k.a.managerA.get('/reassignment-queue?limit=100')).body.data.filter((e: { previousOwner: { id: string } }) => e.previousOwner.id === ex.id)).toHaveLength(0);
    const again = await k.a.managerA.post('/reassignment-queue/bulk-assign').send({ entryIds, toUserId: k.fx.execA2.id, reason: 'second try' });
    expect(again.body.data.resolved).toBe(0);
    expect(again.body.data.skipped).toBe(entryIds.length);
    expect(await k.t.prisma.auditLog.count({ where: { action: 'ownership.changed', entityId: leads[0]!.id } })).toBeGreaterThanOrEqual(1);
  });
});

describe('lost-lead reactivation queue', () => {
  const lose = async (reason: string, who = k.a.execA1) => {
    const l = await createLead(who);
    expect((await who.post(`/leads/${l.id}/status`).send({ status: 'LOST', lostReason: reason })).status).toBe(200);
    return l;
  };

  it('lists eligible entries by rule; excluded reasons never enter; reactivation reopens, assigns, schedules and closes the entry', async () => {
    const l = await lose('BAD_TIMING');
    const excluded = await lose('NOT_ELIGIBLE');
    const entry = await k.t.prisma.reactivationEntry.findFirstOrThrow({ where: { leadId: l.id } });
    expect(await k.t.prisma.reactivationEntry.count({ where: { leadId: excluded.id } })).toBe(0);
    const list = await k.a.managerA.get('/leads/reactivation?limit=100');
    const row = list.body.data.find((e: { id: string }) => e.id === entry.id);
    expect(row).toMatchObject({ eligible: false, lostReason: 'BAD_TIMING' });
    expect((await k.a.managerA.post(`/leads/reactivation/${entry.id}/reactivate`).send({ toUserId: k.fx.execA2.id, reason: 'fresh campaign' })).body.error.code).toBe('NOT_YET_ELIGIBLE');
    await k.t.prisma.reactivationEntry.update({ where: { id: entry.id }, data: { eligibleFrom: new Date(Date.now() - 1000) } });
    expect((await k.a.execA1.post(`/leads/reactivation/${entry.id}/reactivate`).send({ reason: 'self serve' })).status).toBe(403);
    expect((await k.a.managerB.post(`/leads/reactivation/${entry.id}/reactivate`).send({ toUserId: k.fx.execB1.id, reason: 'other team' })).status).toBe(404);
    const ok = await k.a.managerA.post(`/leads/reactivation/${entry.id}/reactivate`).send({ toUserId: k.fx.execA2.id, reason: 'fresh campaign' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'CONTACT_ATTEMPTED', stageCategory: 'OPEN' });
    expect(ok.body.data.assignedTo.id).toBe(k.fx.execA2.id);
    const lead = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(lead.reactivationCount).toBe(1);
    expect(lead.lostReason).toBeNull();
    const reTask = await k.t.prisma.task.findFirstOrThrow({ where: { leadId: l.id, ruleKey: 'REACTIVATION', status: 'OPEN' } });
    expect(reTask.assignedToId).toBe(k.fx.execA2.id);
    const done = await k.t.prisma.reactivationEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(done).toMatchObject({ status: 'REACTIVATED', openKey: null });
    expect(await k.t.prisma.leadStatusHistory.count({ where: { leadId: l.id, oldCategory: 'LOST', newCategory: 'OPEN' } })).toBe(1);
    expect((await k.a.managerA.post(`/leads/reactivation/${entry.id}/reactivate`).send({ toUserId: k.fx.execA2.id, reason: 'again' })).status).toBe(409);
  });

  it('withdrawn consent blocks reactivation; the reactivation attempt cap archives repeat losses', async () => {
    const l = await lose('PRICE');
    const entry = await k.t.prisma.reactivationEntry.findFirstOrThrow({ where: { leadId: l.id } });
    await k.t.prisma.reactivationEntry.update({ where: { id: entry.id }, data: { eligibleFrom: new Date(Date.now() - 1000) } });
    expect((await k.a.execA1.patch(`/leads/${l.id}`).send({ consentStatus: 'DND' })).status).toBe(200);
    expect((await k.t.prisma.reactivationEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('EXCLUDED'); // consent change closes the entry
    expect((await k.a.managerA.post(`/leads/reactivation/${entry.id}/reactivate`).send({ toUserId: k.fx.execA2.id, reason: 'try anyway' })).status).toBe(409);
    // attempt cap: a lead already reactivated twice does not re-enter the queue
    const capped = await createLead(k.a.execA1);
    await k.t.prisma.lead.update({ where: { id: capped.id }, data: { reactivationCount: 2 } });
    await k.a.execA1.post(`/leads/${capped.id}/status`).send({ status: 'LOST', lostReason: 'PRICE' });
    expect(await k.t.prisma.reactivationEntry.count({ where: { leadId: capped.id } })).toBe(0);
  });

  it('LOST is never set automatically: only an explicit human status/disposition creates a LOST lead', async () => {
    const l = await createLead(k.a.execA1);
    for (let i = 0; i < 8; i++) await k.a.execA1.post(`/leads/${l.id}/calls`).send({ outcome: i % 2 ? 'NO_ANSWER' : 'SWITCHED_OFF' });
    const row = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(row.stageCategory).toBe('OPEN');
    expect(await k.t.prisma.leadStatusHistory.count({ where: { leadId: l.id, newCategory: 'LOST' } })).toBe(0);
    expect(await k.t.prisma.auditLog.count({ where: { entityId: l.id, action: 'lead.lost' } })).toBe(0);
  });
});
