import { Injectable } from '@nestjs/common';
import { Prisma, type AttendanceRecord } from '@prisma/client';
import { PLATFORM_EVENTS, WORKFORCE_EVENTS } from '@salesos/shared-types';
import type { attendanceCorrectionSchema, attendanceMonthQuerySchema, checkInSchema, checkOutSchema, correctionsQuerySchema, daySheetQuerySchema, teamSummaryQuerySchema, WorkforceConfig } from '@salesos/validation';
import {
  addDays, canSeeMeeting, classifyCheckIn, classifyCheckOut, eachDay, isCheckInOpen, lateMinutesOf, lateSoFarMinutes, localDay, minutesBetween, monthEnd, monthOf, monthStart, overtimeMinutesOf, startOfLocalDay, summarise, TASK_OPEN,
  type AttendanceSummary,
} from '@salesos/workforce-core';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { asPage, assertTargetInScope, isoDay, scopeUserIds, toDate, userNameMap } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { assertEmployee } from '../leave/leave.common';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

/** Roles whose attendance corrections are not limited by `managerCorrectionWindowDays` (HR and the Boss). */
const UNLIMITED_CORRECTORS = ['HR', 'FOUNDER_CEO'];

/**
 * What clients see of one record. `lateMinutes` / `overtimeMinutes` are stored at check-in / check-out; rows from before those columns
 * existed are derived from the times when the policy is passed (WFH has no lateness).
 */
const recordView = (r: AttendanceRecord, config?: Pick<WorkforceConfig, 'timezone' | 'attendance'>) => ({
  id: r.id, userId: r.userId, date: isoDay(r.date)!, status: r.status, checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, workMinutes: r.workMinutes,
  lateMinutes: r.lateMinutes ?? (config && r.checkInAt && r.status !== 'WFH' ? lateMinutesOf(config, r.checkInAt) : null),
  overtimeMinutes: r.overtimeMinutes ?? (config && r.checkOutAt ? overtimeMinutesOf(config, isoDay(r.date)!, r.checkOutAt) : null),
  meetingJoinedAt: r.meetingJoinedAt,
  lateJoin: r.lateJoin, lateJoinReason: r.lateJoinReason,
  dayReportPct: r.dayReportPct, dayReportNote: r.dayReportNote, tasksDone: r.tasksDone, tasksOpen: r.tasksOpen,
  source: r.source, note: r.note, version: r.version,
});

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cfg: WorkforceConfigService,
  ) {}

  // ------------------------------------------------------------------ self service
  async checkIn(user: Principal, body: Dto<typeof checkInSchema>) {
    const now = new Date();
    const { config } = await this.cfg.getConfig(user.organizationId);
    if (!config.attendance.selfCheckIn) throw new AppError('SELF_CHECK_IN_DISABLED', 'Self check-in is turned off by policy; ask HR or your manager to record attendance', 403);
    const today = localDay(now, config.timezone);
    const { calendar } = await this.cfg.getCalendar(user.organizationId, today, today);
    const kind = calendar.kindOf(today);
    if (kind !== 'WORKING') throw new AppError('NON_WORKING_DAY', kind === 'HOLIDAY' ? 'Today is a holiday' : 'Today is not a working day. HR can record attendance if you worked.', 409);
    const lateJoin = !isCheckInOpen(config, now);
    if (lateJoin) {
      if (!config.attendance.lateJoinAllowed) {
        throw new AppError('CHECK_IN_CLOSED', `Self check-in closed at ${config.attendance.checkInCutoff}. Ask HR or your manager to record your attendance.`, 409);
      }
      if (!body.reason) throw new AppError('LATE_JOIN_REASON_REQUIRED', `It is after ${config.attendance.checkInCutoff}. Tell HR why you are joining late.`, 422);
    }
    // joining after the cutoff is always at least LATE, whatever the mode (WFH keeps its own status)
    const status = classifyCheckIn(config, now, body.mode);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rec = await tx.attendanceRecord.create({ data: { organizationId: user.organizationId, userId: user.userId, date: toDate(today), status, checkInAt: now, lateMinutes: lateMinutesOf(config, now, body.mode), lateJoin, lateJoinReason: lateJoin ? body.reason ?? null : null, source: 'SELF' } });
        await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'attendance.checked_in', entityType: 'attendance_record', entityId: rec.id, metadata: { date: today, status, mode: body.mode, lateJoin } });
        return recordView(rec, config);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.attendanceRecord.findUnique({ where: { userId_date: { userId: user.userId, date: toDate(today) } } });
        throw new AppError('ALREADY_CHECKED_IN', 'Attendance for today is already recorded', 409, existing ? recordView(existing, config) : undefined);
      }
      throw e;
    }
  }

  async checkOut(user: Principal, body: Dto<typeof checkOutSchema> = {}) {
    const now = new Date();
    const { config } = await this.cfg.getConfig(user.organizationId);
    const today = localDay(now, config.timezone);
    // today's record, or yesterday's still-open one (overnight shift)
    const rec = await this.prisma.attendanceRecord.findFirst({
      where: { userId: user.userId, organizationId: user.organizationId, date: { gte: toDate(addDays(today, -1)), lte: toDate(today) }, checkInAt: { not: null }, checkOutAt: null },
      orderBy: { date: 'desc' },
    });
    if (!rec || !rec.checkInAt) {
      const done = await this.prisma.attendanceRecord.findUnique({ where: { userId_date: { userId: user.userId, date: toDate(today) } } });
      if (done?.checkOutAt) throw new AppError('ALREADY_CHECKED_OUT', 'You have already checked out today', 409, recordView(done, config));
      throw new AppError('NOT_CHECKED_IN', 'Check in first', 409);
    }
    if (config.attendance.requireDayReport) {
      if (body.dayReportPct === undefined) throw new AppError('DAY_REPORT_REQUIRED', 'Fill in how much of today\'s work is done before you check out', 422);
      if (body.dayReportPct < 100 && !body.dayReportNote?.trim()) throw new AppError('DAY_REPORT_NOTE_REQUIRED', 'Add a short note on what is still pending', 422);
    }
    const res = classifyCheckOut(config, rec.status, rec.checkInAt, now);
    const day = isoDay(rec.date)!;
    const dayStart = startOfLocalDay(day, config.timezone);
    const dayEnd = startOfLocalDay(addDays(day, 1), config.timezone);
    const [tasksDone, tasksOpen] = await Promise.all([
      this.prisma.workTask.count({ where: { organizationId: user.organizationId, assigneeId: user.userId, status: 'COMPLETED', completedAt: { gte: dayStart, lt: dayEnd } } }),
      this.prisma.workTask.count({ where: { organizationId: user.organizationId, assigneeId: user.userId, status: { in: [...TASK_OPEN] }, dueAt: { lt: dayEnd } } }),
    ]);
    return this.prisma.$transaction(async (tx) => {
      const upd = await tx.attendanceRecord.updateMany({
        where: { id: rec.id, checkOutAt: null, version: rec.version },
        data: {
          checkOutAt: now, workMinutes: res.workMinutes, overtimeMinutes: overtimeMinutesOf(config, day, now), status: res.status, version: { increment: 1 },
          dayReportPct: body.dayReportPct ?? null, dayReportNote: body.dayReportNote?.trim() || null, tasksDone, tasksOpen,
        },
      });
      if (upd.count !== 1) throw conflict('ALREADY_CHECKED_OUT', 'You have already checked out');
      const out = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: rec.id } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'attendance.checked_out', entityType: 'attendance_record', entityId: rec.id, metadata: { date: day, workMinutes: res.workMinutes, status: res.status, needsReview: res.needsReview, dayReportPct: body.dayReportPct ?? null, tasksDone, tasksOpen } });
      return { ...recordView(out, config), needsReview: res.needsReview };
    });
  }

  async today(user: Principal) {
    const now = new Date();
    const { config } = await this.cfg.getConfig(user.organizationId);
    const today = localDay(now, config.timezone);
    const { calendar } = await this.cfg.getCalendar(user.organizationId, today, today);
    const rec = await this.prisma.attendanceRecord.findFirst({
      where: { userId: user.userId, organizationId: user.organizationId, date: { gte: toDate(addDays(today, -1)), lte: toDate(today) } },
      orderBy: { date: 'desc' },
    });
    const todays = rec && isoDay(rec.date) === today ? rec : null;
    const open = rec && rec.checkInAt && !rec.checkOutAt ? rec : null;
    const holiday = calendar.holidayOn(today);
    const kind = calendar.kindOf(today);
    const cutoffPassed = !isCheckInOpen(config, now);
    const meetingUrl = config.attendance.meetingUrl;
    // The meeting link is returned only here, and only when today's own record shows the person as present.
    const meeting = meetingUrl && todays && canSeeMeeting(todays.status) ? { url: meetingUrl } : null;
    return {
      date: today, timezone: config.timezone, dayKind: kind, holiday: holiday ? { name: holiday.name, kind: holiday.kind } : null,
      record: todays ? recordView(todays, config) : open ? recordView(open, config) : null,
      can: { checkIn: config.attendance.selfCheckIn && kind === 'WORKING' && !todays && (!cutoffPassed || config.attendance.lateJoinAllowed), checkOut: !!open },
      /** after the cutoff with late join off: nobody can check in themselves */
      checkInClosed: cutoffPassed && !config.attendance.lateJoinAllowed && !todays && kind === 'WORKING' && config.attendance.selfCheckIn,
      /** after the cutoff with late join on: check-in still works but needs a reason and HR is told */
      lateJoin: cutoffPassed && config.attendance.lateJoinAllowed && !todays && kind === 'WORKING' && config.attendance.selfCheckIn,
      /** minutes past the late time right now, for someone who has not checked in on a working day (null otherwise) */
      lateByMinutes: !todays && kind === 'WORKING' ? lateSoFarMinutes(config, now) : null,
      meeting,
      policy: { lateAfter: config.attendance.lateAfter, checkInCutoff: config.attendance.checkInCutoff, workdayEnd: config.attendance.workdayEnd, fullDayMinutes: config.attendance.fullDayMinutes, selfCheckIn: config.attendance.selfCheckIn, lateJoinAllowed: config.attendance.lateJoinAllowed, requireDayReport: config.attendance.requireDayReport },
    };
  }

  // ------------------------------------------------------------------ reads
  async month(user: Principal, q: Dto<typeof attendanceMonthQuerySchema>) {
    const targetId = q.userId ?? user.userId;
    await assertTargetInScope(this.access, user, 'attendance:view', targetId);
    const target = await this.prisma.user.findFirst({ where: { id: targetId, organizationId: user.organizationId }, select: { id: true, name: true } });
    if (!target) throw notFound('Employee');
    const { config } = await this.cfg.getConfig(user.organizationId);
    const month = q.month ?? monthOf(localDay(new Date(), config.timezone));
    const from = monthStart(month);
    const to = monthEnd(month);
    const [{ calendar }, records, leaves] = await Promise.all([
      this.cfg.getCalendar(user.organizationId, from, to),
      this.prisma.attendanceRecord.findMany({ where: { userId: targetId, organizationId: user.organizationId, date: { gte: toDate(from), lte: toDate(to) } }, orderBy: { date: 'asc' } }),
      this.prisma.leaveRequest.findMany({ where: { userId: targetId, organizationId: user.organizationId, status: { in: ['APPROVED', 'PENDING_MANAGER', 'PENDING_HR'] }, startDate: { lte: toDate(to) }, endDate: { gte: toDate(from) } }, select: { startDate: true, endDate: true, status: true, typeKey: true, halfDay: true } }),
    ]);
    const byDay = new Map(records.map((r) => [isoDay(r.date)!, r]));
    const days = eachDay(from, to).map((date) => {
      const rec = byDay.get(date);
      const holiday = calendar.holidayOn(date);
      const leave = leaves.find((l) => isoDay(l.startDate)! <= date && isoDay(l.endDate)! >= date);
      return {
        date, dayKind: calendar.kindOf(date), holiday: holiday?.name ?? null, record: rec ? recordView(rec, config) : null,
        leave: leave ? { typeKey: leave.typeKey, status: leave.status, halfDay: leave.halfDay } : null,
      };
    });
    const summary: AttendanceSummary = summarise(records.map((r) => ({ status: r.status, workMinutes: r.workMinutes })));
    const views = records.map((r) => recordView(r, config));
    const extras = {
      lateDays: views.filter((v) => (v.lateMinutes ?? 0) > 0).length,
      lateMinutes: views.reduce((n, v) => n + (v.lateMinutes ?? 0), 0),
      overtimeMinutes: views.reduce((n, v) => n + (v.overtimeMinutes ?? 0), 0),
      meetingJoinedDays: views.filter((v) => v.meetingJoinedAt).length,
    };
    return { userId: targetId, userName: target.name, month, from, to, summary: { ...summary, ...extras }, workingDays: calendar.workingDaysBetween(from, to), days };
  }

  async teamSummary(user: Principal, q: Dto<typeof teamSummaryQuerySchema>) {
    const ids = await scopeUserIds(this.access, user, 'attendance:view');
    const { config } = await this.cfg.getConfig(user.organizationId);
    const date = q.date ?? localDay(new Date(), config.timezone);
    const { calendar } = await this.cfg.getCalendar(user.organizationId, date, date);
    const people = await this.prisma.user.findMany({ where: { organizationId: user.organizationId, isActive: true, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true }, take: 5000 });
    const grouped = await this.prisma.attendanceRecord.groupBy({ by: ['status'], where: { organizationId: user.organizationId, date: toDate(date), userId: { in: people.map((p) => p.id) } }, _count: { _all: true } });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;
    const recorded = grouped.reduce((n, g) => n + g._count._all, 0);
    const kind = calendar.kindOf(date);
    return { date, dayKind: kind, total: people.length, recorded, notMarked: kind === 'WORKING' ? Math.max(0, people.length - recorded) : 0, byStatus };
  }

  async corrections(user: Principal, q: Dto<typeof correctionsQuerySchema>) {
    const ids = await scopeUserIds(this.access, user, 'attendance:view');
    if (q.userId && ids && !ids.includes(q.userId)) throw notFound('Employee');
    const where: Prisma.AttendanceCorrectionWhereInput = {
      organizationId: user.organizationId,
      ...(q.userId ? { userId: q.userId } : ids ? { userId: { in: ids } } : {}),
      ...(q.from || q.to ? { date: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}),
    };
    const rows = await this.prisma.attendanceCorrection.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.userId, r.correctedById]));
    return asPage(res, res.data.map((r) => ({ id: r.id, userId: r.userId, userName: names.get(r.userId) ?? null, date: isoDay(r.date), oldValue: r.oldValue, newValue: r.newValue, reason: r.reason, correctedById: r.correctedById, correctedByName: names.get(r.correctedById) ?? null, createdAt: r.createdAt })));
  }

  // ------------------------------------------------------------------ correction (HR / manager)
  async correct(user: Principal, dto: Dto<typeof attendanceCorrectionSchema>) {
    if (dto.userId === user.userId) throw forbidden('You cannot correct your own attendance; ask your manager or HR');
    await assertTargetInScope(this.access, user, 'attendance:correct', dto.userId);
    await assertEmployee(this.prisma, user.organizationId, dto.userId);
    const { config } = await this.cfg.getConfig(user.organizationId);
    const today = localDay(new Date(), config.timezone);
    if (dto.date > today) throw new AppError('FUTURE_DATE', 'Attendance cannot be corrected for a future date', 400);
    const unlimited = user.roles.some((r) => UNLIMITED_CORRECTORS.includes(r));
    const window = config.attendance.managerCorrectionWindowDays;
    if (!unlimited && dto.date < addDays(today, -window)) throw new AppError('CORRECTION_WINDOW_EXPIRED', `Managers can correct attendance up to ${window} days back; ask HR`, 403);
    for (const t of [dto.checkInAt, dto.checkOutAt]) if (t && localDay(t, config.timezone) < dto.date) throw new AppError('TIME_OUTSIDE_DATE', 'Check-in/out cannot be before the corrected date', 400);
    if (dto.checkInAt && localDay(dto.checkInAt, config.timezone) !== dto.date) throw new AppError('TIME_OUTSIDE_DATE', 'Check-in must be on the corrected date', 400);
    const source = unlimited ? 'HR' : 'MANAGER';
    const date = toDate(dto.date);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`att:${dto.userId}:${dto.date}`}))`;
      const old = await tx.attendanceRecord.findUnique({ where: { userId_date: { userId: dto.userId, date } } });
      if (old && old.organizationId !== user.organizationId) throw notFound('Employee');
      if (dto.version !== undefined && (old?.version ?? 0) !== dto.version) throw conflict('VERSION_CONFLICT', 'The record changed since you opened it; reload and try again');
      const checkInAt = dto.checkInAt === undefined ? old?.checkInAt ?? null : dto.checkInAt;
      const checkOutAt = dto.checkOutAt === undefined ? old?.checkOutAt ?? null : dto.checkOutAt;
      const workMinutes = checkInAt && checkOutAt ? minutesBetween(checkInAt, checkOutAt) : null;
      // lateness and overtime follow the corrected times (WFH has no lateness)
      const lateMinutes = checkInAt && dto.status !== 'WFH' ? lateMinutesOf(config, checkInAt) : null;
      const overtimeMinutes = checkOutAt ? overtimeMinutesOf(config, dto.date, checkOutAt) : null;
      const data = { status: dto.status, checkInAt, checkOutAt, workMinutes, lateMinutes, overtimeMinutes, source: source as 'HR' | 'MANAGER', note: dto.reason };
      const rec = old
        ? await tx.attendanceRecord.update({ where: { id: old.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.attendanceRecord.create({ data: { organizationId: user.organizationId, userId: dto.userId, date, ...data } });
      const snap = (r: { status: string; checkInAt: Date | null; checkOutAt: Date | null; workMinutes: number | null; source?: string } | null) =>
        r ? { status: r.status, checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, workMinutes: r.workMinutes, source: r.source ?? null } : null;
      await tx.attendanceCorrection.create({
        data: { organizationId: user.organizationId, recordId: rec.id, userId: dto.userId, date, oldValue: (snap(old) ?? { status: null }) as Prisma.InputJsonValue, newValue: snap(rec) as Prisma.InputJsonValue, reason: dto.reason, correctedById: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'attendance.corrected', entityType: 'attendance_record', entityId: rec.id, metadata: { userId: dto.userId, date: dto.date, from: old?.status ?? null, to: rec.status, source } });
      const key = `${rec.id}:${rec.version}`;
      await this.outbox.publish(tx, {
        eventType: WORKFORCE_EVENTS.ATTENDANCE_CORRECTED, aggregateType: 'attendance_record', aggregateId: rec.id, organizationId: user.organizationId,
        payload: { organizationId: user.organizationId, userId: dto.userId, date: dto.date, status: rec.status, correctedById: user.userId }, idempotencyKey: `${WORKFORCE_EVENTS.ATTENDANCE_CORRECTED}:${key}`,
      });
      await this.outbox.publish(tx, {
        eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'attendance_record', aggregateId: rec.id, organizationId: user.organizationId,
        payload: { organizationId: user.organizationId, type: 'attendance.exception', userIds: [dto.userId], entity: { type: 'attendance_record', id: rec.id }, dedupeKey: `attendance.corrected:${key}`, actionUrl: '/work/attendance', title: 'Your attendance record was corrected' },
        idempotencyKey: `notification.requested:attendance.corrected:${key}`,
      });
      return rec;
    });
    return recordView(result, config);
  }

  // ------------------------------------------------------------------ meeting button
  /** The person pressed the meeting button. Recorded once per day (the first press); only for someone marked present with a meeting link configured. */
  async meetingJoin(user: Principal) {
    const now = new Date();
    const { config } = await this.cfg.getConfig(user.organizationId);
    const today = localDay(now, config.timezone);
    if (!config.attendance.meetingUrl) throw new AppError('NO_MEETING', 'No meeting link is set', 409);
    const rec = await this.prisma.attendanceRecord.findUnique({ where: { userId_date: { userId: user.userId, date: toDate(today) } } });
    if (!rec || rec.organizationId !== user.organizationId || !canSeeMeeting(rec.status)) throw new AppError('NOT_CHECKED_IN', 'Check in first to join the meeting', 409);
    if (rec.meetingJoinedAt) return { joinedAt: rec.meetingJoinedAt, first: false };
    const upd = await this.prisma.attendanceRecord.updateMany({ where: { id: rec.id, meetingJoinedAt: null }, data: { meetingJoinedAt: now } });
    if (upd.count === 1) {
      await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'attendance.meeting_joined', entityType: 'attendance_record', entityId: rec.id, metadata: { date: today } });
    }
    const fresh = await this.prisma.attendanceRecord.findUniqueOrThrow({ where: { id: rec.id } });
    return { joinedAt: fresh.meetingJoinedAt, first: upd.count === 1 };
  }

  // ------------------------------------------------------------------ day sheet (HR / managers)
  /** Everyone in the caller's scope for one day: status, check-in time, how late, meeting button, check-out and overtime. People with no record are listed as not marked. */
  async daySheet(user: Principal, q: Dto<typeof daySheetQuerySchema>) {
    const ids = await scopeUserIds(this.access, user, 'attendance:view');
    const { config } = await this.cfg.getConfig(user.organizationId);
    const date = q.date ?? localDay(new Date(), config.timezone);
    const { calendar } = await this.cfg.getCalendar(user.organizationId, date, date);
    const people = await this.prisma.user.findMany({
      where: { organizationId: user.organizationId, isActive: true, ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500,
    });
    const records = await this.prisma.attendanceRecord.findMany({ where: { organizationId: user.organizationId, date: toDate(date), userId: { in: people.map((p) => p.id) } } });
    const byUser = new Map(records.map((r) => [r.userId, r]));
    const items = people.map((p) => {
      const rec = byUser.get(p.id);
      const v = rec ? recordView(rec, config) : null;
      return {
        userId: p.id, name: p.name, status: v?.status ?? null, checkInAt: v?.checkInAt ?? null, lateMinutes: v?.lateMinutes ?? null,
        meetingJoinedAt: v?.meetingJoinedAt ?? null, checkOutAt: v?.checkOutAt ?? null, workMinutes: v?.workMinutes ?? null, overtimeMinutes: v?.overtimeMinutes ?? null, source: v?.source ?? null,
        lateJoin: v?.lateJoin ?? false, lateJoinReason: v?.lateJoinReason ?? null, dayReportPct: v?.dayReportPct ?? null, dayReportNote: v?.dayReportNote ?? null, tasksDone: v?.tasksDone ?? null, tasksOpen: v?.tasksOpen ?? null,
      };
    });
    // marked people first by check-in time, then the not-marked
    items.sort((a, b) => (a.checkInAt && b.checkInAt ? a.checkInAt.getTime() - b.checkInAt.getTime() : a.checkInAt ? -1 : b.checkInAt ? 1 : a.name.localeCompare(b.name)));
    const marked = items.filter((i) => i.status);
    const kind = calendar.kindOf(date);
    return {
      date, dayKind: kind, timezone: config.timezone,
      policy: { lateAfter: config.attendance.lateAfter, checkInCutoff: config.attendance.checkInCutoff, workdayEnd: config.attendance.workdayEnd, meetingConfigured: Boolean(config.attendance.meetingUrl) },
      totals: {
        people: items.length, marked: marked.length, notMarked: kind === 'WORKING' ? items.length - marked.length : 0,
        late: marked.filter((i) => (i.lateMinutes ?? 0) > 0).length, lateMinutes: marked.reduce((n, i) => n + (i.lateMinutes ?? 0), 0),
        meetingJoined: marked.filter((i) => i.meetingJoinedAt).length, lateJoins: marked.filter((i) => i.lateJoin).length, reportsFilled: marked.filter((i) => i.dayReportPct !== null).length, overtimeMinutes: marked.reduce((n, i) => n + (i.overtimeMinutes ?? 0), 0),
      },
      items,
    };
  }
}
