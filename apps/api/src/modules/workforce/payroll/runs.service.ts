import { Injectable } from '@nestjs/common';
import { Prisma, type PayrollRun, type Payslip } from '@prisma/client';
import { PLATFORM_EVENTS, WORKFORCE_EVENTS, type NotifyRequest } from '@salesos/shared-types';
import type { addAdjustmentSchema, cancelPayrollRunSchema, createPayrollRunSchema, listPayrollRunsQuerySchema, markPayrollPaidSchema, sendBackPayrollRunSchema } from '@salesos/validation';
import {
  calculatePayslip,
  canPayrollTransition,
  computeNet,
  employmentWindow,
  findMissingClosedDays,
  localDay,
  monthEnd,
  monthHasEnded,
  monthStart,
  payslipVisibleToEmployee,
  type PayAdjustment,
  type PayAttendanceStatus,
  type PayComponent,
  type PayrollRunStatus,
  type Day,
} from '@salesos/workforce-core';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { ok } from '../../../common/http/api-result';
import { AppError, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { asComponents, csvCell, dateOnly, dayOf, isoOrNull, roleOf } from './payroll.support';

const MAX_ADJUSTMENTS = 20;
const MAX_SLIPS = 500;

export interface StoredAdjustment extends PayAdjustment {
  id: string;
  addedById: string;
  addedAt: string;
}
const asAdjustments = (v: unknown): StoredAdjustment[] => (Array.isArray(v) ? (v as StoredAdjustment[]) : []);

interface MoveSpec {
  to: PayrollRunStatus;
  action: string;
  event: string;
  check?: (run: PayrollRun, tx: Tx) => void | Promise<void>;
  data?: (run: PayrollRun, now: Date) => Prisma.PayrollRunUncheckedUpdateInput;
  /** work inside the transaction after the guard (calculation) */
  apply?: (run: PayrollRun, tx: Tx) => Promise<Record<string, unknown>>;
  notify?: (run: PayrollRun, tx: Tx) => Promise<NotifyRequest | null>;
  audit?: Record<string, unknown>;
}

@Injectable()
export class PayrollRunsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly cfg: WorkforceConfigService) {}

  // ---- dto ---------------------------------------------------------------------------------------------------------
  private runDto(r: PayrollRun, extra: { slipCount?: number; totals?: Array<{ currency: string; gross: string; deductions: string; adjustments: string; net: string }>; names?: Map<string, string> } = {}) {
    const who = (id: string | null, at: Date | null) => (id ? { id, name: extra.names?.get(id) ?? null, at: isoOrNull(at) } : null);
    return {
      id: r.id,
      month: r.month,
      status: r.status as PayrollRunStatus,
      monthWorkingDays: r.workingDays,
      note: r.note,
      version: r.version,
      createdBy: who(r.createdById, r.createdAt),
      calculatedAt: isoOrNull(r.calculatedAt),
      approved: who(r.approvedById, r.approvedAt),
      paid: who(r.paidById, r.paidAt),
      paymentReference: r.paymentReference,
      payslipCount: extra.slipCount ?? null,
      totals: extra.totals ?? [],
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      statutoryDeductionsCalculated: false,
    };
  }

  private slipDto(s: Payslip, run: Pick<PayrollRun, 'month' | 'status' | 'workingDays'>, userName: string | null, extra: { organizationName?: string } = {}) {
    const adjustments = asAdjustments(s.adjustments);
    const { adjustmentsNet } = computeNet(s.gross.toFixed(2), s.totalDeductions.toFixed(2), adjustments);
    return {
      id: s.id,
      runId: s.runId,
      month: run.month,
      runStatus: run.status as PayrollRunStatus,
      userId: s.userId,
      userName,
      organizationName: extra.organizationName ?? null,
      currency: s.currency,
      monthWorkingDays: run.workingDays,
      workingDays: s.workingDays,
      paidDays: s.paidDays.toFixed(2),
      lossOfPayDays: s.lossOfPayDays.toFixed(2),
      earnings: s.earnings,
      deductions: s.deductions,
      gross: s.gross.toFixed(2),
      totalDeductions: s.totalDeductions.toFixed(2),
      adjustments,
      adjustmentsNet,
      net: s.net.toFixed(2),
      basis: s.basis,
      statutoryDeductionsCalculated: false,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private async names(ids: Array<string | null | undefined>) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map<string, string>();
    const rows = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
    return new Map(rows.map((u) => [u.id, u.name]));
  }

  private async totalsFor(organizationId: string, runIds: string[]) {
    if (!runIds.length) return new Map<string, Array<{ currency: string; gross: string; deductions: string; adjustments: string; net: string }>>();
    const slips = await this.prisma.payslip.findMany({ where: { organizationId, runId: { in: runIds } }, select: { runId: true, currency: true, gross: true, totalDeductions: true, net: true, adjustments: true } });
    const acc = new Map<string, Map<string, { gross: Prisma.Decimal; ded: Prisma.Decimal; net: Prisma.Decimal; adj: Prisma.Decimal; n: number }>>();
    for (const s of slips) {
      const byCur = acc.get(s.runId) ?? new Map();
      const cur = byCur.get(s.currency) ?? { gross: new Prisma.Decimal(0), ded: new Prisma.Decimal(0), net: new Prisma.Decimal(0), adj: new Prisma.Decimal(0), n: 0 };
      cur.gross = cur.gross.plus(s.gross);
      cur.ded = cur.ded.plus(s.totalDeductions);
      cur.net = cur.net.plus(s.net);
      cur.adj = cur.adj.plus(computeNet('0', '0', asAdjustments(s.adjustments)).adjustmentsNet);
      acc.set(s.runId, byCur.set(s.currency, cur));
    }
    return new Map([...acc].map(([runId, m]) => [runId, [...m].map(([currency, v]) => ({ currency, gross: v.gross.toFixed(2), deductions: v.ded.toFixed(2), adjustments: v.adj.toFixed(2), net: v.net.toFixed(2) }))]));
  }

  private async loadRun(user: Principal, id: string): Promise<PayrollRun> {
    const run = await this.prisma.payrollRun.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!run) throw notFound('Payroll run');
    return run;
  }

  // ---- reads -------------------------------------------------------------------------------------------------------
  async list(user: Principal, q: z.infer<typeof listPayrollRunsQuerySchema>) {
    const where: Prisma.PayrollRunWhereInput = { organizationId: user.organizationId, ...(q.status ? { status: q.status } : {}) };
    const rows = await this.prisma.payrollRun.findMany({ where, orderBy: [{ month: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const page = res.data as PayrollRun[];
    const [totals, counts] = await Promise.all([
      this.totalsFor(user.organizationId, page.map((r) => r.id)),
      this.prisma.payslip.groupBy({ by: ['runId'], where: { organizationId: user.organizationId, runId: { in: page.map((r) => r.id) } }, _count: { _all: true } }),
    ]);
    const cnt = new Map(counts.map((c) => [c.runId, c._count._all]));
    return ok(page.map((r) => this.runDto(r, { slipCount: cnt.get(r.id) ?? 0, totals: totals.get(r.id) ?? [] })), res.meta);
  }

  async get(user: Principal, id: string) {
    const run = await this.loadRun(user, id);
    const slips = await this.prisma.payslip.findMany({ where: { runId: id, organizationId: user.organizationId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_SLIPS + 1 });
    const truncated = slips.length > MAX_SLIPS;
    const page = truncated ? slips.slice(0, MAX_SLIPS) : slips;
    const names = await this.names([...page.map((s) => s.userId), run.createdById, run.approvedById, run.paidById]);
    const totals = await this.totalsFor(user.organizationId, [id]);
    const sorted = page.map((s) => this.slipDto(s, run, names.get(s.userId) ?? null)).sort((a, b) => (a.userName ?? '').localeCompare(b.userName ?? ''));
    return ok({ ...this.runDto(run, { slipCount: page.length, totals: totals.get(id) ?? [], names }), payslips: sorted }, truncated ? { warnings: [`Only the first ${MAX_SLIPS} payslips are shown`] } : {});
  }

  // ---- create ------------------------------------------------------------------------------------------------------
  async create(user: Principal, b: z.infer<typeof createPayrollRunSchema>) {
    const existing = await this.prisma.payrollRun.findUnique({ where: { organizationId_month: { organizationId: user.organizationId, month: b.month } } });
    if (existing && existing.status !== 'CANCELLED') throw new AppError('RUN_EXISTS', `A payroll run for ${b.month} already exists`, 409, { id: existing.id, status: existing.status });
    const { calendar } = await this.cfg.getCalendar(user.organizationId, monthStart(b.month), monthEnd(b.month));
    const workingDays = calendar.workingDaysBetween(monthStart(b.month), monthEnd(b.month));
    try {
      const run = await this.prisma.$transaction(async (tx) => {
        let r: PayrollRun;
        if (existing) {
          // a cancelled month is re-opened as a fresh DRAFT (the unique month row is reused, history stays in the audit log)
          const cas = await tx.payrollRun.updateMany({ where: { id: existing.id, status: 'CANCELLED' }, data: { status: 'DRAFT', createdById: user.userId, calculatedAt: null, approvedById: null, approvedAt: null, paidById: null, paidAt: null, paymentReference: null, note: b.note ?? null, workingDays, version: { increment: 1 } } });
          if (cas.count !== 1) throw new AppError('RUN_EXISTS', `A payroll run for ${b.month} already exists`, 409);
          await tx.payslip.deleteMany({ where: { runId: existing.id } });
          r = await tx.payrollRun.findUniqueOrThrow({ where: { id: existing.id } });
        } else {
          r = await tx.payrollRun.create({ data: { organizationId: user.organizationId, month: b.month, workingDays, createdById: user.userId, note: b.note ?? null } });
        }
        await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: existing ? 'payroll.run_reopened' : 'payroll.run_created', entityType: 'payroll_run', entityId: r.id, metadata: { month: b.month } });
        return r;
      });
      return this.runDto(run, { slipCount: 0 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('RUN_EXISTS', `A payroll run for ${b.month} already exists`, 409);
      throw e;
    }
  }

  // ---- the ONE transition function ---------------------------------------------------------------------------------
  private async move(user: Principal, id: string, spec: MoveSpec) {
    await this.loadRun(user, id); // 404 outside the organisation
    const role = roleOf(user.roles);
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${id}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
        const run = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
        if (!canPayrollTransition(run.status as PayrollRunStatus, spec.to)) throw new AppError('INVALID_TRANSITION', `A ${run.status} payroll run cannot move to ${spec.to}`, 409, { from: run.status, to: spec.to });
        await spec.check?.(run, tx);
        const extra = (await spec.apply?.(run, tx)) ?? {};
        const now = new Date();
        const patch = spec.data?.(run, now) ?? {};
        const cas = await tx.payrollRun.updateMany({ where: { id, organizationId: user.organizationId, status: run.status }, data: { ...(patch as Prisma.PayrollRunUncheckedUpdateManyInput), status: spec.to, version: { increment: 1 } } });
        if (cas.count !== 1) throw new AppError('INVALID_TRANSITION', 'This payroll run was just changed by someone else', 409);
        const after = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
        // audit and events never carry amounts
        await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: spec.action, entityType: 'payroll_run', entityId: id, metadata: { month: run.month, from: run.status, to: spec.to, role, ...(spec.audit ?? {}), ...extra } });
        await this.outbox.publish(tx, { eventType: spec.event, aggregateType: 'payroll_run', aggregateId: id, organizationId: user.organizationId, payload: { runId: id, month: run.month, fromStatus: run.status, toStatus: spec.to, actorId: user.userId, ...extra }, idempotencyKey: `${spec.event}:${id}:${after.version}` });
        const n = await spec.notify?.(after, tx);
        if (n) await this.outbox.publish(tx, { eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'payroll_run', aggregateId: id, organizationId: user.organizationId, payload: n as unknown as Record<string, unknown>, idempotencyKey: `notify:${n.dedupeKey}` });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return this.get(user, id);
  }

  private notifyRoles(run: PayrollRun, roles: string[], key: string, title: string): NotifyRequest {
    return { organizationId: run.organizationId, type: 'payroll.update', roles, dedupeKey: `payroll:${run.id}:${key}:${run.version}`, title, entity: { type: 'payroll_run', id: run.id }, actionUrl: `/work/payroll/${run.month}` };
  }

  // ---- calculate ---------------------------------------------------------------------------------------------------
  calculate(user: Principal, id: string) {
    return this.move(user, id, {
      to: 'CALCULATED',
      action: 'payroll.run_calculated',
      event: WORKFORCE_EVENTS.PAYROLL_CALCULATED,
      apply: (run, tx) => this.runCalculation(user, run, tx),
      data: (_r, now) => ({ calculatedAt: now, approvedById: null, approvedAt: null }),
      notify: async (run) => this.notifyRoles(run, ['FOUNDER_CEO'], 'calculated', 'Payroll run ready for approval'),
    });
  }

  private async runCalculation(user: Principal, run: PayrollRun, tx: Tx): Promise<Record<string, unknown>> {
    const month = run.month;
    const from = monthStart(month);
    const to = monthEnd(month);
    const { config, calendar } = await this.cfg.getCalendar(user.organizationId, from, to);
    const today = localDay(new Date(), config.timezone);
    if (!monthHasEnded(month, today)) throw new AppError('MONTH_NOT_CLOSED', `${month} has not ended yet; payroll can be calculated after the last day of the month`, 409, { reason: 'MONTH_NOT_ENDED', monthEnd: to, today, missing: [] });

    const orgId = user.organizationId;
    const structs = await tx.salaryStructure.findMany({ where: { organizationId: orgId, effectiveFrom: { lte: dateOnly(to) } }, orderBy: [{ userId: 'asc' }, { effectiveFrom: 'desc' }] });
    const userIds = [...new Set(structs.map((s) => s.userId))];
    const [users, records, leaves, existing] = await Promise.all([
      tx.user.findMany({ where: { organizationId: orgId, id: { in: userIds } }, select: { id: true, name: true, isActive: true, createdAt: true, deactivatedAt: true, employeeProfileUser: { select: { joinDate: true, exitDate: true } } } }),
      tx.attendanceRecord.findMany({ where: { organizationId: orgId, userId: { in: userIds }, date: { gte: dateOnly(from), lte: dateOnly(to) } }, select: { userId: true, date: true, status: true } }),
      tx.leaveRequest.findMany({ where: { organizationId: orgId, userId: { in: userIds }, status: 'APPROVED', startDate: { lte: dateOnly(to) }, endDate: { gte: dateOnly(from) } }, select: { userId: true, typeKey: true, startDate: true, endDate: true, halfDay: true, unpaidDays: true } }),
      tx.payslip.findMany({ where: { runId: run.id } }),
    ]);
    const paidType = new Map(config.leave.types.map((t) => [t.key, t.isPaid]));
    const recBy = new Map<string, Array<{ date: Day; status: PayAttendanceStatus }>>();
    for (const r of records) (recBy.get(r.userId) ?? recBy.set(r.userId, []).get(r.userId)!).push({ date: dayOf(r.date), status: r.status });
    const leaveBy = new Map<string, Array<{ startDate: Day; endDate: Day; halfDay: 'NONE' | 'FIRST_HALF' | 'SECOND_HALF'; paid: boolean; unpaidDays: number }>>();
    for (const l of leaves) (leaveBy.get(l.userId) ?? leaveBy.set(l.userId, []).get(l.userId)!).push({ startDate: dayOf(l.startDate), endDate: dayOf(l.endDate), halfDay: l.halfDay, paid: paidType.get(l.typeKey) ?? false, unpaidDays: Number(l.unpaidDays) });

    const missing: Array<{ userId: string; name: string; days: Day[] }> = [];
    const plans: Array<{ userId: string; structure: (typeof structs)[number]; calc: ReturnType<typeof calculatePayslip> }> = [];
    for (const u of users) {
      const prof = u.employeeProfileUser[0];
      const joinDate = prof?.joinDate ? dayOf(prof.joinDate) : localDay(u.createdAt, config.timezone);
      const exitDate = prof?.exitDate ? dayOf(prof.exitDate) : !u.isActive && u.deactivatedAt ? localDay(u.deactivatedAt, config.timezone) : null;
      const window = employmentWindow(month, joinDate, exitDate);
      if (!window) continue;
      // structure in force on the last employed day of the month (newest effectiveFrom <= that day)
      const structure = structs.find((s) => s.userId === u.id && dayOf(s.effectiveFrom) <= window.to);
      if (!structure) continue;
      const recs = recBy.get(u.id) ?? [];
      const lvs = leaveBy.get(u.id) ?? [];
      const gaps = findMissingClosedDays({ month, today, calendar, window, records: recs, leaves: lvs });
      if (gaps.length) {
        missing.push({ userId: u.id, name: u.name, days: gaps });
        continue;
      }
      const calc = calculatePayslip({ month, calendar, joinDate, exitDate, policy: { absentIsLossOfPay: config.payroll.absentIsLossOfPay, halfDayLossOfPay: config.payroll.halfDayLossOfPay }, records: recs, leaves: lvs, components: asComponents(structure.components) as PayComponent[] });
      plans.push({ userId: u.id, structure, calc });
    }
    if (missing.length) {
      const flat = missing.flatMap((m) => m.days.map((d) => ({ userId: m.userId, date: d })));
      throw new AppError('MONTH_NOT_CLOSED', `${missing.length} employee(s) have days in ${month} that are not closed yet; the day-close job or an HR correction must complete them first`, 409, { reason: 'DAYS_NOT_CLOSED', employees: missing.slice(0, 50), missingDayCount: flat.length, truncated: missing.length > 50 });
    }

    const exByUser = new Map(existing.map((s) => [s.userId, s]));
    for (const p of plans) {
      const prev = exByUser.get(p.userId);
      const adjustments = asAdjustments(prev?.adjustments);
      const { net } = computeNet(p.calc.gross, p.calc.totalDeductions, adjustments);
      const data = {
        structureId: p.structure.id,
        currency: p.structure.currency,
        workingDays: p.calc.employedWorkingDays,
        paidDays: p.calc.paidDays,
        lossOfPayDays: p.calc.lossOfPayDays,
        basis: p.calc.basis as unknown as Prisma.InputJsonValue,
        earnings: p.calc.earnings as unknown as Prisma.InputJsonValue,
        deductions: p.calc.deductions as unknown as Prisma.InputJsonValue,
        gross: p.calc.gross,
        totalDeductions: p.calc.totalDeductions,
        net,
        adjustments: adjustments as unknown as Prisma.InputJsonValue, // recalculation preserves adjustment lines
      };
      if (prev) await tx.payslip.update({ where: { id: prev.id }, data });
      else await tx.payslip.create({ data: { organizationId: orgId, runId: run.id, userId: p.userId, ...data } });
    }
    // employees no longer eligible lose their slip, unless it carries manual adjustments (kept, listed for review)
    const eligible = new Set(plans.map((p) => p.userId));
    const stale = existing.filter((s) => !eligible.has(s.userId));
    const removable = stale.filter((s) => asAdjustments(s.adjustments).length === 0).map((s) => s.id);
    if (removable.length) await tx.payslip.deleteMany({ where: { id: { in: removable } } });
    await tx.payrollRun.update({ where: { id: run.id }, data: { workingDays: calendar.workingDaysBetween(from, to) } });
    return { employees: plans.length, staleKept: stale.length - removable.length, policyVersionBasis: 'workforce_settings' };
  }

  // ---- approve / send back / pay / cancel --------------------------------------------------------------------------
  approve(user: Principal, id: string) {
    return this.move(user, id, {
      to: 'APPROVED',
      action: 'payroll.run_approved',
      event: WORKFORCE_EVENTS.PAYROLL_APPROVED,
      check: async (run, tx) => {
        // separation of duties: whoever created, calculated or adjusted the run cannot approve it
        if (run.createdById === user.userId) throw new AppError('SEPARATION_OF_DUTIES', 'You prepared this payroll run, so you cannot approve it', 403);
        const prepared = await tx.auditLog.findFirst({ where: { organizationId: run.organizationId, entityType: 'payroll_run', entityId: run.id, actorId: user.userId, action: { in: ['payroll.run_calculated', 'payroll.adjustment_added', 'payroll.adjustment_removed'] } }, select: { id: true } });
        if (prepared) throw new AppError('SEPARATION_OF_DUTIES', 'You prepared this payroll run, so you cannot approve it', 403);
        const n = await tx.payslip.count({ where: { runId: run.id } });
        if (n === 0) throw new AppError('NO_PAYSLIPS', 'There are no payslips to approve', 422);
        const negative = await tx.payslip.count({ where: { runId: run.id, net: { lt: 0 } } });
        if (negative > 0) throw new AppError('NEGATIVE_NET', `${negative} payslip(s) have a negative net pay; fix the deductions or adjustments before approval`, 422, { payslips: negative });
      },
      data: (_r, now) => ({ approvedById: user.userId, approvedAt: now }),
      apply: async (run, tx) => ({ payslips: await tx.payslip.count({ where: { runId: run.id } }) }),
      notify: async (run, tx) => {
        const slips = await tx.payslip.findMany({ where: { runId: run.id }, select: { userId: true } });
        return { organizationId: run.organizationId, type: 'payroll.update', userIds: slips.map((s) => s.userId), roles: ['HR', 'FINANCE'], dedupeKey: `payroll:${run.id}:approved:${run.version}`, title: 'Payslip available', entity: { type: 'payroll_run', id: run.id }, actionUrl: '/work/payslips' };
      },
    });
  }

  sendBack(user: Principal, id: string, b: z.infer<typeof sendBackPayrollRunSchema>) {
    return this.move(user, id, {
      to: 'DRAFT',
      action: 'payroll.run_sent_back',
      event: 'payroll.sent_back',
      data: () => ({ approvedById: null, approvedAt: null, note: b.reason }),
      audit: { reason: b.reason },
      notify: async (run) => this.notifyRoles(run, ['HR', 'FINANCE'], 'sent_back', 'Payroll run sent back'),
    });
  }

  markPaid(user: Principal, id: string, b: z.infer<typeof markPayrollPaidSchema>) {
    return this.move(user, id, {
      to: 'PAID',
      action: 'payroll.run_paid',
      event: WORKFORCE_EVENTS.PAYROLL_PAID,
      data: (_r, now) => ({ paidById: user.userId, paidAt: now, paymentReference: b.reference }),
      audit: { paymentReference: b.reference },
      notify: async (run) => this.notifyRoles(run, ['FOUNDER_CEO', 'HR'], 'paid', 'Payroll run marked as paid'),
    });
  }

  cancel(user: Principal, id: string, b: z.infer<typeof cancelPayrollRunSchema>) {
    return this.move(user, id, {
      to: 'CANCELLED',
      action: 'payroll.run_cancelled',
      event: 'payroll.cancelled',
      data: () => ({ approvedById: null, approvedAt: null, note: b.reason }),
      audit: { reason: b.reason },
      notify: async (run) => this.notifyRoles(run, ['FOUNDER_CEO', 'HR', 'FINANCE'], 'cancelled', 'Payroll run cancelled'),
    });
  }

  // ---- adjustments -------------------------------------------------------------------------------------------------
  async addAdjustment(user: Principal, runId: string, slipId: string, b: z.infer<typeof addAdjustmentSchema>) {
    await this.loadRun(user, runId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${runId}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
      const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
      if (run.status !== 'DRAFT' && run.status !== 'CALCULATED') throw new AppError('RUN_LOCKED', `Adjustments can only be changed while the run is DRAFT or CALCULATED (it is ${run.status})`, 409);
      const slip = await tx.payslip.findFirst({ where: { id: slipId, runId, organizationId: user.organizationId } });
      if (!slip) throw notFound('Payslip');
      const list = asAdjustments(slip.adjustments);
      if (list.length >= MAX_ADJUSTMENTS) throw new AppError('TOO_MANY_ADJUSTMENTS', `At most ${MAX_ADJUSTMENTS} adjustment lines per payslip`, 422);
      const next: StoredAdjustment[] = [...list, { id: randomUUID(), label: b.label, kind: b.kind, amount: b.amount, reason: b.reason, addedById: user.userId, addedAt: new Date().toISOString() }];
      const { net } = computeNet(slip.gross.toFixed(2), slip.totalDeductions.toFixed(2), next);
      if (net.startsWith('-')) throw new AppError('NEGATIVE_NET', 'This adjustment would make the net pay negative', 422);
      await tx.payslip.update({ where: { id: slip.id }, data: { adjustments: next as unknown as Prisma.InputJsonValue, net } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'payroll.adjustment_added', entityType: 'payroll_run', entityId: runId, metadata: { month: run.month, payslipId: slip.id, kind: b.kind } });
    });
    return this.getSlipForManager(user, runId, slipId);
  }

  async removeAdjustment(user: Principal, runId: string, slipId: string, adjustmentId: string) {
    await this.loadRun(user, runId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${runId}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
      const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
      if (run.status !== 'DRAFT' && run.status !== 'CALCULATED') throw new AppError('RUN_LOCKED', `Adjustments can only be changed while the run is DRAFT or CALCULATED (it is ${run.status})`, 409);
      const slip = await tx.payslip.findFirst({ where: { id: slipId, runId, organizationId: user.organizationId } });
      if (!slip) throw notFound('Payslip');
      const list = asAdjustments(slip.adjustments);
      if (!list.some((a) => a.id === adjustmentId)) throw notFound('Adjustment');
      const next = list.filter((a) => a.id !== adjustmentId);
      const { net } = computeNet(slip.gross.toFixed(2), slip.totalDeductions.toFixed(2), next);
      await tx.payslip.update({ where: { id: slip.id }, data: { adjustments: next as unknown as Prisma.InputJsonValue, net } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'payroll.adjustment_removed', entityType: 'payroll_run', entityId: runId, metadata: { month: run.month, payslipId: slip.id } });
    });
    return this.getSlipForManager(user, runId, slipId);
  }

  private async getSlipForManager(user: Principal, runId: string, slipId: string) {
    const run = await this.loadRun(user, runId);
    const slip = await this.prisma.payslip.findFirst({ where: { id: slipId, runId, organizationId: user.organizationId } });
    if (!slip) throw notFound('Payslip');
    const names = await this.names([slip.userId]);
    return this.slipDto(slip, run, names.get(slip.userId) ?? null);
  }

  // ---- payslips ----------------------------------------------------------------------------------------------------
  /** Own payslips, only from approved or paid runs. */
  async mine(user: Principal, q: { limit?: number; cursor?: string; page?: number }) {
    const rows = await this.prisma.payslip.findMany({
      where: { organizationId: user.organizationId, userId: user.userId, run: { status: { in: ['APPROVED', 'PAID'] } } },
      include: { run: true },
      orderBy: [{ run: { month: 'desc' } }, { id: 'desc' }],
      ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    const page = res.data as typeof rows;
    return ok(page.map((s) => this.slipDto(s, s.run, user.name)), res.meta);
  }

  /** One payslip: the employee's own (after approval) or any with payroll:run:view. Everything else is a 404. */
  async getPayslip(user: Principal, id: string) {
    const slip = await this.prisma.payslip.findFirst({ where: { id, organizationId: user.organizationId }, include: { run: true } });
    const viewAll = user.permissions.has('payroll:run:view');
    if (!slip || (!viewAll && (slip.userId !== user.userId || !payslipVisibleToEmployee(slip.run.status as PayrollRunStatus)))) throw notFound('Payslip');
    const [names, org] = await Promise.all([this.names([slip.userId]), this.prisma.organization.findUnique({ where: { id: user.organizationId }, select: { name: true } })]);
    return this.slipDto(slip, slip.run, names.get(slip.userId) ?? null, { organizationName: org?.name });
  }

  // ---- export ------------------------------------------------------------------------------------------------------
  async exportCsv(user: Principal, id: string): Promise<{ fileName: string; body: Buffer }> {
    const run = await this.loadRun(user, id);
    if (run.status === 'DRAFT' || run.status === 'CANCELLED') throw new AppError('NOTHING_TO_EXPORT', 'Calculate the run before exporting it', 409);
    const slips = await this.prisma.payslip.findMany({ where: { runId: id, organizationId: user.organizationId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_SLIPS });
    const names = await this.names(slips.map((s) => s.userId));
    const prof = await this.prisma.employeeProfile.findMany({ where: { organizationId: user.organizationId, userId: { in: slips.map((s) => s.userId) } }, select: { userId: true, employeeCode: true } });
    const code = new Map(prof.map((p) => [p.userId, p.employeeCode]));
    type Line = { key: string; kind: string; amount: string };
    const lineKeys = new Map<string, string>();
    for (const s of slips) for (const l of [...(s.earnings as Line[]), ...(s.deductions as Line[])]) lineKeys.set(`${l.kind}:${l.key}`, `${l.kind === 'EARNING' ? 'Earning' : 'Deduction'} ${l.key}`);
    const cols = [...lineKeys.keys()].sort();
    const head = ['Employee', 'Employee code', 'Month', 'Currency', 'Working days', 'Paid days', 'Loss of pay days', ...cols.map((c) => lineKeys.get(c)!), 'Gross', 'Deductions', 'Adjustments', 'Net', 'Run status', 'Payment reference'];
    const lines = [head.map((h) => csvCell(h, true)).join(',')];
    const sorted = slips.map((s) => ({ s, name: names.get(s.userId) ?? '' })).sort((a, b) => a.name.localeCompare(b.name));
    for (const { s, name } of sorted) {
      const byKey = new Map([...(s.earnings as Line[]), ...(s.deductions as Line[])].map((l) => [`${l.kind}:${l.key}`, l.amount]));
      const { adjustmentsNet } = computeNet(s.gross.toFixed(2), s.totalDeductions.toFixed(2), asAdjustments(s.adjustments));
      const cells: Array<[string | number | null, boolean]> = [[name, true], [code.get(s.userId) ?? null, true], [run.month, false], [s.currency, true], [s.workingDays, false], [s.paidDays.toFixed(2), false], [s.lossOfPayDays.toFixed(2), false], ...cols.map((c): [string | null, boolean] => [byKey.get(c) ?? '0.00', false]), [s.gross.toFixed(2), false], [s.totalDeductions.toFixed(2), false], [adjustmentsNet, false], [s.net.toFixed(2), false], [run.status, true], [run.paymentReference, true]];
      lines.push(cells.map(([v, t]) => csvCell(v, t)).join(','));
    }
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'export.created', entityType: 'payroll_run', entityId: id, metadata: { kind: 'payroll_register', format: 'csv', month: run.month, rows: slips.length } });
    return { fileName: `payroll-${run.month}.csv`, body: Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8') };
  }
}
