import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { addMonths } from '@salesos/workforce-core';
import type { ListDirectoryQuery } from '@salesos/validation';
import { AccessService, type Principal } from '../../../common/authz';
import { notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { dayToDate, employmentStatus, inScope, isoDay, leaveBalanceSummary, statusWhere, todayIn } from './directory.common';

export const MAX_LIST_ITEMS = 10;

@Injectable()
export class DirectoryService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly cfg: WorkforceConfigService) {}

  private async today(orgId: string) {
    const { config } = await this.cfg.getConfig(orgId);
    return { today: todayIn(config.timezone), config };
  }

  /** Minimum-data directory row: name, employee code, designation, department, manager, status. No contact data, DOB or pay. */
  async list(user: Principal, q: ListDirectoryQuery) {
    const { today } = await this.today(user.organizationId);
    const scoped = (await this.access.scopedWhere(user, { permission: 'directory:view', ownerField: 'id' })) as Prisma.UserWhereInput;
    const and: Prisma.UserWhereInput[] = [scoped];
    if (q.department) and.push({ department: q.department });
    if (q.managerId) and.push({ managerId: q.managerId });
    // exited employees are listed only when asked for explicitly
    and.push(q.status ? statusWhere(q.status, today) : { NOT: statusWhere('EXITED', today) });
    // Prisma does not escape LIKE wildcards in `contains`: escape them so the search text is always literal
    const s = q.search?.trim().replace(/[\\%_]/g, '\\$&');
    if (s) {
      and.push({
        OR: [
          { name: { contains: s, mode: 'insensitive' } },
          { department: { contains: s, mode: 'insensitive' } },
          { manager: { name: { contains: s, mode: 'insensitive' } } },
          { employeeProfileUser: { some: { OR: [{ employeeCode: { contains: s, mode: 'insensitive' } }, { positionTitle: { contains: s, mode: 'insensitive' } }] } } },
        ],
      });
    }
    const where: Prisma.UserWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(q), select: { id: true, name: true, isActive: true, department: true, manager: { select: { id: true, name: true } } } }),
      q.page ? this.prisma.user.count({ where }) : Promise.resolve(undefined),
    ]);
    const visible = rows.slice(0, Math.min(rows.length, q.limit));
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organizationId: user.organizationId, userId: { in: visible.map((r) => r.id) } },
      select: { userId: true, employeeCode: true, positionTitle: true, exitDate: true, probationEndDate: true },
    });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    const items = rows.map((r) => {
      const p = byUser.get(r.id);
      return { id: r.id, name: r.name, employeeCode: p?.employeeCode ?? null, designation: p?.positionTitle ?? null, department: r.department, manager: r.manager, status: employmentStatus(r.isActive, p, today) };
    });
    return pageResult(items, q, total);
  }

  /** Distinct departments of the viewer's directory scope (for filters). */
  async departments(user: Principal) {
    const scoped = (await this.access.scopedWhere(user, { permission: 'directory:view', ownerField: 'id' })) as Prisma.UserWhereInput;
    const rows = await this.prisma.user.findMany({ where: { AND: [scoped, { isActive: true, department: { not: null } }] }, distinct: ['department'], select: { department: true }, orderBy: { department: 'asc' }, take: 200 });
    return rows.map((r) => r.department!).filter(Boolean);
  }

  /**
   * Employee 360: every section is guarded by the VIEWER's own permission and scope over this employee and comes back as
   * `{ available: false }` when not permitted. Empty data is an honest `{ available: true, hasData: false }`.
   */
  async get360(user: Principal, userId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: user.organizationId },
      select: { id: true, name: true, email: true, isActive: true, department: true, managerId: true, manager: { select: { id: true, name: true } } },
    });
    if (!target || !(await inScope(this.access, user, 'directory:view', userId))) throw notFound('Employee');
    const { today, config } = await this.today(user.organizationId);
    const org = user.organizationId;
    const profile = await this.prisma.employeeProfile.findFirst({ where: { organizationId: org, userId } });
    const hrContact = profile?.hrContactId ? await this.prisma.user.findFirst({ where: { id: profile.hrContactId, organizationId: org }, select: { id: true, name: true } }) : null;
    const self = userId === user.userId;
    const hrRecords = this.access.has(user, 'hr:records:view');
    const can = (key: Parameters<typeof inScope>[2]) => inScope(this.access, user, key, userId);
    const [canAttendance, canLeave, canGoals, canTasks, canDash] = await Promise.all([can('attendance:view'), can('leave:view'), can('goals:view'), can('work-tasks:view'), can('workforce:dashboard:view')]);
    const status = employmentStatus(target.isActive, profile ?? undefined, today);
    const NA = { available: false as const };

    const profileSection = {
      available: true as const,
      id: target.id,
      name: target.name,
      employeeCode: profile?.employeeCode ?? null,
      designation: profile?.positionTitle ?? null,
      department: target.department,
      manager: target.manager,
      status,
      joinDate: isoDay(profile?.joinDate),
      employmentType: profile?.employmentType ?? null,
      workLocation: profile?.workLocation ?? null,
      hrContact,
      // work email is shown only to the person, HR and managers whose attendance scope covers the employee
      email: self || hrRecords || canAttendance ? target.email : null,
      isSelf: self,
    };

    const hr = hrRecords || self
      ? {
          available: true as const,
          employmentType: profile?.employmentType ?? null,
          joinDate: isoDay(profile?.joinDate),
          exitDate: isoDay(profile?.exitDate),
          exitType: profile?.exitType ?? null,
          hasProfile: !!profile,
        }
      : NA;

    // probation: HR records, or the viewer's own workforce dashboard scope (self / team / org)
    let probation: unknown = NA;
    if (hrRecords || canDash) {
      const months = profile?.probationMonths ?? config.hr.probationDefaultMonths;
      const join = isoDay(profile?.joinDate);
      const stored = isoDay(profile?.probationEndDate);
      const end = stored ?? (join ? addMonths(join, months) : null);
      const reviews = await this.prisma.probationReview.findMany({ where: { organizationId: org, employeeId: userId }, orderBy: { dueDate: 'desc' }, take: MAX_LIST_ITEMS, select: { id: true, checkpointDay: true, dueDate: true, status: true, outcome: true } });
      probation = {
        available: true as const,
        hasData: !!join,
        startDate: join,
        durationMonths: join ? months : null,
        endDate: end,
        status: !join ? 'UNKNOWN' : end && end >= today ? 'ON_PROBATION' : 'COMPLETED',
        daysLeft: end && end >= today ? Math.round((dayToDate(end).getTime() - dayToDate(today).getTime()) / 86_400_000) : null,
        reviews: reviews.map((r) => ({ id: r.id, checkpointDay: r.checkpointDay, dueDate: isoDay(r.dueDate), status: r.status, outcome: r.outcome })),
      };
    }

    // performance: goals + work tasks, each under its own permission
    const goals = canGoals
      ? await (async () => {
          const rows = await this.prisma.goal.findMany({ where: { organizationId: org, ownerId: userId }, orderBy: [{ targetDate: 'desc' }, { id: 'asc' }], take: MAX_LIST_ITEMS, select: { id: true, title: true, status: true, risk: true, progressPct: true, startDate: true, targetDate: true } });
          const open = await this.prisma.goal.groupBy({ by: ['risk'], where: { organizationId: org, ownerId: userId, status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } }, _count: { _all: true } });
          return { available: true as const, hasData: rows.length > 0, byRisk: Object.fromEntries(open.map((o) => [o.risk, o._count._all])), items: rows.map((g) => ({ id: g.id, title: g.title, status: g.status, risk: g.risk, progressPct: g.progressPct, startDate: isoDay(g.startDate), targetDate: isoDay(g.targetDate) })) };
        })()
      : NA;
    const tasks = canTasks
      ? await (async () => {
          const now = new Date();
          const base = { organizationId: org, assigneeId: userId };
          const [grouped, overdue] = await Promise.all([
            this.prisma.workTask.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
            this.prisma.workTask.count({ where: { ...base, status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REVIEW'] }, dueAt: { lt: now } } }),
          ]);
          const c = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
          const assigned = grouped.filter((g) => g.status !== 'CANCELLED' && g.status !== 'REJECTED').reduce((a, g) => a + g._count._all, 0);
          const completed = c('COMPLETED');
          return {
            available: true as const,
            hasData: assigned > 0,
            assigned,
            completed,
            inProgress: c('IN_PROGRESS') + c('ACCEPTED') + c('REVIEW'),
            pending: c('ASSIGNED'),
            overdue,
            completionRatePct: assigned > 0 ? Math.round((completed / assigned) * 100) : null,
          };
        })()
      : NA;
    const performance = goals.available || tasks.available ? { available: true as const, goals, tasks } : NA;

    const attendance = canAttendance
      ? await (async () => {
          const monthFirst = `${today.slice(0, 7)}-01`;
          const [monthRows, recent] = await Promise.all([
            this.prisma.attendanceRecord.groupBy({ by: ['status'], where: { organizationId: org, userId, date: { gte: dayToDate(monthFirst), lte: dayToDate(today) } }, _count: { _all: true } }),
            this.prisma.attendanceRecord.findMany({ where: { organizationId: org, userId }, orderBy: { date: 'desc' }, take: 14, select: { id: true, date: true, status: true, checkInAt: true, checkOutAt: true, workMinutes: true } }),
          ]);
          const counts = Object.fromEntries(monthRows.map((r) => [r.status, r._count._all]));
          return {
            available: true as const,
            hasData: recent.length > 0,
            month: today.slice(0, 7),
            counts,
            recent: recent.map((r) => ({ id: r.id, date: isoDay(r.date), status: r.status, checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, workMinutes: r.workMinutes })),
          };
        })()
      : NA;

    const leave = canLeave
      ? { available: true as const, ...(await leaveBalanceSummary(this.prisma, org, userId, config, today)) }
      : NA;

    const activity = canGoals || canTasks
      ? await (async () => {
          const [gu, te] = await Promise.all([
            canGoals ? this.prisma.goalUpdate.findMany({ where: { organizationId: org, authorId: userId }, orderBy: { createdAt: 'desc' }, take: MAX_LIST_ITEMS, select: { id: true, kind: true, note: true, createdAt: true, goal: { select: { id: true, title: true } } } }) : Promise.resolve([]),
            canTasks ? this.prisma.workTaskEvent.findMany({ where: { organizationId: org, actorId: userId }, orderBy: { createdAt: 'desc' }, take: MAX_LIST_ITEMS, select: { id: true, kind: true, toStatus: true, note: true, createdAt: true, task: { select: { id: true, title: true } } } }) : Promise.resolve([]),
          ]);
          const items = [
            ...gu.map((g) => ({ id: g.id, source: 'goal' as const, kind: g.kind as string, at: g.createdAt, entityId: g.goal.id, title: g.goal.title, note: g.note ? g.note.slice(0, 200) : null })),
            ...te.map((t) => ({ id: t.id, source: 'task' as const, kind: (t.toStatus ?? t.kind) as string, at: t.createdAt, entityId: t.task.id, title: t.task.title, note: t.note ? t.note.slice(0, 200) : null })),
          ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, MAX_LIST_ITEMS);
          return { available: true as const, hasData: items.length > 0, items };
        })()
      : NA;

    return { id: target.id, generatedAt: new Date(), profile: profileSection, hr, performance, attendance, leave, probation, activity };
  }
}
