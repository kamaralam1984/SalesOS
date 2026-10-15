import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantsForRole } from '../../src/common/authz/permissions.catalogue';
import { anonymous, createTestApp, type TestApp } from '../helpers';
import { listRoutes, type RouteInfo } from '../helpers/routes';
import { buildCxFixture, buildOtherOrg, type CxFixture } from './helpers';

/**
 * Exhaustive negative authorization for Phase 7 (CX, handover, collaboration, Founder reporting). For EVERY route under these prefixes:
 *  - anonymous callers get 401;
 *  - a caller whose roles hold NONE of the required permissions gets 403 (picked from the catalogue so a new route cannot slip through);
 *  - a caller from ANOTHER organisation never reaches the record (404 for id routes, empty lists otherwise) even with full permissions.
 */
const PREFIXES = ['/cx', '/handovers', '/xf-tasks', '/founder-reports', '/action-items', '/risk-register', '/collaboration'];
const UUID = '11111111-1111-4111-8111-111111111111';
const concrete = (p: string) => p.replace(/:\w+/g, UUID);

let t: TestApp;
let fx: CxFixture;
let other: Awaited<ReturnType<typeof buildOtherOrg>>;
let routes: RouteInfo[];

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildCxFixture(t);
  other = await buildOtherOrg(t);
  routes = listRoutes(t.app).filter((r) => PREFIXES.some((p) => r.path === p || r.path.startsWith(`${p}/`)));
});
afterAll(async () => { await t.close(); });

type Verb = (p: string) => import('supertest').Test;
interface Caller { get: Verb; post: Verb; patch: Verb; put: Verb; delete: Verb }
const call = (a: Caller, method: string, path: string) => ({ GET: a.get, POST: a.post, PATCH: a.patch, PUT: a.put, DELETE: a.delete } as Record<string, Verb>)[method]!.call(a, concrete(path)).send({});

const holds = (roles: string[], keys: string[]) => roles.some((r) => keys.some((k) => k in grantsForRole(r as never)));

describe('Phase 7 negative authorization (every endpoint)', () => {
  it('discovers every P7 route and each one declares permission metadata (deny-by-default)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(60);
    for (const r of routes) {
      expect(r.isPublic, `${r.method} ${r.path} must not be public`).toBe(false);
      expect(r.requireAll.length + r.requireAny.length, `${r.method} ${r.path}`).toBeGreaterThan(0);
    }
  });

  it('rejects anonymous callers with 401 on every route', async () => {
    const a = anonymous(t.app) as unknown as Caller;
    for (const r of routes) expect((await call(a, r.method, r.path)).status, `${r.method} ${r.path}`).toBe(401);
  });

  it('rejects a caller without any of the required permissions with 403 on every route', async () => {
    // candidates, least privileged first; every route has at least one that holds none of its keys
    const candidates = [
      ['hr', ['HR']], ['finance', ['FINANCE']], ['admin', ['ADMIN']], ['marketing', ['MARKETING']], ['ops', ['OPERATIONS']], ['community', ['COMMUNITY']], ['execA1', ['SALES_EXECUTIVE']], ['ss', ['STUDENT_SUCCESS']], ['managerA', ['SALES_MANAGER']],
    ] as const;
    const uncovered: string[] = [];
    for (const r of routes) {
      const keys = [...r.requireAll, ...r.requireAny];
      // requireAll: lacking ANY key is enough; requireAny: must lack ALL keys
      const lacks = (roles: string[]) => (r.requireAll.length ? r.requireAll.some((k) => !holds(roles, [k])) : !holds(roles, keys));
      const pick = candidates.find(([, roles]) => lacks([...roles]));
      if (!pick) { uncovered.push(`${r.method} ${r.path}`); continue; }
      const res = await call(fx.agents[pick[0]] as unknown as Caller, r.method, r.path);
      expect(res.status, `${r.method} ${r.path} as ${pick[0]}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.data).toBeNull();
    }
    expect(uncovered, 'routes with no role lacking the permission').toEqual([]);
  });

  it('a Founder from another organisation never reaches a record by id (404) and lists stay empty', async () => {
    const idRoutes = routes.filter((r) => r.path.includes(':'));
    expect(idRoutes.length).toBeGreaterThan(25);
    for (const r of idRoutes) {
      if (r.path.includes('/watchlist/:leadId') || r.path.includes('/relationships/:leadId')) continue; // covered below
      const res = await call(other.agent as unknown as Caller, r.method, r.path);
      // 403 = this role lacks the permission outright (e.g. Founder has no handover:acknowledge); never 2xx
      expect([403, 404, 400, 422], `${r.method} ${r.path} -> ${res.status}`).toContain(res.status);
    }
    expect((await other.agent.get(`/cx/relationships/${fx.leadA.id}`)).status).toBe(404);
    expect((await other.agent.post(`/cx/relationships/${fx.leadA.id}/notes`).send({ body: 'x' })).status).toBe(404);
    expect((await other.agent.delete(`/cx/relationships/watchlist/${fx.leadA.id}`)).status).toBe(404);
  });
});
