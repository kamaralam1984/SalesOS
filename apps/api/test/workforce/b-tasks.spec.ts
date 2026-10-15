import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createOrg, createTestApp, createUser, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

/** Area B: work tasks. Real Postgres, real HTTP pipeline. */
let t: TestApp;
let fx: OrgFixture;
let a: Record<'founder' | 'teamLead' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'hr' | 'admin', AuthedAgent>;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  a = {
    founder: await loginAgent(t.app, fx.founder), teamLead: await loginAgent(t.app, fx.teamLead), managerA: await loginAgent(t.app, fx.managerA), managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1), execA2: await loginAgent(t.app, fx.execA2), execB1: await loginAgent(t.app, fx.execB1), hr: await loginAgent(t.app, fx.hr), admin: await loginAgent(t.app, fx.admin),
  };
});
afterAll(async () => { await t.close(); });

type Task = { id: string; version: number; status: string; [k: string]: unknown };
const mk = async (who: AuthedAgent, body: Record<string, unknown> = {}) => {
  const res = await who.post('/workforce/tasks').send({ title: 'Call the stalled leads', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as Task;
};
const move = (who: AuthedAgent, id: string, to: string, extra: Record<string, unknown> = {}) => who.post(`/workforce/tasks/${id}/transition`).send({ to, ...extra });
const code = (res: { body: { error?: { code?: string } } }) => res.body.error?.code;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe('create and assignment scope', () => {
  it('a self task starts ACCEPTED; a task assigned by a manager starts ASSIGNED and notifies the assignee (generic title)', async () => {
    const self = await mk(a.execA1);
    expect(self).toMatchObject({ status: 'ACCEPTED', assigneeId: fx.execA1.id, assignerId: fx.execA1.id, overdue: false });
    const asg = await mk(a.managerA, { assigneeId: fx.execA1.id, priority: 'HIGH', dueAt: iso(86_400_000) });
    expect(asg).toMatchObject({ status: 'ASSIGNED', priority: 'HIGH', assignerId: fx.managerA.id });
    const n = await t.prisma.outboxEvent.findMany({ where: { aggregateId: asg.id, eventType: 'notification.requested' } });
    expect(n).toHaveLength(1);
    expect(n[0]!.payload).toMatchObject({ type: 'work_task.assigned', userIds: [fx.execA1.id] });
    expect(JSON.stringify(n[0]!.payload)).not.toContain('stalled');
    expect(await t.prisma.auditLog.count({ where: { entityType: 'work_task', entityId: asg.id, action: 'work_task.created' } })).toBe(1);
  });
  it('employees cannot assign to others (403); managers only inside their team (404); cross-org assignee 400', async () => {
    expect((await a.execA1.post('/workforce/tasks').send({ title: 'For colleague', assigneeId: fx.execA2.id })).status).toBe(403);
    expect((await a.managerA.post('/workforce/tasks').send({ title: 'Other team', assigneeId: fx.execB1.id })).status).toBe(404);
    expect((await a.founder.post('/workforce/tasks').send({ title: 'Org wide', assigneeId: fx.execB1.id })).status).toBe(201);
    const other = await createOrg(t.prisma);
    const stranger = await createUser(t.prisma, other, { roles: ['SALES_EXECUTIVE'] });
    const x = await a.founder.post('/workforce/tasks').send({ title: 'Cross org', assigneeId: stranger.id });
    expect(x.status).toBe(400);
    expect(code(x)).toBe('INVALID_USER');
  });
  it('validates: short title, past due date, bad uuids, unknown goal link', async () => {
    expect((await a.execA1.post('/workforce/tasks').send({ title: 'x' })).status).toBe(400);
    expect((await a.execA1.post('/workforce/tasks').send({ title: 'Valid title', dueAt: iso(-3_600_000) })).status).toBe(400);
    expect((await a.execA1.post('/workforce/tasks').send({ title: 'Valid title', dueAt: 'tomorrow' })).status).toBe(400);
    expect((await a.execA1.post('/workforce/tasks').send({ title: 'Valid title', assigneeId: 'nope' })).status).toBe(400);
    expect((await a.execA1.post('/workforce/tasks').send({ title: 'Valid title', priority: 'CRITICAL' })).status).toBe(400);
    expect((await a.execA1.post('/workforce/tasks').send({ title: 'Valid title', goalId: '11111111-1111-4111-8111-111111111111' })).status).toBe(404);
  });
  it('links to a goal the caller can see, not to someone elses goal', async () => {
    const g = (await a.execA1.post('/workforce/goals').send({ title: 'Goal for linking' })).body.data;
    const ok = await mk(a.execA1, { goalId: g.id, title: 'Linked task' });
    expect(ok.goalTitle).toBe('Goal for linking');
    expect((await a.execB1.post('/workforce/tasks').send({ title: 'Linking foreign goal', goalId: g.id })).status).toBe(404);
    const detail = await a.execA1.get(`/workforce/goals/${g.id}`);
    expect(detail.body.data.tasks.map((x: { id: string }) => x.id)).toContain(ok.id);
    // the goal detail exposes linked tasks only inside the viewer's own task scope
    const asReviewer = await a.managerA.get(`/workforce/goals/${g.id}`);
    expect(asReviewer.body.data.tasks.map((x: { id: string }) => x.id)).toContain(ok.id);
  });
});

describe('read scope (IDOR safe)', () => {
  let task: Task;
  beforeAll(async () => { task = await mk(a.managerA, { assigneeId: fx.execA1.id, title: 'Scope probe task' }); });
  it('assignee, assigner, team lead, founder and HR (org) read; peers, other teams and other orgs get 404', async () => {
    for (const who of ['execA1', 'managerA', 'teamLead', 'founder', 'hr'] as const) expect((await a[who].get(`/workforce/tasks/${task.id}`)).status, who).toBe(200);
    for (const who of ['execA2', 'execB1', 'managerB', 'admin'] as const) {
      const res = await a[who].get(`/workforce/tasks/${task.id}`);
      expect(res.status, who).toBe(404);
      expect(code(res)).toBe('NOT_FOUND');
    }
    const other = await createOrg(t.prisma);
    const f = await loginAgent(t.app, await createUser(t.prisma, other, { roles: ['FOUNDER_CEO'] }));
    expect((await f.get(`/workforce/tasks/${task.id}`)).status).toBe(404);
  });
  it('mutations outside the scope are 404', async () => {
    expect((await move(a.execB1, task.id, 'ACCEPTED')).status).toBe(404);
    expect((await a.execA2.post(`/workforce/tasks/${task.id}/comment`).send({ note: 'x' })).status).toBe(404);
    expect((await a.managerB.patch(`/workforce/tasks/${task.id}`).send({ version: 1, title: 'hijack' })).status).toBe(404);
  });
  it('lists are scoped by view and bounded; summary counts only visible tasks', async () => {
    const mine = await a.execA1.get('/workforce/tasks?view=mine&limit=100');
    expect(mine.body.data.every((x: { assigneeId: string }) => x.assigneeId === fx.execA1.id)).toBe(true);
    expect(mine.body.data.some((x: { id: string }) => x.id === task.id)).toBe(true);
    const assigned = await a.managerA.get('/workforce/tasks?view=assigned&limit=100');
    expect(assigned.body.data.every((x: { assignerId: string }) => x.assignerId === fx.managerA.id)).toBe(true);
    const bTeam = await a.managerB.get('/workforce/tasks?view=all&limit=100');
    expect(bTeam.body.data.some((x: { id: string }) => x.id === task.id)).toBe(false);
    expect((await a.execA1.get('/workforce/tasks?limit=101')).status).toBe(400);
    expect((await a.execA1.get('/workforce/tasks?status=BOGUS')).status).toBe(400);
    expect((await a.execB1.get('/workforce/tasks/summary')).body.data.mine.open).toBeGreaterThanOrEqual(1); // execB1 got the org-wide task
    expect((await a.execA2.get('/workforce/tasks/summary')).body.data.total).toBe(0);
  });
});

describe('lifecycle', () => {
  it('assignee accepts, starts, sends to review; assigner completes; events are appended; assignee cannot complete', async () => {
    const task = await mk(a.managerA, { assigneeId: fx.execA1.id, title: 'Lifecycle task' });
    expect((await move(a.execA1, task.id, 'IN_PROGRESS')).body.data.status).toBe('IN_PROGRESS'); // ASSIGNED -> IN_PROGRESS allowed
    expect((await move(a.execA1, task.id, 'COMPLETED')).status).toBe(403); // review required
    expect((await move(a.managerA, task.id, 'REVIEW')).status).toBe(403); // the assigner cannot move the assignee's work to review
    const rev = await move(a.execA1, task.id, 'REVIEW', { evidence: 'Sheet uploaded to drive', note: 'all 40 called' });
    expect(rev.body.data).toMatchObject({ status: 'REVIEW', evidence: 'Sheet uploaded to drive' });
    expect((await move(a.managerA, task.id, 'IN_PROGRESS', {})).status).toBe(400); // send-back needs a note
    const back = await move(a.managerA, task.id, 'IN_PROGRESS', { note: 'Missing 5 numbers' });
    expect(back.body.data).toMatchObject({ status: 'IN_PROGRESS', reviewNote: 'Missing 5 numbers' });
    await move(a.execA1, task.id, 'REVIEW');
    const done = await move(a.managerA, task.id, 'COMPLETED', { note: 'thanks' });
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', overdue: false });
    expect(done.body.data.completedAt).toBeTruthy();
    expect((await move(a.managerA, task.id, 'IN_PROGRESS', { note: 'again' })).status).toBe(409);
    const kinds = (done.body.data.events as Array<{ kind: string; toStatus: string | null }>).map((e) => `${e.kind}:${e.toStatus}`);
    expect(kinds).toEqual(['CREATED:ASSIGNED', 'STATUS:IN_PROGRESS', 'STATUS:REVIEW', 'EVIDENCE:null', 'STATUS:IN_PROGRESS', 'STATUS:REVIEW', 'STATUS:COMPLETED']);
    // audit/outbox carry statuses only
    const rows = await t.prisma.auditLog.findMany({ where: { entityType: 'work_task', entityId: task.id } });
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('Missing 5');
    // the event log is append-only at the database level
    await expect(t.prisma.workTaskEvent.deleteMany({ where: { taskId: task.id } })).rejects.toThrow();
  });
  it('reject needs a note, reassign by the assigner resets it, cancel by the assigner; others cannot', async () => {
    const task = await mk(a.managerA, { assigneeId: fx.execA1.id, title: 'Reject then reassign' });
    expect((await move(a.execA1, task.id, 'REJECTED')).status).toBe(400);
    const rej = await move(a.execA1, task.id, 'REJECTED', { note: 'Out of capacity this week' });
    expect(rej.body.data).toMatchObject({ status: 'REJECTED', reviewNote: 'Out of capacity this week' });
    expect((await move(a.execA1, task.id, 'ASSIGNED')).status).toBe(403);
    const re = await a.managerA.patch(`/workforce/tasks/${task.id}`).send({ version: rej.body.data.version, assigneeId: fx.execA2.id });
    expect(re.body.data).toMatchObject({ status: 'ASSIGNED', assigneeId: fx.execA2.id, reviewNote: null });
    expect((await a.execA1.get(`/workforce/tasks/${task.id}`)).status).toBe(404); // the previous assignee loses access
    expect((await move(a.execA2, task.id, 'CANCELLED')).status).toBe(403);
    expect((await move(a.managerA, task.id, 'CANCELLED')).body.data.status).toBe('CANCELLED');
    expect((await move(a.managerA, task.id, 'ASSIGNED')).status).toBe(409);
  });
  it('stale version on transition/update is 409; unknown status is 400', async () => {
    const task = await mk(a.execA1, { title: 'Version task' });
    expect((await move(a.execA1, task.id, 'IN_PROGRESS', { version: 99 })).status).toBe(409);
    expect((await move(a.execA1, task.id, 'NOPE')).status).toBe(400);
    expect((await a.execA1.patch(`/workforce/tasks/${task.id}`).send({ version: 1, title: 'Fine now' })).status).toBe(200);
    const stale = await a.execA1.patch(`/workforce/tasks/${task.id}`).send({ version: 1, title: 'Stale write' });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('STALE_VERSION');
  });
  it('concurrent identical transitions: exactly one wins', async () => {
    const task = await mk(a.managerA, { assigneeId: fx.execA1.id, title: 'Race task' });
    const res = await Promise.all([move(a.execA1, task.id, 'ACCEPTED'), move(a.execA1, task.id, 'ACCEPTED'), move(a.execA1, task.id, 'ACCEPTED')]);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status !== 200).every((r) => [409].includes(r.status))).toBe(true);
    expect(await t.prisma.workTaskEvent.count({ where: { taskId: task.id, kind: 'STATUS' } })).toBe(1);
  });
  it('only the assigner edits; the assignee gets 403; completed tasks are locked', async () => {
    const task = await mk(a.managerA, { assigneeId: fx.execA1.id, title: 'Edit permission task' });
    expect((await a.execA1.patch(`/workforce/tasks/${task.id}`).send({ version: 1, title: 'Assignee edit' })).status).toBe(403);
    const ok = await a.managerA.patch(`/workforce/tasks/${task.id}`).send({ version: 1, title: 'Manager edit', priority: 'URGENT', dueAt: iso(2 * 86_400_000) });
    expect(ok.body.data).toMatchObject({ title: 'Manager edit', priority: 'URGENT', version: 2 });
    expect((await a.managerA.patch(`/workforce/tasks/${task.id}`).send({ version: 2, assigneeId: fx.execB1.id })).status).toBe(404); // outside team
    await move(a.managerA, task.id, 'CANCELLED');
    const locked = await a.managerA.patch(`/workforce/tasks/${task.id}`).send({ version: 3, title: 'Too late' });
    expect(locked.status).toBe(409);
    expect(code(locked)).toBe('TASK_LOCKED');
  });
  it('comments: participants only', async () => {
    const task = await mk(a.managerA, { assigneeId: fx.execA1.id, title: 'Comment task' });
    expect((await a.execA1.post(`/workforce/tasks/${task.id}/comment`).send({ note: 'On it' })).body.data.events.at(-1)).toMatchObject({ kind: 'COMMENT', note: 'On it' });
    expect((await a.execA1.post(`/workforce/tasks/${task.id}/comment`).send({ note: '' })).status).toBe(400);
    expect((await a.hr.post(`/workforce/tasks/${task.id}/comment`).send({ note: 'hr' })).status).toBe(201); // HR holds org-wide work-tasks:update
    expect((await a.admin.post(`/workforce/tasks/${task.id}/comment`).send({ note: 'x' })).status).toBe(404);
  });
});

describe('overdue is computed, never stored', () => {
  it('filters overdue=true/false correctly, including tasks without a due date', async () => {
    const late = await mk(a.execA2, { title: 'Overdue later', dueAt: iso(3_600_000) });
    const noDue = await mk(a.execA2, { title: 'Never due' });
    const future = await mk(a.execA2, { title: 'Due next week', dueAt: iso(7 * 86_400_000) });
    const doneLate = await mk(a.execA2, { title: 'Done though late', dueAt: iso(3_600_000) });
    await t.prisma.workTask.updateMany({ where: { id: { in: [late.id, doneLate.id] } }, data: { dueAt: new Date(Date.now() - 3_600_000) } });
    await t.prisma.workTask.update({ where: { id: doneLate.id }, data: { status: 'COMPLETED' } });
    const od = await a.execA2.get('/workforce/tasks?view=mine&overdue=true&limit=100');
    expect(od.body.data.map((x: { id: string }) => x.id)).toEqual([late.id]);
    expect(od.body.data[0].overdue).toBe(true);
    const ok = await a.execA2.get('/workforce/tasks?view=mine&overdue=false&limit=100');
    const ids = ok.body.data.map((x: { id: string }) => x.id);
    expect(ids).toEqual(expect.arrayContaining([noDue.id, future.id, doneLate.id]));
    expect(ids).not.toContain(late.id);
    const sum = await a.execA2.get('/workforce/tasks/summary');
    expect(sum.body.data).toMatchObject({ overdue: 1, mine: { overdue: 1 } });
    expect(sum.body.data.dueSoon).toBeGreaterThanOrEqual(0);
  });
});

describe('policy: tasks.requireReview=false', () => {
  it('the assignee completes directly', async () => {
    const o = await buildOrgFixture(t.prisma);
    await t.prisma.workforceSetting.upsert({ where: { organizationId: o.org.id }, create: { organizationId: o.org.id, config: { tasks: { requireReview: false } } }, update: { config: { tasks: { requireReview: false } } } });
    const mgr = await loginAgent(t.app, o.managerA);
    const exec = await loginAgent(t.app, o.execA1);
    const task = await mk(mgr, { assigneeId: o.execA1.id, title: 'No review needed' });
    await move(exec, task.id, 'IN_PROGRESS');
    expect((await move(exec, task.id, 'COMPLETED')).body.data.status).toBe('COMPLETED');
  });
});
