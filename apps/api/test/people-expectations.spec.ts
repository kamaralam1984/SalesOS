import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from './helpers';

/** JD-HR-009: employees acknowledge the ownership / accountability expectations of their role (bound to the exact text). */
let t: TestApp;
let fx: OrgFixture;
let hr: AuthedAgent;
let exec: AuthedAgent;
let manager: AuthedAgent;
let other: AuthedAgent;
let expId: string;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  [hr, exec, manager, other] = await Promise.all([fx.hr, fx.execA1, fx.managerA, fx.execB1].map((u) => loginAgent(t.app, u)));
  const created = await hr.post('/people/expectations').send({ roleKey: 'SALES_EXECUTIVE', kind: 'OWNERSHIP', title: 'Own your pipeline', body: 'Every lead you hold has a next action and an honest status.' });
  expect(created.status).toBe(201);
  expId = created.body.data.id;
});
afterAll(async () => { await t.close(); });

describe('expectation acknowledgement', () => {
  it('the employee sees it as pending, acknowledges once (idempotent, audited), and it shows as acknowledged', async () => {
    const before = (await exec.get('/people/expectations')).body.data.find((e: { id: string }) => e.id === expId);
    expect(before).toMatchObject({ acknowledgedByMe: false, mustAcknowledge: true });
    const first = await exec.post(`/people/expectations/${expId}/acknowledge`).send({});
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ acknowledged: true, alreadyAcknowledged: false });
    const again = await exec.post(`/people/expectations/${expId}/acknowledge`).send({});
    expect(again.body.data).toMatchObject({ acknowledged: true, alreadyAcknowledged: true });
    expect(await t.prisma.roleExpectationAcknowledgement.count({ where: { expectationId: expId, userId: fx.execA1.id } })).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { action: 'expectation.acknowledged', entityId: expId, actorId: fx.execA1.id } })).toBe(1);
    const after = (await exec.get('/people/expectations')).body.data.find((e: { id: string }) => e.id === expId);
    expect(after).toMatchObject({ acknowledgedByMe: true });
    expect(after.acknowledgedAt).toBeTruthy();
  });

  it('cannot acknowledge for someone else, for another role\'s expectation, or an unknown id', async () => {
    expect((await manager.post(`/people/expectations/${expId}/acknowledge`).send({})).status).toBe(404); // a manager does not hold the executive expectation
    expect((await hr.post(`/people/expectations/${expId}/acknowledge`).send({})).status).toBe(404);
    expect((await exec.post('/people/expectations/11111111-1111-4111-8111-111111111111/acknowledge').send({})).status).toBe(404);
    expect((await (await loginAgent(t.app, fx.finance)).post(`/people/expectations/${expId}/acknowledge`).send({})).status).toBe(403);
  });

  it('adoption: HR sees counts and who is pending; a manager sees only their team; executives are denied', async () => {
    const all = (await hr.get('/people/expectations/adoption')).body.data.find((e: { id: string }) => e.id === expId);
    expect(all.audience).toBeGreaterThanOrEqual(4);
    expect(all.acknowledged).toBe(1);
    expect(all.pending.map((p: { id: string }) => p.id)).toContain(fx.execB1.id);
    const team = (await manager.get('/people/expectations/adoption')).body.data.find((e: { id: string }) => e.id === expId);
    expect(team.pending.every((p: { id: string }) => [fx.execA1.id, fx.execA2.id].includes(p.id))).toBe(true);
    expect(team.pending.map((p: { id: string }) => p.id)).toContain(fx.execA2.id);
    expect((await exec.get('/people/expectations/adoption')).status).toBe(403);
  });

  it('editing the text invalidates earlier acknowledgements (bound to the content hash)', async () => {
    await t.prisma.roleExpectation.update({ where: { id: expId }, data: { body: 'Revised: every lead has a next action, an honest status and a reason for waiting.' } });
    const e = (await exec.get('/people/expectations')).body.data.find((x: { id: string }) => x.id === expId);
    expect(e.acknowledgedByMe).toBe(false);
    expect((await exec.post(`/people/expectations/${expId}/acknowledge`).send({})).body.data.alreadyAcknowledged).toBe(false);
    expect(await t.prisma.roleExpectationAcknowledgement.count({ where: { expectationId: expId, userId: fx.execA1.id } })).toBe(2);
    // another executive is unaffected by the first one's acknowledgement
    expect((await other.get('/people/expectations')).body.data.find((x: { id: string }) => x.id === expId).acknowledgedByMe).toBe(false);
  });
});
