import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import request from 'supertest';
import { RedisThrottlerStorage } from '../../src/common/security/redis-throttler.storage';
import { createTestApp, type TestApp } from '../helpers';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6391';
const run = randomBytes(4).toString('hex');
const API = '/api/v1';
const ORIGIN = 'http://localhost:3100';

describe('RedisThrottlerStorage against a real Redis', () => {
  let r1: Redis;
  let r2: Redis;
  beforeAll(() => { r1 = new Redis(REDIS_URL); r2 = new Redis(REDIS_URL); });
  afterAll(async () => { r1.disconnect(); r2.disconnect(); });

  it('counts atomically, blocks past the limit, expires the window, and is SHARED between two replicas', async () => {
    const prefix = `sk:test:${run}:`;
    const a = new RedisThrottlerStorage(r1, prefix);
    const b = new RedisThrottlerStorage(r2, prefix);
    const key = 'ip-1:route';
    const seen: boolean[] = [];
    for (let i = 0; i < 6; i++) seen.push((await (i % 2 ? a : b).increment(key, 1500, 4, 0)).isBlocked); // alternate replicas
    expect(seen).toEqual([false, false, false, false, true, true]);
    expect(await r1.get(prefix + key)).toBe('6');
    const pttl = await r1.pttl(prefix + key);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(1500);
    await new Promise((res) => setTimeout(res, 1700));
    expect((await a.increment(key, 1500, 4, 0)).totalHits).toBe(1); // new window
    expect((await Promise.all(Array.from({ length: 20 }, () => b.increment('burst', 5000, 10, 0)))).filter((x) => x.isBlocked)).toHaveLength(10); // atomic under concurrency
    await r1.del(prefix + key, prefix + 'burst');
  });

  it('degrades to per-process counters (does NOT fail open) when Redis is unreachable', async () => {
    const dead = new Redis('redis://127.0.0.1:1', { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, retryStrategy: () => null });
    dead.on('error', () => undefined);
    const s = new RedisThrottlerStorage(dead, 'sk:dead:');
    const out: boolean[] = [];
    for (let i = 0; i < 5; i++) out.push((await s.increment('k', 60_000, 3, 0)).isBlocked);
    expect(out).toEqual([false, false, false, true, true]);
    expect(s.degraded).toBe(true);
    dead.disconnect();
  });
});

describe('global limiter with THROTTLE_STORAGE=redis, two API replicas', () => {
  const saved: Record<string, string | undefined> = {};
  let a: TestApp;
  let b: TestApp;
  let redis: Redis;
  beforeAll(async () => {
    for (const [k, v] of Object.entries({ THROTTLE_STORAGE: 'redis', THROTTLE_LIMIT: '5', THROTTLE_TTL_SECONDS: '60', TRUST_PROXY: 'true', REDIS_URL })) { saved[k] = process.env[k]; process.env[k] = v; }
    a = await createTestApp();
    b = await createTestApp();
    redis = new Redis(REDIS_URL);
  }, 120_000);
  afterAll(async () => {
    await a.close(); await b.close(); redis.disconnect();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it('a client is limited across replicas: 5 requests split over two processes, the 6th is 429 on either', async () => {
    const ip = `203.0.113.${(parseInt(run.slice(0, 2), 16) % 200) + 20}`;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await request((i % 2 ? a : b).app.getHttpServer()).get(`${API}/health`).set('X-Forwarded-For', ip)).status);
    expect(codes.every((c) => c === 200)).toBe(true);
    const over = await request(a.app.getHttpServer()).get(`${API}/health`).set('X-Forwarded-For', ip);
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('RATE_LIMITED');
    expect(over.headers['retry-after']).toBeDefined();
    const over2 = await request(b.app.getHttpServer()).get(`${API}/health`).set('X-Forwarded-For', ip);
    expect(over2.status).toBe(429);
    const keys = await redis.keys('salesos:throttle:*');
    expect(keys.length).toBeGreaterThan(0);
    // another client is unaffected
    expect((await request(a.app.getHttpServer()).get(`${API}/health`).set('X-Forwarded-For', '198.51.100.7')).status).toBe(200);
  });
});

describe('route-specific limits on expensive / abuse-prone endpoints', () => {
  let t: TestApp;
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    for (const [k, v] of Object.entries({ TRUST_PROXY: 'true', THROTTLE_IMPORT_LIMIT: '2', THROTTLE_EXPORT_LIMIT: '2', THROTTLE_UPLOAD_LIMIT: '2', THROTTLE_AI_LIMIT: '2', THROTTLE_REPORT_LIMIT: '2', THROTTLE_DOWNLOAD_LIMIT: '2', THROTTLE_ADMIN_ACTION_LIMIT: '2' })) { saved[k] = process.env[k]; process.env[k] = v; }
    t = await createTestApp();
  }, 120_000);
  afterAll(async () => {
    await t.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  const U = '11111111-1111-4111-8111-111111111111';
  const ROUTES: Array<[string, string, string]> = [
    ['POST', '/leads/import', 'import'],
    ['POST', '/leads/import/preview', 'import preview'],
    [`POST`, `/leads/import/${U}/retry`, 'import retry'],
    ['GET', '/leads/export', 'lead export'],
    ['GET', '/audit-logs/export', 'audit export'],
    ['POST', '/reports/exports', 'report export request'],
    ['GET', `/reports/exports/${U}/download`, 'report export download'],
    ['POST', '/reports/reconciliation/run', 'reconciliation'],
    ['POST', '/files', 'upload'],
    ['GET', `/files/${U}/download`, 'file download'],
    ['GET', `/files/${U}/download-url`, 'file signed url'],
    ['POST', '/ai/summarize', 'ai summarize'],
    ['POST', '/ai/extract', 'ai extract'],
    ['POST', '/ai/draft-followup', 'ai draft'],
    ['GET', `/ai/call-brief/${U}`, 'ai call brief'],
    ['POST', '/integrations/zoho/test', 'integration test'],
  ];
  it.each(ROUTES)('%s %s (%s): the 3rd call from one client inside the window is 429, a different client is not limited', async (method, path) => {
    const ip = `192.0.2.${(ROUTES.findIndex((r) => r[1] === path) + 10)}`;
    const send = (xff: string) => {
      const s = request(t.app.getHttpServer());
      const q = method === 'POST' ? s.post(API + path) : s.get(API + path);
      return q.set('Origin', ORIGIN).set('X-Forwarded-For', xff);
    };
    const codes = [(await send(ip)).status, (await send(ip)).status, (await send(ip)).status];
    expect(codes.slice(0, 2)).toEqual([401, 401]); // unauthenticated: reached the guard chain, not throttled yet
    expect(codes[2]).toBe(429);
    expect((await send('198.51.100.200')).status).toBe(401);
  });
});
