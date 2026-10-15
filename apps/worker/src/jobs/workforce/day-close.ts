import type { PrismaClient } from '@prisma/client';
import { PLATFORM_EVENTS } from '@salesos/shared-types';
import {
  addDays, buildCalendar, deriveClosedDayStatus, eachDay, leaveCoverage, localDay, resolveWorkConfig,
  type Day, type LeaveCover,
} from '@salesos/workforce-core';
import type { JobRegistry } from '../registry';

export const WORKFORCE_DAY_CLOSE_QUEUE = 'workforce-day-close';
const BATCH = 200;
const MAX_USERS_PER_RUN = 50_000;
/** When an employee already has attendance history only the most recent days are re-scanned; a first run (no rows) backfills from the joining date. */
const LOOKBACK_DAYS = 62;
const dayOf = (d: Date): Day => d.toISOString().slice(0, 10);
const dateOf = (d: Day) => new Date(`${d}T00:00:00.000Z`);

export interface DayCloseResult { users: number; written: number; absent: number; queued: number }

type OrgPolicy = { config: ReturnType<typeof resolveWorkConfig>; today: Day };

/**
 * Nightly day-close (idempotent; safe to run hourly and after a restart, DEC-048 section 2.1).
 * For every active employee and every CLOSED day (before today in the business timezone) from the joining date that has no
 * attendance record it writes HOLIDAY / WEEKLY_OFF (calendar), ON_LEAVE / UNPAID_LEAVE / HALF_DAY (approved leave) or ABSENT
 * (when `attendance.autoMarkAbsent`), source SYSTEM. `createMany(skipDuplicates)` on the (user, date) unique key means an existing
 * record is NEVER overwritten, whoever wrote it and whatever runs concurrently.
 * Yesterday's new ABSENT marks raise one generic `attendance.exception` notification to the line manager (dedupe per employee and day).
 */
export async function runDayClose(prisma: PrismaClient, now = new Date(), opts: { fullHistory?: boolean } = {}): Promise<DayCloseResult> {
  const res: DayCloseResult = { users: 0, written: 0, absent: 0, queued: 0 };
  const policies = new Map<string, OrgPolicy>();
  const policyFor = async (orgId: string): Promise<OrgPolicy> => {
    let p = policies.get(orgId);
    if (!p) {
      const row = await prisma.workforceSetting.findUnique({ where: { organizationId: orgId } });
      const config = resolveWorkConfig(row?.config);
      p = { config, today: localDay(now, config.timezone) };
      policies.set(orgId, p);
    }
    return p;
  };

  let cursor: string | undefined;
  while (res.users < MAX_USERS_PER_RUN) {
    const users = await prisma.user.findMany({
      where: { isActive: true }, orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, organizationId: true, managerId: true, createdAt: true },
    });
    if (users.length === 0) break;
    cursor = users[users.length - 1]!.id;
    const profiles = await prisma.employeeProfile.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, joinDate: true, exitDate: true } });
    const profileOf = new Map(profiles.map((p) => [p.userId, p]));

    for (const u of users) {
      res.users++;
      const { config, today } = await policyFor(u.organizationId);
      const prof = profileOf.get(u.id);
      const joinDay = prof?.joinDate ? dayOf(prof.joinDate) : localDay(u.createdAt, config.timezone);
      const yesterday = addDays(today, -1);
      const last = prof?.exitDate && dayOf(prof.exitDate) < yesterday ? dayOf(prof.exitDate) : yesterday;
      if (joinDay > last) continue;
      const existing = await prisma.attendanceRecord.count({ where: { userId: u.id } });
      const lookbackFrom = addDays(today, -LOOKBACK_DAYS);
      const from = opts.fullHistory || existing === 0 || joinDay > lookbackFrom ? joinDay : lookbackFrom;
      if (from > last) continue;

      const [records, leaves, holidayRows] = await Promise.all([
        prisma.attendanceRecord.findMany({ where: { userId: u.id, date: { gte: dateOf(from), lte: dateOf(last) } }, select: { date: true } }),
        prisma.leaveRequest.findMany({ where: { organizationId: u.organizationId, userId: u.id, status: 'APPROVED', startDate: { lte: dateOf(last) }, endDate: { gte: dateOf(from) } } }),
        prisma.holiday.findMany({ where: { organizationId: u.organizationId, date: { gte: dateOf(from), lte: dateOf(last) } } }),
      ]);
      const have = new Set(records.map((r) => dayOf(r.date)));
      const missing = eachDay(from, last).filter((d) => !have.has(d));
      if (missing.length === 0) continue;

      const calendar = buildCalendar(config, holidayRows.map((h) => ({ date: dayOf(h.date), name: h.name, kind: h.kind, status: h.status })));
      const cover = new Map<Day, LeaveCover>();
      for (const l of leaves) {
        const paid = config.leave.types.find((t) => t.key === l.typeKey)?.isPaid ?? false;
        for (const [d, c] of leaveCoverage({ startDate: dayOf(l.startDate), endDate: dayOf(l.endDate), halfDay: l.halfDay, days: Number(l.days.toString()), unpaidDays: Number(l.unpaidDays.toString()) }, paid, calendar)) if (!cover.has(d)) cover.set(d, c);
      }
      const data = [];
      for (const day of missing) {
        const status = deriveClosedDayStatus({ day, calendar, cover: cover.get(day) ?? null, autoMarkAbsent: config.attendance.autoMarkAbsent });
        if (status) data.push({ organizationId: u.organizationId, userId: u.id, date: dateOf(day), status, source: 'SYSTEM' as const });
      }
      if (data.length === 0) continue;
      const created = await prisma.attendanceRecord.createMany({ data, skipDuplicates: true });
      res.written += created.count;
      const absentYesterday = created.count > 0 && data.some((r) => r.status === 'ABSENT' && dayOf(r.date) === yesterday);
      if (absentYesterday) {
        res.absent++;
        if (u.managerId) {
          const key = `attendance.exception:${u.id}:${yesterday}`;
          const q = await prisma.outboxEvent.createMany({
            data: [{
              eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'attendance_record', aggregateId: u.id, organizationId: u.organizationId, availableAt: now, idempotencyKey: `notification.requested:${key}`,
              payload: { organizationId: u.organizationId, type: 'attendance.exception', userIds: [u.managerId], entity: { type: 'user', id: u.id }, dedupeKey: key, actionUrl: '/work/attendance', title: 'A team member has no attendance recorded for yesterday' },
            }],
            skipDuplicates: true,
          });
          res.queued += q.count;
        }
      }
    }
    if (users.length < BATCH) break;
  }
  return res;
}

export function registerDayClose(registry: JobRegistry): void {
  registry.processor({
    queue: WORKFORCE_DAY_CLOSE_QUEUE,
    concurrency: 1,
    process: async (_job, ctx) => {
      const r = await runDayClose(ctx.prisma);
      if (r.written > 0) ctx.log.info({ job: 'workforce-day-close', ...r }, 'workforce day-close wrote attendance rows');
      return r;
    },
  });
  registry.repeatable({ queue: WORKFORCE_DAY_CLOSE_QUEUE, name: 'workforce-day-close', everyMs: 60 * 60_000 });
}
