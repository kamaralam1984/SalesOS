import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, loginAgent, type TestApp } from './helpers';
import { DEMO_DOMAIN, demoPassword, seed } from '../src/seed/seed';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

describe('[DEMO] seed', () => {
  it('is idempotent, labels everything [DEMO], builds 5+4 executive teams, and demo logins work', async () => {
    await seed(t.prisma);
    await seed(t.prisma);
    const org = await t.prisma.organization.findUniqueOrThrow({ where: { slug: 'demo' } });
    expect(org.name).toContain('[DEMO]');
    const users = await t.prisma.user.findMany({ where: { organizationId: org.id } });
    expect(users).toHaveLength(20);
    expect(users.every((u) => u.name.startsWith('[DEMO]'))).toBe(true);
    const a = users.find((u) => u.email === `manager.a@${DEMO_DOMAIN}`)!;
    const b = users.find((u) => u.email === `manager.b@${DEMO_DOMAIN}`)!;
    expect(users.filter((u) => u.managerId === a.id)).toHaveLength(5);
    expect(users.filter((u) => u.managerId === b.id)).toHaveLength(4);
    const agent = await loginAgent(t.app, { email: `founder@${DEMO_DOMAIN}` }, demoPassword('founder'));
    expect((await agent.get('/auth/me')).body.data.user.roles).toEqual(['FOUNDER_CEO']);
  });
});
