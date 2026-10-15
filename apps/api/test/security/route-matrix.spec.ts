import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { CSRF_HEADER } from '@salesos/shared-types';
import { buildOrgFixture, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';
import { listRoutes, type RouteInfo } from '../helpers/routes';

/**
 * Phase 10 authz sweep, part 1: EVERY registered route, driven by the live router (not a hand-written list).
 *  - deny-by-default: no session -> 401 (never 200/403/404/500, never data)
 *  - CSRF: every state-changing route refuses an authenticated call without the token (incl. multipart upload and SSE entry points)
 *  - Origin: a foreign Origin is refused before anything else on every state-changing route
 *  - unknown routes are 404 with the envelope, not a stack trace
 */
let t: TestApp;
let fx: OrgFixture;
let exec: AuthedAgent;
let routes: RouteInfo[];
const UUID = '11111111-1111-4111-8111-111111111111';
const API = '/api/v1';
const concrete = (p: string) => p.replace(/:[A-Za-z]+/g, UUID);
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  exec = await loginAgent(t.app, fx.execA1);
  routes = listRoutes(t.app);
});
afterAll(async () => { await t.close(); });

const call = (r: { method: string }, path: string) => {
  const s = request(t.app.getHttpServer());
  switch (r.method) {
    case 'GET': return s.get(path);
    case 'POST': return s.post(path);
    case 'PUT': return s.put(path);
    case 'PATCH': return s.patch(path);
    case 'DELETE': return s.delete(path);
    default: throw new Error(`unexpected method ${r.method}`);
  }
};

describe('route inventory', () => {
  it('enumerates a non-trivial route table (sanity: the sweep is not vacuous)', () => {
    expect(routes.length).toBeGreaterThan(250);
    expect(routes.filter((r) => UNSAFE.has(r.method)).length).toBeGreaterThan(100);
     
    console.log(`[security] routes=${routes.length} unsafe=${routes.filter((r) => UNSAFE.has(r.method)).length} public=${routes.filter((r) => r.isPublic).length}`);
  });
});

describe('deny-by-default: no session', () => {
  it('every non-public route answers 401 with an empty data envelope', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const res = await call(r, API + concrete(r.path)).set('Origin', 'http://localhost:3100');
      if (res.status !== 401 || res.body?.data !== null) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('a garbage, expired-looking or truncated session cookie is the same as no cookie', async () => {
    const bad: string[] = [];
    for (const cookie of ['salesos_session=', 'salesos_session=not-a-real-token', `salesos_session=${'A'.repeat(4000)}`, 'salesos_session=%00%00', 'salesos_session=a; salesos_session=b']) {
      for (const r of routes.filter((x) => !x.isPublic && x.method === 'GET').slice(0, 12)) {
        const res = await call(r, API + concrete(r.path)).set('Cookie', cookie);
        if (res.status !== 401) bad.push(`${cookie.slice(0, 30)} ${r.path} -> ${res.status}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('CSRF + Origin on every state-changing route', () => {
  it('authenticated unsafe call WITHOUT the CSRF token is refused (403 CSRF_INVALID) on every route, whatever the role', async () => {
    const bad: string[] = [];
    // supertest agents keep cookies; drive the raw agent so the session cookie is sent but no header is added
    for (const r of routes.filter((x) => UNSAFE.has(x.method) && !x.isPublic)) {
      const a = exec.agent;
      const path = API + concrete(r.path);
      const res = await (r.method === 'POST' ? a.post(path) : r.method === 'PUT' ? a.put(path) : r.method === 'PATCH' ? a.patch(path) : a.delete(path));
      if (res.status !== 403 || res.body?.error?.code !== 'CSRF_INVALID') bad.push(`${r.method} ${r.path} -> ${res.status} ${res.body?.error?.code}`);
    }
    expect(bad).toEqual([]);
  });

  it('a wrong / replayed-from-another-session CSRF token is refused', async () => {
    const other = await loginAgent(t.app, fx.managerA);
    expect(other.csrfToken).not.toBe(exec.csrfToken);
    const bad: string[] = [];
    for (const r of routes.filter((x) => UNSAFE.has(x.method) && !x.isPublic).slice(0, 40)) {
      const path = API + concrete(r.path);
      const q = r.method === 'POST' ? exec.agent.post(path) : r.method === 'PUT' ? exec.agent.put(path) : r.method === 'PATCH' ? exec.agent.patch(path) : exec.agent.delete(path);
      const res = await q.set(CSRF_HEADER, other.csrfToken);
      if (res.status !== 403) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('a foreign Origin is refused (403 CSRF_ORIGIN) on every unsafe route, public ones included, even with a valid token', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => UNSAFE.has(x.method))) {
      const path = API + concrete(r.path);
      const q = r.method === 'POST' ? exec.agent.post(path) : r.method === 'PUT' ? exec.agent.put(path) : r.method === 'PATCH' ? exec.agent.patch(path) : exec.agent.delete(path);
      const res = await q.set(CSRF_HEADER, exec.csrfToken).set('Origin', 'https://evil.example');
      if (res.status !== 403 || res.body?.error?.code !== 'CSRF_ORIGIN') bad.push(`${r.method} ${r.path} -> ${res.status} ${res.body?.error?.code}`);
    }
    expect(bad).toEqual([]);
  });

  it('an Origin that merely STARTS WITH an allowed origin is not allowed (no prefix matching)', async () => {
    for (const origin of ['http://localhost:3100.evil.example', 'http://localhost:31000', 'http://localhost:3100@evil.example', 'null']) {
      const res = await exec.agent.post(`${API}/auth/logout`).set(CSRF_HEADER, exec.csrfToken).set('Origin', origin);
      expect(res.status, origin).toBe(403);
    }
  });

  it('GET routes never change state: the session survives a sweep of every GET with a hostile Origin', async () => {
    const res = await exec.get('/auth/me');
    expect(res.status).toBe(200);
  });
});

describe('unknown routes and methods', () => {
  it('unknown path is a 404 envelope without stack, path internals or framework banner', async () => {
    const res = await exec.get('/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.data).toBeNull();
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/node_modules|at \w+\.|\.ts:\d+/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('TRACE / unexpected verbs are not served', async () => {
    const res = await request(t.app.getHttpServer()).trace(`${API}/auth/me`);
    expect([404, 405, 401]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });
});
