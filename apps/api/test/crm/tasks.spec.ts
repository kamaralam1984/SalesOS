import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLead, crmKit, future, type CrmKit } from './kit';

let k: CrmKit;
beforeAll(async () => { k = await crmKit(); });
afterAll(async () => { await k.close(); });

describe('tasks', () => {
  it('creates tasks for a lead (types, priority, due) and the lead exposes the earliest as next action', async () => {
    const l = await createLead(k.a.execA1);
    const r = await k.a.execA1.post(`/leads/${l.id}/tasks`).send({ type: 'DEMO', title: 'Demo for client', dueAt: future(60), priority: 'HIGH' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ type: 'DEMO', priority: 'HIGH', status: 'OPEN', leadId: l.id });
    const lead = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(lead.nextActionAt?.getTime()).toBeLessThanOrEqual(new Date(r.body.data.dueAt).getTime());
    expect((await k.a.execA1.post(`/leads/${l.id}/tasks`).send({ title: 'past', dueAt: '2020-01-01T00:00:00Z' })).status).toBe(400);
    expect((await k.a.execA1.post(`/leads/${l.id}/tasks`).send({ title: 'bad type', type: 'NOPE', dueAt: future(10) })).status).toBe(400);
  });

  it('Idempotency-Key makes task creation retry-safe', async () => {
    const l = await createLead(k.a.execA1);
    const key = `t-${Math.random()}`;
    const b = { title: 'idem', dueAt: future(30) };
    const r1 = await k.a.execA1.post(`/leads/${l.id}/tasks`).set('Idempotency-Key', key).send(b);
    const r2 = await k.a.execA1.post(`/leads/${l.id}/tasks`).set('Idempotency-Key', key).send(b);
    expect(r2.body.data.id).toBe(r1.body.data.id);
    expect(await k.t.prisma.task.count({ where: { leadId: l.id, title: 'idem' } })).toBe(1);
  });

  it('complete is atomic and idempotent-safe: the second complete gets 409, lead activity + next action update', async () => {
    const l = await createLead(k.a.execA1);
    const t = (await k.t.prisma.task.findFirstOrThrow({ where: { leadId: l.id } }));
    const [a, b] = await Promise.all([k.a.execA1.post(`/tasks/${t.id}/complete`).send({ completionNote: 'done' }), k.a.execA1.post(`/tasks/${t.id}/complete`).send({ completionNote: 'done again' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = await k.t.prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.status).toBe('DONE');
    expect(row.completedById).toBe(k.fx.execA1.id);
    const lead = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(lead.nextActionAt).toBeNull();
    expect(lead.lastActivityAt).toBeTruthy();
    // lead is now missing a next action => visible in the exception queue
    expect(await k.t.prisma.leadException.count({ where: { leadId: l.id, kind: 'NO_NEXT_ACTION', resolvedAt: null } })).toBe(1);
    expect((await k.t.prisma.auditLog.count({ where: { entityId: t.id, action: 'task.completed' } }))).toBe(1);
  });

  it('reschedule resets reminder/escalation state; edits of closed tasks are refused', async () => {
    const l = await createLead(k.a.execA1);
    const t = await k.t.prisma.task.findFirstOrThrow({ where: { leadId: l.id } });
    await k.t.prisma.task.update({ where: { id: t.id }, data: { overdueLevel: 3, remindedAt: new Date() } });
    const r = await k.a.execA1.patch(`/tasks/${t.id}`).send({ dueAt: future(500), title: 'moved', version: t.version });
    expect(r.status).toBe(200);
    const row = await k.t.prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.overdueLevel).toBe(0);
    expect(row.remindedAt).toBeNull();
    expect((await k.a.execA1.patch(`/tasks/${t.id}`).send({ title: 'stale', version: t.version })).body.error.code).toBe('VERSION_CONFLICT');
    await k.a.execA1.post(`/tasks/${t.id}/complete`).send({});
    expect((await k.a.execA1.patch(`/tasks/${t.id}`).send({ title: 'closed' })).status).toBe(409);
  });

  it('list filters (overdue, mine, pinned, type) and bounded pagination', async () => {
    const l = await createLead(k.a.execA2);
    const open = await k.t.prisma.task.findFirstOrThrow({ where: { leadId: l.id } });
    await k.t.prisma.task.update({ where: { id: open.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
    const overdue = await k.a.execA2.get('/tasks?overdue=true&limit=100');
    expect(overdue.body.data.some((t: { id: string; overdue: boolean }) => t.id === open.id && t.overdue)).toBe(true);
    const mine = await k.a.execA2.get('/tasks?mine=true');
    expect(mine.body.data.every((t: { assignedTo: { id: string } }) => t.assignedTo.id === k.fx.execA2.id)).toBe(true);
    expect((await k.a.execA2.get('/tasks?limit=1000')).status).toBe(400);
    expect((await k.a.execA2.get('/tasks?status=BOGUS')).status).toBe(400);
    const p1 = await k.a.execA2.get('/tasks?limit=1&status=ALL');
    expect(p1.body.data).toHaveLength(1);
  });

  it('follow-up calendar groups open tasks by IST day and returns the overdue backlog; the range is bounded', async () => {
    const l = await createLead(k.a.execA1);
    const dueAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const t = await k.a.execA1.post(`/leads/${l.id}/tasks`).send({ title: 'calendar task', dueAt });
    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const cal = await k.a.execA1.get(`/tasks/calendar?from=${from}&to=${to}`);
    expect(cal.status).toBe(200);
    expect(cal.body.data.timezone).toBe('Asia/Kolkata');
    const all = cal.body.data.days.flatMap((d: { tasks: { id: string }[] }) => d.tasks);
    expect(all.some((x: { id: string }) => x.id === t.body.data.id)).toBe(true);
    expect(cal.body.data.days.every((d: { date: string; count: number; tasks: unknown[] }) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.count === d.tasks.length)).toBe(true);
    expect(Array.isArray(cal.body.data.overdue)).toBe(true);
    const tooWide = await k.a.execA1.get(`/tasks/calendar?from=${from}&to=${new Date(Date.now() + 90 * 86_400_000).toISOString()}`);
    expect(tooWide.status).toBe(422);
  });

  it('tasks cannot be created on won leads; managers reassign tasks only inside their team', async () => {
    const w = await createLead(k.a.execA1);
    await k.a.execA1.post(`/leads/${w.id}/calls`).send({ outcome: 'WON', wonValue: 1000 });
    expect((await k.a.execA1.post(`/leads/${w.id}/tasks`).send({ title: 'x', dueAt: future(10) })).status).toBe(409);
    const l = await createLead(k.a.execA1);
    const t = await k.t.prisma.task.findFirstOrThrow({ where: { leadId: l.id } });
    expect((await k.a.managerA.post(`/tasks/${t.id}/reassign`).send({ assignedToId: k.fx.execB1.id, reason: 'cross team' })).status).toBe(404);
    const ok = await k.a.managerA.post(`/tasks/${t.id}/reassign`).send({ assignedToId: k.fx.execA2.id, reason: 'cover leave' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.assignedTo.id).toBe(k.fx.execA2.id);
    expect(await k.t.prisma.auditLog.count({ where: { entityId: t.id, action: 'ownership.changed' } })).toBe(1);
    expect((await k.a.execA1.post(`/tasks/${t.id}/reassign`).send({ assignedToId: k.fx.execA1.id, reason: 'steal it back' })).status).toBe(403);
  });
});
