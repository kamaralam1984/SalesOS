import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createOrg, createTestApp, createUser, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

/** Area B: goals (45-day cycle). Real Postgres, real HTTP pipeline. */
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

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const mk = async (who: AuthedAgent, body: Record<string, unknown> = {}) => {
  const res = await who.post('/workforce/goals').send({ title: 'Enrol thirty learners', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; version: number; [k: string]: unknown };
};
const code = (res: { body: { error?: { code?: string } } }) => res.body.error?.code;

describe('create', () => {
  it('creates an own goal: 45-day cycle, default reviewer = manager, risk ON_TRACK, audited, outbox event', async () => {
    const start = ymd(new Date(Date.now() + 86_400_000));
    const g = await mk(a.execA1, { startDate: start, targetValue: '30', unit: 'enrolments', milestones: [{ title: 'Week 1 batch' }] });
    expect(g).toMatchObject({ ownerId: fx.execA1.id, reviewerId: fx.managerA.id, status: 'ACTIVE', risk: 'ON_TRACK', startDate: start, targetDate: ymd(new Date(Date.parse(`${start}T00:00:00Z`) + 44 * 86_400_000)), cycleDays: 45, progressPct: 0, version: 1 });
    expect((g.milestones as unknown[]).length).toBe(1);
    expect(g.can).toMatchObject({ progress: true, verify: false });
    const audit = await t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, entityType: 'goal', entityId: g.id as string, action: 'goal.created' } });
    expect(audit).toHaveLength(1);
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId: g.id as string, eventType: 'goal.created' } })).toBe(1);
  });
  it('validates input (short title, bad date, target before start, cycle limits)', async () => {
    expect((await a.execA1.post('/workforce/goals').send({ title: 'x' })).status).toBe(400);
    expect((await a.execA1.post('/workforce/goals').send({ title: 'Valid title', startDate: '2026-13-45' })).status).toBe(400);
    expect((await a.execA1.post('/workforce/goals').send({ title: 'Valid title', startDate: '2026-10-10', targetDate: '2026-10-01' })).status).toBe(400);
    expect((await a.execA1.post('/workforce/goals').send({ title: 'Valid title', cycleDays: 3 })).status).toBe(400);
    expect((await a.execA1.post('/workforce/goals').send({ title: 'Valid title', targetValue: '-5' })).status).toBe(400);
    expect((await a.execA1.post('/workforce/goals').send({ title: 'Valid title', unknownField: 1, ownerId: 'not-a-uuid' })).status).toBe(400);
  });
  it('the reviewer can never be the owner', async () => {
    const res = await a.execA1.post('/workforce/goals').send({ title: 'Self reviewed', reviewerId: fx.execA1.id });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('INVALID_REVIEWER');
  });
  it('employees cannot assign goals to others; managers can only assign inside their team; cross-org owner is rejected', async () => {
    const own = await a.execA1.post('/workforce/goals').send({ title: 'For my colleague', ownerId: fx.execA2.id });
    expect(own.status).toBe(403);
    const ok = await mk(a.managerA, { ownerId: fx.execA1.id, title: 'Assigned by manager' });
    expect(ok).toMatchObject({ ownerId: fx.execA1.id, createdById: fx.managerA.id, reviewerId: fx.managerA.id });
    expect((await a.managerA.post('/workforce/goals').send({ title: 'Other team', ownerId: fx.execB1.id })).status).toBe(404);
    const other = await createOrg(t.prisma);
    const stranger = await createUser(t.prisma, other, { roles: ['SALES_EXECUTIVE'] });
    const cross = await a.founder.post('/workforce/goals').send({ title: 'Cross org', ownerId: stranger.id });
    expect(cross.status).toBe(400);
    expect(code(cross)).toBe('INVALID_USER');
    // assignee is notified (generic title, no narrative)
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId: ok.id as string, eventType: 'notification.requested' } })).toBe(1);
  });
});

describe('read scope (IDOR safe)', () => {
  let goal: { id: string };
  beforeAll(async () => { goal = await mk(a.execA1, { title: 'Scope probe goal' }); });
  it('owner, reviewer manager, team lead and founder can read; peers, other teams and other orgs get 404', async () => {
    for (const who of ['execA1', 'managerA', 'teamLead', 'founder', 'hr'] as const) expect((await a[who].get(`/workforce/goals/${goal.id}`)).status, who).toBe(200);
    for (const who of ['execA2', 'execB1', 'managerB'] as const) {
      const res = await a[who].get(`/workforce/goals/${goal.id}`);
      expect(res.status, who).toBe(404);
      expect(code(res)).toBe('NOT_FOUND');
    }
    const other = await createOrg(t.prisma);
    const foreign = await createUser(t.prisma, other, { roles: ['FOUNDER_CEO'] });
    const f = await loginAgent(t.app, foreign);
    expect((await f.get(`/workforce/goals/${goal.id}`)).status).toBe(404);
  });
  it('mutations on a goal outside the caller scope are 404, never 200/403 leaks', async () => {
    expect((await a.execB1.post(`/workforce/goals/${goal.id}/progress`).send({ progressPct: 10 })).status).toBe(404);
    expect((await a.execB1.post(`/workforce/goals/${goal.id}/comment`).send({ note: 'hi' })).status).toBe(404);
    expect((await a.managerB.post(`/workforce/goals/${goal.id}/verify`).send({})).status).toBe(404);
    expect((await a.execB1.post(`/workforce/goals/${goal.id}/cancel`).send({ reason: 'not mine' })).status).toBe(404);
    expect((await a.execB1.patch(`/workforce/goals/${goal.id}`).send({ version: 1, title: 'hijacked' })).status).toBe(404);
  });
  it('lists are scoped by view and bounded; summary counts only what the caller can see', async () => {
    const mine = await a.execA2.get('/workforce/goals?view=mine&limit=5');
    expect(mine.status).toBe(200);
    expect(mine.body.data.every((g: { ownerId: string }) => g.ownerId === fx.execA2.id)).toBe(true);
    expect(mine.body.data.find((g: { id: string }) => g.id === goal.id)).toBeUndefined();
    const team = await a.managerA.get(`/workforce/goals?view=team&ownerId=${fx.execA1.id}&limit=100`);
    expect(team.body.data.some((g: { id: string }) => g.id === goal.id)).toBe(true);
    const crossTeam = await a.managerB.get(`/workforce/goals?view=all&limit=100`);
    expect(crossTeam.body.data.some((g: { id: string }) => g.id === goal.id)).toBe(false);
    expect((await a.execA1.get('/workforce/goals?limit=500')).status).toBe(400);
    const sum = await a.managerA.get('/workforce/goals/summary');
    expect(sum.status).toBe(200);
    expect(sum.body.data.total).toBeGreaterThan(0);
    const sumB = await a.execB1.get('/workforce/goals/summary');
    expect(sumB.body.data.total).toBe(0);
  });
});

describe('progress, risk and the verification flow', () => {
  it('measurable goal: value drives %, owner only, stale version is 409, risk recomputed', async () => {
    // started 40 days ago in a 45-day cycle with 10% progress -> AT_RISK
    const start = ymd(new Date(Date.now() - 40 * 86_400_000));
    const g = await mk(a.execA1, { startDate: start, targetValue: '30' });
    const p = await a.execA1.post(`/workforce/goals/${g.id}/progress`).send({ currentValue: '3', note: 'three signed', version: g.version });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.data).toMatchObject({ progressPct: 10, currentValue: '3', risk: 'AT_RISK', version: 2 });
    expect(p.body.data.updates.some((u: { kind: string; note: string }) => u.kind === 'PROGRESS' && u.note === 'three signed')).toBe(true);
    expect((await a.execA1.post(`/workforce/goals/${g.id}/progress`).send({ currentValue: '6', version: 1 })).status).toBe(409);
    expect((await a.execA1.post(`/workforce/goals/${g.id}/progress`).send({ progressPct: 50 })).status).toBe(400); // measurable needs currentValue
    expect((await a.execA1.post(`/workforce/goals/${g.id}/progress`).send({})).status).toBe(400);
    expect((await a.managerA.post(`/workforce/goals/${g.id}/progress`).send({ currentValue: '30' })).status).toBe(403); // only the owner moves progress
    const done = await a.execA1.post(`/workforce/goals/${g.id}/progress`).send({ currentValue: '45' });
    expect(done.body.data).toMatchObject({ progressPct: 100, risk: 'ON_TRACK' });
  });
  it('non-measurable goal takes a manual percentage', async () => {
    const g = await mk(a.execA2, { title: 'Run the weekly review cadence' });
    expect((await a.execA2.post(`/workforce/goals/${g.id}/progress`).send({ currentValue: '5' })).status).toBe(400);
    expect((await a.execA2.post(`/workforce/goals/${g.id}/progress`).send({ progressPct: 101 })).status).toBe(400);
    const r = await a.execA2.post(`/workforce/goals/${g.id}/progress`).send({ progressPct: 40 });
    expect(r.body.data.progressPct).toBe(40);
  });
  it('owner submits, owner cannot verify, reviewer returns (note required) then verifies; progress locks while pending', async () => {
    const g = await mk(a.execA1, { title: 'Verification flow goal' });
    const sub = await a.execA1.post(`/workforce/goals/${g.id}/submit`).send({ note: 'done early' });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.data).toMatchObject({ status: 'PENDING_VERIFICATION', can: { verify: false, return: false } });
    expect((await a.execA1.post(`/workforce/goals/${g.id}/progress`).send({ progressPct: 60 })).status).toBe(409);
    expect((await a.execA1.post(`/workforce/goals/${g.id}/submit`).send({})).status).toBe(409);
    expect((await a.execA1.post(`/workforce/goals/${g.id}/verify`).send({})).status).toBe(403);
    expect((await a.execA2.post(`/workforce/goals/${g.id}/verify`).send({})).status).toBe(403); // no goals:review
    expect((await a.managerA.post(`/workforce/goals/${g.id}/return`).send({})).status).toBe(400); // note required
    const ret = await a.managerA.post(`/workforce/goals/${g.id}/return`).send({ note: 'Attach the enrolment sheet' });
    expect(ret.body.data).toMatchObject({ status: 'ACTIVE' });
    await a.execA1.post(`/workforce/goals/${g.id}/submit`).send({});
    const ver = await a.managerA.post(`/workforce/goals/${g.id}/verify`).send({});
    expect(ver.body.data).toMatchObject({ status: 'COMPLETED', risk: 'COMPLETED', verifiedByName: fx.managerA.name });
    expect((await a.managerA.post(`/workforce/goals/${g.id}/verify`).send({})).status).toBe(409);
    expect((await a.managerA.post(`/workforce/goals/${g.id}/cancel`).send({ reason: 'too late now' })).status).toBe(409);
    const kinds = (ver.body.data.updates as Array<{ kind: string }>).map((u) => u.kind);
    expect(kinds).toEqual(['SUBMITTED', 'RETURNED', 'SUBMITTED', 'VERIFIED']);
    // audit has status only, never the narrative note
    const rows = await t.prisma.auditLog.findMany({ where: { entityType: 'goal', entityId: g.id as string } });
    expect(rows.map((r) => r.action).sort()).toEqual(['goal.created', 'goal.returned', 'goal.submitted', 'goal.submitted', 'goal.verified']);
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('enrolment sheet');
  });
  it('a goal with no reviewer cannot be submitted (422)', async () => {
    const g = await mk(a.execA1, { title: 'No reviewer goal', reviewerId: null });
    const res = await a.execA1.post(`/workforce/goals/${g.id}/submit`).send({});
    expect(res.status).toBe(422);
    expect(code(res)).toBe('NO_REVIEWER');
  });
  it('the Founder (org review scope) can verify any goal; a cross-team manager cannot', async () => {
    const g = await mk(a.execB1, { title: 'Founder verifies' });
    await a.execB1.post(`/workforce/goals/${g.id}/submit`).send({});
    expect((await a.managerA.post(`/workforce/goals/${g.id}/verify`).send({})).status).toBe(404);
    expect((await a.founder.post(`/workforce/goals/${g.id}/verify`).send({})).body.data.status).toBe('COMPLETED');
  });
});

describe('edit, milestones, comments, cancel', () => {
  it('edit: creator-owner or reviewer side; version conflict 409; the new target date may not precede the start', async () => {
    const g = await mk(a.execA1, { startDate: '2026-10-01' });
    const ok = await a.managerA.patch(`/workforce/goals/${g.id}`).send({ version: 1, title: 'Renamed by manager', targetDate: '2026-11-30' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ title: 'Renamed by manager', targetDate: '2026-11-30', version: 2 });
    expect((await a.execA1.patch(`/workforce/goals/${g.id}`).send({ version: 1, title: 'stale edit' })).status).toBe(409);
    expect((await a.execA1.patch(`/workforce/goals/${g.id}`).send({ version: 2, targetDate: '2026-09-01' })).status).toBe(400);
    expect((await a.execA1.patch(`/workforce/goals/${g.id}`).send({ version: 2 })).status).toBe(400);
    expect((await a.execA1.patch(`/workforce/goals/${g.id}`).send({ version: 2, reviewerId: fx.execA1.id })).status).toBe(422);
  });
  it('milestones: add, toggle done, limits and permission', async () => {
    const g = await mk(a.execA1, { title: 'Milestone goal' });
    const add = await a.execA1.post(`/workforce/goals/${g.id}/milestones`).send({ title: 'Kick-off webinar', dueDate: '2026-10-20' });
    expect(add.status).toBe(201);
    const m = (add.body.data.milestones as Array<{ id: string }>)[0]!;
    const done = await a.execA1.patch(`/workforce/goals/${g.id}/milestones/${m.id}`).send({ done: true });
    expect(done.body.data.milestones[0]).toMatchObject({ done: true });
    expect(done.body.data.milestones[0].doneAt).toBeTruthy();
    expect((await a.execA1.patch(`/workforce/goals/${g.id}/milestones/${m.id}`).send({})).status).toBe(400);
    expect((await a.execA1.patch(`/workforce/goals/${g.id}/milestones/11111111-1111-4111-8111-111111111111`).send({ done: true })).status).toBe(404);
    expect((await a.execA2.post(`/workforce/goals/${g.id}/milestones`).send({ title: 'sneaky' })).status).toBe(404);
  });
  it('comments: owner and reviewer; strangers cannot; notification goes to the other party only', async () => {
    const g = await mk(a.execA1, { title: 'Comment goal' });
    const c = await a.managerA.post(`/workforce/goals/${g.id}/comment`).send({ note: 'Looks good so far' });
    expect(c.status).toBe(201);
    expect(c.body.data.updates.at(-1)).toMatchObject({ kind: 'COMMENT', note: 'Looks good so far', authorName: fx.managerA.name });
    expect((await a.execA1.post(`/workforce/goals/${g.id}/comment`).send({ note: '' })).status).toBe(400);
    expect((await a.hr.post(`/workforce/goals/${g.id}/comment`).send({ note: 'hr can read, not write' })).status).toBe(403);
    const n = await t.prisma.outboxEvent.findMany({ where: { aggregateId: g.id as string, eventType: 'notification.requested' } });
    expect(n).toHaveLength(1);
    expect((n[0]!.payload as { userIds: string[] }).userIds).toEqual([fx.execA1.id]);
    expect(JSON.stringify(n[0]!.payload)).not.toContain('Looks good');
  });
  it('cancel: owner may cancel only a goal they created; assigned goals are cancelled from the manager side; reason required', async () => {
    const own = await mk(a.execA1, { title: 'Own goal to cancel' });
    expect((await a.execA1.post(`/workforce/goals/${own.id}/cancel`).send({})).status).toBe(400);
    expect((await a.execA1.post(`/workforce/goals/${own.id}/cancel`).send({ reason: 'priorities changed' })).body.data).toMatchObject({ status: 'CANCELLED', riskApplies: false });
    const assigned = await mk(a.managerA, { ownerId: fx.execA1.id, title: 'Assigned goal to cancel' });
    expect((await a.execA1.post(`/workforce/goals/${assigned.id}/cancel`).send({ reason: 'I do not want it' })).status).toBe(403);
    expect((await a.managerA.post(`/workforce/goals/${assigned.id}/cancel`).send({ reason: 'plan changed' })).body.data.status).toBe('CANCELLED');
    expect((await a.execA1.post(`/workforce/goals/${assigned.id}/progress`).send({ progressPct: 5 })).status).toBe(409);
  });
});

describe('policy: goals.requireVerification=false', () => {
  it('the owner completes directly and the verify route is unavailable', async () => {
    const org = await buildOrgFixture(t.prisma);
    await t.prisma.workforceSetting.upsert({ where: { organizationId: org.org.id }, create: { organizationId: org.org.id, config: { goals: { requireVerification: false } } }, update: { config: { goals: { requireVerification: false } } } });
    const exec = await loginAgent(t.app, org.execA1);
    const mgr = await loginAgent(t.app, org.managerA);
    const g = await mk(exec, { title: 'Direct completion' });
    expect(g.can).toMatchObject({ submit: false, completeDirect: true });
    const done = await exec.post(`/workforce/goals/${g.id}/submit`).send({});
    expect(done.body.data.status).toBe('COMPLETED');
    expect(await t.prisma.auditLog.count({ where: { entityId: g.id as string, action: 'goal.completed' } })).toBe(1);
    expect((await mgr.post(`/workforce/goals/${g.id}/verify`).send({})).status).toBe(409);
  });
});

describe('Admin and summary leakage', () => {
  it('Admin has only own-scope goals: cannot read other employees goals', async () => {
    const g = await mk(a.execA1, { title: 'Admin cannot see' });
    expect((await a.admin.get(`/workforce/goals/${g.id}`)).status).toBe(404);
    const list = await a.admin.get('/workforce/goals?view=all&limit=100');
    expect(list.body.data.every((x: { ownerId: string }) => x.ownerId === fx.admin.id)).toBe(true);
  });
});
