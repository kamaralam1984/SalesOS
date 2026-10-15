import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import request from 'supertest';
import type { TestApp } from './helpers';
import { buildOrgFixture, loginAgent, API } from './helpers';

/**
 * Reliability: dependency outages. A TCP forwarder sits between the API and Postgres / Redis so a test can "pull the cable"
 * (close the listener and every open socket) without touching the shared infrastructure, then restore it.
 */
class Proxy {
  private server?: net.Server;
  private sockets = new Set<net.Socket>();
  port = 0;
  constructor(private readonly target: { host: string; port: number }) {}
  async start(port = 0) {
    this.server = net.createServer((c) => {
      const up = net.connect(this.target);
      this.sockets.add(c).add(up);
      c.pipe(up).pipe(c);
      const done = () => { c.destroy(); up.destroy(); this.sockets.delete(c); this.sockets.delete(up); };
      c.on('error', done); up.on('error', done); c.on('close', done); up.on('close', done);
    });
    await new Promise<void>((r) => this.server!.listen(port, '127.0.0.1', r));
    this.port = (this.server.address() as net.AddressInfo).port;
  }
  async stop() {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = undefined;
  }
}

const dbUrl = new URL(process.env.DATABASE_URL!);
const redisUrl = new URL(process.env.REDIS_URL!);
const pgProxy = new Proxy({ host: dbUrl.hostname, port: Number(dbUrl.port) });
const redisProxy = new Proxy({ host: redisUrl.hostname, port: Number(redisUrl.port) });
let t: TestApp;
let users: Awaited<ReturnType<typeof buildOrgFixture>>;
const saved = { db: process.env.DATABASE_URL, redis: process.env.REDIS_URL, throttle: process.env.THROTTLE_STORAGE, token: process.env.METRICS_TOKEN };
const get = (p: string) => request(t.app.getHttpServer()).get(p);
const eventually = async (fn: () => Promise<boolean>, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); }
  return false;
};

beforeAll(async () => {
  // seed users with a direct connection first (roles are synced by booting the app)
  const { createTestApp } = await import('./helpers');
  const direct = await createTestApp();
  users = await buildOrgFixture(direct.prisma);
  await direct.close();
  await pgProxy.start();
  await redisProxy.start();
  const u = new URL(saved.db!); u.hostname = '127.0.0.1'; u.port = String(pgProxy.port);
  process.env.DATABASE_URL = u.toString();
  process.env.REDIS_URL = `redis://127.0.0.1:${redisProxy.port}`;
  process.env.THROTTLE_STORAGE = 'redis'; // prove the limiter fails open
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
  await pgProxy.stop();
  await redisProxy.stop();
  Object.assign(process.env, { DATABASE_URL: saved.db, REDIS_URL: saved.redis, THROTTLE_STORAGE: saved.throttle });
});

describe('dependency outages', () => {
  it('all green: /health 200, /ready 200 with checks, worker status reported (informational)', async () => {
    expect((await get(`${API}/health`)).status).toBe(200);
    const r = await get(`${API}/ready`);
    expect(r.status).toBe(200);
    expect(r.body.data.checks).toEqual({ database: 'ok', redis: 'ok' });
    expect(['ok', 'stale', 'unknown']).toContain(r.body.data.worker.status);
  });

  it('Redis outage: API is degraded, not dead (login + authenticated reads + KPI endpoint still work; /ready 503 names redis; limiter fails open)', async () => {
    const agent = await loginAgent(t.app, users.founder);
    await redisProxy.stop();
    expect(await eventually(async () => (await get(`${API}/ready`)).status === 503)).toBe(true);
    const ready = await get(`${API}/ready`);
    expect(ready.body.error.details).toMatchObject({ database: 'ok', redis: 'down' });
    expect((await get(`${API}/health`)).status).toBe(200);
    expect((await agent.get('/auth/me')).status).toBe(200);
    expect((await agent.get('/dashboard/ceo')).status).toBe(200); // cache bypassed, computed from Postgres
    const relogin = await loginAgent(t.app, users.founder); // new session, throttler storage down
    expect((await relogin.get('/auth/me')).status).toBe(200);
    await redisProxy.start(redisProxy.port);
    expect(await eventually(async () => (await get(`${API}/ready`)).status === 200)).toBe(true);
  });

  it('DB outage: /health stays 200 (liveness), /ready is 503 naming the database, data requests fail cleanly (no hang/crash); recovers when the DB returns', async () => {
    const agent = await loginAgent(t.app, users.founder);
    await pgProxy.stop();
    expect(await eventually(async () => (await get(`${API}/ready`)).status === 503)).toBe(true);
    const ready = await get(`${API}/ready`);
    expect(ready.body.error.details).toMatchObject({ database: 'down', redis: 'ok' });
    expect((await get(`${API}/health`)).status).toBe(200);
    const started = Date.now();
    const res = await agent.get('/leads?limit=5');
    expect(res.status).toBeGreaterThanOrEqual(401); // 401 (session lookup needs the DB) or 5xx: never 2xx, never a hang
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(res.body.error).toBeTruthy(); // envelope preserved
    await pgProxy.start(pgProxy.port);
    expect(await eventually(async () => (await get(`${API}/ready`)).status === 200, 30_000)).toBe(true);
    expect((await loginAgent(t.app, users.founder).then((a) => a.get('/auth/me'))).status).toBe(200);
  });
});

describe('request ids and error envelope', () => {
  it('generates an x-request-id, echoes a well-formed inbound id, replaces a malformed one, and repeats it in error bodies', async () => {
    const a = await get(`${API}/health`);
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await get(`${API}/health`).set('x-request-id', 'client-req-12345');
    expect(b.headers['x-request-id']).toBe('client-req-12345');
    const c = await get(`${API}/health`).set('x-request-id', 'bad id with spaces!!');
    expect(c.headers['x-request-id']).not.toBe('bad id with spaces!!');
    const notFound = await get(`${API}/nope-${Date.now()}`).set('x-request-id', 'client-req-67890');
    expect(notFound.body.meta.requestId).toBe('client-req-67890');
    expect(notFound.body.error.code).toBe('NOT_FOUND');
  });
});

describe('/metrics', () => {
  it('serves prometheus text on loopback in non-production without a token, with request, latency, dependency and outbox series', async () => {
    await get(`${API}/health`);
    const r = await get('/metrics');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/plain/);
    expect(r.text).toMatch(/salesos_http_requests_total\{method="GET",route="\/api\/v1\/health",status="200"\} \d+/);
    expect(r.text).toContain('salesos_http_request_duration_seconds_bucket');
    expect(r.text).toContain('salesos_dependency_up{dependency="database"} 1');
    expect(r.text).toContain('salesos_outbox_pending');
    expect(r.text).toContain('salesos_worker_heartbeat_age_seconds');
    expect(r.text).not.toMatch(/token|password|cookie/i);
  });
  it('is not under /api/v1 and is not in the public API surface', async () => {
    expect((await get(`${API}/metrics`)).status).toBe(404);
  });
});

describe('/metrics access control', () => {
  it('with METRICS_TOKEN: 401 without/with wrong bearer, 200 with the right one; in production without a token: 404', async () => {
    const { createTestApp } = await import('./helpers');
    process.env.DATABASE_URL = saved.db; process.env.REDIS_URL = saved.redis!;
    process.env.METRICS_TOKEN = 'metrics-token-0123456789abcdef';
    const tok = await createTestApp();
    const g = (p: string) => request(tok.app.getHttpServer()).get(p);
    expect((await g('/metrics')).status).toBe(401);
    expect((await g('/metrics').set('authorization', 'Bearer wrong-token-0123456789abcdef')).status).toBe(401);
    expect((await g('/metrics').set('authorization', 'Bearer metrics-token-0123456789abcdef')).status).toBe(200);
    await tok.close();
    delete process.env.METRICS_TOKEN;
    // production without a token is denied outright (a full production boot needs a hardened DB role; decision logic tested directly)
    const { MetricsController } = await import('../src/common/observability/metrics.controller');
    const { MetricsService } = await import('../src/common/observability/metrics.service');
    const prodCtl = new MetricsController(new MetricsService(), {} as never, { isProd: true, METRICS_TOKEN: undefined } as never);
    await expect(prodCtl.scrape({ headers: {}, socket: { remoteAddress: '127.0.0.1' } } as never, {} as never)).rejects.toMatchObject({ status: 404 });
    const devRemote = new MetricsController(new MetricsService(), {} as never, { isProd: false, METRICS_TOKEN: undefined } as never);
    await expect(devRemote.scrape({ headers: {}, socket: { remoteAddress: '10.1.2.3' } } as never, {} as never)).rejects.toMatchObject({ status: 404 });
    if (saved.token) process.env.METRICS_TOKEN = saved.token;
  });
});
