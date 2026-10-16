import type { PrismaClient } from '@prisma/client';
import { PLATFORM_EVENTS } from '@salesos/shared-types';
import { addDays, buildCalendar, hhmmToMinutes, isoWeekday, localDay, localMinutes, resolveWorkConfig } from '@salesos/workforce-core';
import type { JobRegistry } from '../registry';

export const WORKFORCE_ATTENDANCE_DIGEST_QUEUE = 'workforce-attendance-digest';
/** Minutes after the check-in cutoff for the morning note, and after the end of the working day for the evening note. */
const MORNING_AFTER_CUTOFF_MIN = 5;
const EVENING_AFTER_END_MIN = 30;
const DIGEST_ROLES = ['FOUNDER_CEO', 'HR'];

export interface AttendanceDigestResult { orgs: number; morning: number; evening: number; weekly: number }
/** Monday at or after this local time: last week's progress (tasks, attendance, late joins) goes to the Boss and HR. */
const WEEKLY_AFTER_MIN = 10 * 60;

/**
 * Daily attendance notes to the Boss and HR (idempotent: one note per organisation, kind and day through the outbox key, so hourly runs
 * and restarts never double-send). Notifications are generic (counts only, no names); the day sheet in the app has the details.
 *  - morning (just after the check-in cutoff, e.g. 11:05): how many joined late with a reason, how many have not checked in at all;
 *  - weekly (Monday from 10:00): last week's tasks done, attendance and late joins;
 *  - evening (e.g. 19:30): how many checked out, how many filled the end-of-day task report (and the average done), how many are still not checked out.
 * Skipped on weekly offs and holidays.
 */
export async function runAttendanceDigest(prisma: PrismaClient, now = new Date()): Promise<AttendanceDigestResult> {
  const res: AttendanceDigestResult = { orgs: 0, morning: 0, evening: 0, weekly: 0 };
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    res.orgs++;
    const row = await prisma.workforceSetting.findUnique({ where: { organizationId: org.id } });
    const config = resolveWorkConfig(row?.config);
    const day = localDay(now, config.timezone);
    const holidays = await prisma.holiday.findMany({ where: { organizationId: org.id, date: new Date(`${day}T00:00:00.000Z`) } });
    const calendar = buildCalendar(config, holidays.map((h) => ({ date: day, name: h.name, kind: h.kind, status: h.status })));
    if (calendar.kindOf(day) !== 'WORKING') continue;
    const minutes = localMinutes(now, config.timezone);
    const date = new Date(`${day}T00:00:00.000Z`);
    const people = await prisma.user.findMany({ where: { organizationId: org.id, isActive: true }, select: { id: true } });
    const ids = people.map((p) => p.id);
    const push = async (kind: 'morning' | 'evening' | 'weekly', title: string, message: string, severityType: 'attendance.exception' | 'digest.summary') => {
      const key = `attendance.digest.${kind}:${org.id}:${day}`;
      const r = await prisma.outboxEvent.createMany({
        data: [{
          eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'organization', aggregateId: org.id, organizationId: org.id, availableAt: now, idempotencyKey: `notification.requested:${key}`,
          payload: { organizationId: org.id, type: severityType, roles: DIGEST_ROLES, entity: { type: 'organization', id: org.id }, dedupeKey: key, actionUrl: kind === 'weekly' ? '/work/reports' : '/work/attendance', title, message },
        }],
        skipDuplicates: true,
      });
      return r.count;
    };

    if (minutes >= Math.min(hhmmToMinutes(config.attendance.checkInCutoff) + MORNING_AFTER_CUTOFF_MIN, 23 * 60 + 59)) {
      const [records, onLeave] = await Promise.all([
        prisma.attendanceRecord.findMany({ where: { organizationId: org.id, date, userId: { in: ids } }, select: { userId: true, lateJoin: true } }),
        prisma.leaveRequest.findMany({ where: { organizationId: org.id, status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } }, select: { userId: true } }),
      ]);
      const marked = new Set(records.map((r) => r.userId));
      const away = new Set(onLeave.map((l) => l.userId));
      const lateJoins = records.filter((r) => r.lateJoin).length;
      const notIn = ids.filter((id) => !marked.has(id) && !away.has(id)).length;
      if (lateJoins > 0 || notIn > 0) {
        res.morning += await push('morning', 'Late joins and missing check-ins today',
          `${lateJoins} joined after ${config.attendance.checkInCutoff} (with a reason) and ${notIn} have not checked in. Open the attendance day sheet for names.`, 'attendance.exception');
      }
    }

    if (isoWeekday(day) === 1 && minutes >= WEEKLY_AFTER_MIN) {
      const from = addDays(day, -7);
      const to = addDays(day, -1);
      const range = { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) };
      const inst = { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${day}T00:00:00Z`) };
      const [att, tasks] = await Promise.all([
        prisma.attendanceRecord.findMany({ where: { organizationId: org.id, date: range, userId: { in: ids } }, select: { status: true, lateJoin: true } }),
        prisma.workTask.findMany({
          where: { organizationId: org.id, assigneeId: { in: ids }, status: { notIn: ['CANCELLED', 'REJECTED'] }, OR: [{ createdAt: inst }, { dueAt: inst }] },
          select: { status: true },
        }),
      ]);
      if (att.length > 0 || tasks.length > 0) {
        const marked = att.filter((a) => ['PRESENT', 'LATE', 'WFH', 'HALF_DAY', 'ABSENT', 'UNPAID_LEAVE'].includes(a.status));
        const present = att.filter((a) => ['PRESENT', 'LATE', 'WFH'].includes(a.status)).length;
        const done = tasks.filter((t) => t.status === 'COMPLETED').length;
        const attPct = marked.length ? Math.round((100 * present) / marked.length) : null;
        res.weekly += await push('weekly', 'Last week\'s progress',
          `Tasks: ${done} of ${tasks.length} done${tasks.length ? ` (${Math.round((100 * done) / tasks.length)}%)` : ''}. Attendance: ${attPct === null ? 'no records' : `${attPct}%`}. ${att.filter((a) => a.lateJoin).length} late joins after the cutoff. Open the weekly progress report for each person.`, 'digest.summary');
      }
    }

    if (config.attendance.requireDayReport && minutes >= Math.min(hhmmToMinutes(config.attendance.workdayEnd) + EVENING_AFTER_END_MIN, 23 * 60 + 59)) {
      const records = await prisma.attendanceRecord.findMany({
        where: { organizationId: org.id, date, userId: { in: ids }, checkInAt: { not: null } },
        select: { checkOutAt: true, dayReportPct: true },
      });
      if (records.length > 0) {
        const out = records.filter((r) => r.checkOutAt);
        const reports = out.filter((r) => r.dayReportPct !== null);
        const avg = reports.length ? Math.round(reports.reduce((n, r) => n + (r.dayReportPct ?? 0), 0) / reports.length) : null;
        res.evening += await push('evening', 'End-of-day attendance and task report',
          `${out.length} of ${records.length} checked out; ${reports.length} filled the task report${avg === null ? '' : ` (on average ${avg}% of the day's work done)`}; ${records.length - out.length} not checked out yet.`, 'digest.summary');
      }
    }
  }
  return res;
}

export function registerAttendanceDigest(registry: JobRegistry): void {
  registry.processor({
    queue: WORKFORCE_ATTENDANCE_DIGEST_QUEUE,
    concurrency: 1,
    process: async (_job, ctx) => {
      const r = await runAttendanceDigest(ctx.prisma);
      if (r.morning + r.evening + r.weekly > 0) ctx.log.info({ job: 'workforce-attendance-digest', ...r }, 'attendance digest queued');
      return r;
    },
  });
  registry.repeatable({ queue: WORKFORCE_ATTENDANCE_DIGEST_QUEUE, name: 'workforce-attendance-digest', everyMs: 10 * 60_000 });
}
