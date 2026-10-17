import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from './helpers';

let t: TestApp;
let fx: OrgFixture;
let founder: AuthedAgent;
let execA1: AuthedAgent;
let managerA: AuthedAgent;
let admin: AuthedAgent;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  [founder, execA1, managerA, admin] = await Promise.all([loginAgent(t.app, fx.founder), loginAgent(t.app, fx.execA1), loginAgent(t.app, fx.managerA), loginAgent(t.app, fx.admin)]);
});
afterAll(async () => { await t.close(); });

const layout = [
  { id: 'goal', visible: true, size: 'L' },
  { id: 'attendance', visible: true, size: 'M' },
  { id: 'followups', visible: false, size: 'S' },
];

describe('home layout per role', () => {
  it('everyone gets the built-in default until a role is customised', async () => {
    const r = await execA1.get('/home-layout');
    expect(r.status).toBe(200);
    expect(r.body.data.source).toBe('DEFAULT');
    expect(r.body.data.widgets.map((w: { id: string }) => w.id)).toEqual(['stats', 'attendance', 'goal', 'onboarding', 'followups', 'quickActions', 'workspace']);
  });

  it('only Founder / Developer can see or change layouts for roles', async () => {
    for (const who of [execA1, managerA, admin]) {
      expect((await who.get('/home-layout/roles')).status).toBe(403);
      expect((await who.put('/home-layout/roles/SALES_EXECUTIVE').send({ widgets: layout })).status).toBe(403);
      expect((await who.delete('/home-layout/roles/SALES_EXECUTIVE')).status).toBe(403);
    }
  });

  it('rejects bad input', async () => {
    expect((await founder.put('/home-layout/roles/SALES_EXECUTIVE').send({ widgets: [{ id: 'nope', visible: true, size: 'M' }] })).status).toBe(400);
    expect((await founder.put('/home-layout/roles/SALES_EXECUTIVE').send({ widgets: [{ id: 'goal', visible: true, size: 'XL' }] })).status).toBe(400);
    expect((await founder.put('/home-layout/roles/SALES_EXECUTIVE').send({ widgets: [{ id: 'goal', visible: true, size: 'M' }, { id: 'goal', visible: true, size: 'S' }] })).status).toBe(400);
    expect((await founder.put('/home-layout/roles/NOT_A_ROLE').send({ widgets: layout })).status).toBe(400);
    expect((await founder.put('/home-layout/roles/DEVELOPER').send({ widgets: layout })).status).toBe(400);
  });

  it('a saved role layout reaches that role only, keeps order/size/visibility and appends widgets added later; saving is audited', async () => {
    const saved = await founder.put('/home-layout/roles/SALES_EXECUTIVE').send({ widgets: layout });
    expect(saved.status).toBe(200);
    const mine = (await execA1.get('/home-layout')).body.data;
    expect(mine.source).toBe('ROLE');
    expect(mine.role).toBe('SALES_EXECUTIVE');
    expect(mine.widgets.slice(0, 3)).toEqual(layout);
    expect(mine.widgets.map((w: { id: string }) => w.id)).toHaveLength(7);
    expect((await managerA.get('/home-layout')).body.data.source).toBe('DEFAULT');
    expect(await t.prisma.auditLog.count({ where: { action: 'home_layout.saved', actorId: fx.founder.id } })).toBeGreaterThanOrEqual(1);
  });

  it('the editor lists every role with its layout and the widgets that apply to it', async () => {
    const r = (await founder.get('/home-layout/roles')).body.data;
    expect(r.roles.map((x: { role: string }) => x.role)).not.toContain('DEVELOPER');
    expect(r.roles).toHaveLength(11);
    const exec = r.roles.find((x: { role: string }) => x.role === 'SALES_EXECUTIVE');
    const hr = r.roles.find((x: { role: string }) => x.role === 'HR');
    expect(exec.customised).toBe(true);
    expect(exec.applicable).toEqual(expect.arrayContaining(['attendance', 'goal', 'followups', 'quickActions']));
    expect(hr.customised).toBe(false);
    expect(hr.applicable).not.toContain('followups');
  });

  it('reset returns the role to the default', async () => {
    expect((await founder.delete('/home-layout/roles/SALES_EXECUTIVE')).status).toBe(200);
    expect((await execA1.get('/home-layout')).body.data.source).toBe('DEFAULT');
  });
});
