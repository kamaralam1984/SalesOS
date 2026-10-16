import { Injectable } from '@nestjs/common';
import { addDays, isoWeekday, localDay, monthStart, nextBirthday, monthDay, type Day } from '@salesos/workforce-core';
import type { WorkforceReportKey, WorkforceReportQuery } from '@salesos/validation';
import { AccessService, type Principal } from '../../../common/authz';
import { ApiResult } from '../../../common/http/api-result';
import { forbidden, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { isoDay, scopeUserIds, toDate } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { ProbationService } from '../hr/probation.service';
import { pct, REPORT_TITLES, round2, type BuiltReport, type ReportColumn, type ReportRow } from './report-types';

export const reportRowCap = () => Number(process.env.WORKFORCE_EXPORT_MAX_ROWS ?? 10_000);
const PRESENT_LIKE = ['PRESENT', 'LATE', 'WFH'];
const MARKED = ['PRESENT', 'LATE', 'WFH', 'HALF_DAY', 'ABSENT', 'UNPAID_LEAVE'];
const countBy = <T>(xs: T[], f: (x: T) => string): Record<string, number> => xs.reduce<Record<string, number>>((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});

interface Ctx {
  user: Principal;
  from: Day;
  to: Day;
  today: Day;
  tz: string;
  cap: number;
  scopeLevel: string;
  /** users in scope (after department/user filters) */
  users: Map<string, { id: string; name: string; department: string | null; managerId: string | null }>;
  ids: string[];
  q: Pick<WorkforceReportQuery, 'departmentId' | 'userId' | 'groupBy'>;
}

@Injectable()
export class WorkforceReportsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly cfg: WorkforceConfigService, private readonly probation: ProbationService) {}

  async page(user: Principal, key: WorkforceReportKey, q: WorkforceReportQuery) {
    const built = await this.build(user, key, q, reportRowCap());
    const start = (q.page - 1) * q.limit;
    const rows = built.rows.slice(start, start + q.limit);
    const { rows: _all, ...rest } = built;
    return new ApiResult({ ...rest, rows }, { pagination: { mode: 'page', limit: q.limit, page: q.page, hasMore: start + q.limit < built.rows.length, total: built.rows.length, totalPages: Math.max(1, Math.ceil(built.rows.length / q.limit)) } });
  }

  /** Builds a report scoped by the viewer's `workforce:reports:view` scope. Rows are capped; `truncated` says so honestly. */
  async build(user: Principal, key: WorkforceReportKey, q: Pick<WorkforceReportQuery, 'from' | 'to' | 'departmentId' | 'userId' | 'groupBy'>, cap: number): Promise<BuiltReport> {
    if (key === 'birthdays' && !this.access.has(user, 'birthdays:view')) throw forbidden('Birthdays are HR data');
    const level = this.access.scopeLevel(user, 'workforce:reports:view');
    if (!level) throw forbidden();
    const ids = await scopeUserIds(this.access, user, 'workforce:reports:view');
    const { config } = await this.cfg.getConfig(user.organizationId);
    const today = localDay(new Date(), config.timezone);
    const defaults = key === 'probation' ? { from: addDays(today, -30), to: addDays(today, 90) }
      : key === 'birthdays' ? { from: today, to: addDays(today, 30) }
      : key === 'weekly-progress' ? { from: addDays(today, 1 - isoWeekday(today)), to: today }
      : key === 'new-joiners' ? { from: addDays(today, -90), to: today }
      : { from: monthStart(today.slice(0, 7)), to: today };
    const from = q.from ?? defaults.from;
    const to = q.to ?? defaults.to;
    if (q.userId && ids && !ids.includes(q.userId)) throw notFound('Employee');
    const users = await this.prisma.user.findMany({
      where: { organizationId: user.organizationId, ...(ids ? { id: { in: ids } } : {}), ...(q.userId ? { id: q.userId } : {}), ...(q.departmentId ? { department: q.departmentId } : {}) },
      select: { id: true, name: true, department: true, managerId: true },
      take: 5000,
    });
    if (q.userId && users.length === 0) throw notFound('Employee');
    const ctx: Ctx = { user, from, to, today, tz: config.timezone, cap, scopeLevel: level, users: new Map(users.map((u) => [u.id, u])), ids: users.map((u) => u.id), q };
    const parts = await this.dispatch(key, ctx, config.earnedLeave.leaveTypeKey);
    const truncated = parts.rows.length > cap;
    return {
      report: key, title: REPORT_TITLES[key], columns: parts.columns, rows: truncated ? parts.rows.slice(0, cap) : parts.rows, summary: parts.summary, truncated, rowCap: cap, scopeLevel: level,
      range: { from, to }, filters: { departmentId: q.departmentId ?? null, userId: q.userId ?? null, groupBy: key === 'department-performance' ? q.groupBy ?? 'department' : null },
    };
  }

  private dispatch(key: WorkforceReportKey, c: Ctx, elType: string) {
    switch (key) {
      case 'attendance': return this.attendance(c);
      case 'leave': return this.leave(c);
      case 'earned-leave': return this.earnedLeave(c, elType);
      case 'tasks': return this.tasks(c);
      case 'goals': return this.goals(c);
      case 'holidays': return this.holidays(c);
      case 'probation': return this.probationReport(c);
      case 'birthdays': return this.birthdays(c);
      case 'department-performance': return this.departmentPerformance(c);
      case 'weekly-progress': return this.weeklyProgress(c);
      case 'new-joiners': return this.newJoiners(c);
    }
  }

  private who(c: Ctx, id: string) {
    const u = c.users.get(id);
    return { employee: u?.name ?? '—', department: u?.department ?? null };
  }

  // ------------------------------------------------------------------ attendance
  private async attendance(c: Ctx) {
    const rows = await this.prisma.attendanceRecord.findMany({
      where: { organizationId: c.user.organizationId, userId: { in: c.ids }, date: { gte: toDate(c.from), lte: toDate(c.to) } },
      orderBy: [{ date: 'asc' }, { userId: 'asc' }, { id: 'asc' }], take: c.cap + 1,
    });
    const hhmm = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: c.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d) : null);
    const columns: ReportColumn[] = [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'employee', label: 'Employee', type: 'text' }, { key: 'department', label: 'Department', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' }, { key: 'checkIn', label: 'Check-in', type: 'text' }, { key: 'checkOut', label: 'Check-out', type: 'text' },
      { key: 'lateMinutes', label: 'Minutes late', type: 'int' }, { key: 'meetingJoined', label: 'Meeting button', type: 'text' },
      { key: 'workMinutes', label: 'Worked minutes', type: 'int' }, { key: 'overtimeMinutes', label: 'Overtime minutes', type: 'int' }, { key: 'source', label: 'Source', type: 'text' },
    ];
    const out: ReportRow[] = rows.map((r) => ({
      date: isoDay(r.date), ...this.who(c, r.userId), status: r.status, checkIn: hhmm(r.checkInAt), checkOut: hhmm(r.checkOutAt),
      lateMinutes: r.lateMinutes, meetingJoined: hhmm(r.meetingJoinedAt), workMinutes: r.workMinutes, overtimeMinutes: r.overtimeMinutes, source: r.source,
    }));
    const marked = rows.filter((r) => MARKED.includes(r.status)).length;
    const present = rows.filter((r) => PRESENT_LIKE.includes(r.status)).length + rows.filter((r) => r.status === 'HALF_DAY').length * 0.5;
    return {
      columns, rows: out,
      summary: {
        records: Math.min(rows.length, c.cap), byStatus: countBy(rows, (r) => r.status), attendancePct: pct(present, marked),
        lateMinutes: rows.reduce((n, r) => n + (r.lateMinutes ?? 0), 0), overtimeMinutes: rows.reduce((n, r) => n + (r.overtimeMinutes ?? 0), 0),
      },
    };
  }

  // ------------------------------------------------------------------ leave
  private async leave(c: Ctx) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { organizationId: c.user.organizationId, userId: { in: c.ids }, startDate: { lte: toDate(c.to) }, endDate: { gte: toDate(c.from) } },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }], take: c.cap + 1,
    });
    const columns: ReportColumn[] = [
      { key: 'employee', label: 'Employee', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'type', label: 'Leave type', type: 'text' },
      { key: 'start', label: 'From', type: 'date' }, { key: 'end', label: 'To', type: 'date' }, { key: 'halfDay', label: 'Half day', type: 'text' },
      { key: 'days', label: 'Days', type: 'number' }, { key: 'unpaidDays', label: 'Unpaid days', type: 'number' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'appliedOn', label: 'Applied on', type: 'date' },
    ];
    const out: ReportRow[] = rows.map((r) => ({ ...this.who(c, r.userId), type: r.typeKey, start: isoDay(r.startDate), end: isoDay(r.endDate), halfDay: r.halfDay, days: Number(r.days), unpaidDays: Number(r.unpaidDays), status: r.status, appliedOn: localDay(r.createdAt, c.tz) }));
    return { columns, rows: out, summary: { requests: Math.min(rows.length, c.cap), byStatus: countBy(rows, (r) => r.status), approvedDays: round2(rows.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + Number(r.days), 0)) } };
  }

  // ------------------------------------------------------------------ Earned Leave transactions
  private async earnedLeave(c: Ctx, typeKey: string) {
    const rows = await this.prisma.leaveBalanceTxn.findMany({
      where: { organizationId: c.user.organizationId, userId: { in: c.ids }, typeKey, createdAt: { gte: new Date(`${c.from}T00:00:00Z`), lt: new Date(`${addDays(c.to, 1)}T00:00:00Z`) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: c.cap + 1,
    });
    const columns: ReportColumn[] = [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'employee', label: 'Employee', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'kind', label: 'Transaction', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number' }, { key: 'balanceBefore', label: 'Balance before', type: 'number' }, { key: 'balanceAfter', label: 'Balance after', type: 'number' },
      { key: 'periodStart', label: 'Period from', type: 'date' }, { key: 'periodEnd', label: 'Period to', type: 'date' }, { key: 'eligibleDays', label: 'Eligible days', type: 'number' },
      { key: 'policyVersion', label: 'Policy version', type: 'int' }, { key: 'by', label: 'Created by', type: 'text' },
    ];
    const out: ReportRow[] = rows.map((r) => ({
      date: localDay(r.createdAt, c.tz), ...this.who(c, r.userId), kind: r.kind, amount: Number(r.amount), balanceBefore: Number(r.balanceBefore), balanceAfter: Number(r.balanceAfter),
      periodStart: isoDay(r.periodStart), periodEnd: isoDay(r.periodEnd), eligibleDays: r.eligibleDays == null ? null : Number(r.eligibleDays), policyVersion: r.policyVersion, by: r.createdById ? 'User' : 'System rule',
    }));
    const credits = rows.filter((r) => r.kind === 'CREDIT_EARNED');
    return { columns, rows: out, summary: { transactions: Math.min(rows.length, c.cap), byKind: countBy(rows, (r) => r.kind), creditsCount: credits.length, creditedDays: round2(credits.reduce((s, r) => s + Number(r.amount), 0)) } };
  }

  // ------------------------------------------------------------------ tasks
  private async tasks(c: Ctx) {
    const rows = await this.prisma.workTask.findMany({
      where: { organizationId: c.user.organizationId, assigneeId: { in: c.ids }, createdAt: { gte: new Date(`${c.from}T00:00:00Z`), lt: new Date(`${addDays(c.to, 1)}T00:00:00Z`) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: c.cap + 1,
    });
    const names = await this.nameMap(c.user.organizationId, rows.map((r) => r.assignerId));
    const now = new Date();
    const open = (s: string) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(s);
    const columns: ReportColumn[] = [
      { key: 'title', label: 'Task', type: 'text' }, { key: 'assignee', label: 'Assignee', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'assigner', label: 'Assigned by', type: 'text' },
      { key: 'priority', label: 'Priority', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'created', label: 'Created', type: 'date' }, { key: 'due', label: 'Due', type: 'date' },
      { key: 'completed', label: 'Completed', type: 'date' }, { key: 'overdue', label: 'Overdue', type: 'text' },
    ];
    const out: ReportRow[] = rows.map((r) => ({
      title: r.title, assignee: this.who(c, r.assigneeId).employee, department: this.who(c, r.assigneeId).department, assigner: names.get(r.assignerId) ?? '—', priority: r.priority, status: r.status,
      created: localDay(r.createdAt, c.tz), due: r.dueAt ? localDay(r.dueAt, c.tz) : null, completed: r.completedAt ? localDay(r.completedAt, c.tz) : null, overdue: open(r.status) && !!r.dueAt && r.dueAt < now ? 'Yes' : 'No',
    }));
    const done = rows.filter((r) => r.status === 'COMPLETED').length;
    return { columns, rows: out, summary: { tasks: Math.min(rows.length, c.cap), byStatus: countBy(rows, (r) => r.status), overdue: rows.filter((r) => open(r.status) && !!r.dueAt && r.dueAt < now).length, completionPct: pct(done, rows.filter((r) => r.status !== 'CANCELLED').length) } };
  }

  // ------------------------------------------------------------------ goals
  private async goals(c: Ctx) {
    const rows = await this.prisma.goal.findMany({
      where: { organizationId: c.user.organizationId, ownerId: { in: c.ids }, startDate: { lte: toDate(c.to) }, targetDate: { gte: toDate(c.from) } },
      orderBy: [{ targetDate: 'asc' }, { id: 'asc' }], take: c.cap + 1,
    });
    const names = await this.nameMap(c.user.organizationId, rows.map((r) => r.reviewerId));
    const columns: ReportColumn[] = [
      { key: 'title', label: 'Goal', type: 'text' }, { key: 'owner', label: 'Owner', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'reviewer', label: 'Reviewer', type: 'text' },
      { key: 'start', label: 'Start', type: 'date' }, { key: 'target', label: 'Target date', type: 'date' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'risk', label: 'Risk', type: 'text' },
      { key: 'progressPct', label: 'Progress %', type: 'pct' }, { key: 'currentValue', label: 'Current value', type: 'number' }, { key: 'targetValue', label: 'Target value', type: 'number' }, { key: 'unit', label: 'Unit', type: 'text' },
    ];
    const out: ReportRow[] = rows.map((r) => ({
      title: r.title, owner: this.who(c, r.ownerId).employee, department: this.who(c, r.ownerId).department, reviewer: r.reviewerId ? names.get(r.reviewerId) ?? '—' : null,
      start: isoDay(r.startDate), target: isoDay(r.targetDate), status: r.status, risk: r.risk, progressPct: r.progressPct, currentValue: Number(r.currentValue), targetValue: r.targetValue == null ? null : Number(r.targetValue), unit: r.unit,
    }));
    return { columns, rows: out, summary: { goals: Math.min(rows.length, c.cap), byStatus: countBy(rows, (r) => r.status), byRisk: countBy(rows, (r) => r.risk), averageProgressPct: rows.length ? Math.round((rows.reduce((s, r) => s + r.progressPct, 0) / rows.length) * 10) / 10 : null } };
  }

  // ------------------------------------------------------------------ holidays (company data)
  private async holidays(c: Ctx) {
    const rows = await this.prisma.holiday.findMany({ where: { organizationId: c.user.organizationId, date: { gte: toDate(c.from), lte: toDate(c.to) } }, orderBy: [{ date: 'asc' }, { id: 'asc' }], take: c.cap + 1 });
    const columns: ReportColumn[] = [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'name', label: 'Holiday', type: 'text' }, { key: 'kind', label: 'Type', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'location', label: 'Location', type: 'text' },
    ];
    const out: ReportRow[] = rows.map((r) => ({ date: isoDay(r.date), name: r.name, kind: r.kind, status: r.status, location: r.location }));
    return { columns, rows: out, summary: { holidays: Math.min(rows.length, c.cap), byStatus: countBy(rows, (r) => r.status), byKind: countBy(rows, (r) => r.kind) } };
  }

  // ------------------------------------------------------------------ probation
  private async probationReport(c: Ctx) {
    const { rows: all } = await this.probation.rows(c.user.organizationId, c.ids, 30);
    const rows = all.filter((r) => r.endDate >= c.from && r.endDate <= c.to);
    rows.sort((a, b) => a.endDate.localeCompare(b.endDate) || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
    const columns: ReportColumn[] = [
      { key: 'employee', label: 'Employee', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'manager', label: 'Line manager', type: 'text' }, { key: 'position', label: 'Position', type: 'text' },
      { key: 'start', label: 'Joined', type: 'date' }, { key: 'months', label: 'Probation months', type: 'int' }, { key: 'end', label: 'Probation end', type: 'date' }, { key: 'state', label: 'Status', type: 'text' },
      { key: 'daysLeft', label: 'Days left', type: 'int' }, { key: 'extensions', label: 'Extensions', type: 'int' },
    ];
    const out: ReportRow[] = rows.map((r) => ({ employee: r.name, department: r.department, manager: r.managerName, position: r.positionTitle, start: r.startDate, months: r.months, end: r.endDate, state: r.state, daysLeft: r.daysLeft, extensions: r.extensions }));
    return { columns, rows: out, summary: { employees: rows.length, byState: countBy(rows, (r) => r.state) } };
  }

  // ------------------------------------------------------------------ birthdays (day + month only)
  private async birthdays(c: Ctx) {
    const profiles = await this.prisma.employeeProfile.findMany({ where: { organizationId: c.user.organizationId, userId: { in: c.ids }, dateOfBirth: { not: null }, exitDate: null }, select: { userId: true, dateOfBirth: true, shareBirthday: true }, take: 5000 });
    const rows = profiles.flatMap((p) => {
      const u = c.users.get(p.userId);
      if (!u || !p.dateOfBirth) return [];
      const dob = isoDay(p.dateOfBirth)!;
      const nb = nextBirthday(dob, c.from);
      if (nb.date > c.to) return [];
      const md = monthDay(dob);
      return [{ u, date: nb.date, md, shared: p.shareBirthday }];
    });
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.u.name.localeCompare(b.u.name) || a.u.id.localeCompare(b.u.id));
    const columns: ReportColumn[] = [
      { key: 'date', label: 'Birthday on', type: 'date' }, { key: 'employee', label: 'Employee', type: 'text' }, { key: 'department', label: 'Department', type: 'text' },
      { key: 'month', label: 'Month', type: 'int' }, { key: 'day', label: 'Day', type: 'int' }, { key: 'shared', label: 'Shared with team', type: 'text' },
    ];
    const out: ReportRow[] = rows.map((r) => ({ date: r.date, employee: r.u.name, department: r.u.department, month: r.md.month, day: r.md.day, shared: r.shared ? 'Yes' : 'No' }));
    return { columns, rows: out, summary: { birthdays: rows.length, shared: rows.filter((r) => r.shared).length } };
  }

  // ------------------------------------------------------------------ department / manager performance
  private async departmentPerformance(c: Ctx) {
    const org = c.user.organizationId;
    const range = { gte: toDate(c.from), lte: toDate(c.to) };
    const [att, tasks, goals, leave] = await Promise.all([
      this.prisma.attendanceRecord.groupBy({ by: ['userId', 'status'], where: { organizationId: org, userId: { in: c.ids }, date: range }, _count: { _all: true } }),
      this.prisma.workTask.findMany({ where: { organizationId: org, assigneeId: { in: c.ids }, createdAt: { gte: new Date(`${c.from}T00:00:00Z`), lt: new Date(`${addDays(c.to, 1)}T00:00:00Z`) } }, select: { assigneeId: true, status: true, dueAt: true }, take: 50_000 }),
      this.prisma.goal.findMany({ where: { organizationId: org, ownerId: { in: c.ids }, startDate: { lte: toDate(c.to) }, targetDate: { gte: toDate(c.from) } }, select: { ownerId: true, status: true, risk: true, progressPct: true }, take: 50_000 }),
      this.prisma.leaveRequest.findMany({ where: { organizationId: org, userId: { in: c.ids }, status: 'APPROVED', startDate: { lte: toDate(c.to) }, endDate: { gte: toDate(c.from) } }, select: { userId: true, days: true }, take: 50_000 }),
    ]);
    const byManager = c.q.groupBy === 'manager';
    const mgrNames = byManager ? await this.nameMap(org, [...c.users.values()].map((u) => u.managerId)) : new Map<string, string>();
    const groupOf = (id: string) => {
      const u = c.users.get(id);
      return byManager ? (u?.managerId ? mgrNames.get(u.managerId) ?? 'Unknown manager' : 'No manager') : u?.department ?? 'Unassigned';
    };
    type G = { employees: Set<string>; present: number; marked: number; tasks: number; done: number; overdue: number; goals: number; goalsDone: number; goalsRisk: number; leaveDays: number };
    const groups = new Map<string, G>();
    const g = (id: string) => {
      const k = groupOf(id);
      let x = groups.get(k);
      if (!x) { x = { employees: new Set(), present: 0, marked: 0, tasks: 0, done: 0, overdue: 0, goals: 0, goalsDone: 0, goalsRisk: 0, leaveDays: 0 }; groups.set(k, x); }
      return x;
    };
    for (const id of c.ids) g(id).employees.add(id);
    for (const a of att) {
      const x = g(a.userId);
      const n = a._count._all;
      if (MARKED.includes(a.status)) x.marked += n;
      if (PRESENT_LIKE.includes(a.status)) x.present += n;
      if (a.status === 'HALF_DAY') x.present += n * 0.5;
    }
    const now = new Date();
    for (const t of tasks) {
      const x = g(t.assigneeId);
      if (t.status === 'CANCELLED') continue;
      x.tasks += 1;
      if (t.status === 'COMPLETED') x.done += 1;
      else if (!['REJECTED'].includes(t.status) && t.dueAt && t.dueAt < now) x.overdue += 1;
    }
    for (const gl of goals) {
      const x = g(gl.ownerId);
      x.goals += 1;
      if (gl.status === 'COMPLETED') x.goalsDone += 1;
      if (gl.risk === 'AT_RISK' || gl.risk === 'OVERDUE') x.goalsRisk += 1;
    }
    for (const l of leave) g(l.userId).leaveDays += Number(l.days);
    const columns: ReportColumn[] = [
      { key: 'group', label: byManager ? 'Manager' : 'Department', type: 'text' }, { key: 'employees', label: 'Employees', type: 'int' }, { key: 'attendancePct', label: 'Attendance %', type: 'pct' },
      { key: 'tasks', label: 'Tasks', type: 'int' }, { key: 'tasksDone', label: 'Tasks completed', type: 'int' }, { key: 'taskCompletionPct', label: 'Task completion %', type: 'pct' }, { key: 'tasksOverdue', label: 'Tasks overdue', type: 'int' },
      { key: 'goals', label: 'Goals', type: 'int' }, { key: 'goalsDone', label: 'Goals completed', type: 'int' }, { key: 'goalsAtRisk', label: 'Goals at risk or overdue', type: 'int' }, { key: 'leaveDays', label: 'Approved leave days', type: 'number' },
    ];
    const out: ReportRow[] = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, x]) => ({
      group: k, employees: x.employees.size, attendancePct: pct(x.present, x.marked), tasks: x.tasks, tasksDone: x.done, taskCompletionPct: pct(x.done, x.tasks), tasksOverdue: x.overdue,
      goals: x.goals, goalsDone: x.goalsDone, goalsAtRisk: x.goalsRisk, leaveDays: round2(x.leaveDays),
    }));
    return { columns, rows: out, summary: { groups: out.length, employees: c.ids.length } };
  }

  // ------------------------------------------------------------------ weekly progress (one row per person; default = this week, Monday to today)
  private async weeklyProgress(c: Ctx) {
    const org = c.user.organizationId;
    const day = { gte: toDate(c.from), lte: toDate(c.to) };
    const inst = { gte: new Date(`${c.from}T00:00:00Z`), lt: new Date(`${addDays(c.to, 1)}T00:00:00Z`) };
    const [att, tasks, goals] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { organizationId: org, userId: { in: c.ids }, date: day },
        select: { userId: true, status: true, lateMinutes: true, lateJoin: true, overtimeMinutes: true, dayReportPct: true }, take: 50_000,
      }),
      this.prisma.workTask.findMany({
        where: { organizationId: org, assigneeId: { in: c.ids }, status: { notIn: ['CANCELLED', 'REJECTED'] }, OR: [{ createdAt: inst }, { dueAt: inst }, { completedAt: inst }] },
        select: { assigneeId: true, status: true, dueAt: true, completedAt: true, createdAt: true }, take: 100_000,
      }),
      this.prisma.goal.findMany({ where: { organizationId: org, ownerId: { in: c.ids }, status: 'ACTIVE', startDate: { lte: toDate(c.to) }, targetDate: { gte: toDate(c.from) } }, select: { ownerId: true, progressPct: true }, take: 50_000 }),
    ]);
    const now = new Date();
    const inRange = (d: Date | null) => !!d && d >= inst.gte && d < inst.lt;
    const rows: ReportRow[] = c.ids.map((id) => {
      const a = att.filter((r) => r.userId === id);
      const marked = a.filter((r) => MARKED.includes(r.status)).length;
      const present = a.filter((r) => PRESENT_LIKE.includes(r.status)).length + a.filter((r) => r.status === 'HALF_DAY').length * 0.5;
      const reports = a.filter((r) => r.dayReportPct !== null);
      const ts = tasks.filter((t) => t.assigneeId === id && (inRange(t.createdAt) || inRange(t.dueAt)));
      const done = ts.filter((t) => t.status === 'COMPLETED').length;
      const gl = goals.filter((g) => g.ownerId === id);
      return {
        ...this.who(c, id), daysMarked: marked, attendancePct: pct(present, marked), lateDays: a.filter((r) => (r.lateMinutes ?? 0) > 0).length, lateJoinDays: a.filter((r) => r.lateJoin).length,
        overtimeMinutes: a.reduce((n, r) => n + (r.overtimeMinutes ?? 0), 0), reportsFilled: reports.length,
        avgDayReportPct: reports.length ? Math.round(reports.reduce((n, r) => n + (r.dayReportPct ?? 0), 0) / reports.length) : null,
        tasks: ts.length, tasksDone: done, taskCompletionPct: pct(done, ts.length), tasksCompletedInRange: tasks.filter((t) => t.assigneeId === id && inRange(t.completedAt)).length,
        tasksOverdue: ts.filter((t) => t.status !== 'COMPLETED' && !!t.dueAt && t.dueAt < now).length,
        goalsActive: gl.length, avgGoalProgressPct: gl.length ? Math.round(gl.reduce((n, g) => n + g.progressPct, 0) / gl.length) : null,
      };
    }).sort((x, y) => String(x.employee).localeCompare(String(y.employee)));
    const columns: ReportColumn[] = [
      { key: 'employee', label: 'Employee', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'daysMarked', label: 'Days marked', type: 'int' }, { key: 'attendancePct', label: 'Attendance %', type: 'pct' },
      { key: 'lateDays', label: 'Late days', type: 'int' }, { key: 'lateJoinDays', label: 'Late joins (after cutoff)', type: 'int' }, { key: 'overtimeMinutes', label: 'Overtime minutes', type: 'int' },
      { key: 'reportsFilled', label: 'Day reports filled', type: 'int' }, { key: 'avgDayReportPct', label: 'Average work done (own report) %', type: 'pct' },
      { key: 'tasks', label: 'Tasks (assigned or due)', type: 'int' }, { key: 'tasksDone', label: 'Tasks done', type: 'int' }, { key: 'taskCompletionPct', label: 'Task completion %', type: 'pct' },
      { key: 'tasksCompletedInRange', label: 'Tasks completed in the week', type: 'int' }, { key: 'tasksOverdue', label: 'Tasks overdue', type: 'int' },
      { key: 'goalsActive', label: 'Active goals', type: 'int' }, { key: 'avgGoalProgressPct', label: 'Average goal progress %', type: 'pct' },
    ];
    const total = (k: string) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
    return { columns, rows, summary: { employees: rows.length, tasks: total('tasks'), tasksDone: total('tasksDone'), taskCompletionPct: pct(total('tasksDone'), total('tasks')), lateDays: total('lateDays'), lateJoinDays: total('lateJoinDays') } };
  }

  // ------------------------------------------------------------------ new joiners: progress through the first 90 days
  private async newJoiners(c: Ctx) {
    const org = c.user.organizationId;
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organizationId: org, userId: { in: c.ids }, joinDate: { gte: toDate(c.from), lte: toDate(c.to) }, exitDate: null },
      select: { userId: true, joinDate: true, positionTitle: true }, orderBy: { joinDate: 'desc' }, take: 2000,
    });
    const ids = profiles.map((p) => p.userId);
    const [plans, att, tasks, goals, reviews, mgrNames] = await Promise.all([
      this.prisma.onboardingPlan.findMany({ where: { organizationId: org, employeeId: { in: ids }, status: { not: 'CANCELLED' } }, select: { employeeId: true, items: { select: { status: true } } } }),
      this.prisma.attendanceRecord.findMany({ where: { organizationId: org, userId: { in: ids } }, select: { userId: true, date: true, status: true, dayReportPct: true, lateMinutes: true }, take: 100_000 }),
      this.prisma.workTask.findMany({ where: { organizationId: org, assigneeId: { in: ids }, status: { notIn: ['CANCELLED', 'REJECTED'] } }, select: { assigneeId: true, status: true, createdAt: true }, take: 100_000 }),
      this.prisma.goal.findMany({ where: { organizationId: org, ownerId: { in: ids }, status: { in: ['ACTIVE', 'PENDING_VERIFICATION', 'COMPLETED'] } }, select: { ownerId: true, progressPct: true }, take: 50_000 }),
      this.prisma.probationReview.findMany({ where: { organizationId: org, employeeId: { in: ids } }, select: { employeeId: true, checkpointDay: true, status: true, outcome: true }, orderBy: { checkpointDay: 'asc' } }),
      this.nameMap(org, [...c.users.values()].map((u) => u.managerId)),
    ]);
    const rows: ReportRow[] = profiles.map((p) => {
      const joined = isoDay(p.joinDate)!;
      const dayN = Math.max(1, Math.round((Date.parse(`${c.today}T00:00:00Z`) - Date.parse(`${joined}T00:00:00Z`)) / 86_400_000) + 1);
      const u = c.users.get(p.userId);
      const items = plans.filter((x) => x.employeeId === p.userId).flatMap((x) => x.items).filter((i) => i.status !== 'SKIPPED');
      const a = att.filter((r) => r.userId === p.userId && isoDay(r.date)! >= joined);
      const marked = a.filter((r) => MARKED.includes(r.status)).length;
      const present = a.filter((r) => PRESENT_LIKE.includes(r.status)).length + a.filter((r) => r.status === 'HALF_DAY').length * 0.5;
      const reports = a.filter((r) => r.dayReportPct !== null);
      const ts = tasks.filter((t) => t.assigneeId === p.userId);
      const gl = goals.filter((g) => g.ownerId === p.userId);
      const rv = reviews.filter((r) => r.employeeId === p.userId);
      const next = rv.find((r) => r.status !== 'COMPLETED');
      return {
        employee: u?.name ?? '—', department: u?.department ?? null, manager: u?.managerId ? mgrNames.get(u.managerId) ?? null : null, position: p.positionTitle, joined, day: dayN, daysLeftOf90: Math.max(0, 90 - dayN),
        onboardingItems: items.length, onboardingDonePct: pct(items.filter((i) => i.status === 'DONE').length, items.length),
        tasks: ts.length, tasksDone: ts.filter((t) => t.status === 'COMPLETED').length, taskCompletionPct: pct(ts.filter((t) => t.status === 'COMPLETED').length, ts.length),
        attendancePct: pct(present, marked), lateDays: a.filter((r) => (r.lateMinutes ?? 0) > 0).length,
        avgDayReportPct: reports.length ? Math.round(reports.reduce((n, r) => n + (r.dayReportPct ?? 0), 0) / reports.length) : null,
        avgGoalProgressPct: gl.length ? Math.round(gl.reduce((n, g) => n + g.progressPct, 0) / gl.length) : null,
        nextReview: next ? `Day ${next.checkpointDay} review` : rv.length ? 'All reviews done' : null,
      };
    });
    const columns: ReportColumn[] = [
      { key: 'employee', label: 'Employee', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }, { key: 'manager', label: 'Line manager', type: 'text' }, { key: 'position', label: 'Position', type: 'text' },
      { key: 'joined', label: 'Joined', type: 'date' }, { key: 'day', label: 'Day of 90', type: 'int' }, { key: 'daysLeftOf90', label: 'Days left of 90', type: 'int' },
      { key: 'onboardingItems', label: 'Training items', type: 'int' }, { key: 'onboardingDonePct', label: 'Training done %', type: 'pct' },
      { key: 'tasks', label: 'Tasks', type: 'int' }, { key: 'tasksDone', label: 'Tasks done', type: 'int' }, { key: 'taskCompletionPct', label: 'Task completion %', type: 'pct' },
      { key: 'attendancePct', label: 'Attendance %', type: 'pct' }, { key: 'lateDays', label: 'Late days', type: 'int' }, { key: 'avgDayReportPct', label: 'Average work done (own report) %', type: 'pct' },
      { key: 'avgGoalProgressPct', label: 'Average goal progress %', type: 'pct' }, { key: 'nextReview', label: 'Next review', type: 'text' },
    ];
    return { columns, rows, summary: { newJoiners: rows.length, inFirst30Days: rows.filter((r) => Number(r.day) <= 30).length, inFirst90Days: rows.filter((r) => Number(r.day) <= 90).length } };
  }

  private async nameMap(organizationId: string, ids: Array<string | null | undefined>) {
    const uniq = [...new Set(ids.filter((i): i is string => !!i))];
    if (!uniq.length) return new Map<string, string>();
    const rows = await this.prisma.user.findMany({ where: { organizationId, id: { in: uniq } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

