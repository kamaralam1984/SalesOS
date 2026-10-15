import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { passwordWeakness, passwordSchema } from '@salesos/validation';
import { API, anonymous, buildOrgFixture, createTestApp, createUser, latestEmailToken, loginAgent, TEST_PASSWORD, type OrgFixture, type TestApp } from '../helpers';

let t: TestApp;
let fx: OrgFixture;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
});
afterAll(async () => { await t.close(); });
const anon = () => anonymous(t.app);
const ORIGIN = 'http://localhost:3100';
const STRONG = 'Kj7#mQ2-vLx9!tRw4';

describe('password policy', () => {
  it.each([
    'Password1234', 'Passw0rd1234', 'Welcome12345', 'Qwerty123456', 'Qwertyuiop12', 'Admin1234567', 'Letmein12345', 'Iloveyou1234', 'Abcdefgh1234', 'Aaaaaaaaaa11', 'Salesos12345', 'CoachEasily1', 'Password@2026', 'P@ssw0rd2026!',
    'Ab1234567890', 'Zxcvbnm12345', 'Welcome@123456', 'WelcomePassword1',
  ])('refuses the guessable password %s', (pw) => {
    expect(passwordSchema.safeParse(pw).success, pw).toBe(false);
  });

  it('accepts long random passwords and passphrases (no arbitrary composition rules beyond length + classes)', () => {
    for (const pw of [STRONG, 'Correct-Horse-Battery-Staple-9', 'Test-Passw0rd-Strong!', 'Demo!founder#2026']) expect(passwordSchema.safeParse(pw).success, pw).toBe(true);
  });

  it('refuses passwords that contain the user\'s name or e-mail local part (context check)', () => {
    expect(passwordWeakness('Kamar-Alam-2026-xx', ['kamar.alam', 'Kamar Alam'])).toMatch(/name or email/);
    expect(passwordWeakness(STRONG, ['kamar.alam'])).toBeNull();
  });

  it('is enforced on the real endpoints that set passwords: reset and invite acceptance', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], email: 'pw.policy@test.salesos.local' });
    await anon().post('/auth/password/forgot').send({ email: u.email });
    const token = await latestEmailToken(t.prisma, u.email);
    for (const pw of ['Password1234', 'short1A', 'alllowercase12345', 'Pw.Policy-Alpha-2026Q']) {
      const res = await anon().post('/auth/password/reset').send({ token, password: pw });
      expect(res.status, pw).toBe(400);
    }
    // the rejected attempts must NOT burn the token
    const ok = await anon().post('/auth/password/reset').send({ token, password: STRONG });
    expect(ok.status).toBe(200);
    expect((await anon().post('/auth/login').send({ email: u.email, password: STRONG })).status).toBe(200);
  });
});

describe('account enumeration and timing', () => {
  it('forgot-password answers identically for existing, unknown, inactive and malformed-case accounts', async () => {
    const inactive = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], isActive: false });
    const bodies: string[] = [];
    const statuses = new Set<number>();
    for (const email of [fx.execA1.email, fx.execA1.email.toUpperCase(), `  ${fx.execA1.email}  `, 'nobody-at-all@test.salesos.local', inactive.email]) {
      const res = await anon().post('/auth/password/forgot').send({ email });
      statuses.add(res.status);
      bodies.push(JSON.stringify({ ...res.body, meta: undefined }));
    }
    expect([...statuses]).toEqual([200]);
    expect(new Set(bodies).size).toBe(1);
  });

  it('response time does not separate existing from unknown accounts on forgot-password (both padded to the same floor)', async () => {
    const measure = async (email: string) => { const t0 = process.hrtime.bigint(); await anon().post('/auth/password/forgot').send({ email }); return Number(process.hrtime.bigint() - t0) / 1e6; };
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 5; i++) { known.push(await measure(fx.execA2.email)); unknown.push(await measure(`ghost-${i}@test.salesos.local`)); }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
    expect(med(known)).toBeGreaterThanOrEqual(380); // padded to FORGOT_PASSWORD_MIN_MS
    expect(med(unknown)).toBeGreaterThanOrEqual(380);
    expect(Math.abs(med(known) - med(unknown))).toBeLessThan(150);
  });

  it('login: wrong password, unknown user, inactive user and locked user are indistinguishable (same status, code, message)', async () => {
    const inactive = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], isActive: false });
    const locked = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    await t.prisma.user.update({ where: { id: locked.id }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    const outs = new Set<string>();
    for (const [email, password] of [[fx.execB2.email, 'Wrong-password-123x'], ['nobody@test.salesos.local', 'Wrong-password-123x'], [inactive.email, TEST_PASSWORD], [locked.email, TEST_PASSWORD]] as const) {
      const res = await anon().post('/auth/login').send({ email, password });
      expect(res.status).toBe(401);
      outs.add(JSON.stringify(res.body.error));
    }
    expect(outs.size).toBe(1);
  });
});

describe('lockout cannot be bypassed by changing the shape of the identifier', () => {
  it('upper case, surrounding whitespace and repeated attempts all hit the same counter; correct password during lockout is still refused', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const variants = [u.email, u.email.toUpperCase(), ` ${u.email} `, u.email.replace(/^./, (c) => c.toUpperCase()), u.email];
    for (const email of variants) {
      const res = await anon().post('/auth/login').send({ email, password: 'Definitely-wrong-1' });
      expect(res.status).toBe(401);
    }
    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.lockedUntil && row.lockedUntil > new Date()).toBe(true);
    for (const email of [u.email, u.email.toUpperCase()]) expect((await anon().post('/auth/login').send({ email, password: TEST_PASSWORD })).status).toBe(401);
    const audit = await t.prisma.auditLog.findMany({ where: { entityId: u.id, action: 'auth.account_locked' } });
    expect(audit.length).toBe(1);
  });

  it('a different X-Forwarded-For does not reset the per-account lockout (and is ignored without TRUST_PROXY)', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    for (let i = 0; i < 5; i++) await request(t.app.getHttpServer()).post(`${API}/auth/login`).set('Origin', ORIGIN).set('X-Forwarded-For', `203.0.113.${i}`).send({ email: u.email, password: 'Definitely-wrong-1' });
    const res = await request(t.app.getHttpServer()).post(`${API}/auth/login`).set('Origin', ORIGIN).set('X-Forwarded-For', '198.51.100.99').send({ email: u.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe('sessions: fixation, rotation, logout everywhere', () => {
  it('login while holding another session cookie revokes that old session and issues a brand-new token + family', async () => {
    const first = await loginAgent(t.app, fx.execA1);
    const rows = await t.prisma.session.findMany({ where: { userId: fx.execA1.id, revokedAt: null } });
    const oldTokenHashes = new Set(rows.map((r) => r.tokenHash));
    // log in again from the SAME cookie jar (as a browser would)
    const res = await first.agent.post(`${API}/auth/login`).set('Origin', ORIGIN).set('x-csrf-token', first.csrfToken).send({ email: fx.execA1.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const after = await t.prisma.session.findMany({ where: { userId: fx.execA1.id, revokedAt: null } });
    const fresh = after.filter((s) => !oldTokenHashes.has(s.tokenHash));
    expect(fresh.length).toBe(1);
    expect(fresh[0]!.familyId).not.toBe(rows.find((r) => r.familyId)?.familyId);
    const superseded = await t.prisma.session.count({ where: { userId: fx.execA1.id, revokedReason: 'superseded_by_login' } });
    expect(superseded).toBeGreaterThan(0);
  });

  it('an attacker-planted session cookie value is never adopted: the server issues its own random token', async () => {
    const planted = 'A'.repeat(43);
    const res = await request(t.app.getHttpServer()).post(`${API}/auth/login`).set('Origin', ORIGIN).set('Cookie', `salesos_session=${planted}`).send({ email: fx.execA2.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('salesos_session='))!;
    expect(cookie).not.toContain(planted);
    expect(cookie.split(';')[0]!.length).toBeGreaterThan(40);
  });

  it('password reset and deactivation revoke every session of the user ("logout everywhere")', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    const a1 = await loginAgent(t.app, u);
    const a2 = await loginAgent(t.app, u);
    expect((await a1.get('/auth/me')).status).toBe(200);
    expect((await a2.get('/auth/me')).status).toBe(200);
    await anon().post('/auth/password/forgot').send({ email: u.email });
    const token = await latestEmailToken(t.prisma, u.email);
    expect((await anon().post('/auth/password/reset').send({ token, password: STRONG })).status).toBe(200);
    expect((await a1.get('/auth/me')).status).toBe(401);
    expect((await a2.get('/auth/me')).status).toBe(401);
    const b1 = await loginAgent(t.app, u, STRONG);
    const founder = await loginAgent(t.app, fx.founder);
    expect((await founder.post(`/users/${u.id}/deactivate`).send({ reason: 'test' })).status).toBe(200);
    expect((await b1.get('/auth/me')).status).toBe(401);
    expect((await anon().post('/auth/login').send({ email: u.email, password: STRONG })).status).toBe(401);
  });

  it('"revoke other sessions" keeps only the caller', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const keep = await loginAgent(t.app, u);
    const other = await loginAgent(t.app, u);
    expect((await keep.post('/auth/sessions/revoke').send({})).body.data.revoked).toBeGreaterThan(0);
    expect((await keep.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
  });

  it('role changes take effect on the very next request (permissions are never cached in the cookie)', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_MANAGER'], managerId: fx.teamLead.id });
    const a = await loginAgent(t.app, u);
    expect((await a.get('/audit-logs')).status).toBeLessThan(500);
    const before = (await a.get('/auth/me')).body.data.permissions.length;
    const founder = await loginAgent(t.app, fx.founder);
    const res = await founder.post(`/users/${u.id}/roles`).send({ roles: ['SALES_EXECUTIVE'] });
    expect(res.status).toBe(200);
    const after = (await a.get('/auth/me')).body.data.permissions.length;
    expect(after).toBeLessThan(before);
  });
});

describe('reset / invite token handling (account takeover)', () => {
  it('tokens are single use, purpose-bound, newest-wins, expire, and are stored only as hashes', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    await anon().post('/auth/password/forgot').send({ email: u.email });
    const t1 = await latestEmailToken(t.prisma, u.email);
    await anon().post('/auth/password/forgot').send({ email: u.email });
    const t2 = await latestEmailToken(t.prisma, u.email);
    expect(t2).not.toBe(t1);
    expect((await anon().post('/auth/password/reset').send({ token: t1, password: STRONG })).status).toBe(400); // superseded
    // a RESET token cannot be used to accept an invite and vice versa
    expect((await anon().post('/auth/invite/accept').send({ token: t2, password: STRONG })).status).toBe(400);
    const rows = await t.prisma.authToken.findMany({ where: { userId: u.id } });
    for (const r of rows) { expect(r.tokenHash).toMatch(/^[0-9a-f]{64}$/); expect(r.tokenHash).not.toBe(t1); expect(r.tokenHash).not.toBe(t2); }
    expect((await anon().post('/auth/password/reset').send({ token: t2, password: STRONG })).status).toBe(200);
    expect((await anon().post('/auth/password/reset').send({ token: t2, password: 'Another-Strong-Pw-77x' })).status).toBe(400); // replay
    // expiry
    await anon().post('/auth/password/forgot').send({ email: u.email });
    const t3 = await latestEmailToken(t.prisma, u.email);
    await t.prisma.authToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await anon().post('/auth/password/reset').send({ token: t3, password: STRONG })).status).toBe(400);
  });

  it('concurrent use of the same token succeeds exactly once', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    await anon().post('/auth/password/forgot').send({ email: u.email });
    const token = await latestEmailToken(t.prisma, u.email);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => anon().post('/auth/password/reset').send({ token, password: `Concurrent-${i}-Strong-Pw!x` })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('reset / invite links point at APP_BASE_URL only (Host header cannot poison the link), and raw tokens are not logged in audit rows', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    await request(t.app.getHttpServer()).post(`${API}/auth/password/forgot`).set('Origin', ORIGIN).set('Host', 'evil.example').set('X-Forwarded-Host', 'evil.example').send({ email: u.email });
    const ev = (await t.prisma.outboxEvent.findMany({ where: { eventType: 'notification.email.requested' }, orderBy: { createdAt: 'desc' }, take: 20 })).find((e) => (e.payload as { to?: string }).to === u.email)!;
    const link = (ev.payload as { variables: { link: string } }).variables.link;
    expect(new URL(link).origin).toBe(ORIGIN);
    const token = new URL(link).searchParams.get('token')!;
    const audits = await t.prisma.auditLog.findMany({ where: { entityId: u.id } });
    expect(JSON.stringify(audits)).not.toContain(token);
  });

  it('a deactivated user cannot use a previously issued reset token', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    await anon().post('/auth/password/forgot').send({ email: u.email });
    const token = await latestEmailToken(t.prisma, u.email);
    await t.prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await anon().post('/auth/password/reset').send({ token, password: STRONG })).status).toBe(400);
  });
});

describe('CSRF on login (login CSRF) and logout', () => {
  it('login from a foreign Origin is refused; logout needs the token', async () => {
    const res = await request(t.app.getHttpServer()).post(`${API}/auth/login`).set('Origin', 'https://evil.example').send({ email: fx.execA1.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    const a = await loginAgent(t.app, fx.execA1);
    expect((await a.postNoCsrf('/auth/logout').set('Origin', ORIGIN)).status).toBe(403);
    expect((await a.get('/auth/me')).status).toBe(200);
  });
});
