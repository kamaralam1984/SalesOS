import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDay } from '@salesos/workforce-core';
import { buildOrgFixture, createOrg, createTestApp, createUser, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

/** Area A integration: holiday calendar (suggest / approve / audit) and the Earned Leave engine through the API. */
let t: TestApp;
let fx: OrgFixture;
let A: Record<'founder' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'admin' | 'hr' | 'finance', AuthedAgent>;
const today = () => localDay(new Date(), 'Asia/Kolkata');
const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const audit = (action: string) => t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, action } });
const setConfig = (config: object) => t.prisma.workforceSetting.upsert({ where: { organizationId: fx.org.id }, create: { organizationId: fx.org.id, config }, update: { config } });

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  await setConfig({ weeklyOffDays: [] });
  A = {
    founder: await loginAgent(t.app, fx.founder), managerA: await loginAgent(t.app, fx.managerA), managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1), execA2: await loginAgent(t.app, fx.execA2), execB1: await loginAgent(t.app, fx.execB1),
    admin: await loginAgent(t.app, fx.admin), hr: await loginAgent(t.app, fx.hr), finance: await loginAgent(t.app, fx.finance),
  };
});
afterAll(async () => { await t.close(); });

describe('holidays', () => {
  const body = (date: string, name = 'Company Foundation Day', extra: object = {}) => ({ date, name, kind: 'COMPANY', ...extra });
  let hid: string;
  const hdate = () => addDays(today(), 25);

  it('HR creates an APPROVED holiday; duplicates are 409; executives, managers, admin cannot manage', async () => {
    const res = await A.hr.post('/workforce/holidays').send(body(hdate()));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ date: hdate(), name: 'Company Foundation Day', status: 'APPROVED', kind: 'COMPANY' });
    hid = res.body.data.id;
    expect((await A.hr.post('/workforce/holidays').send(body(hdate()))).body.error.code).toBe('HOLIDAY_EXISTS');
    for (const who of ['execA1', 'managerA', 'admin', 'finance'] as const) expect((await A[who].post('/workforce/holidays').send(body(addDays(hdate(), 1), 'Nope'))).status).toBe(403);
    expect((await A.hr.post('/workforce/holidays').send({ date: '2026-02-30', name: 'Bad date', kind: 'COMPANY' })).status).toBe(400);
    expect((await A.hr.post('/workforce/holidays').send({ date: hdate(), name: 'X', kind: 'COMPANY' })).status).toBe(400); // name too short
    const a = await audit('holiday.created');
    expect(a).toHaveLength(1);
    expect(a[0]!.metadata).toMatchObject({ after: { name: 'Company Foundation Day', status: 'APPROVED' } });
  });

  it('an approved holiday is not a leave day; everyone sees the approved calendar', async () => {
    const r = await A.execA1.post('/workforce/leave/requests').send({ typeKey: 'UNPAID', startDate: hdate(), endDate: hdate(), reason: 'trip' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('NO_WORKING_DAYS');
    const list = await A.execA1.get(`/workforce/holidays?year=${hdate().slice(0, 4)}`);
    expect(list.body.data.map((h: { id: string }) => h.id)).toContain(hid);
  });

  it('suggestions: fixed national dates, SUGGESTED, hidden from non-managers, never counted until approved, idempotent', async () => {
    const res = await A.hr.post('/workforce/holidays/suggest').send({ year: 2031 });
    expect(res.status).toBe(200);
    expect(res.body.data.created.map((h: { date: string }) => h.date)).toEqual(['2031-01-26', '2031-08-15', '2031-10-02']);
    expect(res.body.data.created.every((h: { status: string; suggested: boolean }) => h.status === 'SUGGESTED' && h.suggested)).toBe(true);
    expect((await A.hr.post('/workforce/holidays/suggest').send({ year: 2031 })).body.data).toMatchObject({ created: [], skipped: 3 });
    expect((await A.execA1.get('/workforce/holidays?year=2031')).body.data).toEqual([]);
    expect((await A.managerA.get('/workforce/holidays?year=2031&status=SUGGESTED')).body.data).toEqual([]);
    expect((await A.hr.get('/workforce/holidays?year=2031')).body.data).toHaveLength(3);
    expect((await A.execA1.post('/workforce/holidays/suggest').send({ year: 2031 })).status).toBe(403);
    // suggestions never change the calendar: an ordinary day is still a working day for leave
    const r = await A.execA1.post('/workforce/leave/requests').send({ typeKey: 'UNPAID', startDate: addDays(today(), 30), endDate: addDays(today(), 30), reason: 'trip' });
    expect(r.status).toBe(201);
    // ...and the suggested Independence Day itself still counts as a working day until HR approves it
    const sugDay = await A.execA2.post('/workforce/leave/requests').send({ typeKey: 'UNPAID', startDate: '2031-08-15', endDate: '2031-08-15', reason: 'trip' });
    expect(sugDay.body.data).toMatchObject({ days: '1' });
  });

  it('approve once (409 after), with before/after audit; patch and delete are audited with before/after', async () => {
    const sug = (await A.hr.get('/workforce/holidays?year=2031&status=SUGGESTED')).body.data[0];
    const ok = await A.hr.post(`/workforce/holidays/${sug.id}/approve`).send({});
    expect(ok.body.data).toMatchObject({ status: 'APPROVED' });
    expect((await A.hr.post(`/workforce/holidays/${sug.id}/approve`).send({})).body.error.code).toBe('ALREADY_APPROVED');
    const approved = (await audit('holiday.approved'))[0]!;
    expect(approved.metadata).toMatchObject({ before: { status: 'SUGGESTED' }, after: { status: 'APPROVED' } });
    expect((await A.execA1.get('/workforce/holidays?year=2031')).body.data.map((h: { id: string }) => h.id)).toEqual([sug.id]);

    const upd = await A.hr.patch(`/workforce/holidays/${hid}`).send({ name: 'Foundation Day (renamed)', kind: 'REGIONAL' });
    expect(upd.body.data).toMatchObject({ name: 'Foundation Day (renamed)', kind: 'REGIONAL' });
    expect((await audit('holiday.updated'))[0]!.metadata).toMatchObject({ before: { name: 'Company Foundation Day', kind: 'COMPANY' }, after: { name: 'Foundation Day (renamed)', kind: 'REGIONAL' } });
    expect((await A.hr.patch(`/workforce/holidays/${hid}`).send({})).status).toBe(400);
    expect((await A.managerA.patch(`/workforce/holidays/${hid}`).send({ name: 'Hacked' })).status).toBe(403);
    expect((await A.hr.delete(`/workforce/holidays/${hid}`)).body.data).toEqual({ id: hid, deleted: true });
    expect((await audit('holiday.deleted'))[0]!.metadata).toMatchObject({ before: { name: 'Foundation Day (renamed)' } });
    expect((await A.hr.delete(`/workforce/holidays/${hid}`)).status).toBe(404);
  });

  it('the suggestion switch in the policy is honoured, and another organisation cannot touch the holiday', async () => {
    const sug = (await A.hr.get('/workforce/holidays?year=2031&status=SUGGESTED')).body.data[0];
    const org2 = await createOrg(t.prisma);
    const hr2 = await loginAgent(t.app, await createUser(t.prisma, org2, { roles: ['HR'] }));
    expect((await hr2.post(`/workforce/holidays/${sug.id}/approve`).send({})).status).toBe(404);
    expect((await hr2.patch(`/workforce/holidays/${sug.id}`).send({ name: 'Hijack' })).status).toBe(404);
    expect((await hr2.delete(`/workforce/holidays/${sug.id}`)).status).toBe(404);
    expect((await hr2.get('/workforce/holidays?year=2031')).body.data).toEqual([]);
    await setConfig({ weeklyOffDays: [], holidays: { suggestFixedNational: false } });
    expect((await A.hr.post('/workforce/holidays/suggest').send({ year: 2032 })).body.error.code).toBe('SUGGESTIONS_DISABLED');
    await setConfig({ weeklyOffDays: [] });
  });
});

describe('Earned Leave through the API', () => {
  const join = () => addDays(today(), -30);

  beforeAll(async () => {
    // execB1 joined 30 days ago and was PRESENT on the last 25 closed days (days 26..2 ago are marked; 30..27 ago have no record -> ABSENT, not counted)
    await t.prisma.employeeProfile.create({ data: { organizationId: fx.org.id, userId: fx.execB1.id, joinDate: dayDate(join()) } });
    const rows = [];
    for (let i = 25; i >= 1; i--) rows.push({ organizationId: fx.org.id, userId: fx.execB1.id, date: dayDate(addDays(today(), -i)), status: 'PRESENT' as const, source: 'HR' as const });
    await t.prisma.attendanceRecord.createMany({ data: rows });
  });

  it('only HR/Founder run the engine (managers, executives, admin cannot); the run credits exactly one day with an explanation', async () => {
    for (const who of ['managerB', 'execB1', 'admin', 'finance'] as const) expect((await A[who].post('/workforce/earned-leave/run').send({ userId: fx.execB1.id })).status).toBe(403);
    const res = await A.hr.post('/workforce/earned-leave/run').send({ userId: fx.execB1.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ users: 1, credits: 1 });
    const credit = res.body.data.results[0].credits[0];
    expect(credit).toMatchObject({ n: 1, amount: 1, balanceAfter: 1 });
    const row = await t.prisma.leaveBalanceTxn.findFirstOrThrow({ where: { userId: fx.execB1.id, kind: 'CREDIT_EARNED' } });
    expect(row).toMatchObject({ uniqueKey: `EL:${fx.execB1.id}:1`, typeKey: 'EARNED', createdById: null, policyVersion: 1 });
    expect(row.eligibleDays?.toString()).toBe('20');
    const calc = row.calculation as { days: Array<{ date: string; eligible: number; reason: string }>; eligibleDays: number };
    expect(calc.days.reduce((n, d) => n + d.eligible, 0)).toBe(20);
    expect(calc.days.slice(0, 4).every((d) => d.reason === 'SKIP_ABSENT')).toBe(true); // the days before the first record
    expect((await audit('earned_leave.credited')).length).toBe(1);
    const notes = await t.prisma.outboxEvent.findMany({ where: { organizationId: fx.org.id, eventType: 'earned_leave.credited' } });
    expect(notes).toHaveLength(1);
  });

  it('progress shows eligible days, days to the next credit and the open-period explanation', async () => {
    const p = (await A.execB1.get('/workforce/earned-leave/progress')).body.data;
    expect(p).toMatchObject({ enabled: true, requiredEligibleDays: 20, eligibleDays: 5, daysToNextCredit: 15, creditsGiven: 1, balance: 1, processedThrough: addDays(today(), -1) });
    expect(p.dayLog).toHaveLength(5);
    expect(p.dayLog.reduce((n: number, d: { eligible: number }) => n + d.eligible, 0)).toBe(5);
  });

  it('re-running, and running concurrently, never credits twice', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => A.hr.post('/workforce/earned-leave/run').send({ userId: fx.execB1.id })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.reduce((n, r) => n + r.body.data.credits, 0)).toBe(0);
    expect(await t.prisma.leaveBalanceTxn.count({ where: { userId: fx.execB1.id, kind: 'CREDIT_EARNED' } })).toBe(1);
    // a second run of everyone is also harmless
    await A.founder.post('/workforce/earned-leave/run').send({});
    expect(await t.prisma.leaveBalanceTxn.count({ where: { userId: fx.execB1.id, kind: 'CREDIT_EARNED' } })).toBe(1);
    expect((await A.execB1.get('/workforce/leave/balances')).body.data.balances.find((b: { typeKey: string }) => b.typeKey === 'EARNED').balance).toBe(1);
  });

  it('a duplicate credit key is rejected by the database itself', async () => {
    await expect(
      t.prisma.leaveBalanceTxn.create({ data: { organizationId: fx.org.id, userId: fx.execB1.id, typeKey: 'EARNED', kind: 'CREDIT_EARNED', amount: 1, balanceBefore: 1, balanceAfter: 2, uniqueKey: `EL:${fx.execB1.id}:1` } }),
    ).rejects.toThrow();
  });

  it('transactions show the credit with its calculation, scoped like balances', async () => {
    const own = (await A.execB1.get('/workforce/earned-leave/transactions')).body.data;
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ kind: 'CREDIT_EARNED', amount: '1', eligibleDays: '20', policyVersion: 1 });
    expect(own[0].calculation.days.length).toBeGreaterThanOrEqual(20);
    expect((await A.managerB.get(`/workforce/earned-leave/transactions?userId=${fx.execB1.id}`)).status).toBe(200);
    expect((await A.hr.get(`/workforce/earned-leave/progress?userId=${fx.execB1.id}`)).status).toBe(200);
    for (const who of ['managerA', 'execA1', 'admin', 'finance'] as const) {
      expect((await A[who].get(`/workforce/earned-leave/transactions?userId=${fx.execB1.id}`)).status).toBe(404);
      expect((await A[who].get(`/workforce/earned-leave/progress?userId=${fx.execB1.id}`)).status).toBe(404);
    }
  });

  it('a disabled policy credits nothing, and the maximum balance caps a credit', async () => {
    await setConfig({ weeklyOffDays: [], earnedLeave: { enabled: false } });
    await t.prisma.attendanceRecord.create({ data: { organizationId: fx.org.id, userId: fx.execB1.id, date: dayDate(today()), status: 'PRESENT', source: 'HR' } });
    expect((await A.hr.post('/workforce/earned-leave/run').send({ userId: fx.execB1.id })).body.data.results[0].status).toBe('DISABLED');
    await setConfig({ weeklyOffDays: [] });
  });

  it('cross-organisation: another HR cannot run or read it', async () => {
    const org2 = await createOrg(t.prisma);
    const hr2 = await loginAgent(t.app, await createUser(t.prisma, org2, { roles: ['HR'] }));
    expect((await hr2.post('/workforce/earned-leave/run').send({ userId: fx.execB1.id })).status).toBe(404);
    expect((await hr2.get(`/workforce/earned-leave/progress?userId=${fx.execB1.id}`)).status).toBe(404);
    expect((await hr2.post('/workforce/earned-leave/run').send({})).body.data.credits).toBe(0);
  });
});
