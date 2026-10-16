import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createTestApp, createUser, loginAgent, anonymous, type OrgFixture, type TestApp } from '../helpers';
import { isMaintenanceExempt, normalisePath } from '../../src/modules/devpanel/maintenance/maintenance.guard-logic';
import { MaintenanceService, parseMaintenance } from '../../src/modules/devpanel/maintenance/maintenance.service';
import { RedisService } from '../../src/common/security/redis.module';

// Isolate the Redis key from other specs sharing the test Redis.
const prefix = `mt${Math.random().toString(36).slice(2, 8)}`;
process.env.BULLMQ_PREFIX = prefix;

let t: TestApp;
let fx: OrgFixture;
let dev: Awaited<ReturnType<typeof createUser>>;
let svc: MaintenanceService;
let redis: RedisService;

const clear = async () => { await redis.ensureConnected(); await redis.del(svc.redisKey); svc.resetCache(); };

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  dev = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
  svc = t.app.get(MaintenanceService);
  redis = t.app.get(RedisService);
  await clear();
});
afterAll(async () => {
  try { await clear(); } finally { await t.close(); }
});

describe('maintenance allow-list (unit)', () => {
  it('allows health, auth, status and webhooks; blocks business paths', () => {
    for (const p of ['/api/v1/health', '/api/v1/health/ready', '/api/v1/ready', '/metrics', '/api/v1/auth/me', '/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/auth/csrf',
      '/api/v1/auth/password/reset', '/api/v1/auth/invite/accept', '/api/v1/maintenance/status?x=1', '/api/v1/integrations/telephony/webhook', '/api/v1/integrations/webhooks/razorpay', '/api/v1/auth/me/'])
      expect(isMaintenanceExempt(p), p).toBe(true);
    for (const p of ['/api/v1/leads', '/api/v1/dev-panel/overview', '/api/v1/auth/me/../leads', '/api/v1/integrations', '/api/v1/health-secret', '/api/v1/auth/users', '/api/v1/notifications/stream'])
      expect(isMaintenanceExempt(p), p).toBe(false);
    expect(normalisePath('/api/v1/Auth/Me?a=b')).toBe('/auth/me');
  });
  it('parses stored state and rejects junk', () => {
    expect(parseMaintenance(null)?.enabled).toBe(false);
    expect(parseMaintenance('not json')).toBeNull();
    expect(parseMaintenance('{"enabled":"yes"}')).toBeNull();
    expect(parseMaintenance(JSON.stringify({ enabled: true, message: '' }))).toBeNull();
    expect(parseMaintenance(JSON.stringify({ enabled: true, message: 'ok msg', eta: 'garbage' }))?.eta).toBeNull();
  });
});

describe('maintenance mode', () => {
  it('is off by default and the public status leaks nothing', async () => {
    const res = await anonymous(t.app).get('/maintenance/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: false, message: null, eta: null });
  });

  it('validates input and refuses non-developers', async () => {
    const d = await loginAgent(t.app, dev);
    expect((await d.post('/dev-panel/maintenance/enable').send({ message: 'x' })).status).toBe(400);
    expect((await d.post('/dev-panel/maintenance/enable').send({ message: 'Valid text', eta: new Date(Date.now() - 60_000).toISOString() })).status).toBe(422);
    const a = await loginAgent(t.app, fx.founder);
    expect((await a.post('/dev-panel/maintenance/enable').send({ message: 'Valid text' })).status).toBe(403);
    expect((await a.get('/dev-panel/maintenance')).status).toBe(403);
    expect((await d.get('/dev-panel/maintenance')).body.data.enabled).toBe(false);
  });

  it('enable blocks non-developers on business endpoints, but not auth/health; developer unaffected; disable restores', async () => {
    const d = await loginAgent(t.app, dev);
    const founder = await loginAgent(t.app, fx.founder);
    const exec = await loginAgent(t.app, fx.execA1);
    const eta = new Date(Date.now() + 3600_000).toISOString();

    const en = await d.post('/dev-panel/maintenance/enable').send({ message: 'Upgrading the database', eta });
    expect(en.status).toBe(200);
    expect(en.body.data).toMatchObject({ enabled: true, message: 'Upgrading the database', enabledBy: { id: dev.id } });

    for (const a of [founder, exec]) {
      const res = await a.get('/leads');
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('MAINTENANCE');
      expect(res.body.error.message).toBe('Upgrading the database');
      expect(res.body.error.details.eta).toBe(eta);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect((await a.get('/auth/me')).status).toBe(200);
      expect((await a.get('/auth/csrf')).status).toBe(200);
    }
    expect((await anonymous(t.app).get('/health')).status).toBe(200);
    // login still works while maintenance is on
    await loginAgent(t.app, fx.execA2);

    // developer unaffected, and the public status shows only the three fields
    expect((await d.get('/dev-panel/overview')).status).toBe(200);
    expect((await d.get('/leads')).status).not.toBe(503);
    const pub = await anonymous(t.app).get('/maintenance/status');
    expect(pub.body.data).toEqual({ enabled: true, message: 'Upgrading the database', eta });

    // idempotent: enabling again just updates the message
    const again = await d.post('/dev-panel/maintenance/enable').send({ message: 'Still upgrading' });
    expect(again.status).toBe(200);
    expect((await exec.get('/leads')).body.error.message).toBe('Still upgrading');

    const off = await d.post('/dev-panel/maintenance/disable').send({});
    expect(off.status).toBe(200);
    expect(off.body.data.enabled).toBe(false);
    expect((await exec.get('/leads')).status).not.toBe(503);
    expect((await anonymous(t.app).get('/maintenance/status')).body.data.enabled).toBe(false);

    const rows = await t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, action: { startsWith: 'devpanel.maintenance_' } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['devpanel.maintenance_enabled', 'devpanel.maintenance_enabled', 'devpanel.maintenance_disabled']);
    expect(rows.every((r) => r.actorId === dev.id)).toBe(true);
  });

  it('fails open when the stored value is corrupted', async () => {
    await redis.ensureConnected();
    await redis.set(svc.redisKey, '{{{ junk');
    svc.resetCache();
    const exec = await loginAgent(t.app, fx.execA1);
    expect((await exec.get('/leads')).status).not.toBe(503);
    expect((await anonymous(t.app).get('/maintenance/status')).body.data.enabled).toBe(false);
    await redis.set(svc.redisKey, JSON.stringify({ enabled: true, message: '' }));
    svc.resetCache();
    expect((await exec.get('/leads')).status).not.toBe(503);
    await clear();
  });
});
