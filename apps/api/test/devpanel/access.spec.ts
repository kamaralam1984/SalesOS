import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createUser, createTestApp, loginAgent, type OrgFixture, type TestApp } from '../helpers';

let t: TestApp;
let fx: OrgFixture;
let dev: Awaited<ReturnType<typeof createUser>>;
const FAKE = 'sk-fake-secret-value-9f8e7d6c5b4a';

beforeAll(async () => {
  process.env.OPENAI_API_KEY = FAKE;
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  dev = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
});
afterAll(async () => {
  delete process.env.OPENAI_API_KEY;
  await t.close();
});

const paths = ['/dev-panel/access/matrix', '/dev-panel/access/flags', '/dev-panel/access/runbook'];

describe('Developer Panel / access authorization', () => {
  it.each(['founder', 'admin', 'execA1'] as const)('%s gets 403 on every access route', async (who) => {
    const a = await loginAgent(t.app, fx[who]);
    for (const p of [...paths, `/dev-panel/access/matrix/user/${fx.execA1.id}`]) expect((await a.get(p)).status).toBe(403);
  });
});

describe('Developer Panel / access as DEVELOPER', () => {
  it('matrix lists DEVELOPER with only devpanel/auth/audit grants plus the account-approval and home-layout super-admin keys', async () => {
    const a = await loginAgent(t.app, dev);
    const res = await a.get('/dev-panel/access/matrix');
    expect(res.status).toBe(200);
    const m = res.body.data;
    expect(m.roles).toContain('DEVELOPER');
    expect(m.permissions.length).toBe(m.totalPermissions);
    const devKeys: string[] = m.permissions.filter((p: { grants: Record<string, string> }) => p.grants.DEVELOPER).map((p: { key: string }) => p.key);
    expect(devKeys.length).toBe(m.totals.DEVELOPER);
    const superAdminKeys = ['users:create', 'users:approve', 'users:password:reset', 'home-layout:view', 'home-layout:manage'];
    for (const k of devKeys) expect(k.startsWith('devpanel:') || k.startsWith('auth:') || k.startsWith('audit:') || superAdminKeys.includes(k), k).toBe(true);
    const sample = m.permissions.find((p: { key: string }) => p.key === 'devpanel:access');
    expect(sample).toMatchObject({ domain: 'devpanel', sensitive: true });
  });

  it('effective permissions of a seeded user match their roles and are org-scoped', async () => {
    const a = await loginAgent(t.app, dev);
    const res = await a.get(`/dev-panel/access/matrix/user/${fx.execA1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toEqual(['SALES_EXECUTIVE']);
    const matrix = (await a.get('/dev-panel/access/matrix')).body.data;
    const expected = matrix.permissions.filter((p: { grants: Record<string, string> }) => p.grants.SALES_EXECUTIVE).length;
    expect(res.body.data.total).toBe(expected);
    expect(res.body.data.permissions.every((p: { via: string[] }) => p.via.includes('SALES_EXECUTIVE'))).toBe(true);
    expect(res.body.data.permissions.some((p: { key: string }) => p.key.startsWith('devpanel:'))).toBe(false);
    const other = await buildOrgFixture(t.prisma);
    expect((await a.get(`/dev-panel/access/matrix/user/${other.execA1.id}`)).status).toBe(404);
    expect((await a.get('/dev-panel/access/matrix/user/not-a-uuid')).status).toBe(400);
  });

  it('flags never leak secret values', async () => {
    const a = await loginAgent(t.app, dev);
    const res = await a.get('/dev-panel/access/flags');
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(FAKE);
    expect(text).not.toContain(process.env.SESSION_SECRET ?? 'no-session-secret');
    expect(text).not.toMatch(/postgresql:\/\//);
    const openai = res.body.data.flags.find((f: { key: string }) => f.key === 'AI_OPENAI');
    expect(openai.status).toBe('configured');
    expect(res.body.data.flags.find((f: { key: string }) => f.key === 'AI_GEMINI').status).toBe('not configured');
  });

  it('runbook is static and states it never executes commands', async () => {
    const a = await loginAgent(t.app, dev);
    const res = await a.get('/dev-panel/access/runbook');
    expect(res.status).toBe(200);
    expect(res.body.data.executesCommands).toBe(false);
    expect(res.body.data.sections.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(['deploy', 'restart', 'backup']));
  });
});
