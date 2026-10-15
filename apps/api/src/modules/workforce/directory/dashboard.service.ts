import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { addDays } from '@salesos/workforce-core';
import { AccessService, type Principal } from '../../../common/authz';
import { PrismaService } from '../../../common/prisma';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { AnnouncementsService } from './announcements.service';
import { birthdayDaysAway, dayToDate, isoDay, leaveBalanceSummary, scopeIds, todayIn } from './directory.common';

const NA = { available: false as const };
const OPEN_TASK = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REVIEW'] as const;
const LIST = 8;
const mmdd = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const dec = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

/**
 * One dashboard payload per viewer. `employee` is always present; `team` appears when the viewer holds team/org scope on at
 * least one of the work keys; `organisation` for `workforce:dashboard:view` at org scope (HR / Boss). Each block is read-only,
 * queried directly and bounded; blocks with no data say so honestly (never fabricated).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly cfg: WorkforceConfigService, private readonly announcements: AnnouncementsService) {}

  async get(user: Principal) {
    const org = user.organizationId;
    const { config } = await this.cfg.getConfig(org);
    const today = todayIn(config.timezone);
    const level = this.access.scopeLevel(user, 'workforce:dashboard:view')!;
    const employee = await this.employee(user, config, today);
    const team = level === 'team' || level === 'org' ? await this.team(user, today) : null;
    const organisation = level === 'org' ? await this.organisation(user, config, today) : null;
    return { generatedAt: new Date(), today, timezone: config.timezone, scopeLevel: level, employee, team, organisation };
  }

  // ------------------------------------------------------------------ employee
  private async employee(user: Principal, config: Awaited<ReturnType<WorkforceConfigService['getConfig']>>['config'], today: string) {
    const org = user.organizationId;
    const me = user.userId;
    const has = (k: Parameters<AccessService['has']>[1]) => this.access.has(user, k);
    const now = new Date();
    const { calendar, holidays } = await this.cfg.getCalendar(org, today, addDays(today, 90));

    const attendance = has('attendance:view') || has('attendance:self')
      ? await (async () => {
          const rec = await this.prisma.attendanceRecord.findUnique({ where: { userId_date: { userId: me, date: dayToDate(today) } }, select: { status: true, checkInAt: true, checkOutAt: true, workMinutes: true } });
          const holiday = calendar.holidayOn(today);
          return { available: true as const, day: today, dayKind: calendar.kindOf(today), holidayName: holiday?.name ?? null, record: rec };
        })()
      : NA;

    const tasks = has('work-tasks:view')
      ? await (async () => {
          const base = { organizationId: org, assigneeId: me, status: { in: [...OPEN_TASK] } };
          const endOfToday = new Date(`${addDays(today, 1)}T00:00:00Z`);
          const [items, open, overdue, dueToday] = await Promise.all([
            this.prisma.workTask.findMany({ where: base, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: LIST, select: { id: true, title: true, status: true, priority: true, dueAt: true } }),
            this.prisma.workTask.count({ where: base }),
            this.prisma.workTask.count({ where: { ...base, dueAt: { lt: now } } }),
            this.prisma.workTask.count({ where: { ...base, dueAt: { gte: now, lt: endOfToday } } }),
          ]);
          return { available: true as const, hasData: open > 0, open, overdue, dueToday, items: items.map((t) => ({ ...t, overdue: !!t.dueAt && t.dueAt < now })) };
        })()
      : NA;

    const goals = has('goals:view')
      ? await (async () => {
          const rows = await this.prisma.goal.findMany({
            where: { organizationId: org, ownerId: me, status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } },
            orderBy: [{ targetDate: 'asc' }, { id: 'asc' }], take: 5,
            select: { id: true, title: true, status: true, risk: true, progressPct: true, targetDate: true, milestones: { where: { done: false }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { sortOrder: 'asc' }], take: 1, select: { title: true, dueDate: true } } },
          });
          return { available: true as const, hasData: rows.length > 0, items: rows.map((g) => ({ id: g.id, title: g.title, status: g.status, risk: g.risk, progressPct: g.progressPct, targetDate: isoDay(g.targetDate), nextMilestone: g.milestones[0] ? { title: g.milestones[0].title, dueDate: isoDay(g.milestones[0].dueDate) } : null })) };
        })()
      : NA;

    const leave = has('leave:view')
      ? await (async () => {
          const [summary, progress] = await Promise.all([leaveBalanceSummary(this.prisma, org, me, config, today), this.prisma.earnedLeaveProgress.findUnique({ where: { userId: me } })]);
          const required = config.earnedLeave.requiredEligibleDays;
          const eligible = dec(progress?.eligibleDays);
          return {
            available: true as const, ...summary,
            earnedLeave: config.earnedLeave.enabled ? { required, eligibleDays: eligible, daysToNextCredit: Math.max(0, required - eligible), creditsGiven: progress?.creditsGiven ?? 0, processedThrough: isoDay(progress?.processedThrough), started: !!progress } : null,
          };
        })()
      : NA;

    const upcomingHolidays = has('holidays:view')
      ? { available: true as const, items: holidays.filter((h) => h.status === 'APPROVED' && h.date >= today).slice(0, 5).map((h) => ({ date: h.date, name: h.name, kind: h.kind })) }
      : NA;

    const announcements = has('announcements:view')
      ? await (async () => {
          const rows = await this.prisma.announcement.findMany({ where: this.announcements.activeWhere(user, now), orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 5, select: { id: true, title: true, body: true, publishedAt: true, expiresAt: true } });
          return { available: true as const, hasData: rows.length > 0, items: rows };
        })()
      : NA;

    // colleagues who chose to share their birthday: day + month only, never the year; limited to my team and my reporting line
    const birthdays = await (async () => {
      const visible = (await this.access.visibleUsers(user)).ids;
      const ids = new Set<string>(visible);
      if (user.managerId) {
        const peers = await this.prisma.user.findMany({ where: { organizationId: org, managerId: user.managerId, isActive: true }, select: { id: true }, take: 200 });
        peers.forEach((p) => ids.add(p.id));
        ids.add(user.managerId);
      }
      ids.delete(me);
      const rows = await this.prisma.employeeProfile.findMany({ where: { organizationId: org, shareBirthday: true, dateOfBirth: { not: null }, userId: { in: [...ids] } }, select: { userId: true, dateOfBirth: true }, take: 500 });
      const names = await this.prisma.user.findMany({ where: { organizationId: org, isActive: true, id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
      const nm = new Map(names.map((n) => [n.id, n.name]));
      const items = rows
        .map((r) => ({ userId: r.userId, name: nm.get(r.userId), daysAway: birthdayDaysAway(r.dateOfBirth!, today, 14), date: mmdd(r.dateOfBirth!) }))
        .filter((r): r is { userId: string; name: string; daysAway: number; date: string } => !!r.name && r.daysAway !== null)
        .sort((a, b) => a.daysAway - b.daysAway)
        .slice(0, 10);
      return { available: true as const, hasData: items.length > 0, items };
    })();

    return { attendance, tasks, goals, leave, upcomingHolidays, announcements, birthdays };
  }

  // ------------------------------------------------------------------ manager (team)
  private async team(user: Principal, today: string) {
    const org = user.organizationId;
    const wide = async (key: Parameters<AccessService['scopeLevel']>[1]) => {
      const level = this.access.scopeLevel(user, key);
      if (level !== 'team' && level !== 'org') return undefined;
      return scopeIds(this.access, user, key);
    };
    const [attIds, taskIds, goalIds, leaveIds] = await Promise.all([wide('attendance:view'), wide('work-tasks:view'), wide('goals:view'), wide('leave:view')]);
    if (attIds === undefined && taskIds === undefined && goalIds === undefined && leaveIds === undefined) return null;
    const inIds = (ids: string[] | null): Prisma.UuidFilter | undefined => (ids === null ? undefined : { in: ids });
    const memberIds = attIds !== undefined ? attIds : taskIds !== undefined ? taskIds : goalIds !== undefined ? goalIds : leaveIds;
    const members = await this.prisma.user.count({ where: { organizationId: org, isActive: true, ...(memberIds ? { id: { in: memberIds.filter((i) => i !== user.userId) } } : { id: { not: user.userId } }) } });
    const now = new Date();

    const attendance = attIds !== undefined
      ? await (async () => {
          const rows = await this.prisma.attendanceRecord.groupBy({ by: ['status'], where: { organizationId: org, date: dayToDate(today), userId: inIds(attIds) }, _count: { _all: true } });
          const marked = rows.reduce((a, r) => a + r._count._all, 0);
          const total = await this.prisma.user.count({ where: { organizationId: org, isActive: true, ...(attIds ? { id: { in: attIds } } : {}) } });
          return { available: true as const, hasData: marked > 0, members: total, counts: Object.fromEntries(rows.map((r) => [r.status, r._count._all])), notMarked: Math.max(0, total - marked) };
        })()
      : NA;

    const tasks = taskIds !== undefined
      ? await (async () => {
          const base: Prisma.WorkTaskWhereInput = { organizationId: org, assigneeId: inIds(taskIds) };
          const [grouped, overdue, doneRecently] = await Promise.all([
            this.prisma.workTask.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
            this.prisma.workTask.count({ where: { ...base, status: { in: [...OPEN_TASK] }, dueAt: { lt: now } } }),
            this.prisma.workTask.count({ where: { ...base, status: 'COMPLETED', completedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } }),
          ]);
          const c = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
          const assigned = grouped.reduce((a, g) => a + g._count._all, 0);
          return { available: true as const, hasData: assigned > 0, assigned, inProgress: c('IN_PROGRESS') + c('ACCEPTED'), inReview: c('REVIEW'), notStarted: c('ASSIGNED'), completed: c('COMPLETED'), completedLast30Days: doneRecently, overdue };
        })()
      : NA;

    const goals = goalIds !== undefined
      ? await (async () => {
          const base: Prisma.GoalWhereInput = { organizationId: org, ownerId: inIds(goalIds), status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } };
          const [byRisk, byOwner] = await Promise.all([
            this.prisma.goal.groupBy({ by: ['risk'], where: base, _count: { _all: true } }),
            this.prisma.goal.groupBy({ by: ['ownerId'], where: base, _count: { _all: true }, _avg: { progressPct: true }, orderBy: { _avg: { progressPct: 'asc' } }, take: 10 }),
          ]);
          const names = await this.prisma.user.findMany({ where: { organizationId: org, id: { in: byOwner.map((o) => o.ownerId) } }, select: { id: true, name: true } });
          const nm = new Map(names.map((n) => [n.id, n.name]));
          const total = byRisk.reduce((a, r) => a + r._count._all, 0);
          return {
            available: true as const, hasData: total > 0, open: total, byRisk: Object.fromEntries(byRisk.map((r) => [r.risk, r._count._all])),
            byEmployee: byOwner.map((o) => ({ userId: o.ownerId, name: nm.get(o.ownerId) ?? null, goals: o._count._all, avgProgressPct: Math.round(o._avg.progressPct ?? 0) })),
          };
        })()
      : NA;

    const leave = leaveIds !== undefined
      ? await (async () => {
          const where: Prisma.LeaveRequestWhereInput = { organizationId: org, status: { in: ['PENDING_MANAGER', 'PENDING_HR'] }, userId: leaveIds ? { in: leaveIds.filter((i) => i !== user.userId) } : { not: user.userId } };
          const [count, rows] = await Promise.all([this.prisma.leaveRequest.count({ where }), this.prisma.leaveRequest.findMany({ where, orderBy: [{ startDate: 'asc' }, { id: 'asc' }], take: 5, select: { id: true, userId: true, typeKey: true, startDate: true, endDate: true, days: true, status: true } })]);
          const names = await this.prisma.user.findMany({ where: { organizationId: org, id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
          const nm = new Map(names.map((n) => [n.id, n.name]));
          return { available: true as const, hasData: count > 0, pending: count, items: rows.map((r) => ({ id: r.id, userId: r.userId, name: nm.get(r.userId) ?? null, typeKey: r.typeKey, startDate: isoDay(r.startDate), endDate: isoDay(r.endDate), days: dec(r.days), status: r.status })) };
        })()
      : NA;

    return {
      members, attendance, tasks, goals, leave,
      drilldown: [
        { key: 'directory', href: '/work/directory' },
        { key: 'orgChartTeam', href: '/work/org-chart?view=team' },
        ...(goals.available ? [{ key: 'goals', href: '/work/goals' }] : []),
        ...(tasks.available ? [{ key: 'tasks', href: '/work/tasks' }] : []),
        ...(attendance.available ? [{ key: 'attendance', href: '/work/attendance' }] : []),
        ...(leave.available ? [{ key: 'approvals', href: '/work/approvals' }] : []),
      ],
    };
  }

  // ------------------------------------------------------------------ HR / Boss (organisation)
  private async organisation(user: Principal, config: Awaited<ReturnType<WorkforceConfigService['getConfig']>>['config'], today: string) {
    const org = user.organizationId;
    const level = (k: Parameters<AccessService['scopeLevel']>[1]) => this.access.scopeLevel(user, k) === 'org';
    const t = dayToDate(today);
    const active = { organizationId: org, isActive: true };
    const [headcount, onProbation, joiners, departments, endingSoon] = await Promise.all([
      this.prisma.user.count({ where: active }),
      this.prisma.employeeProfile.count({ where: { organizationId: org, probationEndDate: { gte: t }, user: { isActive: true } } }),
      this.prisma.employeeProfile.count({ where: { organizationId: org, joinDate: { gte: dayToDate(addDays(today, -30)), lte: t }, user: { isActive: true } } }),
      this.prisma.user.groupBy({ by: ['department'], where: active, _count: { _all: true }, orderBy: [{ _count: { department: 'desc' } }], take: 30 }),
      this.prisma.employeeProfile.findMany({ where: { organizationId: org, probationEndDate: { gte: t, lte: dayToDate(addDays(today, 14)) }, user: { isActive: true } }, orderBy: [{ probationEndDate: 'asc' }, { id: 'asc' }], take: 10, select: { userId: true, probationEndDate: true } }),
    ]);
    const names = await this.prisma.user.findMany({ where: { organizationId: org, id: { in: endingSoon.map((e) => e.userId) } }, select: { id: true, name: true } });
    const nm = new Map(names.map((n) => [n.id, n.name]));

    const birthdays = this.access.has(user, 'birthdays:view')
      ? await (async () => {
          const window = Math.max(7, ...config.hr.birthdayReminderDays);
          const rows = await this.prisma.employeeProfile.findMany({ where: { organizationId: org, dateOfBirth: { not: null }, user: { isActive: true } }, select: { userId: true, dateOfBirth: true, user: { select: { name: true } } }, take: 2000 });
          const items = rows
            .map((r) => ({ userId: r.userId, name: r.user.name, date: mmdd(r.dateOfBirth!), daysAway: birthdayDaysAway(r.dateOfBirth!, today, window) }))
            .filter((r): r is { userId: string; name: string; date: string; daysAway: number } => r.daysAway !== null)
            .sort((a, b) => a.daysAway - b.daysAway)
            .slice(0, 10);
          return { available: true as const, hasData: items.length > 0, windowDays: window, items };
        })()
      : NA;

    const pendingLeave = level('leave:view')
      ? await (async () => {
          const pending = await this.prisma.leaveRequest.count({ where: { organizationId: org, status: { in: ['PENDING_MANAGER', 'PENDING_HR'] } } });
          return { available: true as const, hasData: pending > 0, pending };
        })()
      : NA;

    const attendanceExceptions = level('attendance:view')
      ? await (async () => {
          const yesterday = addDays(today, -1);
          const [today_, missing] = await Promise.all([
            this.prisma.attendanceRecord.groupBy({ by: ['status'], where: { organizationId: org, date: t, status: { in: ['ABSENT', 'LATE', 'HALF_DAY'] } }, _count: { _all: true } }),
            this.prisma.attendanceRecord.count({ where: { organizationId: org, date: dayToDate(yesterday), checkInAt: { not: null }, checkOutAt: null } }),
          ]);
          const counts = Object.fromEntries(today_.map((r) => [r.status, r._count._all]));
          return { available: true as const, hasData: today_.length > 0 || missing > 0, today: counts, missingCheckOutYesterday: missing };
        })()
      : NA;

    const earnedLeave = level('leave:view')
      ? await (async () => {
          const since = new Date(Date.now() - 30 * 86_400_000);
          const where = { organizationId: org, kind: 'CREDIT_EARNED' as const, createdAt: { gte: since } };
          const [count, rows] = await Promise.all([this.prisma.leaveBalanceTxn.count({ where }), this.prisma.leaveBalanceTxn.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5, select: { id: true, userId: true, amount: true, createdAt: true } })]);
          const un = await this.prisma.user.findMany({ where: { organizationId: org, id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
          const um = new Map(un.map((n) => [n.id, n.name]));
          return { available: true as const, hasData: count > 0, creditsLast30Days: count, items: rows.map((r) => ({ id: r.id, userId: r.userId, name: um.get(r.userId) ?? null, amount: dec(r.amount), at: r.createdAt })) };
        })()
      : NA;

    return {
      headcount, onProbation, newJoinersLast30Days: joiners,
      departments: departments.filter((d) => d.department).map((d) => ({ department: d.department!, headcount: d._count._all, href: `/work/org-chart?view=department&department=${encodeURIComponent(d.department!)}` })),
      probationEndingSoon: { windowDays: 14, items: endingSoon.map((e) => ({ userId: e.userId, name: nm.get(e.userId) ?? null, endDate: isoDay(e.probationEndDate), daysLeft: Math.round(((e.probationEndDate as Date).getTime() - t.getTime()) / 86_400_000) })) },
      birthdays, pendingLeave, attendanceExceptions, earnedLeave,
    };
  }
}
