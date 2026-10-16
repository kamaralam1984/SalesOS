import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { addDays, localDay } from '@salesos/workforce-core';
import { runDayClose } from '../src/jobs/workforce/day-close';
import { runAttendanceDigest } from '../src/jobs/workforce/attendance-digest';
import { runEarnedLeaveSweep } from '../src/jobs/workforce/earned-leave';
import { buildRegistry } from '../src/jobs/registry';

/** Area A worker jobs (real Postgres): day-close materialisation and the Earned Leave sweep. Idempotency + restart safety. */
const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';
let prisma: PrismaClient;
let orgId: string;
let boss: string;
let emp: string;
let late: string;
const today = () => localDay(new Date(), 'Asia/Kolkata');
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const statuses = async (userId: string) => Object.fromEntries((await prisma.attendanceRecord.findMany({ where: { userId } })).map((r) => [r.date.toISOString().slice(0, 10), `${r.status}/${r.source}`]));

beforeAll(async () => {
  prisma = new PrismaClient({ datasourceUrl: DB });
  orgId = (await prisma.organization.create({ data: { name: '[TEST] wf-a-worker', slug: `wfa-${randomUUID().slice(0, 8)}` } })).id;
  const mk = (n: string, managerId?: string) => prisma.user.create({ data: { organizationId: orgId, email: `${n}-${randomUUID().slice(0, 6)}@test.local`, name: n, managerId: managerId ?? null } });
  boss = (await mk('boss')).id;
  emp = (await mk('emp', boss)).id;
  late = (await mk('late', boss)).id;
  // Sunday weekly off (default); a holiday 5 days ago; the employee joined 12 days ago
  await prisma.employeeProfile.createMany({ data: [{ organizationId: orgId, userId: emp, joinDate: d(addDays(today(), -12)) }, { organizationId: orgId, userId: late, joinDate: d(today()) }, { organizationId: orgId, userId: boss, joinDate: d(today()) }] });
});
afterAll(async () => { await prisma.$disconnect(); });

describe('day-close job', () => {
  it('is registered with the workforce registry (hourly, idempotent)', () => {
    const r = buildRegistry();
    expect(r.processors.map((p) => p.queue)).toEqual(expect.arrayContaining(['workforce-day-close', 'workforce-earned-leave']));
    expect(r.repeatables.map((p) => p.name)).toEqual(expect.arrayContaining(['workforce-day-close', 'workforce-earned-leave']));
  });

  it('writes WEEKLY_OFF / HOLIDAY / ON_LEAVE / ABSENT for closed days, never touches today or an existing record', async () => {
    const hol = addDays(today(), -5);
    await prisma.holiday.create({ data: { organizationId: orgId, date: d(hol), name: 'Test holiday', kind: 'COMPANY', status: 'APPROVED' } });
    await prisma.holiday.create({ data: { organizationId: orgId, date: d(addDays(today(), -6)), name: 'Only a suggestion', kind: 'COMPANY', status: 'SUGGESTED' } });
    const leaveDay = addDays(today(), -3);
    await prisma.leaveRequest.create({ data: { organizationId: orgId, userId: emp, typeKey: 'CASUAL', startDate: d(leaveDay), endDate: d(leaveDay), days: 1, reason: 'seed', status: 'APPROVED' } });
    const unpaidDay = addDays(today(), -2);
    await prisma.leaveRequest.create({ data: { organizationId: orgId, userId: emp, typeKey: 'UNPAID', startDate: d(unpaidDay), endDate: d(unpaidDay), days: 1, reason: 'seed', status: 'APPROVED' } });
    // a record written by a human must survive
    const kept = addDays(today(), -8);
    await prisma.attendanceRecord.create({ data: { organizationId: orgId, userId: emp, date: d(kept), status: 'PRESENT', source: 'HR' } });
    // a still-pending leave must not count
    const pend = addDays(today(), -1);
    await prisma.leaveRequest.create({ data: { organizationId: orgId, userId: emp, typeKey: 'CASUAL', startDate: d(pend), endDate: d(pend), days: 1, reason: 'seed', status: 'PENDING_MANAGER' } });

    const r = await runDayClose(prisma);
    expect(r.users).toBeGreaterThanOrEqual(3);
    const s = await statuses(emp);
    expect(Object.keys(s)).toHaveLength(12); // joinDate .. yesterday, no today
    expect(s[today()]).toBeUndefined();
    expect(s[addDays(today(), -13)]).toBeUndefined(); // before joining
    expect(s[hol]).toBe('HOLIDAY/SYSTEM');
    expect(s[addDays(today(), -6)]).not.toBe('HOLIDAY/SYSTEM'); // suggestions never count
    expect(s[leaveDay]).toMatch(/^(ON_LEAVE|WEEKLY_OFF|HOLIDAY)\/SYSTEM$/);
    expect(s[kept]).toBe('PRESENT/HR');
    expect(s[pend]).toMatch(/^(ABSENT|WEEKLY_OFF|HOLIDAY)\/SYSTEM$/);
    for (const [day, v] of Object.entries(s)) {
      const dow = d(day).getUTCDay();
      if (dow === 0) expect(v).toBe('WEEKLY_OFF/SYSTEM');
    }
    // the employee that joined today has nothing to close
    expect(await prisma.attendanceRecord.count({ where: { userId: late } })).toBe(0);
    // the paid/unpaid leave days map to the right status unless they fall on a Sunday/holiday
    if (d(leaveDay).getUTCDay() !== 0 && leaveDay !== hol) expect(s[leaveDay]).toBe('ON_LEAVE/SYSTEM');
    if (d(unpaidDay).getUTCDay() !== 0 && unpaidDay !== hol) expect(s[unpaidDay]).toBe('UNPAID_LEAVE/SYSTEM');
  });

  it('a second run changes nothing (idempotent) and writes no duplicate notifications', async () => {
    const before = await statuses(emp);
    const events = await prisma.outboxEvent.count({ where: { organizationId: orgId } });
    const r = await runDayClose(prisma);
    expect(r.written).toBe(0);
    expect(r.queued).toBe(0);
    expect(await statuses(emp)).toEqual(before);
    expect(await prisma.outboxEvent.count({ where: { organizationId: orgId } })).toBe(events);
  });

  it('restart safety: deleting nothing and re-running concurrently still yields one row per day', async () => {
    await Promise.all([runDayClose(prisma), runDayClose(prisma), runDayClose(prisma)]);
    const rows = await prisma.attendanceRecord.findMany({ where: { userId: emp } });
    expect(new Set(rows.map((x) => x.date.toISOString())).size).toBe(rows.length);
  });

  it('a gap (job was down) is repaired from the joining date on the next run; autoMarkAbsent=false leaves working days unmarked', async () => {
    const gap = addDays(today(), -9);
    await prisma.attendanceRecord.deleteMany({ where: { userId: emp, date: d(gap) } });
    await runDayClose(prisma);
    expect(Object.keys(await statuses(emp))).toContain(gap);

    await prisma.workforceSetting.create({ data: { organizationId: orgId, config: { attendance: { autoMarkAbsent: false } } } });
    await prisma.attendanceRecord.deleteMany({ where: { userId: emp, date: d(gap) } });
    await runDayClose(prisma);
    const after = (await statuses(emp))[gap];
    expect(after === undefined || /WEEKLY_OFF|HOLIDAY|ON_LEAVE|UNPAID/.test(after)).toBe(true);
    await prisma.workforceSetting.delete({ where: { organizationId: orgId } });
  });

  it('yesterday ABSENT raises exactly one generic notification to the manager', async () => {
    const y = addDays(today(), -1);
    const abs = (await prisma.attendanceRecord.findFirst({ where: { userId: emp, date: d(y) } }))?.status;
    const evs = await prisma.outboxEvent.findMany({ where: { organizationId: orgId, eventType: 'notification.requested' } });
    const mine = evs.filter((e) => (e.payload as { dedupeKey?: string }).dedupeKey === `attendance.exception:${emp}:${y}`);
    expect(mine.length).toBe(abs === 'ABSENT' ? 1 : 0);
    if (mine[0]) {
      expect((mine[0].payload as { userIds: string[] }).userIds).toEqual([boss]);
      expect(JSON.stringify(mine[0].payload)).not.toMatch(/emp-/);
    }
  });
});

describe('Earned Leave sweep', () => {
  it('credits once for 20 eligible days, is idempotent, and survives concurrent runs', async () => {
    const worker = (await prisma.user.create({ data: { organizationId: orgId, email: `el-${randomUUID().slice(0, 6)}@test.local`, name: 'el' } })).id;
    await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: worker, joinDate: d(addDays(today(), -25)) } });
    await prisma.attendanceRecord.createMany({ data: Array.from({ length: 24 }, (_, i) => ({ organizationId: orgId, userId: worker, date: d(addDays(today(), -(i + 1))), status: 'PRESENT' as const, source: 'HR' as const })) });
    // Sundays are weekly offs (not eligible) so 24 present records include a few non-counting Sundays: 20 eligible days are reached on the way
    await Promise.all([runEarnedLeaveSweep(prisma), runEarnedLeaveSweep(prisma)]);
    const credits = await prisma.leaveBalanceTxn.findMany({ where: { userId: worker, kind: 'CREDIT_EARNED' } });
    expect(credits.length).toBe(1);
    expect(credits[0]!.uniqueKey).toBe(`EL:${worker}:1`);
    const again = await runEarnedLeaveSweep(prisma);
    expect(again.credits).toBe(0);
    expect(await prisma.leaveBalanceTxn.count({ where: { userId: worker, kind: 'CREDIT_EARNED' } })).toBe(1);
    const prog = await prisma.earnedLeaveProgress.findUniqueOrThrow({ where: { userId: worker } });
    expect(prog.processedThrough?.toISOString().slice(0, 10)).toBe(addDays(today(), -1));
    expect(prog.creditsGiven).toBe(1);
  });

  it('does not credit before 20 eligible days and ignores deactivated employees', async () => {
    const few = (await prisma.user.create({ data: { organizationId: orgId, email: `few-${randomUUID().slice(0, 6)}@test.local`, name: 'few' } })).id;
    await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: few, joinDate: d(addDays(today(), -5)) } });
    const off = (await prisma.user.create({ data: { organizationId: orgId, email: `off-${randomUUID().slice(0, 6)}@test.local`, name: 'off', isActive: false } })).id;
    await runEarnedLeaveSweep(prisma);
    expect(await prisma.leaveBalanceTxn.count({ where: { userId: few } })).toBe(0);
    expect(await prisma.earnedLeaveProgress.count({ where: { userId: off } })).toBe(0);
  });
});

describe('attendance digest to the Boss and HR', () => {
  it('is registered, sends one morning and one evening note per day (counts only), and never doubles on a rerun', async () => {
    expect(buildRegistry().repeatables.map((p) => p.name)).toContain('workforce-attendance-digest');
    const org = (await prisma.organization.create({ data: { name: '[TEST] wf-digest', slug: `wfd-${randomUUID().slice(0, 8)}` } })).id;
    const mk = (n: string) => prisma.user.create({ data: { organizationId: org, email: `${n}-${randomUUID().slice(0, 6)}@test.local`, name: n } });
    const [a, b, c] = [await mk('a'), await mk('b'), await mk('c')];
    // every day is a working day; the cutoff and the end of the day are both 00:00 so both notes are due whatever time this runs at
    await prisma.workforceSetting.create({ data: { organizationId: org, config: { weeklyOffDays: [], attendance: { checkInCutoff: '00:00', workdayEnd: '00:00', requireDayReport: true } } } });
    const day = new Date(`${today()}T00:00:00.000Z`);
    await prisma.attendanceRecord.createMany({
      data: [
        { organizationId: org, userId: a.id, date: day, status: 'LATE', checkInAt: new Date(), lateJoin: true, lateJoinReason: 'client visit', checkOutAt: new Date(), dayReportPct: 80 },
        { organizationId: org, userId: b.id, date: day, status: 'PRESENT', checkInAt: new Date() },
      ],
    });
    const r1 = await runAttendanceDigest(prisma);
    expect(r1.morning).toBeGreaterThanOrEqual(1);
    expect(r1.evening).toBeGreaterThanOrEqual(1);
    const events = await prisma.outboxEvent.findMany({ where: { organizationId: org, eventType: 'notification.requested' } });
    expect(events).toHaveLength(2);
    const morning = events.find((e) => (e.payload as { dedupeKey: string }).dedupeKey.includes('morning'))!.payload as { roles: string[]; message: string; title: string };
    expect(morning.roles).toEqual(['FOUNDER_CEO', 'HR']);
    expect(morning.message).toContain('1 joined after 00:00');
    expect(morning.message).toContain('1 have not checked in');
    expect(JSON.stringify(events)).not.toContain(c.email);
    const evening = events.find((e) => (e.payload as { dedupeKey: string }).dedupeKey.includes('evening'))!.payload as { message: string };
    expect(evening.message).toContain('1 of 2 checked out');
    expect(evening.message).toContain('80%');
    const r2 = await runAttendanceDigest(prisma);
    expect(r2.morning + r2.evening).toBeLessThanOrEqual(r1.morning + r1.evening);
    expect(await prisma.outboxEvent.count({ where: { organizationId: org, eventType: 'notification.requested' } })).toBe(2);
  });
});

describe('weekly progress note to the Boss and HR', () => {
  it('on Monday morning it sends last week\'s task and attendance numbers once (counts only)', async () => {
    const org = (await prisma.organization.create({ data: { name: '[TEST] wf-weekly', slug: `wfw-${randomUUID().slice(0, 8)}` } })).id;
    const u = await prisma.user.create({ data: { organizationId: org, email: `w-${randomUUID().slice(0, 6)}@test.local`, name: 'w' } });
    await prisma.workforceSetting.create({ data: { organizationId: org, config: { weeklyOffDays: [] } } });
    // Monday 2026-10-19, 10:30 IST (05:00 UTC); last week is 2026-10-12 .. 2026-10-18
    const monday = new Date('2026-10-19T05:00:00.000Z');
    await prisma.attendanceRecord.createMany({ data: [
      { organizationId: org, userId: u.id, date: d('2026-10-13'), status: 'PRESENT', source: 'SELF' },
      { organizationId: org, userId: u.id, date: d('2026-10-14'), status: 'LATE', source: 'SELF', lateJoin: true },
    ] });
    await prisma.workTask.create({ data: { organizationId: org, title: 'done task', assignerId: u.id, assigneeId: u.id, status: 'COMPLETED', completedAt: new Date('2026-10-15T08:00:00Z'), createdAt: new Date('2026-10-13T08:00:00Z') } });
    await prisma.workTask.create({ data: { organizationId: org, title: 'open task', assignerId: u.id, assigneeId: u.id, status: 'IN_PROGRESS', createdAt: new Date('2026-10-13T09:00:00Z') } });
    const r1 = await runAttendanceDigest(prisma, monday);
    expect(r1.weekly).toBeGreaterThanOrEqual(1);
    const ev = (await prisma.outboxEvent.findMany({ where: { organizationId: org, eventType: 'notification.requested' } })).map((e) => e.payload as { dedupeKey: string; message: string; roles: string[] });
    const weekly = ev.find((e) => e.dedupeKey.includes('weekly'))!;
    expect(weekly.roles).toEqual(['FOUNDER_CEO', 'HR']);
    expect(weekly.message).toContain('Tasks: 1 of 2 done (50%)');
    expect(weekly.message).toContain('Attendance: 100%');
    expect(weekly.message).toContain('1 late joins');
    expect(weekly.message).not.toContain('done task');
    await runAttendanceDigest(prisma, monday);
    expect((await prisma.outboxEvent.findMany({ where: { organizationId: org, eventType: 'notification.requested' } })).filter((e) => (e.payload as { dedupeKey: string }).dedupeKey.includes('weekly'))).toHaveLength(1);
    // not on other days of the week
    const tuesday = new Date('2026-10-20T05:00:00.000Z');
    await runAttendanceDigest(prisma, tuesday);
    expect((await prisma.outboxEvent.findMany({ where: { organizationId: org, eventType: 'notification.requested' } })).filter((e) => (e.payload as { dedupeKey: string }).dedupeKey.includes('weekly'))).toHaveLength(1);
  });
});
