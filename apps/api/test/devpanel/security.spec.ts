import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymous, buildOrgFixture, createTestApp, createUser, loginAgent, type OrgFixture, type TestApp } from '../helpers';

let t: TestApp;
let fx: OrgFixture;
let other: OrgFixture;
let dev: Awaited<ReturnType<typeof createUser>>;
const B = '/dev-panel/security';

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  other = await buildOrgFixture(t.prisma);
  dev = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
});
afterAll(async () => { await t.close(); });

describe('dev-panel security: authorization', () => {
  it.each(['founder', 'admin'] as const)('%s gets 403 on every security route', async (who) => {
    const a = await loginAgent(t.app, fx[who]);
    for (const p of ['/sessions', '/login-history', '/locked-accounts', '/audit']) expect((await a.get(B + p)).status).toBe(403);
    expect((await a.post(`${B}/sessions/${fx.execA1.id}/revoke`).send({})).status).toBe(403);
    expect((await a.post(`${B}/users/${fx.execA1.id}/unlock`).send({})).status).toBe(403);
    expect((await a.post(`${B}/users/${fx.execA1.id}/reset-link`).send({})).status).toBe(403);
  });
});

describe('sessions', () => {
  it('lists live sessions without secrets, flags the current one, and killing one logs that user out', async () => {
    const victim = await loginAgent(t.app, fx.execA1);
    expect((await victim.get('/auth/me')).status).toBe(200);
    const a = await loginAgent(t.app, dev);
    const list = await a.get(`${B}/sessions?limit=200`);
    expect(list.status).toBe(200);
    const text = JSON.stringify(list.body);
    expect(text).not.toMatch(/tokenHash|familyId|token_hash/);
    expect(list.body.data.some((s: { isCurrent: boolean; userId: string }) => s.isCurrent && s.userId === dev.id)).toBe(true);
    const filtered = await a.get(`${B}/sessions?userId=${fx.execA1.id}`);
    const row = filtered.body.data.find((s: { userId: string }) => s.userId === fx.execA1.id);
    expect(row).toBeTruthy();
    expect(row.isCurrent).toBe(false);

    const res = await a.post(`${B}/sessions/${row.id}/revoke`).send({});
    expect(res.status).toBe(200);
    expect((await victim.get('/auth/me')).status).toBe(401);
    expect(await t.prisma.auditLog.count({ where: { action: 'devpanel.session_revoked', actorId: dev.id } })).toBe(1);
    const after = await a.get(`${B}/sessions?userId=${fx.execA1.id}`);
    expect(after.body.data.length).toBe(0);
    expect((await a.post(`${B}/sessions/${row.id}/revoke`).send({})).status).toBe(404); // already dead
  });

  it('is org-scoped: another org session is 404 and never listed', async () => {
    await loginAgent(t.app, other.execA1);
    const foreign = await t.prisma.session.findFirstOrThrow({ where: { userId: other.execA1.id } });
    const a = await loginAgent(t.app, dev);
    expect((await a.post(`${B}/sessions/${foreign.id}/revoke`).send({})).status).toBe(404);
    const list = await a.get(`${B}/sessions?limit=200`);
    expect(list.body.data.some((s: { userId: string }) => s.userId === other.execA1.id)).toBe(false);
    expect((await t.prisma.session.findUniqueOrThrow({ where: { id: foreign.id } })).revokedAt).toBeNull();
  });
});

describe('login history and locked accounts', () => {
  it('records and filters login events, and states the failed-attempt limitation', async () => {
    const bad = await anonymous(t.app).post('/auth/login').send({ email: fx.execA2.email, password: 'Wrong-Passw0rd-xx!' });
    expect(bad.status).toBe(401);
    const a = await loginAgent(t.app, dev);
    const res = await a.get(`${B}/login-history?action=auth.login_failed&userId=${fx.execA2.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toMatchObject({ action: 'auth.login_failed', userEmail: fx.execA2.email, reason: 'bad_password' });
    expect(res.body.meta.failedAttemptsRecorded).toBe('known-accounts-only');
    const all = await a.get(`${B}/login-history?limit=5`);
    expect(all.body.data.length).toBeLessThanOrEqual(5);
    expect(all.body.data.every((r: { action: string }) => r.action.startsWith('auth.'))).toBe(true);
    expect((await a.get(`${B}/login-history?action=user.deleted`)).status).toBe(400);
  });

  it('lists locked accounts and unlocks them with audit', async () => {
    await t.prisma.user.update({ where: { id: fx.hr.id }, data: { lockedUntil: new Date(Date.now() + 3_600_000), failedLoginCount: 0 } });
    await t.prisma.user.update({ where: { id: fx.finance.id }, data: { failedLoginCount: 4 } });
    const a = await loginAgent(t.app, dev);
    const list = await a.get(`${B}/locked-accounts`);
    const byId = new Map<string, { isLocked: boolean }>(list.body.data.map((u: { id: string; isLocked: boolean }) => [u.id, u]));
    expect(byId.get(fx.hr.id)?.isLocked).toBe(true);
    expect(byId.get(fx.finance.id)?.isLocked).toBe(false);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash/);

    expect((await a.post(`${B}/users/${fx.hr.id}/unlock`).send({})).status).toBe(200);
    const u = await t.prisma.user.findUniqueOrThrow({ where: { id: fx.hr.id } });
    expect(u.lockedUntil).toBeNull();
    expect(await t.prisma.auditLog.count({ where: { action: 'devpanel.account_unlocked', entityId: fx.hr.id } })).toBe(1);
    expect((await a.post(`${B}/users/${other.hr.id}/unlock`).send({})).status).toBe(404);
  });
});

describe('reset link', () => {
  it('issues a single-use link once, never stores the token in audit, rejects self/inactive/cross-org', async () => {
    const a = await loginAgent(t.app, dev);
    const res = await a.post(`${B}/users/${fx.execA2.id}/reset-link`).send({});
    expect(res.status).toBe(200);
    const link: string = res.body.data.link;
    expect(link).toContain('reset-password?token=');
    expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const token = new URL(link).searchParams.get('token')!;
    const audits = await t.prisma.auditLog.findMany({ where: { action: 'devpanel.reset_link_issued', entityId: fx.execA2.id } });
    expect(audits.length).toBe(1);
    expect(JSON.stringify(audits)).not.toContain(token);
    const emails = await t.prisma.outboxEvent.findMany({ where: { eventType: 'notification.email.requested' } });
    expect(JSON.stringify(emails)).not.toContain(token);

    const pw = 'Brand-New-Passw0rd-77!';
    const use = await anonymous(t.app).post('/auth/password/reset').send({ token, password: pw });
    expect(use.status).toBe(200);
    const again = await anonymous(t.app).post('/auth/password/reset').send({ token, password: pw });
    expect(again.status).toBe(400);

    expect((await a.post(`${B}/users/${dev.id}/reset-link`).send({})).status).toBe(400);
    expect((await a.post(`${B}/users/${other.execA1.id}/reset-link`).send({})).status).toBe(404);
    const gone = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], isActive: false });
    expect((await a.post(`${B}/users/${gone.id}/reset-link`).send({})).status).toBe(409);
  });
});

describe('devpanel audit trail', () => {
  it('only returns devpanel.* rows, newest first, with actor name, and filters', async () => {
    const a = await loginAgent(t.app, dev);
    const res = await a.get(`${B}/audit?limit=100`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((r: { action: string }) => r.action.startsWith('devpanel.'))).toBe(true);
    expect(res.body.data[0].actorName).toBe(dev.name);
    const times = res.body.data.map((r: { createdAt: string }) => new Date(r.createdAt).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    const one = await a.get(`${B}/audit?action=devpanel.account_unlocked`);
    expect(one.body.data.every((r: { action: string }) => r.action === 'devpanel.account_unlocked')).toBe(true);
    expect((await a.get(`${B}/audit?action=auth.login_success`)).status).toBe(400);
    const p1 = await a.get(`${B}/audit?limit=1`);
    expect(p1.body.meta.pagination.hasMore).toBe(true);
    const p2 = await a.get(`${B}/audit?limit=1&cursor=${p1.body.meta.pagination.nextCursor}`);
    expect(p2.body.data[0].id).not.toBe(p1.body.data[0].id);
  });
});
