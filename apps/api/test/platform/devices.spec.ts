import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildOrgFixture, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

let t: TestApp;
let fx: OrgFixture;
let admin: AuthedAgent;
let a1: AuthedAgent;
let a2: AuthedAgent;
let hr: AuthedAgent;
const body = (over: object = {}) => ({ deviceId: `android-${randomUUID()}`, label: 'Pixel 8', osVersion: '15', appVersion: '0.1', disclosureVersion: '2026-10', disclosureAccepted: true, ...over });

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  [admin, a1, a2, hr] = await Promise.all([fx.admin, fx.execA1, fx.execA2, fx.hr].map((u) => loginAgent(t.app, u)));
});
afterAll(async () => { await t.close(); });

describe('companion devices (data model only; Android go/no-go = NO-GO for v1)', () => {
  it('is disabled by default: registration answers 403 DEVICES_DISABLED', async () => {
    const res = await a1.post('/devices/register').send(body());
    expect([res.status, res.body.error.code]).toEqual([403, 'DEVICES_DISABLED']);
    const s = await admin.get('/devices/settings');
    expect(s.body.data).toMatchObject({ 'devices.enabled': false, 'recordings.enabled': false });
    expect(s.body.data.goNoGo).toMatch(/NO-GO/);
  });

  it('only integrations:manage holders can switch the flag; recordings can never be switched on', async () => {
    expect((await a1.patch('/devices/settings').send({ enabled: true })).status).toBe(403);
    const on = await admin.patch('/devices/settings').send({ enabled: true });
    expect(on.body.data).toMatchObject({ 'devices.enabled': true, 'recordings.enabled': false });
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'devices.flag_changed' } })).toBe(1);
  });

  it('register requires the disclosure, stores only a hash of the device id, is idempotent and starts PENDING', async () => {
    expect((await a1.post('/devices/register').send(body({ disclosureAccepted: false }))).status).toBe(400);
    expect((await a1.post('/devices/register').send({ ...body(), disclosureVersion: undefined })).status).toBe(400);
    const b = body();
    const r1 = await a1.post('/devices/register').send(b);
    expect(r1.status).toBe(201);
    expect(r1.body.data).toMatchObject({ status: 'PENDING', userId: fx.execA1.id, platform: 'ANDROID', disclosureVersion: '2026-10' });
    const row = await t.prisma.device.findUniqueOrThrow({ where: { id: r1.body.data.id } });
    expect(row.deviceIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(b.deviceId);
    const r2 = await a1.post('/devices/register').send(b);
    expect(r2.body.data.id).toBe(r1.body.data.id);
    expect(await t.prisma.device.count({ where: { userId: fx.execA1.id } })).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'device.registered' } })).toBe(1);
  });

  it('listing: own devices for users, whole organisation for integrations:manage; roles without devices:register are denied', async () => {
    await a2.post('/devices/register').send(body());
    const mine = await a1.get('/devices');
    expect(mine.body.data.every((d: { userId: string }) => d.userId === fx.execA1.id)).toBe(true);
    const all = await admin.get('/devices');
    expect(new Set(all.body.data.map((d: { userId: string }) => d.userId))).toEqual(new Set([fx.execA1.id, fx.execA2.id]));
    expect((await hr.get('/devices')).status).toBe(403);
    expect((await hr.post('/devices/register').send(body())).status).toBe(403);
  });

  it('approve (admin only) then revoke (owner or admin); other users get 404; revoked devices cannot re-register', async () => {
    const d = (await a1.get('/devices')).body.data[0];
    expect((await a1.post(`/devices/${d.id}/approve`).send({})).status).toBe(403);
    const ok = await admin.post(`/devices/${d.id}/approve`).send({});
    expect(ok.body.data.status).toBe('ACTIVE');
    expect((await admin.post(`/devices/${d.id}/approve`).send({})).status).toBe(409);
    expect((await a2.delete(`/devices/${d.id}`)).status).toBe(404);
    expect((await a1.delete(`/devices/${d.id}`)).body.data.status).toBe('REVOKED');
    const row = await t.prisma.device.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.revokedById).toBe(fx.execA1.id);
    const d2 = (await a2.get('/devices')).body.data[0];
    expect((await admin.delete(`/devices/${d2.id}`)).body.data.status).toBe('REVOKED');
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: { in: ['device.approved', 'device.revoked'] } } })).toBe(3);
  });

  it('limits devices per user', async () => {
    for (let i = 0; i < 5; i++) expect((await a1.post('/devices/register').send(body())).status).toBe(201);
    expect((await a1.post('/devices/register').send(body())).status).toBe(409);
  });
});
