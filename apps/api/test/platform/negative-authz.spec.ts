import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymous, buildOrgFixture, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';
import { listRoutes } from '../helpers/routes';

/**
 * Negative authorization for every platform endpoint (notifications, files, integrations, ai, devices, recordings).
 * Mirrors test/negative-authz.spec.ts but only asserts coverage for THIS domain's routes, so parallel domain work cannot
 * break it. `deniedUser` = an authenticated user who lacks the permission (must get 403).
 */
type Who = 'execA1' | 'managerA' | 'hr' | 'finance' | 'admin' | 'teamLead';
interface Case { route: string; deniedUser?: Who; body?: unknown }
const PREFIXES = ['/notifications', '/files', '/integrations', '/ai', '/devices', '/recordings'];

const CASES: Case[] = [
  // notifications (every role holds notifications:view / manage-prefs; negative = unauthenticated; config = notifications:config)
  { route: 'GET /notifications' },
  { route: 'GET /notifications/stream' },
  { route: 'GET /notifications/unread-count' },
  { route: 'GET /notifications/types' },
  { route: 'POST /notifications/read-all' },
  { route: 'GET /notifications/preferences' },
  { route: 'PUT /notifications/preferences', body: { preferences: [] } },
  { route: 'GET /notifications/rules', deniedUser: 'execA1' },
  { route: 'PATCH /notifications/rules', deniedUser: 'managerA', body: {} },
  { route: 'POST /notifications/:id/read' },
  { route: 'POST /notifications/:id/dismiss' },
  // files (files:view is not held by ADMIN; files:delete not by HR/Finance; settings = integrations:manage)
  { route: 'POST /files' },
  { route: 'GET /files/settings', deniedUser: 'execA1' },
  { route: 'PATCH /files/settings', deniedUser: 'managerA', body: {} },
  { route: 'GET /files', deniedUser: 'admin' },
  { route: 'GET /files/:id', deniedUser: 'admin' },
  { route: 'GET /files/:id/download-url', deniedUser: 'admin' },
  { route: 'GET /files/:id/download', deniedUser: 'admin' },
  { route: 'POST /files/:id/attach', body: { entityType: 'user', entityId: '11111111-1111-4111-8111-111111111111' } },
  { route: 'POST /files/:id/retry', deniedUser: 'hr' },
  { route: 'DELETE /files/:id', deniedUser: 'hr' },
  // integrations (integrations:manage = Founder, Admin)
  { route: 'POST /integrations/telephony/webhook' },
  { route: 'POST /integrations/webhooks/:provider' },
  { route: 'GET /integrations', deniedUser: 'execA1' },
  { route: 'GET /integrations/health', deniedUser: 'managerA' },
  { route: 'GET /integrations/failures', deniedUser: 'teamLead' },
  { route: 'GET /integrations/deliveries', deniedUser: 'hr' },
  { route: 'GET /integrations/deliveries/:id', deniedUser: 'finance' },
  { route: 'POST /integrations/deliveries/:id/retry', deniedUser: 'managerA', body: {} },
  { route: 'GET /integrations/consent', deniedUser: 'execA1' },
  { route: 'PUT /integrations/consent', deniedUser: 'execA1', body: { channel: 'EMAIL', address: 'a@b.co', status: 'OPTED_IN' } },
  { route: 'PATCH /integrations/:provider', deniedUser: 'managerA', body: { enabled: false } },
  { route: 'POST /integrations/:provider/health', deniedUser: 'managerA', body: {} },
  { route: 'POST /integrations/:provider/test', deniedUser: 'managerA', body: { to: 'a@b.co', body: 'x' } },
  // ai
  { route: 'GET /ai/status', deniedUser: 'hr' },
  { route: 'GET /ai/config', deniedUser: 'teamLead' },
  { route: 'PATCH /ai/config', deniedUser: 'teamLead', body: { enabled: false } },
  { route: 'GET /ai/usage', deniedUser: 'managerA' },
  { route: 'POST /ai/summarize', deniedUser: 'hr', body: { text: 'x' } },
  { route: 'POST /ai/extract', deniedUser: 'finance', body: { text: 'x' } },
  { route: 'POST /ai/draft-followup', deniedUser: 'hr', body: { text: 'x' } },
  { route: 'GET /ai/call-brief/:leadId', deniedUser: 'hr' },
  { route: 'GET /ai/lead-priority', deniedUser: 'finance' },
  { route: 'GET /ai/suggestions', deniedUser: 'hr' },
  { route: 'GET /ai/suggestions/:id', deniedUser: 'hr' },
  { route: 'PATCH /ai/suggestions/:id', deniedUser: 'hr', body: { action: 'REJECT' } },
  // devices
  { route: 'GET /devices/settings', deniedUser: 'execA1' },
  { route: 'PATCH /devices/settings', deniedUser: 'execA1', body: { enabled: true } },
  { route: 'POST /devices/register', deniedUser: 'hr', body: { deviceId: 'abcdefgh12', label: 'x', disclosureVersion: '1', disclosureAccepted: true } },
  { route: 'GET /devices', deniedUser: 'hr' },
  { route: 'POST /devices/:id/approve', deniedUser: 'execA1', body: {} },
  { route: 'DELETE /devices/:id', deniedUser: 'hr' },
  // recordings (blocked)
  { route: 'GET /recordings', deniedUser: 'execA1' },
  { route: 'POST /recordings', deniedUser: 'execA1', body: {} },
];

let t: TestApp;
let fx: OrgFixture;
let agents: Record<Who, AuthedAgent>;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  const entries = await Promise.all((['execA1', 'managerA', 'hr', 'finance', 'admin', 'teamLead'] as const).map(async (w) => [w, await loginAgent(t.app, fx[w])] as const));
  agents = Object.fromEntries(entries) as Record<Who, AuthedAgent>;
});
afterAll(async () => { await t.close(); });

const UUID = '11111111-1111-4111-8111-111111111111';
const concrete = (p: string) => p.replace(/:\w+/g, p.includes(':provider') ? 'sandbox-email' : UUID);
const split = (r: string) => [r.split(' ')[0]!, r.split(' ')[1]!] as const;
const PUBLIC = new Set(['POST /integrations/telephony/webhook', 'POST /integrations/webhooks/:provider']);

describe('platform negative authorization', () => {
  it('has a negative case for every platform route (and no stale cases)', () => {
    const registered = listRoutes(t.app).filter((r) => PREFIXES.some((p) => r.path === p || r.path.startsWith(`${p}/`))).map((r) => `${r.method} ${r.path}`).sort();
    expect(CASES.map((c) => c.route).sort()).toEqual(registered);
  });

  describe.each(CASES.filter((c) => !PUBLIC.has(c.route)))('$route', (c) => {
    const [method, path] = split(c.route);
    const call = (a: { get: (p: string) => import('supertest').Test; post: (p: string) => import('supertest').Test; patch: (p: string) => import('supertest').Test; delete: (p: string) => import('supertest').Test }) => {
      const m = method.toLowerCase();
      if (m === 'put') return (a as unknown as AuthedAgent).agent.put(`/api/v1${concrete(path)}`).set('x-csrf-token', (a as unknown as AuthedAgent).csrfToken).set('Origin', 'http://localhost:3100');
      return a[m as 'get'](concrete(path));
    };
    it('is rejected (401) without a session', async () => {
      const res = method === 'PUT'
        ? await (await import('supertest')).default(t.app.getHttpServer()).put(`/api/v1${concrete(path)}`).set('Origin', 'http://localhost:3100').send(c.body as object)
        : await call(anonymous(t.app)).send(c.body as object | undefined);
      expect(res.status).toBe(401);
      expect(res.body.data).toBeNull();
    });
    if (c.deniedUser) {
      it(`is rejected (403) for ${c.deniedUser} who lacks the permission`, async () => {
        const res = await call(agents[c.deniedUser!]).send(c.body as object | undefined);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(res.body.data).toBeNull();
      });
    }
  });

  it('webhook routes are public but never accept unsigned requests', async () => {
    for (const p of ['/integrations/telephony/webhook', '/integrations/webhooks/sandbox-email']) {
      const res = await anonymous(t.app).post(p).send({ id: 'x', type: 'call.event', data: {} });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    }
  });
});
