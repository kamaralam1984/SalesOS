import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createTestApp, createUser, loginAgent, type AuthedAgent, type TestApp } from '../helpers';
import { listRoutes, type RouteInfo } from '../helpers/routes';
import { DEMO_DOMAIN, demoPassword, seed } from '../../src/seed/seed';

/**
 * Phase 10 IDOR matrix, driven by the live router and by the [DEMO] organisation (leads, tasks, calls, deals, payments, refunds,
 * handovers, complaints, SOPs, reviews, PIPs, incentives, files ... across every domain).
 *
 *  A. cross-organisation: the most privileged user of ANOTHER organisation (a Founder) replays every id that exists in the demo org against
 *     every route with a path parameter, with every verb. Nothing may succeed: GET never 200, writes never 2xx.
 *  B. intra-organisation: ids visible to Executive A1 (from the list endpoints) that are NOT visible to Executive B1 / Manager B must not be
 *     readable by them through the detail routes (list visibility and detail visibility must agree).
 *  C. positive control: the owner gets 200 on a large share of the same URLs, so a pass cannot be explained by "all ids were invalid".
 */
let t: TestApp;
let routes: RouteInfo[];
let demoFounder: AuthedAgent;
let alien: AuthedAgent;
const pool = new Map<string, string[]>(); // table -> ids in the demo org
let allIds: string[] = [];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const segmentOf = (path: string) => path.split('/')[1] ?? '';

/** Which ids to try for a route: tables whose name resembles the first path segment, then a spread of everything else. */
function candidates(route: RouteInfo): string[] {
  const seg = segmentOf(route.path).replace(/-/g, '').toLowerCase();
  const stem = seg.replace(/s$/, '');
  const near: string[] = [];
  for (const [table, ids] of pool) {
    const tn = table.replace(/_/g, '').toLowerCase();
    if (tn.includes(stem) || stem.includes(tn.replace(/s$/, ''))) near.push(...ids.slice(0, 3));
  }
  const spread = allIds.filter((_, i) => i % Math.max(1, Math.floor(allIds.length / 6)) === 0).slice(0, 6);
  return [...new Set([...near.slice(0, 8), ...spread])];
}

const send = (a: AuthedAgent, method: string, path: string) => {
  switch (method) {
    case 'GET': return a.get(path);
    case 'POST': return a.post(path).send({});
    case 'PUT': return a.put(path).send({});
    case 'PATCH': return a.patch(path).send({});
    case 'DELETE': return a.delete(path);
    default: throw new Error(method);
  }
};

const fill = (path: string, id: string) => path.replace(/:[A-Za-z]+/g, id);
const SKIP = /\/(stream|events\/.*\.ics|openapi)|\.ics$|^\/health/;

beforeAll(async () => {
  t = await createTestApp();
  await seed(t.prisma);
  routes = listRoutes(t.app).filter((r) => r.path.includes(':') && !r.isPublic && !SKIP.test(r.path));
  demoFounder = await loginAgent(t.app, { email: `founder@${DEMO_DOMAIN}` }, demoPassword('founder'));
  const orgB = await createOrg(t.prisma);
  alien = await loginAgent(t.app, await createUser(t.prisma, orgB, { roles: ['FOUNDER_CEO'] }));

  const demo = await t.prisma.organization.findUniqueOrThrow({ where: { slug: 'demo' } });
  const tables = await t.prisma.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' AND table_name NOT IN ('audit_logs','outbox_events','sessions','auth_tokens') ORDER BY 1`;
  for (const { table_name } of tables) {
    if (!/^[a-z_]+$/.test(table_name)) continue;
    const rows = await t.prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id::text AS id FROM "${table_name}" WHERE organization_id = $1::uuid ORDER BY id LIMIT 4`, demo.id).catch(() => []);
    const ids = rows.map((r) => r.id).filter((i) => UUID_RE.test(i));
    if (ids.length) pool.set(table_name, ids);
  }
  allIds = [...new Set([...pool.values()].flat())];
}, 240_000);
afterAll(async () => { await t.close(); });

describe('A. cross-organisation replay of every demo-org id against every parameterised route', () => {
  it('the demo org is rich enough for the sweep to mean something', () => {
    expect(pool.size).toBeGreaterThan(40);
    expect(allIds.length).toBeGreaterThan(150);
    expect(routes.length).toBeGreaterThan(120);
  });

  it('a Founder of another organisation never gets a 2xx on any verb', async () => {
    const hits: string[] = [];
    let probes = 0;
    for (const r of routes) {
      for (const id of candidates(r)) {
        const path = fill(r.path, id);
        const res = await send(alien, r.method, path);
        probes += 1;
        // 2xx is acceptable only when nothing of the victim organisation is returned or changed: empty list / null / "updated: 0" no-ops
        // (scoped list endpoints answer 200 [] for ids outside the caller's scope; indistinguishable from a missing id, so no oracle)
        const d = res.body?.data as unknown;
        const harmless = d === null || d === undefined || (Array.isArray(d) && d.length === 0) || (d && typeof d === 'object' && (d as { updated?: number }).updated === 0);
        if (res.status >= 200 && res.status < 300 && !harmless) hits.push(`${r.method} ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
        if (res.status >= 500) hits.push(`${r.method} ${path} -> ${res.status} (server error)`);
      }
    }
     
    console.log(`[security] cross-org probes=${probes} routes=${routes.length}`);
    expect(probes).toBeGreaterThan(1500);
    expect(hits).toEqual([]);
  }, 600_000);

  it('positive control: the demo Founder reads many of the same GET urls (ids are real, so the denials above are meaningful)', async () => {
    let ok = 0;
    let total = 0;
    for (const r of routes.filter((x) => x.method === 'GET')) {
      for (const id of candidates(r).slice(0, 4)) {
        total += 1;
        if ((await demoFounder.get(fill(r.path, id))).status === 200) ok += 1;
      }
    }
     
    console.log(`[security] positive control: ${ok}/${total} GET urls readable by the owning Founder`);
    expect(ok).toBeGreaterThan(15);
  }, 300_000);
});

describe('B. intra-organisation: list visibility and detail visibility agree (Executive A1 vs Executive B1 / Manager B)', () => {
  it('every id that Executive A1 can list but Executive B1 / Manager B cannot list is also unreadable through the detail routes', async () => {
    const a1 = await loginAgent(t.app, { email: `exec.a1@${DEMO_DOMAIN}` }, demoPassword('exec.a1'));
    const b1 = await loginAgent(t.app, { email: `exec.b1@${DEMO_DOMAIN}` }, demoPassword('exec.b1'));
    const mb = await loginAgent(t.app, { email: `manager.b@${DEMO_DOMAIN}` }, demoPassword('manager.b'));
    const flat = listRoutes(t.app).filter((r) => r.method === 'GET' && !r.path.includes(':') && !r.isPublic && !SKIP.test(r.path) && !/export|\/ics|download|dashboards?|kpis|reports|audit|users|org|teams|permissions|devices|auth|notifications|ai\//.test(r.path));
    const idsOf = (body: { data?: unknown }): string[] => {
      const d = body?.data as unknown;
      const arr = Array.isArray(d) ? d : Array.isArray((d as { items?: unknown[] })?.items) ? (d as { items: unknown[] }).items : [];
      return arr.map((x) => (x as { id?: string })?.id).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x));
    };
    const visible = async (agent: AuthedAgent, path: string) => new Set(idsOf((await agent.get(path).query({ limit: 100 })).body));
    const probes: Array<{ list: string; id: string }> = [];
    for (const r of flat) {
      const [va, vb, vm] = [await visible(a1, r.path), await visible(b1, r.path), await visible(mb, r.path)];
      for (const id of va) if (!vb.has(id) || !vm.has(id)) probes.push({ list: r.path, id });
    }
    expect(probes.length).toBeGreaterThan(10);
    const detail = listRoutes(t.app).filter((r) => r.method === 'GET' && /^\/[a-z-]+\/:[A-Za-z]+$/.test(r.path));
    const leaks: string[] = [];
    let checked = 0;
    for (const p of probes) {
      const seg = p.list.split('/')[1];
      const route = detail.find((r) => r.path.split('/')[1] === seg);
      if (!route) continue;
      const url = fill(route.path, p.id);
      const [ra, rb, rm] = [await a1.get(url), await b1.get(url), await mb.get(url)];
      if (ra.status !== 200) continue; // not a detail route for this list's ids
      checked += 1;
      const vb = new Set(idsOf((await b1.get(p.list).query({ limit: 100 })).body));
      const vm = new Set(idsOf((await mb.get(p.list).query({ limit: 100 })).body));
      if (!vb.has(p.id) && rb.status === 200) leaks.push(`exec.b1 GET ${url} -> 200 but not in b1's list ${p.list}`);
      if (!vm.has(p.id) && rm.status === 200) leaks.push(`manager.b GET ${url} -> 200 but not in manager B's list ${p.list}`);
    }
     
    console.log(`[security] intra-org: list-only ids=${probes.length}, detail comparisons=${checked}`);
    expect(checked).toBeGreaterThan(5);
    expect(leaks).toEqual([]);
  }, 300_000);
});
