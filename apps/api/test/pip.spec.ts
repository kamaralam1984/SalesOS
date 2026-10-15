import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from './helpers';

let t: TestApp;
let fx: OrgFixture;
let A: Record<'founder' | 'teamLead' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'admin' | 'hr' | 'finance', AuthedAgent>;
let pipId: string;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  A = {
    founder: await loginAgent(t.app, fx.founder), teamLead: await loginAgent(t.app, fx.teamLead), managerA: await loginAgent(t.app, fx.managerA), managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1), execA2: await loginAgent(t.app, fx.execA2), execB1: await loginAgent(t.app, fx.execB1),
    admin: await loginAgent(t.app, fx.admin), hr: await loginAgent(t.app, fx.hr), finance: await loginAgent(t.app, fx.finance),
  };
});
afterAll(async () => { await t.close(); });

const create = (employeeId: string) => ({ employeeId, reason: 'Revenue achievement below 60% for two consecutive months', kpiGaps: [{ key: 'revenue-achievement', name: 'Revenue achievement', target: 100, actual: 55 }] });
const ready = { goals: [{ title: 'Reach 80% of monthly target', measure: 'Collections' }], measures: ['Weekly pipeline review'], durationDays: 30, checkpoints: [{ dueDate: day(10), title: 'Mid-point review' }, { dueDate: day(20), title: 'Final review' }] };
const trans = (a: AuthedAgent, id: string, body: object) => a.post(`/people/pips/${id}/transition`).send(body);

describe('PIP creation and visibility', () => {
  it('only Team Lead / HR create plans; managers, executives, admin and finance cannot', async () => {
    for (const who of ['managerA', 'execA1', 'admin', 'finance', 'founder'] as const) {
      expect((await A[who].post('/people/pips').send(create(fx.execA1.id))).status).toBe(403);
    }
    expect((await A.teamLead.post('/people/pips').send(create(fx.teamLead.id))).status).toBe(403); // self
    const res = await A.teamLead.post('/people/pips').send(create(fx.execA1.id));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    pipId = res.body.data.id;
    expect((await A.teamLead.post('/people/pips').send(create(fx.execA1.id))).status).toBe(409); // one open plan per employee
  });

  it('is restricted HR data: team scope, own scope, no admin; the employee never sees a DRAFT', async () => {
    expect((await A.managerA.get(`/people/pips/${pipId}`)).status).toBe(200);
    for (const who of ['managerB', 'execA2', 'execB1', 'execA1']) expect((await A[who as 'managerB'].get(`/people/pips/${pipId}`)).status).toBe(404);
    expect((await A.admin.get(`/people/pips/${pipId}`)).status).toBe(403);
    expect((await A.admin.get('/people/pips')).status).toBe(403);
    expect((await A.finance.get('/people/pips')).status).toBe(403);
    expect((await A.execA1.get('/people/pips')).body.data).toEqual([]);
    expect((await A.managerB.get('/people/pips')).body.data).toEqual([]);
    expect((await A.hr.get('/people/pips')).body.data.map((p: { id: string }) => p.id)).toContain(pipId);
  });
});

describe('PIP state machine', () => {
  it('rejects illegal transitions with 409/400 and incomplete submissions with 422', async () => {
    expect((await trans(A.teamLead, pipId, { to: 'ACTIVE' })).status).toBe(400); // not a valid target through /transition
    expect((await trans(A.teamLead, pipId, { to: 'COMPLETED_SUCCESS', finalReview: 'All goals were met in the period.' })).status).toBe(409);
    expect((await trans(A.teamLead, pipId, { to: 'EXTENDED', reason: 'more time', newEndDate: day(60) })).status).toBe(409);
    const early = await trans(A.teamLead, pipId, { to: 'PENDING_APPROVAL' });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('PIP_INCOMPLETE');
  });

  it('draft is editable by the plan owner side and then submitted by a Team Lead (not a manager)', async () => {
    expect((await A.teamLead.patch(`/people/pips/${pipId}`).send(ready)).status).toBe(200);
    expect((await trans(A.managerA, pipId, { to: 'PENDING_APPROVAL' })).status).toBe(403);
    const sub = await trans(A.teamLead, pipId, { to: 'PENDING_APPROVAL' });
    expect(sub.status).toBe(200);
    expect(sub.body.data.status).toBe('PENDING_APPROVAL');
    expect((await A.teamLead.patch(`/people/pips/${pipId}`).send({ reason: 'edit after submit attempt' })).status).toBe(409);
  });

  it('cannot start without the employee acknowledgement (reminder queued), only the employee can acknowledge', async () => {
    expect((await A.teamLead.post(`/people/pips/${pipId}/approve`).send({})).status).toBe(403); // no pip:approve
    expect((await A.managerA.post(`/people/pips/${pipId}/approve`).send({})).status).toBe(403);
    const blocked = await A.founder.post(`/people/pips/${pipId}/approve`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PIP_ACK_REQUIRED');
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId: pipId, eventType: 'pip.acknowledgement_reminder' } })).toBe(1);
    expect((await A.execB1.post(`/people/pips/${pipId}/acknowledge`).send({})).status).toBe(404);
    expect((await A.managerA.post(`/people/pips/${pipId}/acknowledge`).send({})).status).toBe(403);
    expect((await A.execA1.post(`/people/pips/${pipId}/acknowledge`).send({})).status).toBe(200);
  });

  it('Founder approval activates the plan: dates, checkpoint tasks, audit and event', async () => {
    const res = await A.founder.post(`/people/pips/${pipId}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ACTIVE', startDate: day(0), endDate: day(30) });
    expect(await t.prisma.coachingAction.count({ where: { sourceRef: `pip:${pipId}`, ownerId: fx.execA1.id } })).toBe(2);
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId: pipId, eventType: 'pip.activated' } })).toBe(1);
    // the employee can now read it
    expect((await A.execA1.get(`/people/pips/${pipId}`)).status).toBe(200);
    expect((await A.execA2.get(`/people/pips/${pipId}`)).status).toBe(404);
  });

  it('checkpoints: team manager updates; other team and the employee cannot', async () => {
    const detail = (await A.hr.get(`/people/pips/${pipId}`)).body.data;
    const cp = detail.checkpoints[0].id;
    expect((await A.managerB.patch(`/people/pips/${pipId}/checkpoints/${cp}`).send({ status: 'DONE' })).status).toBe(404);
    expect((await A.execA1.patch(`/people/pips/${pipId}/checkpoints/${cp}`).send({ status: 'DONE' })).status).toBe(403);
    const ok = await A.managerA.patch(`/people/pips/${pipId}/checkpoints/${cp}`).send({ status: 'DONE', notes: 'On track' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.checkpoints[0].status).toBe('DONE');
  });

  it('extension is a two-step TL request + approver decision and is limited to one', async () => {
    expect((await trans(A.teamLead, pipId, { to: 'EXTENDED', reason: 'Illness in week 2', newEndDate: day(20) })).status).toBe(400); // not after current end
    const req = await trans(A.teamLead, pipId, { to: 'EXTENDED', reason: 'Illness in week 2', newEndDate: day(45) });
    expect(req.status).toBe(200);
    expect(req.body.data).toMatchObject({ status: 'EXTENDED', endDate: day(30), proposedEndDate: day(45) });
    expect((await A.teamLead.post(`/people/pips/${pipId}/approve`).send({})).status).toBe(403);
    const done = await A.founder.post(`/people/pips/${pipId}/approve`).send({ decision: 'APPROVE' });
    expect(done.body.data).toMatchObject({ status: 'ACTIVE', endDate: day(45), extensionCount: 1 });
    const second = await trans(A.teamLead, pipId, { to: 'EXTENDED', reason: 'Another extension', newEndDate: day(70) });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('PIP_EXTENSION_LIMIT');
  });

  it('completion is by Team Lead / HR only, requires a final review, and terminal states are final', async () => {
    expect((await trans(A.managerA, pipId, { to: 'COMPLETED_SUCCESS', finalReview: 'Met all agreed goals.' })).status).toBe(403);
    expect((await trans(A.teamLead, pipId, { to: 'COMPLETED_SUCCESS', finalReview: 'short' })).status).toBe(400);
    const res = await trans(A.teamLead, pipId, { to: 'COMPLETED_SUCCESS', finalReview: 'Met all agreed goals within the period.' });
    expect(res.body.data.status).toBe('COMPLETED_SUCCESS');
    for (const to of [{ to: 'CANCELLED', reason: 'no longer needed' }, { to: 'COMPLETED_NOT_IMPROVED', finalReview: 'Changed my mind later', recommendedAction: 'Escalate to HR' }, { to: 'PENDING_APPROVAL' }]) {
      expect((await trans(A.founder, pipId, to)).status).toBe(409);
      expect((await trans(A.hr, pipId, to)).status).toBe(409);
    }
    expect((await A.founder.post(`/people/pips/${pipId}/approve`).send({})).status).toBe(409);
    // a new plan is possible once the previous one is terminal
    expect((await A.teamLead.post('/people/pips').send(create(fx.execA1.id))).status).toBe(201);
  });

  it('audit trail records every transition with the actor and no narrative text', async () => {
    const rows = await t.prisma.auditLog.findMany({ where: { entityId: pipId, entityType: 'improvement_plan' }, orderBy: { createdAt: 'asc' } });
    const actions = rows.map((r) => r.action);
    for (const a of ['pip.created', 'pip.updated', 'pip.submitted', 'pip.acknowledged', 'pip.activated', 'pip.checkpoint_updated', 'pip.extension_requested', 'pip.extended', 'pip.completed']) expect(actions).toContain(a);
    expect(rows.find((r) => r.action === 'pip.activated')?.actorId).toBe(fx.founder.id);
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toMatch(/Revenue achievement below|Illness|Met all agreed/);
    const history = (await A.hr.get(`/people/pips/${pipId}`)).body.data.history;
    expect(history.map((h: { to: string }) => h.to)).toEqual(['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXTENDED', 'ACTIVE', 'COMPLETED_SUCCESS']);
  });

  it('approver can return a submitted plan to draft; cancel is Founder/HR only and works from DRAFT', async () => {
    const p = (await A.hr.post('/people/pips').send(create(fx.execA2.id))).body.data.id;
    await A.hr.patch(`/people/pips/${p}`).send(ready);
    await trans(A.hr, p, { to: 'PENDING_APPROVAL' });
    const ret = await A.founder.post(`/people/pips/${p}/approve`).send({ decision: 'RETURN', note: 'Add measurable goals' });
    expect(ret.body.data.status).toBe('DRAFT');
    expect((await trans(A.teamLead, p, { to: 'CANCELLED', reason: 'no longer needed' })).status).toBe(403);
    const cancelled = await trans(A.founder, p, { to: 'CANCELLED', reason: 'Employee transferred' });
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect((await trans(A.founder, p, { to: 'PENDING_APPROVAL' })).status).toBe(409);
  });

  it('cross-organisation access returns 404', async () => {
    const other = await buildOrgFixture(t.prisma);
    const o = await loginAgent(t.app, other.teamLead);
    expect((await o.get(`/people/pips/${pipId}`)).status).toBe(404);
    expect((await o.post('/people/pips').send(create(fx.execA2.id))).status).toBe(400);
  });
});
