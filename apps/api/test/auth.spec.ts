import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { API, anonymous, buildOrgFixture, createTestApp, createUser, loginAgent, TEST_PASSWORD, type OrgFixture, type TestApp } from './helpers';

let t: TestApp;
let fx: OrgFixture;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
});
afterAll(async () => { await t.close(); });
const anon = () => anonymous(t.app);

describe('login / logout / me', () => {
  it('logs in with secure cookie attributes and never leaks the hash', async () => {
    const res = await anon().post('/auth/login').send({ email: fx.execA1.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith('salesos_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Path=\//);
    expect(cookies.find((c) => c.startsWith('salesos_csrf='))).not.toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    expect(res.body.data.csrfToken).toHaveLength(64);
  });

  it('stores only a sha256 of the session token and an argon2id password hash', async () => {
    const u = await t.prisma.user.findUniqueOrThrow({ where: { id: fx.execA1.id } });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    const agent = await loginAgent(t.app, fx.execA2);
    expect(agent.csrfToken).toBeTruthy();
    const sessions = await t.prisma.session.findMany({ where: { userId: fx.execA2.id } });
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) expect(s.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects wrong password and unknown email with the same generic error', async () => {
    const a = await anon().post('/auth/login').send({ email: fx.execA1.email, password: 'Wrong-password-123' });
    const b = await anon().post('/auth/login').send({ email: 'nobody@test.salesos.local', password: 'Wrong-password-123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toEqual(b.body.error);
  });

  it('validates the login body', async () => {
    const res = await anon().post('/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('/auth/me returns effective permissions and a scope summary', async () => {
    const a = await loginAgent(t.app, fx.managerA);
    const res = await a.get('/auth/me');
    expect(res.status).toBe(200);
    const me = res.body.data;
    expect(me.user.roles).toEqual(['SALES_MANAGER']);
    expect(me.permissions).toContainEqual({ key: 'users:view', scope: 'team' });
    expect(me.permissions.find((p: { key: string }) => p.key === 'hr:records:view')).toBeUndefined();
    expect(me.scope.directReportCount).toBe(2);
    expect(me.scope.visibleUserCount).toBe(3); // self + 2 execs
    expect(me.csrfToken).toBe(a.csrfToken);
  });

  it('logout revokes the session server-side', async () => {
    const a = await loginAgent(t.app, fx.execB1);
    expect((await a.post('/auth/logout')).status).toBe(200);
    expect((await a.get('/auth/me')).status).toBe(401);
    const revoked = await t.prisma.session.findMany({ where: { userId: fx.execB1.id, revokedAt: { not: null } } });
    expect(revoked.length).toBeGreaterThan(0);
  });
});

describe('session lifecycle', () => {
  it('rejects a session past idle expiry', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const a = await loginAgent(t.app, u);
    await t.prisma.session.updateMany({ where: { userId: u.id }, data: { idleExpiresAt: new Date(Date.now() - 1000) } });
    expect((await a.get('/auth/me')).status).toBe(401);
  });

  it('rejects a session past absolute expiry', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const a = await loginAgent(t.app, u);
    await t.prisma.session.updateMany({ where: { userId: u.id }, data: { absoluteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await a.get('/auth/me')).status).toBe(401);
  });

  it('rotates the token after the rotation interval and keeps the old one valid briefly (grace)', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const a = await loginAgent(t.app, u);
    await t.prisma.session.updateMany({ where: { userId: u.id }, data: { rotatedAt: new Date(Date.now() - 3_600_000) } });
    const res = await a.get('/auth/me');
    expect(res.status).toBe(200);
    const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(setCookie.some((c) => c.startsWith('salesos_session='))).toBe(true);
    const sessions = await t.prisma.session.findMany({ where: { userId: u.id } });
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((s) => s.familyId)).size).toBe(1);
    // New cookie works (agent stored it), csrf token stays valid across rotation.
    expect((await a.post('/auth/logout')).status).toBe(200);
  });

  it('a deactivated user cannot log in and an existing session is rejected', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const a = await loginAgent(t.app, u);
    await t.prisma.user.update({ where: { id: u.id }, data: { isActive: false } }); // even without session revocation
    expect((await a.get('/auth/me')).status).toBe(401);
    const login = await anon().post('/auth/login').send({ email: u.email, password: TEST_PASSWORD });
    expect(login.status).toBe(401);
  });
});

describe('lockout', () => {
  it('locks after N failures, rejects even the correct password, audits, then recovers', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    for (let i = 0; i < 5; i++) {
      const r = await anon().post('/auth/login').send({ email: u.email, password: 'Wrong-password-123' });
      expect(r.status).toBe(401);
    }
    const correctWhileLocked = await anon().post('/auth/login').send({ email: u.email, password: TEST_PASSWORD });
    expect(correctWhileLocked.status).toBe(401);
    expect(correctWhileLocked.body.error.code).toBe('INVALID_CREDENTIALS'); // does not reveal the lock

    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const audit = await t.prisma.auditLog.findMany({ where: { actorId: u.id } });
    expect(audit.filter((a) => a.action === 'auth.login_failed').length).toBeGreaterThanOrEqual(6);
    expect(audit.some((a) => a.action === 'auth.account_locked')).toBe(true);

    await t.prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await anon().post('/auth/login').send({ email: u.email, password: TEST_PASSWORD })).status).toBe(200);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(0);
  });
});

describe('CSRF', () => {
  it('rejects unsafe requests without the csrf token, with a wrong one, and from a foreign Origin', async () => {
    const a = await loginAgent(t.app, fx.execA1);
    const none = await a.postNoCsrf('/auth/logout');
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('CSRF_INVALID');
    const wrong = await a.agent.post(`${API}/auth/logout`).set('x-csrf-token', 'f'.repeat(64));
    expect(wrong.status).toBe(403);
    const foreign = await a.agent.post(`${API}/auth/logout`).set('x-csrf-token', a.csrfToken).set('Origin', 'https://evil.example');
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('CSRF_ORIGIN');
    // session untouched by the rejected attempts
    expect((await a.get('/auth/me')).status).toBe(200);
  });

  it('a csrf token from another session is rejected', async () => {
    const a = await loginAgent(t.app, fx.execA1);
    const b = await loginAgent(t.app, fx.execA2);
    const res = await a.agent.post(`${API}/auth/logout`).set('x-csrf-token', b.csrfToken);
    expect(res.status).toBe(403);
  });

  it('safe methods do not need a token; login rejects a foreign Origin', async () => {
    const a = await loginAgent(t.app, fx.execA1);
    expect((await a.get('/auth/me')).status).toBe(200);
    const res = await request(t.app.getHttpServer()).post(`${API}/auth/login`).set('Origin', 'https://evil.example').send({ email: fx.execA1.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
  });
});

/** The raw token inside a link handed out to an approver. */
const tokenOf = (link: string) => new URL(link).searchParams.get('token') as string;

describe('password reset + invite (hashed, single-use, expiring)', () => {
  it('forgot is generic for unknown emails and creates no token', async () => {
    const before = await t.prisma.authToken.count();
    const res = await anon().post('/auth/password/forgot').send({ email: 'ghost@test.salesos.local' });
    expect(res.status).toBe(200);
    expect(await t.prisma.authToken.count()).toBe(before);
  });

  it('forgot for a real account leaves a pending request for HR / Founder / Developer and still creates no token', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const tokens = await t.prisma.authToken.count();
    expect((await anon().post('/auth/password/forgot').send({ email: u.email })).status).toBe(200);
    expect((await anon().post('/auth/password/forgot').send({ email: u.email })).status).toBe(200);
    expect(await t.prisma.authToken.count()).toBe(tokens);
    expect(await t.prisma.passwordResetRequest.count({ where: { userId: u.id, status: 'PENDING' } })).toBe(1); // asking twice keeps one open request
  });

  it('reset flow: an approver issues the link, it works once, revokes sessions, old password stops working', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const a = await loginAgent(t.app, u);
    const founder = await loginAgent(t.app, fx.founder);
    expect((await anon().post('/auth/password/forgot').send({ email: u.email })).status).toBe(200);
    const list = await founder.get('/users/password-resets');
    const reqRow = list.body.data.find((r: { userId: string }) => r.userId === u.id);
    expect(reqRow).toBeTruthy();
    const issued = await founder.post(`/users/password-resets/${reqRow.id}/issue`).send({});
    expect(issued.status).toBe(201);
    const token = tokenOf(issued.body.data.link);
    const stored = await t.prisma.authToken.findFirstOrThrow({ where: { userId: u.id, purpose: 'PASSWORD_RESET', usedAt: null } });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await founder.get('/users/password-resets')).body.data.some((r: { id: string }) => r.id === reqRow.id)).toBe(false);

    const weak = await anon().post('/auth/password/reset').send({ token, password: 'short' });
    expect(weak.status).toBe(400);

    const newPw = 'Brand-New-Passw0rd!';
    expect((await anon().post('/auth/password/reset').send({ token, password: newPw })).status).toBe(200);
    expect((await anon().post('/auth/password/reset').send({ token, password: newPw + 'x' })).status).toBe(400); // single use
    expect((await a.get('/auth/me')).status).toBe(401); // old session revoked
    expect((await anon().post('/auth/login').send({ email: u.email, password: TEST_PASSWORD })).status).toBe(401);
    expect((await anon().post('/auth/login').send({ email: u.email, password: newPw })).status).toBe(200);
  });

  it('expired tokens are refused', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const founder = await loginAgent(t.app, fx.founder);
    const token = tokenOf((await founder.post('/users/password-resets/direct').send({ email: u.email })).body.data.link);
    await t.prisma.authToken.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await anon().post('/auth/password/reset').send({ token, password: 'Another-Passw0rd!' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('a new reset link invalidates the previous one', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const founder = await loginAgent(t.app, fx.founder);
    const first = tokenOf((await founder.post('/users/password-resets/direct').send({ email: u.email })).body.data.link);
    await founder.post('/users/password-resets/direct').send({ email: u.email });
    const res = await anon().post('/auth/password/reset').send({ token: first, password: 'Another-Passw0rd!' });
    expect(res.status).toBe(400);
  });

  it('invite: a new account cannot log in or get a link until someone other than its creator approves it', async () => {
    const founder = await loginAgent(t.app, fx.founder);
    const hr = await loginAgent(t.app, fx.hr);
    const email = `invitee-${Date.now()}@test.salesos.local`;
    const created = await founder.post('/users').send({ email, name: '[TEST] Invitee', roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    expect(created.status).toBe(201);
    expect(created.body.data.approvalStatus).toBe('PENDING');
    expect(await t.prisma.authToken.count({ where: { user: { email } } })).toBe(0);
    expect((await anon().post('/auth/login').send({ email, password: TEST_PASSWORD })).status).toBe(401);
    const id = created.body.data.id as string;
    expect((await founder.post(`/users/${id}/approve`).send({})).status).toBe(403); // not your own creation
    expect((await founder.post(`/users/${id}/invite-link`).send({})).status).toBe(409); // no link while pending
    const approved = await hr.post(`/users/${id}/approve`).send({});
    expect(approved.status).toBe(200);
    const token = tokenOf(approved.body.data.invite.link);
    expect((await anon().post('/auth/invite/accept').send({ token, password: 'Invite-Passw0rd-Ok1' })).status).toBe(200);
    expect((await anon().post('/auth/login').send({ email, password: 'Invite-Passw0rd-Ok1' })).status).toBe(200);
    // an invite token cannot be replayed as a reset token (purpose-bound, and already used)
    expect((await anon().post('/auth/password/reset').send({ token, password: 'Invite-Passw0rd-Ok2' })).status).toBe(400);
  });

  it('audit rows exist for reset requests and completion', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const founder = await loginAgent(t.app, fx.founder);
    await anon().post('/auth/password/forgot').send({ email: u.email });
    const token = tokenOf((await founder.post('/users/password-resets/direct').send({ email: u.email })).body.data.link);
    await anon().post('/auth/password/reset').send({ token, password: 'Another-Passw0rd!' });
    const actions = (await t.prisma.auditLog.findMany({ where: { OR: [{ actorId: u.id }, { entityId: u.id }] } })).map((a) => a.action);
    expect(actions).toContain('auth.password_reset_requested');
    expect(actions).toContain('user.password_reset_link_issued');
    expect(actions).toContain('auth.password_reset_completed');
  });
});

describe('audit log is append-only at the database level', () => {
  it('UPDATE and DELETE are rejected by the trigger', async () => {
    const row = await t.prisma.auditLog.findFirstOrThrow({ where: { organizationId: fx.org.id } });
    await expect(t.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(t.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(t.prisma.auditLog.deleteMany({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});

describe('csrf + other-session revocation endpoints', () => {
  it('GET /auth/csrf returns the session token; POST /auth/sessions/revoke kills other sessions only', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const a = await loginAgent(t.app, u);
    const b = await loginAgent(t.app, u); // second device
    expect((await a.get('/auth/csrf')).body.data.csrfToken).toBe(a.csrfToken);
    const res = await a.post('/auth/sessions/revoke').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBeGreaterThanOrEqual(1);
    expect((await b.get('/auth/me')).status).toBe(401);
    expect((await a.get('/auth/me')).status).toBe(200);
    expect(await t.prisma.auditLog.count({ where: { actorId: u.id, action: 'auth.sessions_revoked' } })).toBe(1);
  });

  it('/ready alias works', async () => {
    expect((await request(t.app.getHttpServer()).get('/api/v1/ready')).status).toBe(200);
  });
});
