import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get } from '@nestjs/common';
import { buildOrgFixture, createTestApp, loginAgent, type OrgFixture, type TestApp } from './helpers';
import { listRoutes } from './helpers/routes';

/** A route with NO permission metadata: the global guard must refuse it. */
@Controller('__probe_unprotected')
class UnprotectedProbeController {
  @Get()
  open() {
    return { leaked: true };
  }
}

let t: TestApp;
let fx: OrgFixture;
beforeAll(async () => {
  t = await createTestApp({ extraControllers: [UnprotectedProbeController] });
  fx = await buildOrgFixture(t.prisma);
});
afterAll(async () => { await t.close(); });

const PUBLIC_ALLOWLIST = [
  'GET /health',
  'GET /health/ready',
  'GET /ready',
  // Prometheus scrape: @Public only so the controller can do its own check (METRICS_TOKEN bearer, else 404 in prod / loopback-only in dev)
  'GET /metrics',

  'POST /auth/login',
  'POST /auth/password/forgot',
  'POST /auth/password/reset',
  'POST /auth/invite/accept',
  // provider webhooks: authenticity = HMAC signature over the raw body + timestamp window + replay store (platform module)
  'POST /integrations/telephony/webhook',
  'POST /integrations/webhooks/:provider',
].sort();

describe('deny-by-default meta test', () => {
  it('EVERY controller route declares permission metadata (@Public/@Authenticated/@RequirePermission)', () => {
    const missing = listRoutes(t.app)
      .filter((r) => r.controller !== 'UnprotectedProbeController')
      .filter((r) => !r.hasMetadata)
      .map((r) => `${r.method} ${r.path} (${r.controller}.${r.handler})`);
    expect(missing, `Routes without permission metadata:\n${missing.join('\n')}`).toEqual([]);
  });

  it('only the allow-listed endpoints are @Public', () => {
    const pub = listRoutes(t.app)
      .filter((r) => r.isPublic)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(pub).toEqual(PUBLIC_ALLOWLIST);
  });

  it('a route lacking metadata is denied at runtime even for a Founder', async () => {
    const founder = await loginAgent(t.app, fx.founder);
    const res = await founder.get('/__probe_unprotected');
    expect(res.status).toBe(403);
    expect(res.body.data).toBeNull();
  });

  it('unauthenticated access to a route lacking metadata is 401', async () => {
    const res = await (await import('supertest')).default(t.app.getHttpServer()).get('/api/v1/__probe_unprotected');
    expect(res.status).toBe(401);
  });

  it('every permission key referenced by a route exists in the catalogue', async () => {
    const { isKnownPermission } = await import('../src/common/authz/permissions.catalogue');
    for (const r of listRoutes(t.app)) {
      for (const k of [...r.requireAll, ...r.requireAny]) expect(isKnownPermission(k), `${k} on ${r.controller}.${r.handler}`).toBe(true);
    }
  });
});
