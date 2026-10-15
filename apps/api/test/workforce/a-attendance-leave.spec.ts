import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDay } from '@salesos/workforce-core';
import { buildOrgFixture, createOrg, createTestApp, createUser, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

/** Area A integration: attendance (self + corrections) and leave (apply, chain, balances, cancel). Real Postgres, real HTTP pipeline. */
let t: TestApp;
let fx: OrgFixture;
let A: Record<'founder' | 'teamLead' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'admin' | 'hr' | 'finance', AuthedAgent>;
const TZ = 'Asia/Kolkata';
const today = () => localDay(new Date(), TZ);
const future = (n: number) => addDays(today(), n);
/** Replaces the stored policy. The self check-in cutoff defaults to 23:59 so tests do not depend on the time of day they run at. */
const setConfig = (input: { attendance?: Record<string, string | number | boolean | null> } & Record<string, unknown>) => {
  const config: object = { ...input, attendance: { checkInCutoff: '23:59', ...input.attendance } };
  return t.prisma.workforceSetting.upsert({ where: { organizationId: fx.org.id }, create: { organizationId: fx.org.id, config }, update: { config } });
};
const audit = (action: string, entityId?: string) => t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, action, ...(entityId ? { entityId } : {}) } });
const outbox = (eventType: string) => t.prisma.outboxEvent.findMany({ where: { organizationId: fx.org.id, eventType } });
const opening = (userId: string, typeKey: string, amount: string) => A.hr.post('/workforce/leave/balances/adjust').send({ userId, typeKey, amount, kind: 'OPENING', reason: 'opening balance (test)' });
const apply = (a: AuthedAgent, start: string, end = start, extra: object = {}) => a.post('/workforce/leave/requests').send({ typeKey: 'CASUAL', startDate: start, endDate: end, reason: 'family event', ...extra });
const decide = (a: AuthedAgent, id: string, decision: 'APPROVE' | 'REJECT', comment?: string) => a.post(`/workforce/leave/requests/${id}/decision`).send({ decision, comment });

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  // every day is a working day so the tests do not depend on the weekday they run on
  await setConfig({ weeklyOffDays: [] });
  A = {
    founder: await loginAgent(t.app, fx.founder), teamLead: await loginAgent(t.app, fx.teamLead), managerA: await loginAgent(t.app, fx.managerA), managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1), execA2: await loginAgent(t.app, fx.execA2), execB1: await loginAgent(t.app, fx.execB1),
    admin: await loginAgent(t.app, fx.admin), hr: await loginAgent(t.app, fx.hr), finance: await loginAgent(t.app, fx.finance),
  };
});
afterAll(async () => { await t.close(); });

describe('attendance: self check-in / check-out', () => {
  it('check-in records PRESENT/LATE with source SELF; repeat is 409 and returns the record', async () => {
    const res = await A.execA1.post('/workforce/attendance/check-in').send({ mode: 'OFFICE' });
    expect(res.status).toBe(201);
    expect(['PRESENT', 'LATE']).toContain(res.body.data.status);
    expect(res.body.data).toMatchObject({ source: 'SELF', date: today(), userId: fx.execA1.id, checkOutAt: null });
    const again = await A.execA1.post('/workforce/attendance/check-in').send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_IN');
    expect(again.body.error.details.id).toBe(res.body.data.id);
    expect(await t.prisma.attendanceRecord.count({ where: { userId: fx.execA1.id } })).toBe(1);
    expect((await audit('attendance.checked_in', res.body.data.id)).length).toBe(1);
  });

  it('WFH check-in is WFH; concurrent check-ins create one record', async () => {
    const [a, b] = await Promise.all([A.execA2.post('/workforce/attendance/check-in').send({ mode: 'WFH' }), A.execA2.post('/workforce/attendance/check-in').send({ mode: 'WFH' })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((a.status === 201 ? a : b).body.data.status).toBe('WFH');
    expect(await t.prisma.attendanceRecord.count({ where: { userId: fx.execA2.id } })).toBe(1);
  });

  it('check-out sets workMinutes; a very short day becomes HALF_DAY flagged for review; second check-out is 409', async () => {
    const res = await A.execA1.post('/workforce/attendance/check-out').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.workMinutes).toBeLessThanOrEqual(1);
    expect(res.body.data).toMatchObject({ status: 'HALF_DAY', needsReview: true });
    expect(res.body.data.checkOutAt).not.toBeNull();
    const second = await A.execA1.post('/workforce/attendance/check-out').send({});
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_CHECKED_OUT');
    expect((await A.execB1.post('/workforce/attendance/check-out').send({})).body.error.code).toBe('NOT_CHECKED_IN');
  });

  it('GET today reports the record and what the user can do', async () => {
    const mine = (await A.execA1.get('/workforce/attendance/today')).body.data;
    expect(mine).toMatchObject({ date: today(), dayKind: 'WORKING', can: { checkIn: false, checkOut: false } });
    expect(mine.record.status).toBe('HALF_DAY');
    const fresh = (await A.execB1.get('/workforce/attendance/today')).body.data;
    expect(fresh).toMatchObject({ record: null, can: { checkIn: true, checkOut: false } });
  });

  it('refuses a weekly off / holiday and honours the selfCheckIn switch', async () => {
    const wd = ((new Date(`${today()}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    await setConfig({ weeklyOffDays: [wd] });
    const off = await A.execB1.post('/workforce/attendance/check-in').send({});
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('NON_WORKING_DAY');
    expect((await A.execB1.get('/workforce/attendance/today')).body.data).toMatchObject({ dayKind: 'WEEKLY_OFF', can: { checkIn: false } });
    await setConfig({ weeklyOffDays: [], attendance: { selfCheckIn: false } });
    expect((await A.execB1.post('/workforce/attendance/check-in').send({})).body.error.code).toBe('SELF_CHECK_IN_DISABLED');
    await setConfig({ weeklyOffDays: [] });
  });

  it('rejects unknown body keys', async () => {
    expect((await A.execB1.post('/workforce/attendance/check-in').send({ mode: 'OFFICE', userId: fx.execA1.id })).status).toBe(400);
  });
});

describe('attendance: check-in cutoff and meeting link', () => {
  const URL_OK = 'https://zoom.us/j/1234567890';
  const todayView = async (a: AuthedAgent) => (await a.get('/workforce/attendance/today')).body.data;

  it('cutoff 00:00 rejects self check-in with CHECK_IN_CLOSED and today() reflects it', async () => {
    await setConfig({ weeklyOffDays: [], attendance: { checkInCutoff: '00:00' } });
    const res = await A.execB1.post('/workforce/attendance/check-in').send({ mode: 'OFFICE' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHECK_IN_CLOSED');
    expect(res.body.error.message).toContain('00:00');
    expect(await t.prisma.attendanceRecord.count({ where: { userId: fx.execB1.id } })).toBe(0);
    const view = await todayView(A.execB1);
    expect(view.can.checkIn).toBe(false);
    expect(view.checkInClosed).toBe(true);
    expect(view.policy.checkInCutoff).toBe('00:00');
    // switched-off self check-in is not reported as "closed by the clock"
    await setConfig({ weeklyOffDays: [], attendance: { checkInCutoff: '00:00', selfCheckIn: false } });
    expect((await todayView(A.execB1)).checkInClosed).toBe(false);
  });

  it('HR corrections still work after the cutoff', async () => {
    await setConfig({ weeklyOffDays: [], attendance: { checkInCutoff: '00:00' } });
    const res = await A.hr.put('/workforce/attendance/records').send({ userId: fx.execB1.id, date: today(), status: 'PRESENT', reason: 'Cutoff test: recorded by HR' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'PRESENT', source: 'HR' });
    // no cleanup: attendance_corrections is append-only (DB trigger), so this record stays for the rest of the file.
    // Later tests in this suite must therefore not assume execB1 has no attendance today.
  });

  it('cutoff 23:59 allows check-in and the view is open', async () => {
    await setConfig({ weeklyOffDays: [], attendance: { checkInCutoff: '23:59' } });
    const view = await todayView(A.finance);
    expect(view).toMatchObject({ can: { checkIn: true }, checkInClosed: false, meeting: null });
  });

  it('meeting link: hidden before check-in, visible after PRESENT/LATE check-in, hidden for other users', async () => {
    await setConfig({ weeklyOffDays: [], attendance: { checkInCutoff: '23:59', meetingUrl: URL_OK } });
    expect((await todayView(A.finance)).meeting).toBeNull();
    const res = await A.finance.post('/workforce/attendance/check-in').send({ mode: 'OFFICE' });
    expect(res.status).toBe(201);
    expect(['PRESENT', 'LATE']).toContain(res.body.data.status);
    expect((await todayView(A.finance)).meeting).toEqual({ url: URL_OK });
    expect((await todayView(A.admin)).meeting).toBeNull();
    // managerB has no attendance record today: the org-wide link is not shown to someone who is not marked present
    expect((await todayView(A.managerB)).meeting).toBeNull();
  });

  it('meeting link is hidden when today is ABSENT (HR correction) and when no link is configured', async () => {
    await setConfig({ weeklyOffDays: [], attendance: { checkInCutoff: '23:59', meetingUrl: URL_OK } });
    const abs = await A.hr.put('/workforce/attendance/records').send({ userId: fx.admin.id, date: today(), status: 'ABSENT', reason: 'Cutoff test: marked absent' });
    expect(abs.status).toBe(200);
    expect((await todayView(A.admin)).meeting).toBeNull();
    const wfh = await A.hr.put('/workforce/attendance/records').send({ userId: fx.admin.id, date: today(), status: 'WFH', reason: 'Cutoff test: corrected to WFH' });
    expect(wfh.status).toBe(200);
    expect((await todayView(A.admin)).meeting).toEqual({ url: URL_OK });
    await setConfig({ weeklyOffDays: [], attendance: { checkInCutoff: '23:59', meetingUrl: null } });
    expect((await todayView(A.admin)).meeting).toBeNull();
  });

  it('the meeting URL never appears in the month response', async () => {
    await setConfig({ weeklyOffDays: [], attendance: { checkInCutoff: '23:59', meetingUrl: URL_OK } });
    const res = await A.finance.get('/workforce/attendance/month');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('zoom.us');
    const team = await A.hr.get('/workforce/attendance/team-summary');
    expect(JSON.stringify(team.body)).not.toContain('zoom.us');
  });

  it('settings reject non-https, javascript: and over-long meeting URLs; HR can set a valid one', async () => {
    await setConfig({ weeklyOffDays: [], attendance: { checkInCutoff: '23:59' } });
    for (const bad of ['http://zoom.us/j/1', 'javascript:alert(1)', `https://zoom.us/${'a'.repeat(500)}`, 'not a url']) {
      const res = await A.hr.patch('/workforce/settings').send({ attendance: { meetingUrl: bad } });
      expect(res.status).toBe(400);
    }
    expect((await A.managerA.patch('/workforce/settings').send({ attendance: { meetingUrl: URL_OK } })).status).toBe(403);
    const ok = await A.hr.patch('/workforce/settings').send({ attendance: { meetingUrl: `  ${URL_OK}  `, checkInCutoff: '10:30' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.effective.attendance).toMatchObject({ meetingUrl: URL_OK, checkInCutoff: '10:30' });
    expect(ok.body.data.defaults.attendance).toMatchObject({ meetingUrl: null, checkInCutoff: '11:00' });
    await setConfig({ weeklyOffDays: [] });
  });
});

describe('attendance: reads are scoped (own / team / org)', () => {
  const month = (a: AuthedAgent, userId?: string) => a.get(`/workforce/attendance/month${userId ? `?userId=${userId}` : ''}`);
  it('own, team and org scope; cross-team, cross-peer and admin get 404 for someone else', async () => {
    expect((await month(A.execA1)).body.data).toMatchObject({ userId: fx.execA1.id, month: today().slice(0, 7) });
    expect((await month(A.managerA, fx.execA1.id)).status).toBe(200);
    expect((await month(A.teamLead, fx.execA1.id)).status).toBe(200);
    expect((await month(A.hr, fx.execA1.id)).status).toBe(200);
    expect((await month(A.founder, fx.execA1.id)).status).toBe(200);
    for (const who of ['managerB', 'execA2', 'execB1', 'admin', 'finance'] as const) expect((await month(A[who], fx.execA1.id)).status).toBe(404);
    expect((await month(A.hr, '22222222-2222-4222-8222-222222222222')).status).toBe(404);
  });

  it('month returns day kinds, records and a summary', async () => {
    const d = (await month(A.execA1)).body.data;
    expect(d.days.length).toBeGreaterThanOrEqual(28);
    expect(d.summary.HALF_DAY).toBe(1);
    expect(d.days.find((x: { date: string }) => x.date === today()).record.status).toBe('HALF_DAY');
  });

  it('team summary counts by status for the caller scope only', async () => {
    const mgr = (await A.managerA.get('/workforce/attendance/team-summary')).body.data;
    expect(mgr.total).toBe(3); // manager + 2 executives
    expect(mgr.byStatus).toMatchObject({ HALF_DAY: 1, WFH: 1 });
    expect(mgr.notMarked).toBe(1);
    expect((await A.execB1.get('/workforce/attendance/team-summary')).body.data.total).toBe(1);
    expect((await A.hr.get('/workforce/attendance/team-summary')).body.data.total).toBeGreaterThanOrEqual(11);
    expect((await A.managerA.get('/workforce/attendance/team-summary?date=not-a-date')).status).toBe(400);
  });
});

describe('attendance: corrections', () => {
  const day = () => addDays(today(), -2);
  const put = (a: AuthedAgent, body: object) => a.put('/workforce/attendance/records').send({ userId: fx.execA1.id, date: day(), status: 'PRESENT', reason: 'Forgot to check in', ...body });

  it('a manager corrects a team member; old and new value, reason and actor are stored; audit + outbox written', async () => {
    const res = await put(A.managerA, { checkInAt: `${day()}T04:00:00.000Z`, checkOutAt: `${day()}T13:00:00.000Z` });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'PRESENT', source: 'MANAGER', workMinutes: 540, version: 1 });
    const rows = await t.prisma.attendanceCorrection.findMany({ where: { userId: fx.execA1.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ correctedById: fx.managerA.id, reason: 'Forgot to check in', oldValue: { status: null } });
    expect((rows[0]!.newValue as { status: string }).status).toBe('PRESENT');
    expect((await audit('attendance.corrected', res.body.data.id)).length).toBe(1);
    expect((await outbox('attendance.corrected')).length).toBeGreaterThanOrEqual(1);
  });

  it('a second correction keeps the first as history (old value = previous record) and bumps the version', async () => {
    const res = await put(A.hr, { status: 'ABSENT', reason: 'HR review: was on unrecorded leave', checkInAt: null, checkOutAt: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ABSENT', source: 'HR', version: 2, checkInAt: null });
    const rows = await t.prisma.attendanceCorrection.findMany({ where: { userId: fx.execA1.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect((rows[1]!.oldValue as { status: string }).status).toBe('PRESENT');
    const list = await A.managerA.get(`/workforce/attendance/corrections?userId=${fx.execA1.id}`);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].correctedByName).toBeTruthy();
  });

  it('optimistic concurrency: a stale version is 409', async () => {
    expect((await put(A.hr, { version: 1 })).body.error.code).toBe('VERSION_CONFLICT');
    expect((await put(A.hr, { version: 2, status: 'PRESENT' })).status).toBe(200);
  });

  it('authz: executives and admin cannot; other team, self-correction and future dates are refused', async () => {
    for (const who of ['execA1', 'execA2', 'admin', 'finance'] as const) expect((await put(A[who], {})).status).toBe(403);
    expect((await put(A.managerB, {})).status).toBe(404); // IDOR-safe
    expect((await put(A.managerA, { userId: fx.managerA.id })).status).toBe(403); // own record
    expect((await put(A.hr, { date: future(3) })).body.error.code).toBe('FUTURE_DATE');
    expect((await put(A.hr, { reason: 'x' })).status).toBe(400);
    expect((await put(A.hr, { checkInAt: `${day()}T10:00:00.000Z`, checkOutAt: `${day()}T09:00:00.000Z` })).status).toBe(400);
  });

  it('managers are limited to the correction window, HR is not', async () => {
    const old = addDays(today(), -30);
    const m = await put(A.managerA, { date: old });
    expect(m.status).toBe(403);
    expect(m.body.error.code).toBe('CORRECTION_WINDOW_EXPIRED');
    expect((await put(A.hr, { date: old })).status).toBe(200);
  });

  it('corrections list is scoped: own, team and org; another peer gets 404', async () => {
    expect((await A.execA1.get('/workforce/attendance/corrections')).body.data.length).toBeGreaterThanOrEqual(3);
    expect((await A.execA2.get(`/workforce/attendance/corrections?userId=${fx.execA1.id}`)).status).toBe(404);
    expect((await A.managerB.get(`/workforce/attendance/corrections?userId=${fx.execA1.id}`)).status).toBe(404);
    expect((await A.execA2.get('/workforce/attendance/corrections')).body.data).toEqual([]);
  });

  it('the corrections table is append-only', async () => {
    await expect(t.prisma.attendanceCorrection.deleteMany({ where: { userId: fx.execA1.id } })).rejects.toThrow();
  });
});

describe('leave: balances ledger', () => {
  it('only HR/Founder adjust; no self adjustment; opening balance once; never negative', async () => {
    expect((await opening(fx.execA1.id, 'CASUAL', '5')).status).toBe(201);
    expect((await opening(fx.execA1.id, 'CASUAL', '5')).body.error.code).toBe('OPENING_EXISTS');
    expect((await opening(fx.execA1.id, 'SICK', '3')).status).toBe(201);
    expect((await opening(fx.execA2.id, 'CASUAL', '5')).status).toBe(201);
    const adj = (a: AuthedAgent, userId: string, amount: string) => a.post('/workforce/leave/balances/adjust').send({ userId, typeKey: 'CASUAL', amount, reason: 'test correction' });
    for (const who of ['managerA', 'execA1', 'admin', 'finance'] as const) expect((await adj(A[who], fx.execA1.id, '1')).status).toBe(403);
    expect((await adj(A.hr, fx.hr.id, '1')).status).toBe(403); // own balance
    expect((await adj(A.hr, fx.execA1.id, '-9')).body.error.code).toBe('NEGATIVE_BALANCE');
    expect((await adj(A.hr, fx.execA1.id, '0')).status).toBe(400);
    expect((await adj(A.hr, fx.execA1.id, '1.234')).status).toBe(400);
    expect((await A.hr.post('/workforce/leave/balances/adjust').send({ userId: fx.execA1.id, typeKey: 'NOPE', amount: '1', reason: 'test correction' })).body.error.code).toBe('INVALID_LEAVE_TYPE');
    const ok = await adj(A.hr, fx.execA1.id, '1');
    expect(ok.body.data).toMatchObject({ amount: '1', balanceBefore: '5', balanceAfter: '6' });
    expect((await adj(A.hr, fx.execA1.id, '-1')).body.data.balanceAfter).toBe('5');
    expect((await audit('leave.balance_adjusted')).length).toBeGreaterThanOrEqual(5);
  });

  it('balances and ledger are scoped; the ledger is append-only', async () => {
    const own = (await A.execA1.get('/workforce/leave/balances')).body.data.balances;
    expect(own.find((b: { typeKey: string }) => b.typeKey === 'CASUAL')).toMatchObject({ balance: 5, pending: 0, available: 5 });
    expect((await A.managerA.get(`/workforce/leave/balances?userId=${fx.execA1.id}`)).status).toBe(200);
    for (const who of ['managerB', 'execA2', 'admin', 'finance'] as const) {
      expect((await A[who].get(`/workforce/leave/balances?userId=${fx.execA1.id}`)).status).toBe(404);
      expect((await A[who].get(`/workforce/leave/ledger?userId=${fx.execA1.id}`)).status).toBe(404);
    }
    const ledger = (await A.execA1.get('/workforce/leave/ledger?typeKey=CASUAL')).body.data;
    expect(ledger.map((r: { kind: string }) => r.kind)).toEqual(['ADJUSTMENT', 'ADJUSTMENT', 'OPENING']);
    await expect(t.prisma.leaveBalanceTxn.deleteMany({ where: { userId: fx.execA1.id } })).rejects.toThrow();
    const types = (await A.execB1.get('/workforce/leave/types')).body.data.map((x: { key: string }) => x.key);
    expect(types).toEqual(['CASUAL', 'SICK', 'EARNED', 'UNPAID']);
  });
});

describe('leave: apply, approval chain, debit and cancel', () => {
  let reqId: string;
  const d0 = () => future(20);

  it('validates dates, type, half day, backdating, working days and overlap', async () => {
    expect((await apply(A.execA1, d0(), addDays(d0(), -1))).status).toBe(400);
    expect((await apply(A.execA1, d0(), d0(), { typeKey: 'NOPE' })).body.error.code).toBe('INVALID_LEAVE_TYPE');
    expect((await apply(A.execA1, d0(), addDays(d0(), 1), { halfDay: 'FIRST_HALF' })).status).toBe(400);
    expect((await apply(A.execA1, addDays(today(), -30))).body.error.code).toBe('BACKDATE_LIMIT');
    expect((await apply(A.execA1, d0(), d0(), { reason: '' })).status).toBe(400);
    expect((await apply(A.execA1, d0(), d0(), { userId: fx.execA2.id, status: 'APPROVED' })).status).toBe(201); // unknown keys stripped: still the caller's own PENDING request
    const mine = (await A.execA1.get('/workforce/leave/requests')).body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ userId: fx.execA1.id, status: 'PENDING_MANAGER' });
    await A.execA1.post(`/workforce/leave/requests/${mine[0].id}/cancel`).send({ reason: 'test cleanup' });
  });

  it('creates a PENDING_MANAGER request with both steps, reserves the days, notifies the manager', async () => {
    const res = await apply(A.execA1, d0(), addDays(d0(), 1));
    expect(res.status).toBe(201);
    reqId = res.body.data.id;
    expect(res.body.data).toMatchObject({ status: 'PENDING_MANAGER', days: '2', unpaidDays: '0', can: { decide: false, cancel: true } });
    expect(res.body.data.steps.map((s: { step: string; status: string }) => `${s.step}:${s.status}`)).toEqual(['MANAGER:PENDING', 'HR:PENDING']);
    const bal = (await A.execA1.get('/workforce/leave/balances')).body.data.balances.find((b: { typeKey: string }) => b.typeKey === 'CASUAL');
    expect(bal).toMatchObject({ balance: 5, pending: 2, available: 3 });
    const notes = (await outbox('notification.requested')).filter((e) => (e.payload as { type?: string }).type === 'leave.pending' && (e.payload as { entity?: { id: string } }).entity?.id === reqId);
    expect(notes).toHaveLength(1);
    expect((notes[0]!.payload as { userIds: string[] }).userIds).toEqual([fx.managerA.id]);
    expect(JSON.stringify(notes[0]!.payload)).not.toContain('family event'); // no narrative in notifications
    expect((await audit('leave.submitted', reqId)).length).toBe(1);
  });

  it('refuses overlapping dates (409) and an over-balance request without explicit unpaid confirmation', async () => {
    expect((await apply(A.execA1, addDays(d0(), 1), addDays(d0(), 2))).body.error.code).toBe('LEAVE_OVERLAP');
    const over = await apply(A.execA1, future(40), future(43)); // 4 days, only 3 available
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: 'UNPAID_CONFIRMATION_REQUIRED', details: { shortfall: 1, available: 3 } });
    const ok = await apply(A.execA1, future(40), future(43), { confirmUnpaid: true });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ days: '4', unpaidDays: '1' });
    await A.execA1.post(`/workforce/leave/requests/${ok.body.data.id}/cancel`).send({ reason: 'test cleanup' });
  });

  it('sees: applicant, manager, HR and org leaders see it; peers, other teams, admin and finance get 404', async () => {
    for (const who of ['execA1', 'managerA', 'teamLead', 'hr', 'founder'] as const) expect((await A[who].get(`/workforce/leave/requests/${reqId}`)).status).toBe(200);
    for (const who of ['execA2', 'managerB', 'execB1', 'admin', 'finance'] as const) expect((await A[who].get(`/workforce/leave/requests/${reqId}`)).status).toBe(404);
    const pendingMe = async (a: AuthedAgent) => (await a.get('/workforce/leave/requests?view=pending-me')).body.data.map((r: { id: string }) => r.id);
    expect(await pendingMe(A.managerA)).toContain(reqId);
    expect(await pendingMe(A.managerB)).not.toContain(reqId);
    expect(await pendingMe(A.hr)).not.toContain(reqId); // not at the HR step yet
    expect(await pendingMe(A.execA1)).toEqual([]);
    expect((await A.managerA.get('/workforce/leave/requests?view=team')).body.data.map((r: { id: string }) => r.id)).toContain(reqId);
    expect((await A.execA2.get('/workforce/leave/requests?view=all')).body.data).toEqual([]);
  });

  it('decision authz: executives and finance are 403, the wrong team is 404, HR cannot jump the manager step, nobody decides their own', async () => {
    for (const who of ['execA1', 'execA2', 'finance'] as const) expect((await decide(A[who], reqId, 'APPROVE')).status).toBe(403);
    expect((await decide(A.managerB, reqId, 'APPROVE')).status).toBe(404);
    const hr = await decide(A.hr, reqId, 'APPROVE');
    expect(hr.status).toBe(403);
    expect(hr.body.error.code).toBe('NOT_YOUR_STEP');
    expect((await decide(A.managerA, reqId, 'REJECT')).status).toBe(400); // rejection needs a comment
    // managerA's own request: their manager is the team lead; they cannot decide it themselves
    const own = await apply(A.managerA, future(60), future(60), { typeKey: 'UNPAID' });
    expect(own.status).toBe(201);
    const self = await decide(A.managerA, own.body.data.id, 'APPROVE');
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_APPROVAL');
    expect((await decide(A.teamLead, own.body.data.id, 'APPROVE')).status).toBe(200);
  });

  it('manager approves -> PENDING_HR; HR approves -> APPROVED with exactly one DEBIT_LEAVE of 2 days', async () => {
    const m = await decide(A.managerA, reqId, 'APPROVE', 'ok');
    expect(m.status).toBe(200);
    expect(m.body.data.status).toBe('PENDING_HR');
    expect(m.body.data.steps[0]).toMatchObject({ step: 'MANAGER', status: 'APPROVED', actorName: fx.managerA.name });
    expect((await decide(A.managerA, reqId, 'APPROVE')).status).toBe(403); // the HR step is waiting now
    expect(await t.prisma.leaveBalanceTxn.count({ where: { leaveRequestId: reqId } })).toBe(0);
    expect((await A.hr.get('/workforce/leave/requests?view=pending-me')).body.data.map((r: { id: string }) => r.id)).toContain(reqId);
    const h = await decide(A.hr, reqId, 'APPROVE');
    expect(h.body.data.status).toBe('APPROVED');
    const debits = await t.prisma.leaveBalanceTxn.findMany({ where: { leaveRequestId: reqId } });
    expect(debits).toHaveLength(1);
    expect(debits[0]).toMatchObject({ kind: 'DEBIT_LEAVE', uniqueKey: `LV-DEBIT:${reqId}`, createdById: fx.hr.id });
    expect(debits[0]!.amount.toString()).toBe('-2');
    expect((await A.execA1.get('/workforce/leave/balances')).body.data.balances.find((b: { typeKey: string }) => b.typeKey === 'CASUAL')).toMatchObject({ balance: 3, pending: 0, available: 3 });
    expect((await decide(A.hr, reqId, 'APPROVE')).status).toBe(409);
    expect((await outbox('leave.approved')).length).toBe(1);
    expect((await audit('leave.step_decided', reqId)).length).toBe(2);
  });

  it('concurrent final approvals debit once', async () => {
    const r = await apply(A.execA2, future(70), future(70));
    await decide(A.managerA, r.body.data.id, 'APPROVE');
    const [a, b] = await Promise.all([decide(A.hr, r.body.data.id, 'APPROVE'), decide(A.founder, r.body.data.id, 'APPROVE')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await t.prisma.leaveBalanceTxn.count({ where: { leaveRequestId: r.body.data.id, kind: 'DEBIT_LEAVE' } })).toBe(1);
  });

  it('cancelling an approved future leave reverses the debit once; only the applicant (or HR) may cancel', async () => {
    expect((await A.execA2.post(`/workforce/leave/requests/${reqId}/cancel`).send({ reason: 'not mine' })).status).toBe(404);
    expect((await A.managerA.post(`/workforce/leave/requests/${reqId}/cancel`).send({ reason: 'manager says' })).status).toBe(403);
    const res = await A.execA1.post(`/workforce/leave/requests/${reqId}/cancel`).send({ reason: 'plans changed' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'CANCELLED', cancelReason: 'plans changed' });
    const rows = await t.prisma.leaveBalanceTxn.findMany({ where: { leaveRequestId: reqId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.kind)).toEqual(['DEBIT_LEAVE', 'REVERSAL']);
    expect(rows[1]!.amount.toString()).toBe('2');
    expect((await A.execA1.get('/workforce/leave/balances')).body.data.balances.find((b: { typeKey: string }) => b.typeKey === 'CASUAL').balance).toBe(5);
    expect((await A.execA1.post(`/workforce/leave/requests/${reqId}/cancel`).send({ reason: 'again' })).body.error.code).toBe('CANNOT_CANCEL');
    expect(await t.prisma.leaveBalanceTxn.count({ where: { leaveRequestId: reqId } })).toBe(2);
  });

  it('a rejection ends the request without any debit; reject at HR step also works', async () => {
    const r = await apply(A.execA1, future(80));
    const rej = await decide(A.managerA, r.body.data.id, 'REJECT', 'team is short that day');
    expect(rej.body.data).toMatchObject({ status: 'REJECTED' });
    expect(await t.prisma.leaveBalanceTxn.count({ where: { leaveRequestId: r.body.data.id } })).toBe(0);
    expect((await decide(A.hr, r.body.data.id, 'APPROVE')).status).toBe(409);
    const r2 = await apply(A.execA1, future(81));
    await decide(A.managerA, r2.body.data.id, 'APPROVE');
    expect((await decide(A.hr, r2.body.data.id, 'REJECT', 'not eligible')).body.data.status).toBe('REJECTED');
    expect((await outbox('leave.rejected')).length).toBe(2);
  });

  it('leave that already started cannot be cancelled', async () => {
    const r = await t.prisma.leaveRequest.create({ data: { organizationId: fx.org.id, userId: fx.execB1.id, typeKey: 'UNPAID', startDate: new Date(`${addDays(today(), -1)}T00:00:00Z`), endDate: new Date(`${today()}T00:00:00Z`), days: 2, reason: 'seed', status: 'APPROVED' } });
    expect((await A.execB1.post(`/workforce/leave/requests/${r.id}/cancel`).send({ reason: 'too late' })).body.error.code).toBe('CANNOT_CANCEL');
  });

  it('an applicant without a manager skips the manager step; HR (not the applicant) decides', async () => {
    const res = await apply(A.founder, future(90), future(90), { typeKey: 'UNPAID' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING_HR');
    expect(res.body.data.steps.map((s: { status: string }) => s.status)).toEqual(['SKIPPED', 'PENDING']);
    expect((await decide(A.founder, res.body.data.id, 'APPROVE')).body.error.code).toBe('SELF_APPROVAL');
    const done = await decide(A.hr, res.body.data.id, 'APPROVE');
    expect(done.body.data.status).toBe('APPROVED');
    expect(await t.prisma.leaveBalanceTxn.count({ where: { leaveRequestId: res.body.data.id } })).toBe(0); // unpaid type: nothing to debit
  });

  it('approval after the day closed turns a system ABSENT into leave and keeps a correction trail; human records are untouched', async () => {
    const y = addDays(today(), -1);
    const yDate = new Date(`${y}T00:00:00Z`);
    await t.prisma.attendanceRecord.create({ data: { organizationId: fx.org.id, userId: fx.execA2.id, date: yDate, status: 'ABSENT', source: 'SYSTEM' } });
    const r = await apply(A.execA2, y);
    expect(r.status).toBe(201);
    await decide(A.managerA, r.body.data.id, 'APPROVE');
    await decide(A.hr, r.body.data.id, 'APPROVE');
    const rec = await t.prisma.attendanceRecord.findUniqueOrThrow({ where: { userId_date: { userId: fx.execA2.id, date: yDate } } });
    expect(rec).toMatchObject({ status: 'ON_LEAVE', source: 'SYSTEM', version: 2 });
    const trail = await t.prisma.attendanceCorrection.findMany({ where: { recordId: rec.id } });
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ reason: 'Leave approved after the day closed' });
  });

  it('leave calendar is scope-limited and bounded to 92 days', async () => {
    const q = `from=${today()}&to=${addDays(today(), 100)}`;
    const mgr = await A.managerA.get(`/workforce/leave/calendar?from=${today()}&to=${addDays(today(), 90)}`);
    expect(mgr.status).toBe(200);
    expect(mgr.body.data.entries.some((e: { userId: string }) => e.userId === fx.execA2.id)).toBe(true);
    expect(mgr.body.data.entries.every((e: { userId: string }) => [fx.managerA.id, fx.execA1.id, fx.execA2.id].includes(e.userId))).toBe(true);
    expect(JSON.stringify(mgr.body.data)).not.toContain('family event');
    expect((await A.managerA.get(`/workforce/leave/calendar?${q}`)).status).toBe(400);
    const peer = await A.execB1.get(`/workforce/leave/calendar?from=${addDays(today(), -2)}&to=${addDays(today(), 1)}`);
    expect(peer.body.data.entries.every((e: { userId: string }) => e.userId === fx.execB1.id)).toBe(true);
  });
});

describe('cross-organisation isolation', () => {
  it('another organisation sees none of this data and cannot reference it by id', async () => {
    const org2 = await createOrg(t.prisma);
    const hr2 = await createUser(t.prisma, org2, { roles: ['HR'] });
    const a2 = await loginAgent(t.app, hr2);
    const req = await t.prisma.leaveRequest.findFirstOrThrow({ where: { organizationId: fx.org.id } });
    expect((await a2.get(`/workforce/leave/requests/${req.id}`)).status).toBe(404);
    expect((await decide(a2, req.id, 'APPROVE')).status).toBe(404);
    expect((await a2.get(`/workforce/leave/balances?userId=${fx.execA1.id}`)).status).toBe(404);
    expect((await a2.get(`/workforce/attendance/month?userId=${fx.execA1.id}`)).status).toBe(404);
    expect((await a2.put('/workforce/attendance/records').send({ userId: fx.execA1.id, date: addDays(today(), -1), status: 'PRESENT', reason: 'cross-org attempt' })).status).toBe(404);
    expect((await a2.post('/workforce/leave/balances/adjust').send({ userId: fx.execA1.id, typeKey: 'CASUAL', amount: '1', reason: 'cross-org attempt' })).status).toBe(404);
    expect((await a2.get('/workforce/leave/requests?view=all')).body.data).toEqual([]);
  });
});
