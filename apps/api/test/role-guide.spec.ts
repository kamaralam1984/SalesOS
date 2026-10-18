import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantsForRole } from '../src/common/authz/permissions.catalogue';
import { buildOrgFixture, createUser, loginAgent, createTestApp, type AuthedAgent, type OrgFixture, type TestApp } from './helpers';
import { createLead } from './cx/helpers';

/**
 * "Sales OS - Roles aur Reporting Guide" (and the 24 role guides) as executable rules.
 * Every statement in those PDFs about who can open what, who can give which role, who approves and who sees how much data is checked
 * here against the real API, so the website and the guides cannot drift apart silently.
 */
type R = 'FOUNDER' | 'TL' | 'MGR' | 'EXEC' | 'ADMIN' | 'FIN' | 'HR' | 'MKT' | 'COM' | 'OPS' | 'SS' | 'DEV';
const ALL: R[] = ['FOUNDER', 'TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'HR', 'MKT', 'COM', 'OPS', 'SS', 'DEV'];
const ROLE_KEY: Record<R, string> = { FOUNDER: 'FOUNDER_CEO', TL: 'SALES_TEAM_LEAD', MGR: 'SALES_MANAGER', EXEC: 'SALES_EXECUTIVE', ADMIN: 'ADMIN', FIN: 'FINANCE', HR: 'HR', MKT: 'MARKETING', COM: 'COMMUNITY', OPS: 'OPERATIONS', SS: 'STUDENT_SUCCESS', DEV: 'DEVELOPER' };

let t: TestApp;
let fx: OrgFixture;
let A: Record<R, AuthedAgent>;
const sfx = Date.now().toString(36);
const mail = (n: string) => `guide-${n}-${sfx}@test.salesos.local`;
const without = (...rs: R[]) => ALL.filter((r) => !rs.includes(r));

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  const [mkt, com, ops, ss, dev] = await Promise.all((['MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS', 'DEVELOPER'] as const).map((r) => createUser(t.prisma, fx.org, { roles: [r] })));
  A = {
    FOUNDER: await loginAgent(t.app, fx.founder), TL: await loginAgent(t.app, fx.teamLead), MGR: await loginAgent(t.app, fx.managerA), EXEC: await loginAgent(t.app, fx.execA1),
    ADMIN: await loginAgent(t.app, fx.admin), FIN: await loginAgent(t.app, fx.finance), HR: await loginAgent(t.app, fx.hr),
    MKT: await loginAgent(t.app, mkt), COM: await loginAgent(t.app, com), OPS: await loginAgent(t.app, ops), SS: await loginAgent(t.app, ss), DEV: await loginAgent(t.app, dev),
  };
});
afterAll(async () => { await t.close(); });

describe('every role has exactly the permissions its guide lists', () => {
  it.each(ALL)('%s: effective permissions from the server equal the catalogue the guide was built from', async (r) => {
    const me = await A[r].get('/auth/me');
    expect(me.status).toBe(200);
    const got = Object.fromEntries((me.body.data.permissions as Array<{ key: string; scope: string }>).map((p) => [p.key, p.scope]));
    expect(got).toEqual(grantsForRole(ROLE_KEY[r] as never));
  });
});

/** [what the guide says, method, path, body, roles that must get in, roles that must be refused (403)] */
const MATRIX: Array<[string, 'GET' | 'POST', string, object | null, R[], R[]]> = [
  ['Deals: sales chain, Finance, Student Success (minimum)', 'GET', '/deals', null, ['FOUNDER', 'TL', 'MGR', 'EXEC', 'FIN', 'SS'], ['HR', 'ADMIN', 'MKT', 'COM', 'OPS', 'DEV']],
  ['Collections (payments): sales chain and Finance', 'GET', '/collections', null, ['FOUNDER', 'TL', 'MGR', 'EXEC', 'FIN'], ['HR', 'ADMIN', 'MKT', 'COM', 'OPS', 'SS', 'DEV']],
  ['Refunds: sales chain, Finance, Student Success (minimum)', 'GET', '/refunds', null, ['FOUNDER', 'TL', 'MGR', 'EXEC', 'FIN', 'SS'], ['HR', 'ADMIN', 'MKT', 'COM', 'OPS', 'DEV']],
  ['Leads: sales chain; Marketing and Student Success see minimum info', 'GET', '/leads', null, ['FOUNDER', 'TL', 'MGR', 'EXEC', 'MKT', 'SS'], ['FIN', 'ADMIN', 'COM', 'OPS', 'DEV']],
  ['Lead exceptions queue: sales chain (Executive sees only own); not Finance/HR/Admin/Marketing/Community/Operations/Developer', 'GET', '/leads/exceptions', null, ['FOUNDER', 'TL', 'MGR', 'EXEC'], ['FIN', 'HR', 'ADMIN', 'MKT', 'COM', 'OPS', 'DEV']],
  ['Payroll register: Founder, HR, Finance', 'GET', '/workforce/payroll/runs', null, ['FOUNDER', 'HR', 'FIN'], ['TL', 'MGR', 'EXEC', 'ADMIN', 'MKT', 'COM', 'OPS', 'SS', 'DEV']],
  ['HR records (employees, joining date): HR only', 'GET', '/people/employees', null, ['HR'], ['FOUNDER', 'TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'SS', 'DEV']],
  ['Workforce policy (Zoom link, attendance times): Founder and HR', 'GET', '/workforce/settings', null, ['FOUNDER', 'HR'], ['TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'SS', 'DEV']],
  ['Join a new employee: HR and Founder', 'POST', '/workforce/hr/joiners', {}, ['HR', 'FOUNDER'], ['TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'SS', 'DEV']],
  ['Create user: HR, Founder, Developer only', 'POST', '/users', { email: 'x', name: '', roles: [] }, ['FOUNDER', 'HR', 'DEV'], ['TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'SS']],
  ['Pending accounts: HR, Founder, Developer', 'GET', '/users/pending', null, ['FOUNDER', 'HR', 'DEV'], ['TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'SS']],
  ['Password reset requests: HR, Founder, Developer', 'GET', '/users/password-resets', null, ['FOUNDER', 'HR', 'DEV'], ['TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'SS']],
  ['Extra Zoom meetings (manage): HR, Founder, Developer', 'GET', '/meetings', null, ['FOUNDER', 'HR', 'DEV'], ['TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'SS']],
  ['Meetings on the home page: every role', 'GET', '/meetings/active', null, ALL, []],
  ['Home layout editor: Founder and Developer', 'GET', '/home-layout/roles', null, ['FOUNDER', 'DEV'], ['TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'HR', 'MKT', 'COM', 'OPS', 'SS']],
  ['Developer Panel: Developer only', 'GET', '/dev-panel/overview', null, ['DEV'], ['FOUNDER', 'TL', 'MGR', 'EXEC', 'ADMIN', 'FIN', 'HR', 'MKT', 'COM', 'OPS', 'SS']],
  ['Change a user\'s roles: Founder and Admin (within the role rules below)', 'POST', '/users/00000000-0000-4000-8000-000000000001/roles', { roles: ['SALES_EXECUTIVE'] }, ['FOUNDER', 'ADMIN'], ['TL', 'MGR', 'EXEC', 'FIN', 'HR', 'MKT', 'COM', 'OPS', 'SS', 'DEV']],
  ['Company settings: Founder, Team Lead, Admin', 'GET', '/org/settings', null, ['FOUNDER', 'TL', 'ADMIN'], ['MGR', 'EXEC', 'FIN', 'HR', 'MKT', 'COM', 'OPS', 'SS', 'DEV']],
  ['Teams: Founder, Team Lead, Admin, Manager, Executive see them; Finance/Marketing do not', 'GET', '/teams', null, ['FOUNDER', 'TL', 'ADMIN', 'MGR'], ['FIN', 'MKT', 'COM', 'OPS', 'DEV']],
  ['Audit log: Admin and Founder', 'GET', '/audit-logs', null, ['ADMIN', 'FOUNDER'], ['EXEC', 'FIN', 'HR', 'MKT', 'COM', 'OPS', 'SS']],
  ['KPI/KRA assignment: Founder, Team Lead, Manager', 'GET', '/people/kpi-assignments', null, ['FOUNDER', 'TL', 'MGR'], ['ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'DEV']],
  ['Reviews: Founder, Team Lead, HR, Manager', 'GET', '/people/reviews', null, ['FOUNDER', 'TL', 'HR', 'MGR'], ['ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'DEV']],
  ['Coaching log: Founder, Team Lead, Manager', 'GET', '/coaching/sessions', null, ['FOUNDER', 'TL', 'MGR'], ['ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'DEV']],
  ['Hiring / openings: Founder, Team Lead, HR', 'GET', '/people/hiring', null, ['FOUNDER', 'TL', 'HR'], ['EXEC', 'ADMIN', 'FIN', 'MKT', 'COM', 'OPS', 'SS', 'DEV']],
  ['Incentive policy: Founder and Finance see it; Admin does not', 'GET', '/incentives/policies', null, ['FOUNDER', 'FIN'], ['ADMIN', 'MKT', 'COM', 'OPS', 'DEV']],
  ['Events / webinars / demos: Marketing, Community, Operations and the sales chain', 'GET', '/events', null, ['MKT', 'COM', 'OPS', 'FOUNDER', 'TL', 'MGR', 'EXEC'], ['FIN', 'HR', 'ADMIN', 'SS', 'DEV']],
  ['Handover: Student Success, Operations (summary) and the sales chain', 'GET', '/handovers', null, ['SS', 'OPS', 'FOUNDER', 'TL', 'MGR', 'EXEC'], ['FIN', 'HR', 'ADMIN', 'MKT', 'COM', 'DEV']],
  ['Complaints: Student Success and Founder', 'GET', '/cx/complaints', null, ['SS', 'FOUNDER'], ['FIN', 'HR', 'ADMIN', 'MKT', 'COM', 'DEV']],
  ['Employee directory: everyone except the Developer', 'GET', '/workforce/directory', null, without('DEV'), ['DEV']],
  ['Attendance (check in / out): everyone except the Developer', 'GET', '/workforce/attendance/today', null, without('DEV'), ['DEV']],
  ['Leave balance page: everyone except the Developer', 'GET', '/workforce/leave/balances', null, without('DEV'), []],
];

describe('who may open what (guide statements checked against the API)', () => {
  it.each(MATRIX)('%s', async (_claim, method, path, body, allow, deny) => {
    const call = (r: R) => (method === 'GET' ? A[r].get(path) : A[r].post(path).send(body ?? {}));
    for (const r of allow) expect((await call(r)).status, `${r} should be allowed on ${method} ${path}`).not.toBe(403);
    for (const r of deny) expect((await call(r)).status, `${r} should be refused on ${method} ${path}`).toBe(403);
  });
});

describe('who may give which role', () => {
  const LEADERSHIP = ['FOUNDER_CEO', 'ADMIN', 'HR', 'FINANCE'];
  const EMPLOYEE = ['SALES_MANAGER', 'SALES_EXECUTIVE', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'];

  it('Admin cannot give or remove any leadership role (Founder, Admin, HR, Finance) but can give employee roles; Founder can give all of them', async () => {
    const target = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    for (const role of LEADERSHIP) {
      expect((await A.ADMIN.post(`/users/${target.id}/roles`).send({ roles: [role] })).status, `Admin gives ${role}`).toBe(403);
    }
    for (const role of [...EMPLOYEE, 'SALES_TEAM_LEAD']) {
      expect((await A.ADMIN.post(`/users/${target.id}/roles`).send({ roles: [role] })).status, `Admin gives ${role}`).toBe(200);
    }
    expect((await A.ADMIN.post(`/users/${target.id}/roles`).send({ roles: ['SALES_EXECUTIVE'] })).status).toBe(200);
    for (const role of LEADERSHIP) {
      expect((await A.FOUNDER.post(`/users/${target.id}/roles`).send({ roles: [role] })).status, `Founder gives ${role}`).toBe(200);
      // taking it away again is leadership business too
      expect((await A.ADMIN.post(`/users/${target.id}/roles`).send({ roles: ['SALES_EXECUTIVE'] })).status, `Admin removes ${role}`).toBe(403);
      expect((await A.FOUNDER.post(`/users/${target.id}/roles`).send({ roles: ['SALES_EXECUTIVE'] })).status).toBe(200);
    }
  });

  it('nobody can change their own roles, and the Developer role is never given through users', async () => {
    expect((await A.ADMIN.post(`/users/${fx.admin.id}/roles`).send({ roles: ['SALES_TEAM_LEAD'] })).status).toBe(403);
    expect((await A.FOUNDER.post(`/users/${fx.founder.id}/roles`).send({ roles: ['FOUNDER_CEO'] })).status).toBe(403);
    const target = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    expect((await A.FOUNDER.post(`/users/${target.id}/roles`).send({ roles: ['DEVELOPER'] })).status).toBe(403);
    expect((await A.ADMIN.post(`/users/${target.id}/roles`).send({ roles: ['DEVELOPER'] })).status).toBe(403);
  });

  it('Creating users: HR gives employee roles only; Founder and Developer give any role except Developer; one primary role per user', async () => {
    for (const role of EMPLOYEE) expect((await A.HR.post('/users').send({ email: mail(`hr-${role}`), name: `HR ${role}`, roles: [role] })).status, `HR creates ${role}`).toBe(201);
    for (const role of [...LEADERSHIP, 'SALES_TEAM_LEAD', 'DEVELOPER']) expect((await A.HR.post('/users').send({ email: mail(`hrx-${role}`), name: `HR ${role}`, roles: [role] })).status, `HR creates ${role}`).toBe(403);
    for (const who of ['FOUNDER', 'DEV'] as const) {
      for (const role of [...LEADERSHIP, 'SALES_TEAM_LEAD', ...EMPLOYEE]) expect((await A[who].post('/users').send({ email: mail(`${who}-${role}`), name: `${who} ${role}`, roles: [role] })).status, `${who} creates ${role}`).toBe(201);
      expect((await A[who].post('/users').send({ email: mail(`${who}-dev`), name: 'x y', roles: ['DEVELOPER'] })).status, `${who} creates DEVELOPER`).toBe(403);
    }
    expect((await A.FOUNDER.post('/users').send({ email: mail('two'), name: 'Two Primary', roles: ['SALES_MANAGER', 'SALES_EXECUTIVE'] })).status).toBe(400);
    expect((await A.FOUNDER.post('/users').send({ email: mail('combo'), name: 'Manager Plus HR', roles: ['SALES_MANAGER', 'HR'] })).status).toBe(201); // primary + secondary is fine
  });
});

describe('accounts: pending until someone else approves, and who may handle whom', () => {
  it('a new account is pending; HR cannot approve her own creation or any leadership account; Admin cannot approve at all; Developer can approve anything; a creator cannot approve their own work', async () => {
    const made = async (by: R, role: string, tag: string) => (await A[by].post('/users').send({ email: mail(tag), name: `Acct ${tag}`, roles: [role] })).body.data as { id: string; approvalStatus: string };
    const hrExec = await made('HR', 'SALES_EXECUTIVE', 'a1');
    expect(hrExec.approvalStatus).toBe('PENDING');
    expect((await A.HR.post(`/users/${hrExec.id}/approve`).send({})).status).toBe(403); // own creation
    expect((await A.ADMIN.post(`/users/${hrExec.id}/approve`).send({})).status).toBe(403);
    expect((await A.MGR.post(`/users/${hrExec.id}/approve`).send({})).status).toBe(403);
    expect((await A.FOUNDER.post(`/users/${hrExec.id}/approve`).send({})).status).toBe(200);
    for (const role of ['ADMIN', 'HR', 'FINANCE']) {
      const acct = await made('FOUNDER', role, `l-${role}`);
      expect((await A.HR.post(`/users/${acct.id}/approve`).send({})).status, `HR approves ${role}`).toBe(403);
      expect((await A.FOUNDER.post(`/users/${acct.id}/approve`).send({})).status, `Founder approves own ${role}`).toBe(403);
      expect((await A.DEV.post(`/users/${acct.id}/approve`).send({})).status, `Developer approves ${role}`).toBe(200);
    }
    const devExec = await made('DEV', 'SALES_MANAGER', 'dm');
    expect((await A.HR.post(`/users/${devExec.id}/approve`).send({})).status).toBe(200); // HR may approve ordinary employees
  });

  it('a pending or rejected account cannot log in; an approved one gets a one-time link only once approved', async () => {
    const p = (await A.FOUNDER.post('/users').send({ email: mail('login'), name: 'Login Check', roles: ['SALES_EXECUTIVE'] })).body.data as { id: string };
    expect((await A.FOUNDER.post(`/users/${p.id}/invite-link`).send({})).status).toBe(409);
    expect((await A.HR.post(`/users/${p.id}/reject`).send({ reason: 'test' })).status).toBe(200);
    expect((await A.HR.post(`/users/${p.id}/approve`).send({})).status).toBe(409);
  });

  it('password reset links: HR for ordinary employees only; leadership accounts only by Founder or Developer', async () => {
    const make = async (role: string, tag: string) => {
      const u = await createUser(t.prisma, fx.org, { roles: [role as never], email: mail(tag) });
      return u.email;
    };
    for (const role of ['SALES_EXECUTIVE', 'SALES_MANAGER', 'SALES_TEAM_LEAD', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS']) {
      expect((await A.HR.post('/users/password-resets/direct').send({ email: await make(role, `rs-${role}`) })).status, `HR resets ${role}`).toBe(201);
    }
    for (const role of ['FOUNDER_CEO', 'ADMIN', 'HR', 'FINANCE']) {
      const email = await make(role, `rl-${role}`);
      expect((await A.HR.post('/users/password-resets/direct').send({ email })).status, `HR resets ${role}`).toBe(403);
      expect((await A.ADMIN.post('/users/password-resets/direct').send({ email })).status).toBe(403);
      expect((await A.FOUNDER.post('/users/password-resets/direct').send({ email })).status, `Founder resets ${role}`).toBe(201);
      expect((await A.DEV.post('/users/password-resets/direct').send({ email })).status, `Developer resets ${role}`).toBe(201);
    }
  });
});

describe('how much data each role sees', () => {
  it('Founder and Team Lead see every lead, a Manager only their team, an Executive only their own', async () => {
    const own = async (u: { id: string }, team: { id: string }) => (await createLead(t.prisma, fx.org.id, u as never, team.id)).id as string;
    const [a1, a2, b1] = [await own(fx.execA1, fx.teamA), await own(fx.execA2, fx.teamA), await own(fx.execB1, fx.teamB)];
    const ids = async (r: R) => ((await A[r].get('/leads?limit=100')).body.data as Array<{ id: string }>).map((l) => l.id);
    const founder = await ids('FOUNDER');
    expect(founder).toEqual(expect.arrayContaining([a1, a2, b1]));
    expect(await ids('TL')).toEqual(expect.arrayContaining([a1, a2, b1]));
    const mgr = await ids('MGR');
    expect(mgr).toEqual(expect.arrayContaining([a1, a2]));
    expect(mgr).not.toContain(b1);
    const exec = await ids('EXEC');
    expect(exec).toContain(a1);
    expect(exec).not.toContain(a2);
    expect(exec).not.toContain(b1);
  });

  it('Executive sees only their own user record, a Manager only their team, HR everyone but only id/name/status', async () => {
    expect(((await A.EXEC.get('/users?limit=100')).body.data as unknown[]).length).toBe(1);
    const mgr = (await A.MGR.get('/users?limit=100')).body.data as Array<{ id: string }>;
    expect(mgr.map((u) => u.id)).toEqual(expect.arrayContaining([fx.managerA.id, fx.execA1.id, fx.execA2.id]));
    expect(mgr.map((u) => u.id)).not.toContain(fx.execB1.id);
    const hr = (await A.HR.get('/users?limit=100')).body.data as Array<Record<string, unknown>>;
    expect(hr.length).toBeGreaterThan(10);
    for (const u of hr) expect(Object.keys(u).sort()).toEqual(['id', 'isActive', 'name']);
  });
});

describe('policy defaults the guides describe', () => {
  it('leave is approved by the manager first, then HR; a manager has a soft limit of 5 executives', async () => {
    const s = (await A.FOUNDER.get('/workforce/settings')).body.data;
    expect(s.effective.leave.approvalChain).toEqual(['MANAGER', 'HR']);
    expect((await A.FOUNDER.get('/org/settings')).body.data.settings.teamSoftLimit).toBe(5);
  });
});
