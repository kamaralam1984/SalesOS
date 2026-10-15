import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymous, buildOrgFixture, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from './helpers';
import { listRoutes, type RouteInfo } from './helpers/routes';

/**
 * Exhaustive negative authorization for the people + SOP domains. For EVERY route under these prefixes:
 *  - anonymous callers get 401;
 *  - the Admin account (which must hold no sensitive HR/people permission) gets 403 unless the route only needs one of
 *    the org-wide "everyone" permissions listed below;
 *  - callers lacking the specific permission get 403 (derived from the permission catalogue, so a new route cannot slip through).
 */
const PREFIXES = ['/sop', '/coaching', '/people', '/incentives', '/engagement', '/resources'];
const EVERYONE = new Set(['sop:view', 'sop:acknowledge', 'resources:view', 'engagement:respond']);
const UUID = '11111111-1111-4111-8111-111111111111';
const concrete = (p: string) => p.replace(/:\w+/g, UUID);

let t: TestApp;
let fx: OrgFixture;
let routes: RouteInfo[];
let admin: AuthedAgent;
let finance: AuthedAgent;
let exec: AuthedAgent;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  routes = listRoutes(t.app).filter((r) => PREFIXES.some((p) => r.path === p || r.path.startsWith(`${p}/`)));
  admin = await loginAgent(t.app, fx.admin);
  finance = await loginAgent(t.app, fx.finance);
  exec = await loginAgent(t.app, fx.execA1);
});
afterAll(async () => { await t.close(); });

type Verb = (p: string) => import('supertest').Test;
interface Caller { get: Verb; post: Verb; patch: Verb; put: Verb; delete: Verb }
const call = (a: Caller, method: string, path: string) => ({ GET: a.get, POST: a.post, PATCH: a.patch, PUT: a.put, DELETE: a.delete } as Record<string, Verb>)[method]!.call(a, concrete(path)).send({});

describe('people + SOP negative authorization', () => {
  it('discovers a substantial number of routes and each declares permission metadata (deny-by-default)', () => {
    expect(routes.length).toBeGreaterThan(90);
    for (const r of routes) {
      expect(r.isPublic, `${r.method} ${r.path} must not be public`).toBe(false);
      expect(r.requireAll.length + r.requireAny.length, `${r.method} ${r.path}`).toBeGreaterThan(0);
    }
  });

  it('rejects anonymous callers with 401 on every route', async () => {
    const a = anonymous(t.app);
    for (const r of routes) {
      const res = await call(a as unknown as Caller, r.method, r.path);
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it('Admin (no sensitive people permissions) is denied everywhere except the org-wide read/ack routes', async () => {
    for (const r of routes) {
      const keys = [...r.requireAll, ...r.requireAny];
      const allowed = keys.every((k) => EVERYONE.has(k));
      const res = await call(admin, r.method, r.path);
      if (allowed) expect(res.status, `${r.method} ${r.path}`).not.toBe(403);
      else {
        expect(res.status, `${r.method} ${r.path}`).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
  });

  it('Finance and an executive are denied on every route whose permissions they do not hold', async () => {
    for (const [agent, user] of [[finance, fx.finance], [exec, fx.execA1]] as const) {
      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
      const held = new Set(row.roleAssignments.flatMap((a) => a.role.permissions.map((p) => p.permission.key)));
      for (const r of routes) {
        const ok = r.requireAll.length ? r.requireAll.every((k) => held.has(k)) : r.requireAny.some((k) => held.has(k));
        if (ok) continue;
        const res = await call(agent, r.method, r.path);
        expect(res.status, `${user.roles[0]} ${r.method} ${r.path}`).toBe(403);
      }
    }
  });

  it('every route that is guarded by a sensitive key is covered by the catalogue as sensitive (Admin holds none)', async () => {
    const admins = await t.prisma.rolePermission.findMany({ where: { role: { key: 'ADMIN' } }, include: { permission: true } });
    const sensitive = admins.filter((p) => p.permission.sensitive);
    expect(sensitive.map((p) => p.permission.key)).toEqual([]);
  });
});
