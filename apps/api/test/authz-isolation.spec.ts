import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get } from '@nestjs/common';
import { buildOrgFixture, createTeam, createUser, createTestApp, loginAgent, type OrgFixture, type TestApp } from './helpers';
import { AccessService, CurrentUser, RequirePermission, type Principal } from '../src/common/authz';

/** Probe endpoints exposing the policy helpers so isolation can be proven end-to-end over HTTP. */
@Controller('__probe')
class ProbeController {
  constructor(private readonly access: AccessService) {}

  @Get('hr')
  @RequirePermission('hr:records:view')
  hr() { return { hr: 'secret' }; }

  @Get('payments')
  @RequirePermission('collections:verify')
  payments() { return { payments: 'secret' }; }

  /** Demonstrates how a domain (e.g. CRM) must build its where-clause. */
  @Get('where')
  @RequirePermission('users:view')
  async where(@CurrentUser() p: Principal) {
    return this.access.scopedWhere(p, { permission: 'users:view', ownerField: 'id' });
  }

  @Get('where-audit')
  @RequirePermission('audit:view')
  async whereAudit(@CurrentUser() p: Principal) {
    return this.access.scopedWhere(p, { permission: 'audit:view', ownerField: 'actorId' });
  }
}

let t: TestApp;
let fx: OrgFixture;
let other: OrgFixture;
beforeAll(async () => {
  t = await createTestApp({ extraControllers: [ProbeController] });
  fx = await buildOrgFixture(t.prisma);
  other = await buildOrgFixture(t.prisma);
});
afterAll(async () => { await t.close(); });

const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((u) => u.id).sort();

describe('hierarchy scoping (users:view / audit:view)', () => {
  it('executive sees only themself', async () => {
    const a = await loginAgent(t.app, fx.execA1);
    const res = await a.get('/users');
    expect(ids(res)).toEqual([fx.execA1.id]);
  });

  it('executive cannot read another executive (same team) by id: 404 not 403', async () => {
    const a = await loginAgent(t.app, fx.execA1);
    const res = await a.get(`/users/${fx.execA2.id}`);
    expect(res.status).toBe(404);
  });

  it('manager sees own team only; sibling team is invisible', async () => {
    const a = await loginAgent(t.app, fx.managerA);
    expect(ids(await a.get('/users'))).toEqual([fx.managerA.id, fx.execA1.id, fx.execA2.id].sort());
    expect((await a.get(`/users/${fx.execB1.id}`)).status).toBe(404);
    expect((await a.get(`/users/${fx.managerB.id}`)).status).toBe(404);
  });

  it('team lead (users:view=org per matrix) sees every sales user; audit:view=team excludes the founder', async () => {
    const a = await loginAgent(t.app, fx.teamLead);
    const got = ids(await a.get('/users?limit=100'));
    for (const u of [fx.managerA, fx.managerB, fx.execA1, fx.execB2, fx.teamLead, fx.founder]) expect(got).toContain(u.id);
    const w = (await a.get('/__probe/where-audit')).body.data;
    expect(w.actorId.in).toEqual(expect.arrayContaining([fx.managerA.id, fx.managerB.id, fx.execA1.id, fx.execB2.id, fx.teamLead.id]));
    expect(w.actorId.in).not.toContain(fx.founder.id);
  });

  it('HR gets users:view=summary: org-wide list with minimum-data projection only', async () => {
    const hr = await loginAgent(t.app, fx.hr);
    const res = await hr.get('/users?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(11);
    for (const u of res.body.data) expect(Object.keys(u).sort()).toEqual(['id', 'isActive', 'name']);
    expect(Object.keys((await hr.get(`/users/${fx.execA1.id}`)).body.data).sort()).toEqual(['id', 'isActive', 'name']);
    // HR may create employee accounts (pending approval) but not leadership ones
    expect((await hr.post('/users').send({ email: 'h@test.salesos.local', name: 'x', roles: ['FINANCE'] })).status).toBe(403);
  });

  it('founder and admin see the whole organization', async () => {
    for (const u of [fx.founder, fx.admin]) {
      const a = await loginAgent(t.app, u);
      const res = await a.get('/users?limit=100');
      expect(res.body.data.length).toBe(11);
    }
  });

  it('scopedWhere always pins the organization and restricts owners by scope', async () => {
    const m = await loginAgent(t.app, fx.managerA);
    const w = (await m.get('/__probe/where')).body.data;
    expect(w.organizationId).toBe(fx.org.id);
    expect(w.id.in.sort()).toEqual([fx.managerA.id, fx.execA1.id, fx.execA2.id].sort());
    const f = await loginAgent(t.app, fx.founder);
    expect((await f.get('/__probe/where')).body.data).toEqual({ organizationId: fx.org.id });
    const e = await loginAgent(t.app, fx.execA1);
    expect((await e.get('/__probe/where')).body.data.id.in).toEqual([fx.execA1.id]);
  });
});

describe('cross-organization isolation', () => {
  it('no role can list or read users of another organization (even Founder/Admin)', async () => {
    for (const actor of [fx.founder, fx.admin]) {
      const a = await loginAgent(t.app, actor);
      const list = (await a.get('/users?limit=100')).body.data as { organizationId: string }[];
      expect(list.every((u) => u.organizationId === fx.org.id)).toBe(true);
      expect((await a.get(`/users/${other.execA1.id}`)).status).toBe(404);
      expect((await a.patch(`/users/${other.execA1.id}`).send({ name: 'pwned' })).status).toBe(404);
      expect((await a.post(`/users/${other.execA1.id}/deactivate`).send({})).status).toBe(404);
      expect((await a.post(`/users/${other.execA1.id}/roles`).send({ roles: ['SALES_MANAGER'] })).status).toBe(404);
    }
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: other.execA1.id } })).isActive).toBe(true);
  });

  it('cannot attach another organization user as manager, team member or team lead', async () => {
    const f = await loginAgent(t.app, fx.founder);
    expect((await f.patch(`/users/${fx.execA1.id}`).send({ managerId: other.managerA.id })).status).toBe(400);
    expect((await f.post(`/teams/${fx.teamA.id}/members`).send({ userId: other.execA1.id })).status).toBe(400);
    expect((await f.post('/teams').send({ name: 'x-org-lead', leadUserId: other.managerA.id })).status).toBe(400);
    expect((await f.get(`/teams/${other.teamA.id}/members`)).status).toBe(404);
    expect((await f.post(`/teams/${other.teamA.id}/members`).send({ userId: fx.execA1.id })).status).toBe(404);
  });

  it('audit log never leaks rows from another organization', async () => {
    const f = await loginAgent(t.app, fx.founder);
    const g = await loginAgent(t.app, other.founder);
    await g.patch(`/users/${other.execA1.id}`).send({ name: 'Renamed in other org' });
    const rows = (await f.get('/audit-logs?limit=100')).body.data as { organizationId: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === fx.org.id)).toBe(true);
  });

  it('a session of org A cannot be used to reach org B teams list', async () => {
    const f = await loginAgent(t.app, fx.founder);
    const teams = (await f.get('/teams')).body.data as { id: string }[];
    expect(teams.map((x) => x.id)).not.toContain(other.teamA.id);
  });
});

describe('sensitive (HR / payments) permissions are not implied by ADMIN', () => {
  it('admin is denied HR and payment endpoints; HR/Finance/Founder get theirs', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    expect((await admin.get('/__probe/hr')).status).toBe(403);
    expect((await admin.get('/__probe/payments')).status).toBe(403);
    const me = (await admin.get('/auth/me')).body.data.permissions as { key: string }[];
    expect(me.map((p) => p.key)).not.toContain('hr:records:view');
    expect(me.map((p) => p.key)).not.toContain('hr:records:manage');
    expect(me.map((p) => p.key)).not.toContain('collections:view');
    expect(me.map((p) => p.key)).not.toContain('collections:verify');

    expect((await (await loginAgent(t.app, fx.hr)).get('/__probe/hr')).status).toBe(200);
    expect((await (await loginAgent(t.app, fx.hr)).get('/__probe/payments')).status).toBe(403);
    expect((await (await loginAgent(t.app, fx.finance)).get('/__probe/payments')).status).toBe(200);
    expect((await (await loginAgent(t.app, fx.founder)).get('/__probe/hr')).status).toBe(403); // not even the Founder by default
    expect((await (await loginAgent(t.app, fx.finance)).get('/__probe/hr')).status).toBe(403);
  });

  it('sales roles cannot reach HR or payments', async () => {
    for (const u of [fx.execA1, fx.managerA, fx.teamLead]) {
      const a = await loginAgent(t.app, u);
      expect((await a.get('/__probe/hr')).status).toBe(403);
      expect((await a.get('/__probe/payments')).status).toBe(403);
    }
  });

  it('admin cannot grant itself or anyone HR/Finance/Founder roles; only the founder can', async () => {
    const admin = await loginAgent(t.app, fx.admin);
    const target = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    const attempts: Record<string, string[]> = { HR: ['SALES_EXECUTIVE', 'HR'], FINANCE: ['SALES_EXECUTIVE', 'FINANCE'], FOUNDER_CEO: ['FOUNDER_CEO'] };
    for (const [role, roles] of Object.entries(attempts)) {
      const res = await admin.post(`/users/${target.id}/roles`).send({ roles });
      expect(res.status, role).toBe(403);
    }
    expect((await admin.post(`/users/${target.id}/roles`).send({ roles: ['SALES_EXECUTIVE', 'SALES_MANAGER'] })).status).toBe(400); // one primary role only
    expect((await admin.post(`/users/${target.id}/roles`).send({ roles: ['SALES_EXECUTIVE', 'MARKETING'] })).status).toBe(200); // non-sensitive group OK
    const founder = await loginAgent(t.app, fx.founder);
    expect((await founder.post(`/users/${target.id}/roles`).send({ roles: ['SALES_EXECUTIVE', 'HR'] })).status).toBe(200);
  });
});

describe('delegation', () => {
  it('without delegation manager A cannot see team B; with an active delegation they can; revocation/expiry removes it', async () => {
    const mA = await loginAgent(t.app, fx.managerA);
    expect((await mA.get(`/users/${fx.execB1.id}`)).status).toBe(404);

    const lead = await loginAgent(t.app, fx.teamLead);
    const created = await lead.post('/delegations').send({ delegatorId: fx.managerB.id, delegateId: fx.managerA.id, endsAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(created.status).toBe(201);

    expect((await mA.get(`/users/${fx.execB1.id}`)).status).toBe(200);
    expect((await mA.get('/auth/me')).body.data.scope.delegatedFromUserIds).toEqual([fx.managerB.id]);

    expect((await lead.delete(`/delegations/${created.body.data.id}`)).status).toBe(200);
    expect((await mA.get(`/users/${fx.execB1.id}`)).status).toBe(404);

    await t.prisma.delegation.create({ data: { organizationId: fx.org.id, delegatorId: fx.managerB.id, delegateId: fx.managerA.id, createdById: fx.teamLead.id, startsAt: new Date(Date.now() - 7_200_000), endsAt: new Date(Date.now() - 3_600_000) } });
    expect((await mA.get(`/users/${fx.execB1.id}`)).status).toBe(404); // expired
  });

  it('a delegation cannot be created for users outside the caller scope or across organizations', async () => {
    const mA = await loginAgent(t.app, fx.managerA);
    expect((await mA.post('/delegations').send({ delegatorId: fx.managerB.id, delegateId: fx.managerA.id, endsAt: new Date(Date.now() + 1000 * 60).toISOString() })).status).toBe(403); // manager lacks delegations:manage
    const lead = await loginAgent(t.app, fx.teamLead);
    expect((await lead.post('/delegations').send({ delegatorId: other.managerA.id, delegateId: fx.managerA.id, endsAt: new Date(Date.now() + 60_000).toISOString() })).status).toBe(400);
    expect((await lead.post('/delegations').send({ delegatorId: fx.founder.id, delegateId: fx.managerA.id, endsAt: new Date(Date.now() + 60_000).toISOString() })).status).toBe(404); // founder outside team-lead scope
  });
});

describe('team membership grants visibility (led teams)', () => {
  it('a team lead-by-membership sees team members even without manager_id link', async () => {
    const lonely = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const member = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const outsider = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    await createTeam(t.prisma, fx.org, undefined, [{ userId: lonely.id, role: 'LEAD' }, { userId: member.id }]);
    // lonely holds an executive role (own scope) so users:read is own; use a manager role for team scope
    const mgr = await createUser(t.prisma, fx.org, { roles: ['SALES_MANAGER'] });
    await createTeam(t.prisma, fx.org, undefined, [{ userId: mgr.id, role: 'LEAD' }, { userId: member.id }]);
    const a = await loginAgent(t.app, mgr);
    const got = ids(await a.get('/users'));
    expect(got).toContain(member.id);
    expect(got).not.toContain(outsider.id);
  });
});

describe('executive cannot escalate', () => {
  it('cannot create users, assign roles, deactivate or edit org settings', async () => {
    const e = await loginAgent(t.app, fx.execA1);
    expect((await e.post('/users').send({ email: 'x@test.salesos.local', name: 'x', roles: ['SALES_EXECUTIVE'] })).status).toBe(403);
    expect((await e.post(`/users/${fx.execA1.id}/roles`).send({ roles: ['FOUNDER_CEO'] })).status).toBe(403);
    expect((await e.post(`/users/${fx.execA2.id}/deactivate`).send({})).status).toBe(403);
    expect((await e.patch('/org/settings').send({ teamSoftLimit: 99 })).status).toBe(403);
    expect((await e.get('/permissions/catalogue')).status).toBe(403);
    expect((await e.get('/audit-logs')).status).toBe(403);
  });

  it('trusts no client-supplied org: an organizationId in the body is rejected/ignored', async () => {
    const f = await loginAgent(t.app, fx.founder);
    const email = `scoped-${Date.now()}@test.salesos.local`;
    const res = await f.post('/users').send({ email, name: 'Scoped', roles: ['SALES_EXECUTIVE'], organizationId: other.org.id });
    // Phase 10: a privileged key the schema does not consume is now refused outright (400 FORBIDDEN_FIELD) instead of silently ignored
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FORBIDDEN_FIELD');
    expect(await t.prisma.user.count({ where: { email } })).toBe(0);
    const ok = await f.post('/users').send({ email, name: 'Scoped', roles: ['SALES_EXECUTIVE'] });
    expect(ok.status).toBe(201);
    expect(ok.body.data.organizationId).toBe(fx.org.id);
  });
});
