import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createUser, createTestApp, loginAgent, type OrgFixture, type TestApp } from '../helpers';

let t: TestApp;
let fx: OrgFixture;
let dev: Awaited<ReturnType<typeof createUser>>;
const PATHS = ['/dev-panel/dashboard', '/dev-panel/dashboard/integrations', '/dev-panel/dashboard/backup'];

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  dev = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
});
afterAll(async () => { await t.close(); });

describe('dev-panel dashboard authorization', () => {
  it.each(['founder', 'admin'] as const)('%s gets 403 on every dashboard route', async (who) => {
    const a = await loginAgent(t.app, fx[who]);
    for (const p of PATHS) expect((await a.get(p)).status).toBe(403);
  });
});

describe('dev-panel dashboard as DEVELOPER', () => {
  it('returns a consolidated snapshot with sane shapes', async () => {
    const a = await loginAgent(t.app, dev);
    const res = await a.get('/dev-panel/dashboard');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(['ok', 'degraded', 'down']).toContain(d.health.status);
    expect(['ok', 'down']).toContain(d.health.database);
    expect(d.users.perRole.DEVELOPER).toBeGreaterThanOrEqual(1);
    expect(d.liveSessions).toBeGreaterThanOrEqual(1);
    expect(d.alerts24h.windowHours).toBe(24);
    expect(typeof d.alerts24h.counters.accountLockouts).toBe('number');
    expect(Array.isArray(d.alerts24h.alerts)).toBe(true);
  });

  it('counts a recorded lockout in the 24h window', async () => {
    const a = await loginAgent(t.app, dev);
    const before = (await a.get('/dev-panel/dashboard')).body.data.alerts24h.counters.accountLockouts as number;
    await t.prisma.auditLog.create({ data: { organizationId: fx.org.id, action: 'auth.account_locked', entityType: 'user', entityId: fx.execA1.id, metadata: {} } });
    const after = (await a.get('/dev-panel/dashboard')).body.data.alerts24h;
    expect(after.counters.accountLockouts).toBe(before + 1);
    expect(after.alerts.some((x: { key: string }) => x.key === 'lockouts')).toBe(true);
  });

  it('integrations: honest shape and no secrets', async () => {
    const a = await loginAgent(t.app, dev);
    await t.prisma.integrationConfig.create({
      data: { organizationId: fx.org.id, provider: 'dash-test-provider', kind: 'EMAIL', enabled: true, secretCipher: 'v1:SECRETCIPHERTEXT', settings: { token: 'TOPSECRET' } },
    });
    const res = await a.get('/dev-panel/dashboard/integrations');
    expect(res.status).toBe(200);
    const item = res.body.data.items.find((i: { provider: string }) => i.provider === 'dash-test-provider');
    expect(item.credentialsStored).toBe(true);
    expect(item.state).toBe('unknown');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('SECRETCIPHERTEXT');
    expect(text).not.toContain('TOPSECRET');
  });

  it('backup: UNKNOWN with a reason when BACKUP_DIR is not configured', async () => {
    const a = await loginAgent(t.app, dev);
    const res = await a.get('/dev-panel/dashboard/backup');
    expect(res.status).toBe(200);
    if (!process.env.BACKUP_DIR) {
      expect(res.body.data.status).toBe('UNKNOWN');
      expect(res.body.data.reason).toBe('BACKUP_DIR_NOT_SET');
    } else {
      expect(['OK', 'STALE', 'MISSING', 'UNKNOWN']).toContain(res.body.data.status);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/\/home\//);
  });
});
