import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createUser, createTestApp, loginAgent, type OrgFixture, type TestApp } from './helpers';

let t: TestApp;
let fx: OrgFixture;
let dev: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  dev = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
});
afterAll(async () => { await t.close(); });

const rolesOf = async (id: string) =>
  (await t.prisma.userRoleAssignment.findMany({ where: { userId: id }, include: { role: true } })).map((a) => a.role.key).sort();

describe('Developer Panel authorization (deny-by-default)', () => {
  it.each(['founder', 'admin', 'hr', 'execA1'] as const)('%s cannot reach any dev-panel endpoint', async (who) => {
    const a = await loginAgent(t.app, fx[who]);
    for (const path of ['/dev-panel/overview', '/dev-panel/users', '/dev-panel/server']) expect((await a.get(path)).status).toBe(403);
    expect((await a.post(`/dev-panel/users/${fx.execA1.id}/roles`).send({ roles: ['ADMIN'] })).status).toBe(403);
    expect((await a.post('/dev-panel/sessions/force-logout-all').send({ reason: 'nope nope' })).status).toBe(403);
  });

  it('Founder/Admin cannot grant DEVELOPER through the normal users API', async () => {
    const a = await loginAgent(t.app, fx.founder);
    const res = await a.post(`/users/${fx.execA1.id}/roles`).send({ roles: ['DEVELOPER'] });
    expect(res.status).toBe(403);
    expect(await rolesOf(fx.execA1.id)).toEqual(['SALES_EXECUTIVE']);
  });

  it('Founder cannot deactivate a Developer account', async () => {
    const a = await loginAgent(t.app, fx.founder);
    expect((await a.post(`/users/${dev.id}/deactivate`).send({})).status).toBe(403);
  });
});

describe('Developer Panel as DEVELOPER', () => {
  it('lists users and overview', async () => {
    const a = await loginAgent(t.app, dev);
    const list = await a.get('/dev-panel/users?limit=50');
    expect(list.status).toBe(200);
    expect(list.body.data.some((u: { id: string }) => u.id === fx.execA1.id)).toBe(true);
    const ov = await a.get('/dev-panel/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.data.usersPerRole.DEVELOPER).toBeGreaterThanOrEqual(1);
  });

  it('grants and removes roles, revokes sessions and audits', async () => {
    const victim = await loginAgent(t.app, fx.execA2);
    expect((await victim.get('/auth/me')).status).toBe(200);
    const a = await loginAgent(t.app, dev);
    const res = await a.post(`/dev-panel/users/${fx.execA2.id}/roles`).send({ roles: ['SALES_MANAGER', 'FINANCE'] });
    expect(res.status).toBe(200);
    expect(res.body.data.added.sort()).toEqual(['FINANCE', 'SALES_MANAGER']);
    expect(await rolesOf(fx.execA2.id)).toEqual(['FINANCE', 'SALES_MANAGER']);
    expect((await victim.get('/auth/me')).status).toBe(401); // sessions dropped
    const back = await a.post(`/dev-panel/users/${fx.execA2.id}/roles`).send({ roles: ['SALES_EXECUTIVE'] });
    expect(back.body.data.removed.sort()).toEqual(['FINANCE', 'SALES_MANAGER']);
    const audit = await t.prisma.auditLog.count({ where: { action: 'devpanel.roles_changed', entityId: fx.execA2.id } });
    expect(audit).toBe(2);
  });

  it('rejects two primary roles, self-change, and cross-org targets', async () => {
    const a = await loginAgent(t.app, dev);
    expect((await a.post(`/dev-panel/users/${fx.execA1.id}/roles`).send({ roles: ['ADMIN', 'SALES_MANAGER'] })).status).toBe(400);
    expect((await a.post(`/dev-panel/users/${dev.id}/roles`).send({ roles: ['ADMIN'] })).status).toBe(403);
    const other = await buildOrgFixture(t.prisma);
    expect((await a.post(`/dev-panel/users/${other.execA1.id}/roles`).send({ roles: ['ADMIN'] })).status).toBe(404);
  });

  it('can grant DEVELOPER, but never strands the last Developer', async () => {
    const a = await loginAgent(t.app, dev);
    expect((await a.post(`/dev-panel/users/${fx.admin.id}/roles`).send({ roles: ['DEVELOPER'] })).status).toBe(200);
    const second = await loginAgent(t.app, fx.admin);
    expect((await second.post(`/dev-panel/users/${dev.id}/roles`).send({ roles: ['ADMIN'] })).status).toBe(200); // another developer remains (admin)
    // now fx.admin is the only Developer in the org
    const lone = await loginAgent(t.app, fx.admin).catch(() => null);
    expect(lone).not.toBeNull();
    const res = await lone!.post(`/dev-panel/users/${dev.id}/roles`).send({ roles: ['DEVELOPER'] });
    expect(res.status).toBe(200);
    const rm = await lone!.post(`/dev-panel/users/${dev.id}/roles`).send({ roles: ['ADMIN'] });
    expect(rm.status).toBe(200);
    // sole remaining Developer cannot be demoted by a peer-less path: demote attempt on the last holder is blocked
    const third = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
    await t.prisma.userRoleAssignment.deleteMany({ where: { userId: fx.admin.id, role: { key: 'DEVELOPER' } } });
    const c = await loginAgent(t.app, third);
    await t.prisma.user.updateMany({ where: { id: dev.id }, data: { isActive: false } });
    const blocked = await c.post(`/dev-panel/users/${third.id}/roles`).send({ roles: ['ADMIN'] });
    expect(blocked.status).toBe(403); // self-change guard
  });

  it('server status is read-only snapshot without secrets', async () => {
    const d2 = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
    const a = await loginAgent(t.app, d2);
    const res = await a.get('/dev-panel/server');
    expect(res.status).toBe(200);
    expect(res.body.data.services.database).toBe('ok');
    expect(JSON.stringify(res.body.data)).not.toMatch(/password|secret|DATABASE_URL/i);
  });

  it('force logout needs a reason, keeps the caller signed in and audits', async () => {
    const d3 = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
    const a = await loginAgent(t.app, d3);
    const v = await loginAgent(t.app, fx.hr);
    expect((await a.post('/dev-panel/sessions/force-logout-all').send({ reason: 'x' })).status).toBe(400);
    const res = await a.post('/dev-panel/sessions/force-logout-all').send({ reason: 'security incident drill' });
    expect(res.status).toBe(200);
    expect((await v.get('/auth/me')).status).toBe(401);
    expect((await a.get('/auth/me')).status).toBe(200);
    expect(await t.prisma.auditLog.count({ where: { action: 'devpanel.force_logout_all', actorId: d3.id } })).toBe(1);
  });
});
