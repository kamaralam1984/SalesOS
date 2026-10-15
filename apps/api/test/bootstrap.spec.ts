import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, loginAgent, type TestApp } from './helpers';
import { bootstrap, readBootstrapEnv } from '../src/owner-bootstrap/bootstrap';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

describe('production-safe bootstrap', () => {
  it('requires env, rejects weak input', () => {
    expect(() => readBootstrapEnv({})).toThrow(/Missing required env/);
    expect(() => readBootstrapEnv({ BOOTSTRAP_ADMIN_EMAIL: 'nope', BOOTSTRAP_ADMIN_NAME: 'A', BOOTSTRAP_ADMIN_PASSWORD: 'longenoughpw1' })).toThrow(/valid email/);
    expect(() => readBootstrapEnv({ BOOTSTRAP_ADMIN_EMAIL: 'a@b.co', BOOTSTRAP_ADMIN_NAME: 'A', BOOTSTRAP_ADMIN_PASSWORD: 'short' })).toThrow(/10 characters/);
  });

  it('creates only org + one Founder, is idempotent, and creates no sample data', async () => {
    const slug = `boot-${Date.now()}`;
    const email = `owner-${Date.now()}@example.com`;
    const input = readBootstrapEnv({ BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_NAME: 'Owner Person', BOOTSTRAP_ADMIN_PASSWORD: 'Boot-Strap-Pw-9271!', BOOTSTRAP_ORG_NAME: '[TEST] Boot Org', BOOTSTRAP_ORG_SLUG: slug });
    const first = await bootstrap(t.prisma, input);
    const second = await bootstrap(t.prisma, input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
    const where = { organizationId: first.organizationId };
    expect(await t.prisma.user.count({ where })).toBe(1);
    expect(await t.prisma.lead.count({ where })).toBe(0);
    expect(await t.prisma.deal.count({ where })).toBe(0);
    expect(await t.prisma.team.count({ where })).toBe(0);
    const agent = await loginAgent(t.app, { email }, 'Boot-Strap-Pw-9271!');
    expect((await agent.get('/auth/me')).body.data.user.roles).toEqual(['FOUNDER_CEO']);
  });
});
