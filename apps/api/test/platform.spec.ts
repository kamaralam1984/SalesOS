import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers';
import { loadEnv } from '../src/config/env';
import { clampLimit, decodeCursor, encodeCursor, pageArgs, pageResult } from '../src/common/pagination/pagination';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });
const http = () => request(t.app.getHttpServer());

describe('platform: envelope, ids, health, headers, CORS', () => {
  it('wraps success in {data, meta, error:null} with a request id', async () => {
    const res = await http().get('/api/v1/health');
    expect(res.body).toMatchObject({ data: { status: 'ok' }, error: null });
    expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
  });

  it('honours a well-formed inbound request id and rejects junk', async () => {
    const good = await http().get('/api/v1/health').set('x-request-id', 'client-req-12345');
    expect(good.headers['x-request-id']).toBe('client-req-12345');
    const bad = await http().get('/api/v1/health').set('x-request-id', 'bad id with spaces <script>');
    expect(bad.headers['x-request-id']).not.toContain('<');
  });

  it('renders errors through the central filter in the same envelope', async () => {
    const res = await http().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ data: null, error: { code: 'UNAUTHENTICATED' } });
    expect(res.body.meta.requestId).toBeTruthy();
    const nf = await http().get('/api/v1/does-not-exist');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
  });

  it('readiness reports database and redis', async () => {
    const res = await http().get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.checks).toEqual({ database: 'ok', redis: 'ok' });
  });

  it('sets security headers (helmet) and hides x-powered-by', async () => {
    const res = await http().get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS only echoes allow-listed origins, with credentials', async () => {
    const ok = await http().options('/api/v1/auth/login').set('Origin', 'http://localhost:3100').set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3100');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await http().options('/api/v1/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves OpenAPI docs at /api/docs', async () => {
    const res = await http().get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/api/v1/auth/login']).toBeDefined();
    expect((await http().get('/api/docs')).status).toBe(200);
  });
});

describe('config validation fails fast', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', SESSION_SECRET: 'x'.repeat(40) };
  it('accepts a valid env', () => expect(loadEnv({ ...base } as NodeJS.ProcessEnv).PORT).toBe(4100));
  it('rejects missing DATABASE_URL', () => expect(() => loadEnv({ SESSION_SECRET: base.SESSION_SECRET } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/));
  it('rejects short SESSION_SECRET', () => expect(() => loadEnv({ ...base, SESSION_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/));
  it('rejects wildcard CORS (credentialed cookies)', () => expect(() => loadEnv({ ...base, CORS_ORIGINS: '*' } as NodeJS.ProcessEnv)).toThrow(/CORS_ORIGINS/));
  it('rejects placeholder secret in production', () =>
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'change-me-change-me-change-me-change-me' } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/));
});

describe('pagination helper', () => {
  it('clamps limit to the maximum and minimum', () => {
    expect(clampLimit(10_000)).toBe(100);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(undefined)).toBe(25);
  });
  it('round-trips cursors and rejects garbage', () => {
    expect(decodeCursor(encodeCursor('abc'))).toBe('abc');
    expect(() => decodeCursor('not-a-cursor')).toThrow();
  });
  it('builds cursor results with hasMore/nextCursor', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const r = pageResult(rows, { limit: 2 });
    expect(r.data).toHaveLength(2);
    expect(r.meta.pagination).toMatchObject({ mode: 'cursor', hasMore: true, limit: 2 });
    expect(decodeCursor(r.meta.pagination!.nextCursor!)).toBe('b');
    expect(pageArgs({ limit: 2, cursor: r.meta.pagination!.nextCursor! })).toMatchObject({ take: 3, skip: 1, cursor: { id: 'b' } });
  });
  it('supports page mode with totals', () => {
    const r = pageResult([{ id: 'x' }], { limit: 10, page: 2 }, 11);
    expect(r.meta.pagination).toMatchObject({ mode: 'page', page: 2, total: 11, totalPages: 2 });
    expect(pageArgs({ limit: 10, page: 3 })).toMatchObject({ take: 11, skip: 20 });
  });
  it('API caps limit via validation (limit=1000 rejected)', async () => {
    const res = await http().get('/api/v1/audit-logs?limit=1000');
    expect(res.status).toBe(401); // auth first; validation covered in users.spec
  });
});
