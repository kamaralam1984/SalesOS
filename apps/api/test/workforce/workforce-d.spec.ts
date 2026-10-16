import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, addMonths, localDay } from '@salesos/workforce-core';
import { buildOrgFixture, createOrg, createTeam, createUser, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

/** Workforce area D (directory, Employee 360, org chart, dashboard, announcements, HR profile, birthdays, probation, reports). Real Postgres. */
let t: TestApp;
let fx: OrgFixture;
let hr: AuthedAgent;
let exec: AuthedAgent;
let execB: AuthedAgent;
let mgrA: AuthedAgent;
let founder: AuthedAgent;
let admin: AuthedAgent;
let other: { id: string };
const today = localDay(new Date(), 'Asia/Kolkata');
const md = (day: string) => day.slice(5);

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  [hr, exec, execB, mgrA, founder, admin] = await Promise.all([fx.hr, fx.execA1, fx.execB1, fx.managerA, fx.founder, fx.admin].map((u) => loginAgent(t.app, u)));
  const org = fx.org.id;
  await t.prisma.user.update({ where: { id: fx.execA1.id }, data: { department: 'Sales' } });
  await t.prisma.user.update({ where: { id: fx.execA2.id }, data: { department: 'Sales' } });
  await t.prisma.user.update({ where: { id: fx.execB1.id }, data: { department: 'Support' } });
  await t.prisma.employeeProfile.create({ data: { organizationId: org, userId: fx.execA1.id, employeeCode: 'EMP-A1', positionTitle: 'Telecaller', joinDate: new Date(`${addDays(today, -80)}T00:00:00Z`), probationEndDate: new Date(`${addDays(today, 10)}T00:00:00Z`), probationMonths: 3, dateOfBirth: new Date(`1990-${md(addDays(today, 3))}T00:00:00Z`), shareBirthday: true } });
  await t.prisma.employeeProfile.create({ data: { organizationId: org, userId: fx.execA2.id, employeeCode: 'EMP-A2', positionTitle: 'Telecaller', joinDate: new Date(`${addDays(today, -400)}T00:00:00Z`), dateOfBirth: new Date(`1991-${md(addDays(today, 4))}T00:00:00Z`), shareBirthday: false } });
  const o2 = await createOrg(t.prisma);
  other = await createUser(t.prisma, o2, { roles: ['SALES_EXECUTIVE'] });
});
afterAll(async () => { await t.close(); });

describe('D1 directory', () => {
  it('lists org-wide minimum data, never contact/DOB, bounded and org-scoped', async () => {
    const res = await exec.get('/workforce/directory?limit=100');
    expect(res.status).toBe(200);
    const items = res.body.data as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(5);
    expect(items.some((i) => i.id === other.id)).toBe(false);
    for (const i of items) expect(Object.keys(i).sort()).toEqual(['department', 'designation', 'employeeCode', 'id', 'manager', 'name', 'status']);
    const a1 = items.find((i) => i.id === fx.execA1.id)!;
    expect(a1).toMatchObject({ employeeCode: 'EMP-A1', designation: 'Telecaller', department: 'Sales', status: 'PROBATION' });
    expect((await exec.get('/workforce/directory?limit=101')).status).toBe(400);
  });
  it('filters by search, department and status; search text is not a pattern', async () => {
    const s = await exec.get('/workforce/directory?search=EMP-A2');
    expect(s.body.data.map((i: { id: string }) => i.id)).toEqual([fx.execA2.id]);
    const d = await exec.get('/workforce/directory?department=Support');
    expect(d.body.data.map((i: { id: string }) => i.id)).toEqual([fx.execB1.id]);
    const p = await exec.get('/workforce/directory?status=PROBATION');
    expect(p.body.data.map((i: { id: string }) => i.id)).toEqual([fx.execA1.id]);
    const pattern = await exec.get('/workforce/directory?search=%25');
    expect(pattern.body.data).toHaveLength(0);
  });
  it('hides exited employees unless asked', async () => {
    await t.prisma.employeeProfile.create({ data: { organizationId: fx.org.id, userId: fx.execB2.id, exitDate: new Date(`${addDays(today, -1)}T00:00:00Z`) } });
    const all = await exec.get('/workforce/directory?limit=100');
    expect(all.body.data.some((i: { id: string }) => i.id === fx.execB2.id)).toBe(false);
    const ex = await exec.get('/workforce/directory?status=EXITED');
    expect(ex.body.data.map((i: { id: string }) => i.id)).toContain(fx.execB2.id);
  });
});

describe('D1 Employee 360', () => {
  it('guards each section by the viewer permission and scope', async () => {
    const peer = (await exec.get(`/workforce/directory/${fx.execA2.id}`)).body.data;
    expect(peer.profile).toMatchObject({ available: true, name: fx.execA2.name, employeeCode: 'EMP-A2', email: null });
    expect(peer.hr.available).toBe(false);
    expect(peer.attendance.available).toBe(false);
    expect(peer.leave.available).toBe(false);
    expect(peer.performance.available).toBe(false);
    expect(JSON.stringify(peer)).not.toContain('1991');

    const self = (await exec.get(`/workforce/directory/${fx.execA1.id}`)).body.data;
    expect(self.attendance.available).toBe(true);
    expect(self.leave.available).toBe(true);
    expect(self.performance.available).toBe(true);
    expect(self.probation.available).toBe(true);
    expect(self.profile.email).toBe(fx.execA1.email);

    const asMgr = (await mgrA.get(`/workforce/directory/${fx.execA1.id}`)).body.data;
    expect(asMgr.attendance.available).toBe(true);
    expect(asMgr.hr.available).toBe(false);
    const mgrOther = (await mgrA.get(`/workforce/directory/${fx.execB1.id}`)).body.data;
    expect(mgrOther.attendance.available).toBe(false);

    const asHr = (await hr.get(`/workforce/directory/${fx.execA1.id}`)).body.data;
    expect(asHr.hr.available).toBe(true);
    expect(asHr.probation).toMatchObject({ available: true, hasData: true, status: 'ON_PROBATION' });
  });
  it('returns 404 across organisations and for unknown ids', async () => {
    expect((await exec.get(`/workforce/directory/${other.id}`)).status).toBe(404);
    expect((await exec.get('/workforce/directory/not-a-uuid')).status).toBe(400);
  });
});

describe('D1 org chart', () => {
  it('builds the tree from managerId for the organisation, department and team views', async () => {
    const org = (await exec.get('/workforce/org-chart')).body.data;
    expect(org.roots.map((r: { id: string }) => r.id)).toContain(fx.founder.id);
    const founderNode = org.roots.find((r: { id: string }) => r.id === fx.founder.id);
    expect(founderNode.children.map((c: { id: string }) => c.id)).toContain(fx.teamLead.id);
    expect(JSON.stringify(org)).not.toContain(other.id);
    const dep = (await exec.get('/workforce/org-chart?view=department&department=Sales')).body.data;
    expect(dep.total).toBe(2);
    const team = (await exec.get(`/workforce/org-chart?view=team&teamId=${fx.teamA.id}`)).body.data;
    expect(team.team.name).toBe('Team A');
    expect((await exec.get('/workforce/org-chart?view=bogus')).status).toBe(400);
  });
  it('rejects a team id from another organisation', async () => {
    const o2 = await createOrg(t.prisma);
    const tm = await createTeam(t.prisma, o2, 'Foreign');
    expect((await exec.get(`/workforce/org-chart?view=team&teamId=${tm.id}`)).status).toBe(404);
  });
});

describe('D1 dashboard', () => {
  it('returns blocks by scope', async () => {
    const e = (await exec.get('/workforce/dashboard')).body.data;
    expect(e.scopeLevel).toBe('own');
    expect(e.employee).toBeTruthy();
    expect(e.team).toBeNull();
    expect(e.organisation).toBeNull();
    const m = (await mgrA.get('/workforce/dashboard')).body.data;
    expect(m.team).toBeTruthy();
    expect(m.organisation).toBeNull();
    const h = (await hr.get('/workforce/dashboard')).body.data;
    expect(h.scopeLevel).toBe('org');
    expect(h.organisation).toBeTruthy();
  });
  it('gives Admin only the own-employee block (no team or organisation data)', async () => {
    const a = (await admin.get('/workforce/dashboard')).body.data;
    expect(a.scopeLevel).toBe('own');
    expect(a.team).toBeNull();
    expect(a.organisation).toBeNull();
  });
});

describe('D1 announcements', () => {
  let id: string;
  it('HR publishes: audited, outbox notification without narrative, validated', async () => {
    const bad = await hr.post('/workforce/announcements').send({ title: 'x', body: 'y', audienceRoles: ['NOPE'] });
    expect(bad.status).toBe(400);
    const past = await hr.post('/workforce/announcements').send({ title: 'Old news', body: 'y', expiresAt: '2020-01-01T00:00:00Z' });
    expect(past.status).toBe(400);
    const res = await hr.post('/workforce/announcements').send({ title: 'Office closed Friday', body: 'Secret narrative text', audienceRoles: [] });
    expect(res.status).toBe(201);
    id = res.body.data.id;
    const audit = await t.prisma.auditLog.findFirst({ where: { organizationId: fx.org.id, action: 'announcement.published', entityId: id } });
    expect(audit).toBeTruthy();
    const ob = await t.prisma.outboxEvent.findFirst({ where: { organizationId: fx.org.id, aggregateId: id, eventType: 'notification.requested' } });
    expect(ob).toBeTruthy();
    expect(JSON.stringify(ob!.payload)).not.toContain('Secret narrative');
  });
  it('everyone in the audience reads it; audience-limited ones are hidden from others; expired are hidden', async () => {
    const hidden = await hr.post('/workforce/announcements').send({ title: 'Finance only', body: 'z', audienceRoles: ['FINANCE'] });
    const list = (await exec.get('/workforce/announcements')).body.data as Array<{ id: string }>;
    expect(list.map((a) => a.id)).toContain(id);
    expect(list.map((a) => a.id)).not.toContain(hidden.body.data.id);
    const exp = await t.prisma.announcement.create({ data: { organizationId: fx.org.id, title: 'Expired one', body: 'b', audienceRoles: [], expiresAt: new Date(Date.now() - 1000), createdById: fx.hr.id } });
    expect(((await exec.get('/workforce/announcements')).body.data as Array<{ id: string }>).map((a) => a.id)).not.toContain(exp.id);
    expect(((await hr.get('/workforce/announcements?include=all')).body.data as Array<{ id: string }>).map((a) => a.id)).toContain(exp.id);
  });
  it('only managers delete; delete is audited; cross-org id is 404', async () => {
    expect((await exec.delete(`/workforce/announcements/${id}`)).status).toBe(403);
    expect((await hr.delete(`/workforce/announcements/${other.id}`)).status).toBe(404);
    expect((await hr.delete(`/workforce/announcements/${id}`)).status).toBe(200);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'announcement.deleted', entityId: id } })).toBe(1);
  });
});

describe('D2 HR profile', () => {
  it('HR reads (audited) and patches; probation end follows join date + months', async () => {
    const get = await hr.get(`/workforce/hr/profiles/${fx.execA2.id}`);
    expect(get.status).toBe(200);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'hr.record_viewed', entityType: 'employee_profile' } })).toBeGreaterThan(0);
    const join = addDays(today, -20);
    const patch = await hr.patch(`/workforce/hr/profiles/${fx.execA2.id}`).send({ joinDate: join, probationMonths: 6, workLocation: 'Pune', employeeCode: 'EMP-A2X' });
    expect(patch.status).toBe(200);
    const row = await t.prisma.employeeProfile.findUnique({ where: { userId: fx.execA2.id } });
    expect(row!.probationEndDate!.toISOString().slice(0, 10)).toBe(addMonths(join, 6));
    expect(row!.workLocation).toBe('Pune');
  });
  it('validates input and rejects non-HR and cross-org targets', async () => {
    expect((await hr.patch(`/workforce/hr/profiles/${fx.execA2.id}`).send({})).status).toBe(400);
    expect((await hr.patch(`/workforce/hr/profiles/${fx.execA2.id}`).send({ dateOfBirth: addDays(today, 5) })).status).toBe(400);
    expect((await hr.patch(`/workforce/hr/profiles/${fx.execA2.id}`).send({ probationMonths: 99 })).status).toBe(400);
    expect((await hr.patch(`/workforce/hr/profiles/${fx.execA2.id}`).send({ role: 'FOUNDER_CEO' })).status).toBe(400);
    expect((await mgrA.get(`/workforce/hr/profiles/${fx.execA2.id}`)).status).toBe(403);
    expect((await exec.patch(`/workforce/hr/profiles/${fx.execA1.id}`).send({ shareBirthday: true })).status).toBe(403);
    expect((await hr.patch(`/workforce/hr/profiles/${other.id}`).send({ workLocation: 'x' })).status).toBe(404);
    expect((await admin.get(`/workforce/hr/profiles/${fx.execA1.id}`)).status).toBe(403);
  });
});

describe('D2 birthdays', () => {
  it('HR sees all upcoming with a share flag and no birth year', async () => {
    const res = await hr.get('/workforce/hr/birthdays?days=30');
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((i: { userId: string }) => i.userId);
    expect(ids).toEqual(expect.arrayContaining([fx.execA1.id, fx.execA2.id]));
    expect(JSON.stringify(res.body)).not.toMatch(/1990|1991/);
    expect((await hr.get('/workforce/hr/birthdays?days=0')).status).toBe(400);
  });
  it('team list shows only people who agreed to share, day and month only', async () => {
    const res = await execB.get('/workforce/birthdays/upcoming?days=30');
    expect(res.status).toBe(200);
    expect(res.body.data.items.some((i: { userId: string }) => i.userId === fx.execA2.id)).toBe(false);
    const own = await mgrA.get('/workforce/birthdays/upcoming?days=30');
    const a1 = own.body.data.items.find((i: { userId: string }) => i.userId === fx.execA1.id);
    expect(a1).toBeTruthy();
    expect(Object.keys(a1).sort()).toEqual(['day', 'daysUntil', 'department', 'month', 'name', 'nextDate', 'userId']);
    expect(JSON.stringify(own.body)).not.toMatch(/1990/);
    expect(execB && (await execB.get('/workforce/birthdays/upcoming')).body.data.items.some((i: { userId: string }) => i.userId === fx.execA1.id)).toBe(false);
    expect((await exec.get('/workforce/hr/birthdays')).status).toBe(403);
  });
});

describe('D2 probation', () => {
  it('lists with state counts and honours the status filter', async () => {
    const res = await hr.get('/workforce/hr/probation?status=ALL&days=30');
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { userId: string }) => r.userId === fx.execA1.id);
    expect(row).toMatchObject({ state: 'ENDING_SOON', daysLeft: 10 });
    expect(res.body.meta.counts).toBeTruthy();
    const filtered = await hr.get('/workforce/hr/probation?status=ENDING_SOON');
    expect(filtered.body.data.every((r: { state: string }) => r.state === 'ENDING_SOON')).toBe(true);
    expect((await hr.get('/workforce/hr/probation?status=NOPE')).status).toBe(400);
  });
  it('team scope: a manager sees only their own team', async () => {
    const res = await mgrA.get('/workforce/hr/probation?status=ALL');
    expect(res.status).toBe(200);
    expect(res.body.data.every((r: { userId: string }) => r.userId !== fx.execB1.id)).toBe(true);
  });
  it('EXTEND needs months and a note; extending moves the end date and keeps history', async () => {
    const base = `/workforce/hr/probation/${fx.execA1.id}/decision`;
    expect((await hr.post(base).send({ decision: 'EXTEND', note: 'needs more time' })).status).toBe(400);
    expect((await hr.post(base).send({ decision: 'EXTEND', months: 2 })).status).toBe(400);
    expect((await hr.post(base).send({ decision: 'CONFIRM', months: 2 })).status).toBe(400);
    const res = await hr.post(base).send({ decision: 'EXTEND', months: 1, note: 'needs more time' });
    expect(res.status).toBe(200);
    expect(res.body.data.endDate > addDays(today, 10)).toBe(true);
    expect(res.body.data.extensions).toBe(1);
    const hist = await hr.get(`/workforce/hr/probation/${fx.execA1.id}/history`);
    expect(hist.body.data).toHaveLength(1);
    expect(hist.body.data[0]).toMatchObject({ decision: 'EXTEND', months: 1 });
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'probation.decision', entityType: 'probation_review' } })).toBeGreaterThan(0);
  });
  it('CONFIRM closes probation, the directory stops showing PROBATION, and a second decision is a conflict', async () => {
    const base = `/workforce/hr/probation/${fx.execA1.id}/decision`;
    const res = await hr.post(base).send({ decision: 'CONFIRM' });
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('CONFIRMED');
    expect((await hr.post(base).send({ decision: 'CONFIRM' })).status).toBe(409);
    const dir = await exec.get('/workforce/directory?limit=100');
    expect(dir.body.data.find((i: { id: string }) => i.id === fx.execA1.id).status).toBe('ACTIVE');
  });
  it('blocks self-decisions, out-of-scope managers and cross-org targets', async () => {
    const mgrSelf = await mgrA.post(`/workforce/hr/probation/${fx.managerA.id}/decision`).send({ decision: 'CONFIRM' });
    expect(mgrSelf.status).toBe(403);
    const cross = await mgrA.post(`/workforce/hr/probation/${fx.execB1.id}/decision`).send({ decision: 'MARK_FOR_REVIEW', note: 'concerns' });
    expect([403, 404]).toContain(cross.status);
    expect((await hr.post(`/workforce/hr/probation/${other.id}/decision`).send({ decision: 'CONFIRM' })).status).toBeGreaterThanOrEqual(403);
    expect((await exec.post(`/workforce/hr/probation/${fx.execA2.id}/decision`).send({ decision: 'CONFIRM' })).status).toBe(403);
  });
});

describe('D2 reports and exports', () => {
  beforeAll(async () => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    await t.prisma.attendanceRecord.createMany({
      data: [
        { organizationId: fx.org.id, userId: fx.execA1.id, date: d, status: 'PRESENT', source: 'SYSTEM' },
        { organizationId: fx.org.id, userId: fx.execB1.id, date: d, status: 'ABSENT', source: 'SYSTEM' },
      ] as never,
      skipDuplicates: true,
    });
  });
  it('returns rows and summary within the viewer scope', async () => {
    const q = `from=${today.slice(0, 7)}-01&to=${today}`;
    const h = await hr.get(`/workforce/reports/attendance?${q}`);
    expect(h.status).toBe(200);
    expect(h.body.data.rows.length).toBeGreaterThanOrEqual(2);
    expect(h.body.data.scopeLevel).toBe('org');
    const m = await mgrA.get(`/workforce/reports/attendance?${q}`);
    expect(m.status).toBe(200);
    expect(m.body.data.scopeLevel).toBe('team');
    expect(m.body.data.rows.every((r: { employee: string }) => r.employee !== fx.execB1.name)).toBe(true);
    expect((await mgrA.get(`/workforce/reports/attendance?userId=${fx.execB1.id}`)).status).toBe(404);
  });
  it('validates the report key, dates and range', async () => {
    expect((await hr.get('/workforce/reports/nope')).status).toBe(400);
    expect((await hr.get('/workforce/reports/attendance?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await hr.get('/workforce/reports/attendance?from=2024-01-01&to=2026-01-01')).status).toBe(400);
    expect((await hr.get('/workforce/reports/attendance?limit=101')).status).toBe(400);
  });
  it('every report key runs without error for HR; birthdays is HR/Founder only', async () => {
    for (const k of ['attendance', 'leave', 'earned-leave', 'tasks', 'goals', 'holidays', 'probation', 'birthdays', 'department-performance', 'weekly-progress', 'new-joiners']) {
      const r = await hr.get(`/workforce/reports/${k}`);
      expect(r.status, k).toBe(200);
      expect(Array.isArray(r.body.data.columns), k).toBe(true);
    }
    expect((await mgrA.get('/workforce/reports/birthdays')).status).toBe(403);
    expect((await founder.get('/workforce/reports/birthdays')).status).toBe(200);
  });
  it('exports CSV: audited, attachment headers, formula-injection safe', async () => {
    const u = await createUser(t.prisma, fx.org, { roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id, name: '=HYPERLINK("http://evil","x")' });
    await t.prisma.attendanceRecord.create({ data: { organizationId: fx.org.id, userId: u.id, date: new Date(`${today.slice(0, 7)}-01T00:00:00Z`), status: 'PRESENT', source: 'SYSTEM' } as never });
    const before = await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'export.created' } });
    const res = await hr.get(`/workforce/reports/attendance/export?format=csv&from=${today.slice(0, 7)}-01&to=${today}`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c).toString('utf8'))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toContain('no-store');
    const text = res.body as unknown as string;
    expect(text).toContain("'=HYPERLINK");
    expect(text).not.toMatch(/(^|,|")=HYPERLINK/m);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'export.created' } })).toBe(before + 1);
    const row = await t.prisma.auditLog.findFirst({ where: { organizationId: fx.org.id, action: 'export.created', entityId: 'attendance' }, orderBy: { createdAt: 'desc' } });
    expect(row!.metadata).toMatchObject({ report: 'attendance', format: 'csv', scopeLevel: 'org' });
    expect(JSON.stringify(row!.metadata)).not.toContain('HYPERLINK');
  });
  it('exports XLSX and applies the row cap honestly', async () => {
    const x = await hr.get(`/workforce/reports/attendance/export?format=xlsx`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    process.env.WORKFORCE_EXPORT_MAX_ROWS = '1';
    try {
      const c = await hr.get(`/workforce/reports/attendance/export?format=csv&from=${today.slice(0, 7)}-01&to=${today}`);
      expect(c.status).toBe(200);
      expect(c.headers['x-truncated']).toBe('true');
      expect(c.headers['x-row-count']).toBe('1');
      const j = await hr.get(`/workforce/reports/attendance?from=${today.slice(0, 7)}-01&to=${today}`);
      expect(j.body.data.truncated).toBe(true);
    } finally {
      delete process.env.WORKFORCE_EXPORT_MAX_ROWS;
    }
  });
  it('export needs workforce:reports:export (managers and Admin are refused, no audit row)', async () => {
    const before = await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'export.created' } });
    expect((await mgrA.get('/workforce/reports/attendance/export')).status).toBe(403);
    expect((await admin.get('/workforce/reports/attendance/export')).status).toBe(403);
    expect((await hr.get('/workforce/reports/attendance/export?format=pdf')).status).toBe(400);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'export.created' } })).toBe(before);
  });
});
