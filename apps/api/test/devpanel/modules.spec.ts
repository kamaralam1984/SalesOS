import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moduleOfPermission, resolveModuleStates, stripDisabledModules } from '../../src/common/authz/modules';
import { buildOrgFixture, createUser, createTestApp, loginAgent, type OrgFixture, type TestApp } from '../helpers';

let t: TestApp;
let fx: OrgFixture;
let dev: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  dev = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
  // a real organisation that never touched the switches: defaults apply
  await t.prisma.platformSetting.deleteMany({ where: { organizationId: fx.org.id, key: 'modules' } });
});
afterAll(async () => {
  await t.close();
});

const state = (res: { body: { data: { modules: Array<{ key: string; enabled: boolean }> } } }, key: string) => res.body.data.modules.find((m) => m.key === key)?.enabled;

describe('module registry (pure)', () => {
  it('attendance is OFF by default, the rest ON; unknown stored keys are ignored', () => {
    const s = resolveModuleStates({ payroll: false, bogus: true });
    expect(s.attendance).toBe(false);
    expect(s.payroll).toBe(false);
    expect(s.leave).toBe(true);
    expect('bogus' in s).toBe(false);
  });

  it('only module keys are stripped: Sales/CRM core and devpanel keys are never owned by a module', () => {
    for (const k of ['leads:view', 'calls:create', 'tasks:update', 'deals:create', 'collections:view', 'refunds:view', 'targets:view', 'dashboard:view', 'devpanel:features:manage']) {
      expect(moduleOfPermission(k), k).toBeUndefined();
    }
    expect(moduleOfPermission('attendance:self')?.key).toBe('attendance');
    const m = stripDisabledModules(new Map([['leads:view', 'org'], ['attendance:view', 'org'], ['payroll:run:view', 'org']]), { attendance: false, payroll: true });
    expect([...m.keys()]).toEqual(['leads:view', 'payroll:run:view']);
  });
});

describe('Developer Panel / modules', () => {
  it('attendance is hidden by default for everyone, including the Developer; the Sales core keeps working', async () => {
    const exec = await loginAgent(t.app, fx.execA1);
    const a = await loginAgent(t.app, dev);
    expect((await exec.get('/workforce/attendance/today')).status).toBe(403);
    expect((await a.get('/workforce/attendance/today')).status).toBe(403);
    expect((await exec.get('/leads')).status).toBe(200);
    const me = await exec.get('/auth/me');
    expect(JSON.stringify(me.body.data)).not.toContain('attendance:');
    const list = await a.get('/dev-panel/features/modules');
    expect(list.status).toBe(200);
    expect(state(list, 'attendance')).toBe(false);
    expect(state(list, 'payroll')).toBe(true);
  });

  it('only the Developer can see or change modules', async () => {
    for (const u of [fx.execA1, fx.managerA]) {
      const agent = await loginAgent(t.app, u);
      expect((await agent.get('/dev-panel/features/modules')).status).toBe(403);
      expect((await agent.put('/dev-panel/features/modules/attendance').send({ enabled: true })).status).toBe(403);
    }
  });

  it('switching Attendance ON restores it, OFF hides it again, and each change is audited', async () => {
    const a = await loginAgent(t.app, dev);
    const exec = await loginAgent(t.app, fx.execA1);
    const on = await a.put('/dev-panel/features/modules/attendance').send({ enabled: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(state(on, 'attendance')).toBe(true);
    expect((await exec.get('/workforce/attendance/today')).status).toBe(200);

    const off = await a.put('/dev-panel/features/modules/attendance').send({ enabled: false });
    expect(state(off, 'attendance')).toBe(false);
    expect((await exec.get('/workforce/attendance/today')).status).toBe(403);

    const audits = await t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, action: 'devpanel.module_toggled' }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((x) => (x.metadata as { to: boolean }).to)).toEqual([true, false]);
  });

  it('an unknown module is rejected and a no-op change writes no audit row', async () => {
    const a = await loginAgent(t.app, dev);
    expect((await a.put('/dev-panel/features/modules/not-a-module').send({ enabled: true })).status).toBe(422);
    expect((await a.put('/dev-panel/features/modules/attendance').send({ enabled: 'yes' })).status).toBe(400);
    const before = await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'devpanel.module_toggled' } });
    await a.put('/dev-panel/features/modules/attendance').send({ enabled: false });
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'devpanel.module_toggled' } })).toBe(before);
  });
});
