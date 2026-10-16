import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyOverrides } from '../../src/common/authz/principal.loader';
import { buildOrgFixture, createUser, createTestApp, loginAgent, type OrgFixture, type TestApp } from '../helpers';

let t: TestApp;
let fx: OrgFixture;
let dev: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  dev = await createUser(t.prisma, fx.org, { roles: ['DEVELOPER'] });
});
afterAll(async () => {
  await t.close();
});

const role = (subject: string) => ({ subjectType: 'ROLE', subject });
const user = (id: string) => ({ subjectType: 'USER', subject: id });
const row = (res: { body: { data: { permissions: Array<{ key: string }> } } }, key: string) => res.body.data.permissions.find((p) => p.key === key) as Record<string, unknown>;

describe('applyOverrides (pure)', () => {
  it('DENY removes a role grant, GRANT adds one, devpanel keys and DEVELOPER are never changed', () => {
    const denied = applyOverrides(['SALES_EXECUTIVE'], [{ subjectType: 'ROLE', subjectKey: 'SALES_EXECUTIVE', permissionKey: 'leads:view', effect: 'DENY', scope: null }]);
    expect(denied.has('leads:view')).toBe(false);
    const granted = applyOverrides(['FINANCE'], [{ subjectType: 'ROLE', subjectKey: 'FINANCE', permissionKey: 'xf-tasks:view', effect: 'GRANT', scope: 'own' }]);
    expect(granted.get('xf-tasks:view')).toBe('own');
    const dev1 = applyOverrides(['DEVELOPER'], [{ subjectType: 'ROLE', subjectKey: 'DEVELOPER', permissionKey: 'devpanel:access', effect: 'DENY', scope: null }]);
    expect(dev1.has('devpanel:access')).toBe(true);
    const smuggled = applyOverrides(['ADMIN'], [{ subjectType: 'ROLE', subjectKey: 'ADMIN', permissionKey: 'devpanel:access', effect: 'GRANT', scope: 'org' }]);
    expect(smuggled.has('devpanel:access')).toBe(false);
  });

  it('a deny on one role does not remove the same permission another held role grants; a user deny wins over everything', () => {
    const rows = [{ subjectType: 'ROLE', subjectKey: 'SALES_EXECUTIVE', permissionKey: 'goals:view', effect: 'DENY', scope: null }];
    expect(applyOverrides(['SALES_EXECUTIVE', 'HR'], rows).has('goals:view')).toBe(true);
    const userDeny = [...rows, { subjectType: 'USER', subjectKey: 'u1', permissionKey: 'goals:view', effect: 'DENY', scope: null }];
    expect(applyOverrides(['SALES_EXECUTIVE', 'HR'], userDeny, 'u1').has('goals:view')).toBe(false);
  });
});

describe('Developer Panel / feature access', () => {
  it('turning a feature OFF for a role removes it for that role only, and turning it back to default restores it', async () => {
    const a = await loginAgent(t.app, dev);
    const exec = await loginAgent(t.app, fx.execA1);
    const mgr = await loginAgent(t.app, fx.managerA);
    expect((await exec.get('/leads')).status).toBe(200);

    const off = await a.put('/dev-panel/features').send({ ...role('SALES_EXECUTIVE'), changes: [{ permissionKey: 'leads:view', state: 'OFF' }] });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(row(off, 'leads:view')).toMatchObject({ default: 'own', override: { effect: 'DENY' }, effective: null });
    expect((await exec.get('/leads')).status).toBe(403);
    expect((await mgr.get('/leads')).status).toBe(200); // other roles untouched

    const back = await a.put('/dev-panel/features').send({ ...role('SALES_EXECUTIVE'), changes: [{ permissionKey: 'leads:view', state: 'DEFAULT' }] });
    expect(back.status).toBe(200);
    expect(row(back, 'leads:view')).toMatchObject({ override: null, effective: 'own' });
    expect((await exec.get('/leads')).status).toBe(200);
  });

  it('turning a feature ON gives it to a role that did not have it, and /auth/me shows it', async () => {
    const a = await loginAgent(t.app, dev);
    const fin = await loginAgent(t.app, fx.finance);
    expect((await fin.get('/collaboration/plan-links')).status).toBe(403);
    const on = await a.put('/dev-panel/features').send({ ...role('FINANCE'), changes: [{ permissionKey: 'xf-tasks:view', state: 'ON', scope: 'org' }] });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(row(on, 'xf-tasks:view')).toMatchObject({ default: null, override: { effect: 'GRANT', scope: 'org' }, effective: 'org' });
    expect((await fin.get('/collaboration/plan-links')).status).toBe(200);
    const me = await fin.get('/auth/me');
    expect(JSON.stringify(me.body)).toContain('xf-tasks:view');
    await a.post('/dev-panel/features/reset').send(role('FINANCE'));
    expect((await fin.get('/collaboration/plan-links')).status).toBe(403);
  });

  it('a per-user override affects only that user', async () => {
    const a = await loginAgent(t.app, dev);
    const one = await loginAgent(t.app, fx.execA1);
    const two = await loginAgent(t.app, fx.execA2);
    const res = await a.put('/dev-panel/features').send({ ...user(fx.execA1.id), changes: [{ permissionKey: 'goals:view', state: 'OFF' }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await one.get('/workforce/goals/summary')).status).toBe(403);
    expect((await two.get('/workforce/goals/summary')).status).toBe(200);
    const eff = await a.get(`/dev-panel/access/matrix/user/${fx.execA1.id}`);
    expect(eff.body.data.permissions.some((p: { key: string }) => p.key === 'goals:view')).toBe(false);
    await a.post('/dev-panel/features/reset').send(user(fx.execA1.id));
    expect((await one.get('/workforce/goals/summary')).status).toBe(200);
  });

  it('protects devpanel features, the Developer role, your own access, unknown keys and other organisations', async () => {
    const a = await loginAgent(t.app, dev);
    const put = (body: object) => a.put('/dev-panel/features').send(body);
    expect((await put({ ...role('ADMIN'), changes: [{ permissionKey: 'devpanel:access', state: 'ON', scope: 'org' }] })).status).toBe(409);
    expect((await put({ ...role('DEVELOPER'), changes: [{ permissionKey: 'leads:view', state: 'ON' }] })).status).toBe(409);
    expect((await put({ ...user(dev.id), changes: [{ permissionKey: 'leads:view', state: 'ON' }] })).status).toBe(403);
    expect((await put({ ...role('ADMIN'), changes: [{ permissionKey: 'nope:nope', state: 'ON' }] })).status).toBe(422);
    expect((await put({ ...role('NOT_A_ROLE'), changes: [{ permissionKey: 'leads:view', state: 'ON' }] })).status).toBe(422);
    expect((await put({ ...role('ADMIN'), changes: [] })).status).toBe(400);
    const other = await buildOrgFixture(t.prisma);
    expect((await put({ ...user(other.execA1.id), changes: [{ permissionKey: 'leads:view', state: 'OFF' }] })).status).toBe(404);
    // the Developer keeps its panel access whatever is stored
    expect((await a.get('/dev-panel/features/summary')).status).toBe(200);
  });

  it('granting a sensitive feature needs explicit confirmation and is audited with before/after', async () => {
    const a = await loginAgent(t.app, dev);
    const body = { ...role('ADMIN'), changes: [{ permissionKey: 'payroll:run:view', state: 'ON', scope: 'org' }] };
    const refused = await a.put('/dev-panel/features').send(body);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('CONFIRM_SENSITIVE');
    const ok = await a.put('/dev-panel/features').send({ ...body, confirmSensitive: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const log = await t.prisma.auditLog.findFirst({ where: { organizationId: fx.org.id, action: 'devpanel.features_changed' }, orderBy: { createdAt: 'desc' } });
    expect(log?.actorId).toBe(dev.id);
    expect(JSON.stringify(log?.metadata)).toContain('payroll:run:view');
    expect(JSON.stringify(log?.metadata)).toContain('DEFAULT');
    const summary = await a.get('/dev-panel/features/summary');
    expect(summary.body.data.subjects.find((s: { key: string }) => s.key === 'ADMIN')).toMatchObject({ type: 'ROLE', grants: 1 });
    expect((await a.post('/dev-panel/features/reset').send(role('ADMIN'))).body.data.removed).toBe(1);
  });

  it('turning ON what the role already has by default stores nothing', async () => {
    const a = await loginAgent(t.app, dev);
    const r = await a.put('/dev-panel/features').send({ ...role('SALES_EXECUTIVE'), changes: [{ permissionKey: 'leads:view', state: 'ON', scope: 'own' }] });
    expect(r.status).toBe(200);
    expect(r.body.data.overrides).toBe(0);
  });
});
