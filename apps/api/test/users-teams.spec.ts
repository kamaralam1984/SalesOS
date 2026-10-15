import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createTestApp, createUser, loginAgent, TEST_PASSWORD, type OrgFixture, type TestApp } from './helpers';
import { anonymous } from './helpers';

let t: TestApp;
let fx: OrgFixture;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
});
afterAll(async () => { await t.close(); });

describe('users', () => {
  it('admin creates a user: invite token issued, roles audited, outbox event written', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    const email = `new-${Date.now()}@test.salesos.local`;
    const res = await admin.post('/users').send({ email: email.toUpperCase(), name: 'New Person', roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email, isActive: true, hasPassword: false, roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    expect(res.body.data.passwordHash).toBeUndefined();
    const audit = await t.prisma.auditLog.findFirst({ where: { entityId: res.body.data.id, action: 'user.created' } });
    expect(audit?.actorId).toBe(fx.admin.id);
    expect(await t.prisma.outboxEvent.count({ where: { aggregateId: res.body.data.id, eventType: 'user.created' } })).toBe(1);
    expect((await admin.post('/users').send({ email, name: 'Dup', roles: ['SALES_EXECUTIVE'] })).status).toBe(409);
  });

  it('validates input (bad email, empty roles, unknown role, oversize page)', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    expect((await admin.post('/users').send({ email: 'bad', name: 'x', roles: ['SALES_EXECUTIVE'] })).status).toBe(400);
    expect((await admin.post('/users').send({ email: 'a@b.co', name: 'x', roles: [] })).status).toBe(400);
    expect((await admin.post('/users').send({ email: 'a@b.co', name: 'x', roles: ['GOD_MODE'] })).status).toBe(400);
    expect((await admin.get('/users?limit=1000')).status).toBe(400);
    expect((await admin.get('/users/not-a-uuid')).status).toBe(400);
  });

  it('paginates with cursors, bounded size', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    const p1 = await admin.get('/users?limit=4');
    expect(p1.body.data).toHaveLength(4);
    expect(p1.body.meta.pagination).toMatchObject({ mode: 'cursor', limit: 4, hasMore: true });
    const p2 = await admin.get(`/users?limit=4&cursor=${p1.body.meta.pagination.nextCursor}`);
    const overlap = p2.body.data.filter((u: { id: string }) => p1.body.data.some((x: { id: string }) => x.id === u.id));
    expect(overlap).toHaveLength(0);
    expect((await admin.get('/users?cursor=garbage')).status).toBe(400);
  });

  it('role changes are audited with before/after; own roles cannot be changed; last founder protected', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    const target = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    const res = await admin.post(`/users/${target.id}/roles`).send({ roles: ['SALES_EXECUTIVE', 'MARKETING'] });
    expect(res.status).toBe(200);
    expect(res.body.data.roles.sort()).toEqual(['MARKETING', 'SALES_EXECUTIVE']);
    const row = await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: target.id, action: 'user.roles_changed' } });
    expect(row.metadata).toMatchObject({ before: ['SALES_EXECUTIVE'], after: ['SALES_EXECUTIVE', 'MARKETING'], added: ['MARKETING'] });
    expect((await admin.post(`/users/${fx.admin.id}/roles`).send({ roles: ['ADMIN', 'FOUNDER_CEO'] })).status).toBe(403);

    const founder = await loginAgent(t.app, fx.founder);
    expect((await founder.post(`/users/${fx.founder.id}/deactivate`).send({})).status).toBe(400);
    const second = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    await founder.post(`/users/${second.id}/roles`).send({ roles: ['FOUNDER_CEO'] });
    // two founders now: admin can demote one but not the last
    expect((await admin.post(`/users/${second.id}/roles`).send({ roles: ['SALES_EXECUTIVE'] })).status).toBe(403); // sensitive
    expect((await founder.post(`/users/${second.id}/roles`).send({ roles: ['SALES_EXECUTIVE'] })).status).toBe(200);
  });

  it('manager hierarchy: cycles rejected, soft limit warns without blocking', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    expect((await admin.patch(`/users/${fx.managerA.id}`).send({ managerId: fx.execA1.id })).status).toBe(400); // cycle
    expect((await admin.patch(`/users/${fx.managerA.id}`).send({ managerId: fx.managerA.id })).status).toBe(400);
    expect((await admin.patch(`/users/${fx.execA1.id}`).send({ managerId: null, unknownField: 1 })).status).toBe(400); // strict

    await admin.patch('/org/settings').send({ teamSoftLimit: 2 });
    const res = await admin.post('/users').send({ email: `soft-${Date.now()}@test.salesos.local`, name: 'Third report', roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    expect(res.status).toBe(201); // warn, never block
    expect(res.body.meta.warnings[0]).toMatch(/MANAGER_REPORTS_ABOVE_SOFT_LIMIT/);
    await admin.patch('/org/settings').send({ teamSoftLimit: 5 });
  });

  it('deactivate: revokes sessions, rejects the old session, enqueues user.deactivated, audits; reactivate restores login', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    const target = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], managerId: fx.managerB.id });
    const targetAgent = await loginAgent(t.app, target);
    expect((await targetAgent.get('/auth/me')).status).toBe(200);

    const res = await admin.post(`/users/${target.id}/deactivate`).send({ reason: 'left company' });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    expect((await targetAgent.get('/auth/me')).status).toBe(401);
    expect(await t.prisma.session.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
    expect((await anonymous(t.app).post('/auth/login').send({ email: target.email, password: TEST_PASSWORD })).status).toBe(401);

    const ev = await t.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: target.id, eventType: 'user.deactivated' } });
    expect(ev.status).toBe('PENDING');
    expect(ev.payload).toMatchObject({ userId: target.id, managerId: fx.managerB.id, deactivatedById: fx.admin.id, reason: 'left company' });
    expect(await t.prisma.auditLog.count({ where: { entityId: target.id, action: 'user.deactivated' } })).toBe(1);

    expect((await admin.post(`/users/${target.id}/deactivate`).send({})).status).toBe(409);
    expect((await admin.post(`/users/${fx.admin.id}/deactivate`).send({})).status).toBe(400); // not self
    expect((await admin.post(`/users/${target.id}/reactivate`).send({})).status).toBe(200);
    expect((await anonymous(t.app).post('/auth/login').send({ email: target.email, password: TEST_PASSWORD })).status).toBe(200);
  });

  it('manager cannot deactivate or edit anyone (no permission)', async () => {
    const m = await loginAgent(t.app, fx.managerA);
    expect((await m.post(`/users/${fx.execA1.id}/deactivate`).send({})).status).toBe(403);
    expect((await m.patch(`/users/${fx.execA1.id}`).send({ name: 'x' })).status).toBe(403);
  });
});

describe('teams', () => {
  it('founder creates a team; duplicates conflict; members add/remove are audited', async () => {
    const f = await loginAgent(t.app, fx.founder);
    const name = `Pod ${Date.now()}`;
    const created = await f.post('/teams').send({ name, leadUserId: fx.managerA.id });
    expect(created.status).toBe(201);
    expect((await f.post('/teams').send({ name })).status).toBe(409);
    const teamId = created.body.data.id as string;
    const add = await f.post(`/teams/${teamId}/members`).send({ userId: fx.execB1.id });
    expect(add.status).toBe(201);
    expect((await f.post(`/teams/${teamId}/members`).send({ userId: fx.execB1.id })).status).toBe(409);
    const members = await f.get(`/teams/${teamId}/members`);
    expect(members.body.data.map((m: { id: string }) => m.id).sort()).toEqual([fx.managerA.id, fx.execB1.id].sort());
    expect((await f.delete(`/teams/${teamId}/members/${fx.execB1.id}`)).status).toBe(200);
    expect((await f.delete(`/teams/${teamId}/members/${fx.execB1.id}`)).status).toBe(404);
    const actions = (await t.prisma.auditLog.findMany({ where: { entityId: teamId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['team.created', 'team.member_added', 'team.member_removed']));
  });

  it('team soft limit warns but never blocks', async () => {
    const f = await loginAgent(t.app, fx.founder);
    await f.patch('/org/settings').send({ teamSoftLimit: 1 });
    const extra = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const res = await f.post(`/teams/${fx.teamA.id}/members`).send({ userId: extra.id });
    expect(res.status).toBe(201);
    expect(res.body.meta.warnings[0]).toMatch(/TEAM_ABOVE_SOFT_LIMIT/);
    const list = await f.get(`/teams/${fx.teamA.id}/members`);
    expect(list.body.meta.warnings).toHaveLength(1);
    await f.patch('/org/settings').send({ teamSoftLimit: 5 });
  });

  it('manager sees own team only; cannot see or edit sibling or own team membership', async () => {
    const m = await loginAgent(t.app, fx.managerA);
    const teams = (await m.get('/teams')).body.data as { id: string }[];
    expect(teams.map((x) => x.id)).toContain(fx.teamA.id);
    expect(teams.map((x) => x.id)).not.toContain(fx.teamB.id);
    expect((await m.get(`/teams/${fx.teamB.id}/members`)).status).toBe(404);
    expect((await m.post(`/teams/${fx.teamB.id}/members`).send({ userId: fx.execA1.id })).status).toBe(403);
    expect((await m.delete(`/teams/${fx.teamB.id}/members/${fx.execB1.id}`)).status).toBe(403);
    expect((await m.post('/teams').send({ name: 'mine now' })).status).toBe(403); // org-level action
    // matrix: teams:update is Founder/Team Lead/Admin only; managers cannot edit membership even of their own team
    expect((await m.post(`/teams/${fx.teamA.id}/members`).send({ userId: fx.execB1.id })).status).toBe(403);
    expect((await m.delete(`/teams/${fx.teamA.id}/members/${fx.execA1.id}`)).status).toBe(403);
    const tl = await loginAgent(t.app, fx.teamLead);
    const mine = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    expect((await tl.post(`/teams/${fx.teamA.id}/members`).send({ userId: mine.id })).status).toBe(201);
  });

  it('executive sees only own team and cannot manage', async () => {
    const e = await loginAgent(t.app, fx.execB1);
    expect(((await e.get('/teams')).body.data as { id: string }[]).map((x) => x.id)).toEqual([fx.teamB.id]);
    expect((await e.get(`/teams/${fx.teamA.id}/members`)).status).toBe(404);
    expect((await e.post(`/teams/${fx.teamB.id}/members`).send({ userId: fx.execB2.id })).status).toBe(403);
  });
});

describe('team deletion', () => {
  it('admin only, empty teams only, audited', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    const created = await admin.post('/teams').send({ name: `Temp ${Date.now()}` });
    const id = created.body.data.id as string;
    await admin.post(`/teams/${id}/members`).send({ userId: fx.execA1.id });
    expect((await admin.delete(`/teams/${id}`)).status).toBe(409);
    await admin.delete(`/teams/${id}/members/${fx.execA1.id}`);
    expect((await (await loginAgent(t.app, fx.teamLead)).delete(`/teams/${id}`)).status).toBe(403);
    expect((await admin.delete(`/teams/${id}`)).status).toBe(200);
    expect(await t.prisma.auditLog.count({ where: { entityId: id, action: 'team.deleted' } })).toBe(1);
    expect((await admin.delete(`/teams/${id}`)).status).toBe(404);
  });
});

describe('org settings + permission catalogue', () => {
  it('admin updates settings (audited as policy change); invalid values rejected; manager cannot read or write; team lead can read', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    const res = await admin.patch('/org/settings').send({ teamSoftLimit: 6 });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.teamSoftLimit).toBe(6);
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { organizationId: fx.org.id, action: 'org.settings_changed' }, orderBy: { createdAt: 'desc' } });
    expect(audit.metadata).toMatchObject({ changedKeys: ['teamSoftLimit'] });
    expect((await admin.patch('/org/settings').send({ teamSoftLimit: 0 })).status).toBe(400);
    expect((await admin.patch('/org/settings').send({ evil: true })).status).toBe(400);
    await admin.patch('/org/settings').send({ teamSoftLimit: 5 });
    const m = await loginAgent(t.app, fx.managerA);
    expect((await m.get('/org/settings')).status).toBe(403); // matrix: settings:view is F/TL/AD
    expect((await (await loginAgent(t.app, fx.teamLead)).get('/org/settings')).status).toBe(200);
    expect((await m.patch('/org/settings').send({ teamSoftLimit: 9 })).status).toBe(403);
  });

  it('catalogue lists keys with grants; Admin has no sensitive permission grants', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    const res = await admin.get('/permissions/catalogue');
    expect(res.status).toBe(200);
    const perms = res.body.data.permissions as { key: string; sensitive: boolean; grants: Record<string, string> }[];
    expect(perms.length).toBeGreaterThan(10);
    for (const p of perms.filter((x) => x.sensitive)) expect(p.grants.ADMIN, p.key).toBeUndefined();
  });

  it('role/permission mirror tables are synced from the code catalogue', async () => {
    const hr = await t.prisma.rolePermission.findMany({ where: { role: { key: 'HR' } }, include: { permission: true } });
    expect(hr.map((r) => r.permission.key)).toContain('hr:records:view');
    const adminPerms = await t.prisma.rolePermission.findMany({ where: { role: { key: 'ADMIN' } }, include: { permission: true } });
    expect(adminPerms.map((r) => r.permission.key)).not.toContain('hr:records:view');
  });
});

describe('audit-logs endpoint scoping', () => {
  it('org scope sees all, manager sees team actors only, executive sees own, filters apply', async () => {
    // generate activity by several actors
    for (const u of [fx.execA1, fx.execB1, fx.managerA]) await loginAgent(t.app, u);
    const f = await loginAgent(t.app, fx.founder);
    const all = (await f.get('/audit-logs?limit=100&action=auth.login_success')).body.data as { actorId: string }[];
    const actors = new Set(all.map((a) => a.actorId));
    expect(actors.has(fx.execA1.id) && actors.has(fx.execB1.id)).toBe(true);

    const m = await loginAgent(t.app, fx.managerA);
    const mine = (await m.get('/audit-logs?limit=100')).body.data as { actorId: string }[];
    const allowed = new Set([fx.managerA.id, fx.execA1.id, fx.execA2.id]);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => allowed.has(r.actorId))).toBe(true);
    // actor filter cannot widen scope
    const widen = (await m.get(`/audit-logs?actorId=${fx.execB1.id}`)).body.data;
    expect(widen).toEqual([]);

    // executives have no audit:view in the matrix
    expect((await (await loginAgent(t.app, fx.execA1)).get('/audit-logs')).status).toBe(403);
    // HR / Finance have no audit permission
    expect((await (await loginAgent(t.app, fx.hr)).get('/audit-logs')).status).toBe(403);
  });
});

describe('GET /teams/:id', () => {
  it('returns the team in scope with lead and soft-limit info; sibling team, other org and unauthorised roles get 404/403', async () => {
    const f = await loginAgent(t.app, fx.founder);
    const one = await f.get(`/teams/${fx.teamA.id}`);
    expect(one.status).toBe(200);
    const count = await t.prisma.teamMembership.count({ where: { teamId: fx.teamA.id } });
    expect(one.body.data).toMatchObject({ id: fx.teamA.id, name: 'Team A', leadUserId: fx.managerA.id, memberCount: count });
    expect(typeof one.body.data.aboveSoftLimit).toBe('boolean');
    expect(one.body.data.lead).toMatchObject({ id: fx.managerA.id });
    const m = await loginAgent(t.app, fx.managerA);
    expect((await m.get(`/teams/${fx.teamA.id}`)).status).toBe(200);
    expect((await m.get(`/teams/${fx.teamB.id}`)).status).toBe(404);
    expect((await (await loginAgent(t.app, fx.finance)).get(`/teams/${fx.teamA.id}`)).status).toBe(403);
    const other = await buildOrgFixture(t.prisma);
    expect((await (await loginAgent(t.app, other.founder)).get(`/teams/${fx.teamA.id}`)).status).toBe(404);
    expect((await f.get('/teams/not-a-uuid')).status).toBe(400);
  });
});

describe('GET /audit-logs/export', () => {
  it('Founder/Admin only; CSV with scope + redaction; capped; the export itself is audited', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    const f = await loginAgent(t.app, fx.founder);
    for (const u of [fx.managerA, fx.execA1, fx.hr, fx.finance]) expect((await (await loginAgent(t.app, u)).get('/audit-logs/export')).status, u.email).toBe(403);
    // money metadata is hidden from Admin (no revenue permission) but visible to the Founder
    await t.prisma.auditLog.create({ data: { organizationId: fx.org.id, actorId: fx.execA1.id, action: 'deal.closed', entityType: 'deal', entityId: fx.execA1.id, metadata: { amount: '987654.00' } } });
    const a = await admin.get('/audit-logs/export?action=deal.closed');
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toContain('text/csv');
    expect(a.headers['content-disposition']).toContain('attachment');
    expect(a.text.split('\n')[0]).toBe('time_utc,actor_id,action,entity_type,entity_id,metadata,request_id');
    expect(a.text).toContain('deal.closed');
    expect(a.text).not.toContain('987654');
    expect((await f.get('/audit-logs/export?action=deal.closed')).text).toContain('987654');
    // formula injection is neutralised
    await t.prisma.auditLog.create({ data: { organizationId: fx.org.id, actorId: fx.execA1.id, action: '=HYPERLINK("x")', entityType: 'test', metadata: {} } });
    expect((await f.get('/audit-logs/export?entityType=test')).text).toContain("\"'=HYPERLINK");
    // row cap + truncation flag
    process.env.AUDIT_EXPORT_MAX_ROWS = '3';
    try {
      const capped = await f.get('/audit-logs/export');
      expect(capped.headers['x-export-rows']).toBe('3');
      expect(capped.headers['x-export-truncated']).toBe('true');
      expect(capped.text.trim().split('\n')).toHaveLength(4);
    } finally {
      delete process.env.AUDIT_EXPORT_MAX_ROWS;
    }
    const rec = await t.prisma.auditLog.findFirst({ where: { organizationId: fx.org.id, action: 'audit.exported', actorId: fx.founder.id }, orderBy: { createdAt: 'desc' } });
    expect(rec?.metadata).toMatchObject({ rows: 3, truncated: true });
    // Admin can export but the Admin's export is audited as well
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'audit.exported', actorId: fx.admin.id } })).toBe(1);
  });

  it('list supports page mode with a total (for "Page N of M")', async () => {
    const f = await loginAgent(t.app, fx.founder);
    const res = await f.get('/audit-logs?page=1&limit=5');
    expect(res.body.meta.pagination).toMatchObject({ mode: 'page', page: 1, limit: 5 });
    expect(res.body.meta.pagination.total).toBeGreaterThan(5);
    expect(res.body.meta.pagination.totalPages).toBeGreaterThan(1);
  });
});
