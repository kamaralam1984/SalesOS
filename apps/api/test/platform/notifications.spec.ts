import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NOTIFICATION_TYPES } from '@salesos/shared-types';
import { NOTIFICATION_CATALOGUE, isQuietNow, nextAllowedAt, notify } from '@salesos/platform-core';
import { buildOrgFixture, createOrg, createUser, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';
import { NotificationService } from '../../src/modules/notifications/notifications.service';

let t: TestApp;
let fx: OrgFixture;
let svc: NotificationService;
let exec1: AuthedAgent;
let exec2: AuthedAgent;
let admin: AuthedAgent;
let manager: AuthedAgent;

beforeAll(async () => {
  process.env.S3_BUCKET ??= 'salesos-agentf-test';
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  svc = t.app.get(NotificationService);
  [exec1, exec2, admin, manager] = await Promise.all([loginAgent(t.app, fx.execA1), loginAgent(t.app, fx.execA2), loginAgent(t.app, fx.admin), loginAgent(t.app, fx.managerA)]);
});
afterAll(async () => { await t.close(); });

const req = (over: Partial<Parameters<typeof notify>[1]> = {}) => ({ organizationId: fx.org.id, type: 'follow_up.overdue' as const, userId: fx.execA1.id, dedupeKey: `k-${randomUUID()}`, title: 'Overdue', ...over });

describe('notification catalogue', () => {
  it('has a catalogue entry for every declared type, in-app by default (DEC-013)', () => {
    expect(Object.keys(NOTIFICATION_CATALOGUE).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    for (const d of Object.values(NOTIFICATION_CATALOGUE)) expect(d.defaultChannels).toEqual(['IN_APP']);
    expect(NOTIFICATION_TYPES.length).toBeGreaterThanOrEqual(24);
  });
  it('GET /notifications/types lists them', async () => {
    const res = await exec1.get('/notifications/types');
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { key: string }) => x.key).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });
});

describe('notify(): dedupe, preferences, digest, validation', () => {
  it('dedupes by key: second raise only increments occurrences', async () => {
    const r = req({ dedupeKey: 'dedupe-1' });
    const a = await svc.notify(r);
    const b = await svc.notify(r);
    const c = await svc.notify(r);
    expect([a.created, b.deduplicated, c.deduplicated]).toEqual([1, 1, 1]);
    const rows = await t.prisma.notification.findMany({ where: { userId: fx.execA1.id, dedupeKey: 'dedupe-1' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurrences).toBe(3);
  });

  it('is atomic with the caller transaction: rollback leaves no notification', async () => {
    const key = `rb-${randomUUID()}`;
    await expect(t.prisma.$transaction(async (tx) => { await svc.notify(tx, req({ dedupeKey: key })); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await t.prisma.notification.count({ where: { dedupeKey: key } })).toBe(0);
  });

  it('role recipients expand to active users of the same organisation only', async () => {
    const other = await createOrg(t.prisma);
    const foreignAdmin = await createUser(t.prisma, other, { roles: ['ADMIN'] });
    const inactive = await createUser(t.prisma, { id: fx.org.id }, { roles: ['ADMIN'], isActive: false });
    const key = `role-${randomUUID()}`;
    const r = await svc.notify(req({ userId: undefined, role: 'ADMIN', dedupeKey: key, type: 'system.delivery_failed' }));
    expect(r.created).toBe(1);
    const rows = await t.prisma.notification.findMany({ where: { dedupeKey: key } });
    expect(rows.map((x) => x.userId)).toEqual([fx.admin.id]);
    expect(rows.some((x) => x.userId === foreignAdmin.id || x.userId === inactive.id)).toBe(false);
  });

  it('cross-org userId in a request is ignored', async () => {
    const other = await createOrg(t.prisma);
    const stranger = await createUser(t.prisma, other, { roles: ['SALES_EXECUTIVE'] });
    const r = await svc.notify(req({ userId: stranger.id }));
    expect(r.created).toBe(0);
  });

  it('rejects malformed requests (no dedupeKey, off-origin link, unknown type, no target)', async () => {
    await expect(svc.notify(req({ dedupeKey: '' }))).rejects.toMatchObject({ status: 400 });
    await expect(svc.notify(req({ actionUrl: 'https://evil.example/x' }))).rejects.toMatchObject({ status: 400 });
    await expect(svc.notify(req({ actionUrl: '//evil.example' }))).rejects.toMatchObject({ status: 400 });
    await expect(svc.notify(req({ type: 'nope' as never }))).rejects.toMatchObject({ status: 400 });
    await expect(svc.notify(req({ userId: undefined }))).rejects.toMatchObject({ status: 400 });
  });

  it('honours a per-type in-app opt-out, but never for mandatory/critical types', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    await t.prisma.notificationPreference.createMany({ data: [
      { organizationId: fx.org.id, userId: u.id, type: 'follow_up.due', channel: 'IN_APP', enabled: false },
      { organizationId: fx.org.id, userId: u.id, type: 'security.event', channel: 'IN_APP', enabled: false },
    ] });
    expect((await svc.notify(req({ userId: u.id, type: 'follow_up.due' }))).suppressed).toBe(1);
    expect((await svc.notify(req({ userId: u.id, type: 'security.event' }))).created).toBe(1);
  });

  it('org rule can disable a non-mandatory type', async () => {
    await t.prisma.notificationRule.create({ data: { organizationId: fx.org.id, type: 'target.at_risk', enabled: false, channels: ['IN_APP'] } });
    const r = await svc.notify(req({ type: 'target.at_risk' }));
    expect([r.created, r.suppressed]).toEqual([0, 1]);
  });

  it('collapses a burst of non-critical notifications into one digest row', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    for (let i = 0; i < 9; i++) await svc.notify(req({ userId: u.id, type: 'lead.no_next_action', dedupeKey: `burst-${i}` }));
    const rows = await t.prisma.notification.findMany({ where: { userId: u.id } });
    expect(rows.filter((r) => !r.isDigest)).toHaveLength(5);
    const digest = rows.filter((r) => r.isDigest);
    expect(digest).toHaveLength(1);
    expect(digest[0]!.occurrences).toBe(4);
  });

  it('quiet hours: external channels are held, in-app is stored; CRITICAL bypasses', () => {
    const cfg = { quietStart: '21:00', quietEnd: '08:00', timezone: 'Asia/Kolkata', workingDays: [1, 2, 3, 4, 5, 6] };
    const night = new Date('2026-10-14T18:00:00Z'); // 23:30 IST Wed
    const day = new Date('2026-10-14T06:00:00Z'); // 11:30 IST Wed
    const sunday = new Date('2026-10-18T06:00:00Z');
    expect(isQuietNow(night, cfg)).toBe(true);
    expect(isQuietNow(day, cfg)).toBe(false);
    expect(isQuietNow(sunday, cfg)).toBe(true);
    const next = nextAllowedAt(night, cfg);
    expect(next.toISOString()).toBe('2026-10-15T02:30:00.000Z'); // 08:00 IST
  });

  it('quiet hours delay the external delivery, not the in-app row', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    await t.prisma.integrationConfig.upsert({ where: { organizationId_provider: { organizationId: fx.org.id, provider: 'sandbox-email' } }, update: { enabled: true }, create: { organizationId: fx.org.id, provider: 'sandbox-email', kind: 'EMAIL', enabled: true } });
    await t.prisma.notificationPreference.create({ data: { organizationId: fx.org.id, userId: u.id, type: '*', channel: 'EMAIL', enabled: true } });
    await t.prisma.notificationUserSettings.create({ data: { userId: u.id, organizationId: fx.org.id, quietStart: '00:00', quietEnd: '23:59', timezone: 'UTC' } });
    const r = await svc.notify(req({ userId: u.id, type: 'review.pending', channel: ['IN_APP', 'EMAIL'] }));
    expect(r.created).toBe(1);
    const n = await t.prisma.notification.findFirstOrThrow({ where: { userId: u.id } });
    expect(n.quietUntil).not.toBeNull();
    const d = await t.prisma.notificationDelivery.findFirstOrThrow({ where: { userId: u.id } });
    expect(d.status).toBe('QUEUED');
    expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // critical bypasses
    const c = await svc.notify(req({ userId: u.id, type: 'security.event', channel: ['IN_APP', 'EMAIL'] }));
    expect(c.created).toBe(1);
    const dc = await t.prisma.notificationDelivery.findFirstOrThrow({ where: { userId: u.id, notificationId: c.notificationIds[0] } });
    expect(dc.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('notification API', () => {
  let mine: string;
  beforeAll(async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const a = await loginAgent(t.app, u);
    exec1 = a;
    for (let i = 0; i < 3; i++) await svc.notify(req({ userId: u.id, type: 'handover.update', dedupeKey: `api-${i}`, title: `T${i}` }));
    mine = (await a.get('/notifications')).body.data[0].id;
  });

  it('lists only my notifications with unreadCount, pagination and filters', async () => {
    const res = await exec1.get('/notifications?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.pagination.hasMore).toBe(true);
    expect(res.body.meta.unreadCount).toBe(3);
    const next = await exec1.get(`/notifications?limit=2&cursor=${res.body.meta.pagination.nextCursor}`);
    expect(next.body.data).toHaveLength(1);
    const other = await exec2.get('/notifications');
    expect(other.body.data.some((n: { id: string }) => n.id === mine)).toBe(false);
  });

  it('polling fallback: ?since returns only newer notifications', async () => {
    const before = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    await svc.notify(req({ userId: exec1.user.id, type: 'handover.update', dedupeKey: 'since-1' }));
    const res = await exec1.get(`/notifications?since=${encodeURIComponent(before)}`);
    expect(res.body.data).toHaveLength(1);
  });

  it('marks read, mark-all-read, dismiss; unread count follows', async () => {
    const r1 = await exec1.post(`/notifications/${mine}/read`).send({});
    expect(r1.status).toBe(201);
    expect(r1.body.data.unreadCount).toBe(3);
    const all = await exec1.post('/notifications/read-all').send({});
    expect(all.body.data.unreadCount).toBe(0);
    const d = await exec1.post(`/notifications/${mine}/dismiss`).send({});
    expect(d.status).toBe(201);
    const listed = await exec1.get('/notifications');
    expect(listed.body.data.some((n: { id: string }) => n.id === mine)).toBe(false);
    expect((await exec1.get('/notifications/unread-count')).body.data.unreadCount).toBe(0);
  });

  it('IDOR: another user (even same team, manager, admin) gets 404 and cannot change state', async () => {
    const victim = await t.prisma.notification.findFirstOrThrow({ where: { userId: fx.execA2.id } }).catch(async () => {
      await svc.notify(req({ userId: fx.execA2.id, dedupeKey: 'victim' }));
      return t.prisma.notification.findFirstOrThrow({ where: { userId: fx.execA2.id } });
    });
    for (const a of [exec1, manager, admin]) {
      expect((await a.post(`/notifications/${victim.id}/read`).send({})).status).toBe(404);
      expect((await a.post(`/notifications/${victim.id}/dismiss`).send({})).status).toBe(404);
    }
    expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: victim.id } })).status).toBe('UNREAD');
  });

  it('preferences: PUT then GET, quiet hours validation, clear override', async () => {
    const put = await exec2.agent.put('/api/v1/notifications/preferences').set('x-csrf-token', exec2.csrfToken).set('Origin', 'http://localhost:3100')
      .send({ preferences: [{ type: 'follow_up.due', channel: 'EMAIL', enabled: true }], quietHours: { quietStart: '22:00', quietEnd: '07:00', timezone: 'Asia/Kolkata' } });
    expect(put.status).toBe(200);
    expect(put.body.data.preferences).toEqual([{ type: 'follow_up.due', channel: 'EMAIL', enabled: true }]);
    expect(put.body.data.quietHours.quietStart).toBe('22:00');
    const bad = await exec2.agent.put('/api/v1/notifications/preferences').set('x-csrf-token', exec2.csrfToken).set('Origin', 'http://localhost:3100').send({ quietHours: { quietStart: '25:00', quietEnd: '07:00', timezone: 'x' } });
    expect(bad.status).toBe(400);
    const clear = await exec2.agent.put('/api/v1/notifications/preferences').set('x-csrf-token', exec2.csrfToken).set('Origin', 'http://localhost:3100').send({ preferences: [], quietHours: null });
    expect(clear.body.data.quietHours).toBeNull();
  });

  it('rules: admin can read/patch (audited); executive/manager cannot', async () => {
    const patch = await admin.patch('/notifications/rules').send({ rules: [{ type: 'review.pending', enabled: false }], orgConfig: { digestThreshold: 7, quietStart: '20:00' } });
    expect(patch.status).toBe(200);
    expect(patch.body.data.orgConfig.digestThreshold).toBe(7);
    expect(patch.body.data.rules.find((r: { type: string }) => r.type === 'review.pending').enabled).toBe(false);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'notification.rules_changed' } })).toBeGreaterThan(0);
    expect((await exec1.get('/notifications/rules')).status).toBe(403);
    expect((await manager.patch('/notifications/rules').send({})).status).toBe(403);
    expect((await admin.patch('/notifications/rules').send({ orgConfig: { digestThreshold: 1 } })).status).toBe(400);
  });
});

describe('SSE stream', () => {
  it('delivers a newly created notification to its owner only, and falls back cleanly', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'] });
    const a = await loginAgent(t.app, u);
    const server = t.app.getHttpServer() as http.Server;
    await new Promise<void>((res) => (server.listening ? res() : server.listen(0, '127.0.0.1', res)));
    const port = (server.address() as AddressInfo).port;
    const cookie = (a.agent as unknown as { jar: { getCookies: (o: object) => Array<{ name: string; value: string }> } }).jar.getCookies({ domain: '127.0.0.1', path: '/api/v1/', secure: false, script: false })
      .map((c) => `${c.name}=${c.value}`).join('; ');
    const events: string[] = [];
    const reqq = http.get({ host: '127.0.0.1', port, path: '/api/v1/notifications/stream', headers: { cookie, accept: 'text/event-stream' } }, (res) => {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      res.setEncoding('utf8');
      res.on('data', (c: string) => events.push(c));
    });
    await new Promise((r) => setTimeout(r, 400));
    await svc.notify(req({ userId: u.id, type: 'handover.update', dedupeKey: 'sse-1', title: 'LIVE-TITLE' }));
    await svc.notify(req({ userId: fx.execA2.id, type: 'handover.update', dedupeKey: 'sse-other', title: 'SECRET-OTHER' }));
    const start = Date.now();
    while (!events.join('').includes('LIVE-TITLE') && Date.now() - start < 8000) await new Promise((r) => setTimeout(r, 200));
    reqq.destroy();
    const text = events.join('');
    expect(text).toContain('event: ready');
    expect(text).toContain('LIVE-TITLE');
    expect(text).not.toContain('SECRET-OTHER');
  });

  it('requires authentication', async () => {
    const res = await (await import('../helpers')).anonymous(t.app).get('/notifications/stream');
    expect(res.status).toBe(401);
  });
});
