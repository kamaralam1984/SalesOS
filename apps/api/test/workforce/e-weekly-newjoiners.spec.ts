import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDay } from '@salesos/workforce-core';
import { buildOrgFixture, createTestApp, createUser, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

/** Weekly progress and the 90-day new joiner report: real Postgres, real HTTP pipeline, scoped by role. */
let t: TestApp;
let fx: OrgFixture;
let hr: AuthedAgent;
let founder: AuthedAgent;
let mgrA: AuthedAgent;
let exec: AuthedAgent;
const today = localDay(new Date(), 'Asia/Kolkata');
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  [hr, founder, mgrA, exec] = [await loginAgent(t.app, fx.hr), await loginAgent(t.app, fx.founder), await loginAgent(t.app, fx.managerA), await loginAgent(t.app, fx.execA1)];
});
afterAll(async () => { await t.close(); });

const rowOf = (res: { body: { data: { rows: Array<Record<string, unknown>> } } }, name: string) => res.body.data.rows.find((r) => r.employee === name);

describe('weekly progress report', () => {
  it('shows attendance, late joins, the own day report, tasks and goal progress per person for the week; scoped by role', async () => {
    const week = addDays(today, 0);
    await t.prisma.attendanceRecord.create({ data: { organizationId: fx.org.id, userId: fx.execA1.id, date: d(week), status: 'LATE', source: 'SELF', lateMinutes: 30, lateJoin: true, dayReportPct: 80 } });
    const mkTask = (status: 'COMPLETED' | 'IN_PROGRESS', extra: object = {}) =>
      t.prisma.workTask.create({ data: { organizationId: fx.org.id, title: `Task ${status}`, assignerId: fx.managerA.id, assigneeId: fx.execA1.id, status, completedAt: status === 'COMPLETED' ? new Date() : null, ...extra } });
    await mkTask('COMPLETED');
    await mkTask('COMPLETED');
    await mkTask('IN_PROGRESS', { dueAt: new Date(Date.now() - 3_600_000) });
    await t.prisma.goal.create({ data: { organizationId: fx.org.id, ownerId: fx.execA1.id, createdById: fx.execA1.id, title: 'G', startDate: d(addDays(today, -5)), targetDate: d(addDays(today, 40)), cycleDays: 45, progressPct: 40 } });

    const res = await hr.get(`/workforce/reports/weekly-progress?from=${addDays(today, -6)}&to=${today}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.title).toContain('Weekly progress');
    const row = rowOf(res, fx.execA1.name)!;
    expect(row).toMatchObject({ lateDays: 1, lateJoinDays: 1, reportsFilled: 1, avgDayReportPct: 80, tasks: 3, tasksDone: 2, taskCompletionPct: 66.7, tasksOverdue: 1, goalsActive: 1, avgGoalProgressPct: 40 });
    // a manager sees only their team, an executive has no reports at all
    const m = await mgrA.get(`/workforce/reports/weekly-progress?from=${addDays(today, -6)}&to=${today}`);
    expect(m.status).toBe(200);
    expect(rowOf(m, fx.execB1.name)).toBeUndefined();
    expect(rowOf(m, fx.execA1.name)).toBeDefined();
    expect((await exec.get('/workforce/reports/weekly-progress')).status).toBe(403);
  });

  it('exports to Excel for HR (audited)', async () => {
    const before = await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'export.created' } });
    const res = await hr.get('/workforce/reports/weekly-progress/export?format=xlsx').buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('weekly-progress');
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'export.created' } })).toBe(before + 1);
  });
});

describe('new joiner 90-day report', () => {
  it('lists people who joined in the last 90 days with day N, training, tasks, attendance and goals', async () => {
    const joiner = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    const joined = addDays(today, -9);
    await t.prisma.employeeProfile.create({ data: { organizationId: fx.org.id, userId: joiner.id, joinDate: d(joined), positionTitle: 'Sales Executive' } });
    const plan = await t.prisma.onboardingPlan.create({ data: { organizationId: fx.org.id, employeeId: joiner.id, startDate: d(joined), createdById: fx.hr.id } });
    await t.prisma.onboardingItem.createMany({ data: [
      { organizationId: fx.org.id, planId: plan.id, title: 'Product training', status: 'DONE' },
      { organizationId: fx.org.id, planId: plan.id, title: 'Shadow a call', status: 'PENDING' },
    ] });
    await t.prisma.workTask.create({ data: { organizationId: fx.org.id, title: 'First task', assignerId: fx.hr.id, assigneeId: joiner.id, status: 'COMPLETED', completedAt: new Date() } });
    await t.prisma.workTask.create({ data: { organizationId: fx.org.id, title: 'Second task', assignerId: fx.hr.id, assigneeId: joiner.id, status: 'ASSIGNED' } });
    await t.prisma.attendanceRecord.create({ data: { organizationId: fx.org.id, userId: joiner.id, date: d(addDays(today, -1)), status: 'PRESENT', source: 'SELF', dayReportPct: 100 } });
    await t.prisma.probationReview.create({ data: { organizationId: fx.org.id, employeeId: joiner.id, checkpointDay: 30, dueDate: d(addDays(joined, 30)) } });

    const res = await hr.get('/workforce/reports/new-joiners');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = rowOf(res, joiner.name)!;
    expect(row).toMatchObject({ day: 10, daysLeftOf90: 80, onboardingItems: 2, onboardingDonePct: 50, tasks: 2, tasksDone: 1, taskCompletionPct: 50, attendancePct: 100, avgDayReportPct: 100, nextReview: 'Day 30 review', position: 'Sales Executive' });
    // someone who joined long ago is not listed
    expect(rowOf(res, fx.execB1.name)).toBeUndefined();
    expect((await founder.get('/workforce/reports/new-joiners')).status).toBe(200);
    expect((await exec.get('/workforce/reports/new-joiners')).status).toBe(403);
  });
});

describe('joining a new employee (HR and the Boss)', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    name: 'Nitin New', email: `nitin.${Math.random().toString(36).slice(2, 8)}@example.test`, roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id, department: 'Sales', positionTitle: 'Sales Executive (Telecaller)',
    tasks: [{ title: 'Complete product training', dueDay: 7, priority: 'HIGH' }, { title: 'Log your first 20 follow-up calls', dueDay: 21 }], ...over,
  });

  it('HR joins an employee in one step: a pending account (the link comes when someone else approves it), HR record, 90-day plan with 30/60/90 reviews and the first tasks', async () => {
    const res = await hr.post('/workforce/hr/joiners').send(body({ joinDate: today }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const d = res.body.data;
    expect(d).toMatchObject({ planItems: 12, reviewDays: [30, 60, 90], tasks: 2, positionTitle: 'Sales Executive (Telecaller)' });
    expect(d.pendingApproval).toBe(true);
    expect(d.invite).toBeNull();
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: d.userId }, include: { roleAssignments: { include: { role: true } } } });
    expect(user.managerId).toBe(fx.managerA.id);
    expect(user.approvalStatus).toBe('PENDING');
    expect(user.createdById).toBe(fx.hr.id);
    expect(user.roleAssignments.map((r) => r.role.key)).toEqual(['SALES_EXECUTIVE']);
    const profile = await t.prisma.employeeProfile.findUniqueOrThrow({ where: { userId: d.userId } });
    expect(profile.positionTitle).toBe('Sales Executive (Telecaller)');
    expect(profile.probationEndDate).not.toBeNull();
    expect(await t.prisma.probationReview.count({ where: { employeeId: d.userId } })).toBe(3);
    const items = await t.prisma.onboardingItem.findMany({ where: { plan: { employeeId: d.userId } }, orderBy: { dueDate: 'asc' } });
    expect(items).toHaveLength(12);
    expect(items[items.length - 1]!.dueDate!.toISOString().slice(0, 10)).toBe(addDays(today, 89));
    const tasks = await t.prisma.workTask.findMany({ where: { assigneeId: d.userId } });
    expect(tasks.map((x) => x.assignerId)).toEqual([fx.hr.id, fx.hr.id]);
    expect(tasks.every((x) => x.status === 'ASSIGNED' && x.project === '90-day plan')).toBe(true);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'joiner.created', entityId: d.userId } })).toBe(1);
    // the new joiner then shows up in the 90-day report, with the first tasks counted
    const rep = await hr.get('/workforce/reports/new-joiners');
    expect(rowOf(rep, 'Nitin New')).toMatchObject({ day: 1, tasks: 2, tasksDone: 0, onboardingItems: 12 });
    // the second joining of the same plan template reuses it
    await hr.post('/workforce/hr/joiners').send(body({ name: 'Second Joiner' }));
    expect(await t.prisma.onboardingTemplate.count({ where: { organizationId: fx.org.id, roleKey: 'ALL' } })).toBe(1);
  });

  it('the Founder can join someone too; HR cannot hand out leadership or HR/Finance roles, the Founder can; duplicates and bad managers are refused', async () => {
    expect((await founder.post('/workforce/hr/joiners').send(body({ name: 'Founder Joined' }))).status).toBe(201);
    const lead = await hr.post('/workforce/hr/joiners').send(body({ roles: ['SALES_TEAM_LEAD'] }));
    expect(lead.status).toBe(403);
    expect((await hr.post('/workforce/hr/joiners').send(body({ roles: ['HR'] }))).status).toBe(403);
    expect((await hr.post('/workforce/hr/joiners').send(body({ roles: ['DEVELOPER'] }))).status).toBe(403);
    expect((await founder.post('/workforce/hr/joiners').send(body({ roles: ['SALES_TEAM_LEAD'] }))).status).toBe(201);
    const dup = body();
    expect((await hr.post('/workforce/hr/joiners').send(dup)).status).toBe(201);
    expect((await hr.post('/workforce/hr/joiners').send(dup)).body.error.code).toBe('EMAIL_TAKEN');
    const bad = body({ managerId: '11111111-1111-4111-8111-111111111111' });
    expect((await hr.post('/workforce/hr/joiners').send(bad)).body.error.code).toBe('INVALID_MANAGER');
    // nothing half-created: the refused attempts left no account behind
    expect(await t.prisma.user.count({ where: { email: bad.email as string } })).toBe(0);
  });

  it('options list only roles the caller may give; managers and templates; others get 403', async () => {
    const h = (await hr.get('/workforce/hr/joiners/options')).body.data;
    expect(h.roles).toEqual(expect.arrayContaining(['SALES_EXECUTIVE', 'SALES_MANAGER']));
    expect(h.roles).not.toContain('HR');
    expect(h.roles).not.toContain('DEVELOPER');
    expect(h.managers.length).toBeGreaterThan(0);
    const f = (await founder.get('/workforce/hr/joiners/options')).body.data;
    expect(f.roles).toEqual(expect.arrayContaining(['SALES_TEAM_LEAD', 'HR', 'FINANCE']));
    expect((await exec.get('/workforce/hr/joiners/options')).status).toBe(403);
    expect((await mgrA.post('/workforce/hr/joiners').send(body())).status).toBe(403);
  });
});
