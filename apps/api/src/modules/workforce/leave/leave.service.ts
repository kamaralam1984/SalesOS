import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PLATFORM_EVENTS, WORKFORCE_EVENTS } from '@salesos/shared-types';
import type { cancelLeaveSchema, createLeaveRequestSchema, leaveDecisionSchema, listLeaveRequestsQuerySchema } from '@salesos/validation';
import { addDays, applyDecision, buildCalendar, countLeaveDays, currentStep, evaluateBalance, leaveCoverage, leaveOverlaps, localDay, planApprovalSteps, roundDays } from '@salesos/workforce-core';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { asPage, isoDay, scopeUserIds, toDate, userNameMap } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { balanceOf, lockUserLeave, num, reservedOf, type LeaveRow } from './leave.common';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
const OPEN = ['PENDING_MANAGER', 'PENDING_HR'] as const;
const MAX_SPAN_DAYS = 366;

interface ApproverCtx {
  /** manager-step authority: null = none, 'org' = anyone but self, else the visible applicant ids */
  manager: 'org' | string[] | null;
  hr: boolean;
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cfg: WorkforceConfigService,
  ) {}

  // ------------------------------------------------------------------ authority
  private async approver(user: Principal): Promise<ApproverCtx> {
    let manager: ApproverCtx['manager'] = null;
    if (this.access.has(user, 'leave:approve')) {
      const level = this.access.scopeLevel(user, 'leave:approve');
      manager = level === 'org' ? 'org' : level === 'team' ? (await this.access.visibleUsers(user)).ids : null;
    }
    return { manager, hr: this.access.scopeLevel(user, 'leave:approve-hr') === 'org' };
  }

  private canAct(ctx: ApproverCtx, user: Principal, r: { userId: string; status: string }): boolean {
    if (r.userId === user.userId) return false;
    if (r.status === 'PENDING_MANAGER') return ctx.manager === 'org' || (Array.isArray(ctx.manager) && ctx.manager.includes(r.userId));
    if (r.status === 'PENDING_HR') return ctx.hr;
    return false;
  }

  // ------------------------------------------------------------------ views
  private view(r: LeaveRow, names: Map<string, string>, user: Principal, ctx: ApproverCtx, today: string) {
    const start = isoDay(r.startDate)!;
    const open = r.status === 'PENDING_MANAGER' || r.status === 'PENDING_HR';
    const mine = r.userId === user.userId;
    return {
      id: r.id, userId: r.userId, userName: names.get(r.userId) ?? null, typeKey: r.typeKey, startDate: start, endDate: isoDay(r.endDate)!, halfDay: r.halfDay,
      days: r.days.toString(), unpaidDays: r.unpaidDays.toString(), reason: r.reason, status: r.status, cancelReason: r.cancelReason, createdAt: r.createdAt, updatedAt: r.updatedAt,
      steps: [...r.steps].sort((a, b) => (a.step === 'MANAGER' ? -1 : 1) - (b.step === 'MANAGER' ? -1 : 1)).map((s) => ({ step: s.step, status: s.status, actorId: s.actorId, actorName: s.actorId ? names.get(s.actorId) ?? null : null, comment: s.comment, decidedAt: s.decidedAt })),
      can: {
        decide: this.canAct(ctx, user, r),
        cancel: (mine || ctx.hr) && (open || (r.status === 'APPROVED' && start > today)),
      },
    };
  }

  private async namesFor(user: Principal, rows: LeaveRow[]) {
    return userNameMap(this.prisma, user.organizationId, rows.flatMap((r) => [r.userId, ...r.steps.map((s) => s.actorId)]));
  }

  private async load(user: Principal, id: string): Promise<LeaveRow> {
    const ids = await scopeUserIds(this.access, user, 'leave:view');
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, organizationId: user.organizationId, ...(ids ? { userId: { in: ids } } : {}) }, include: { steps: true } });
    if (!r) throw notFound('Leave request');
    return r;
  }

  async list(user: Principal, q: Dto<typeof listLeaveRequestsQuerySchema>) {
    const ids = await scopeUserIds(this.access, user, 'leave:view');
    const ctx = await this.approver(user);
    const filters: Prisma.LeaveRequestWhereInput[] = [{ organizationId: user.organizationId }];
    if (q.view === 'mine') filters.push({ userId: user.userId });
    else {
      if (ids) filters.push({ userId: { in: ids } });
      if (q.view === 'team') filters.push({ userId: { not: user.userId } });
      if (q.view === 'pending-me') {
        const or: Prisma.LeaveRequestWhereInput[] = [];
        if (ctx.manager) or.push({ status: 'PENDING_MANAGER', userId: ctx.manager === 'org' ? { not: user.userId } : { in: ctx.manager.filter((i) => i !== user.userId) } });
        if (ctx.hr) or.push({ status: 'PENDING_HR', userId: { not: user.userId } });
        filters.push(or.length ? { OR: or } : { id: { in: [] } });
      }
    }
    if (q.status) filters.push({ status: q.status });
    const rows = await this.prisma.leaveRequest.findMany({ where: { AND: filters }, include: { steps: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await this.namesFor(user, res.data);
    const { config } = await this.cfg.getConfig(user.organizationId);
    const today = localDay(new Date(), config.timezone);
    return asPage(res, res.data.map((r) => this.view(r, names, user, ctx, today)));
  }

  async get(user: Principal, id: string) {
    const r = await this.load(user, id);
    const { config } = await this.cfg.getConfig(user.organizationId);
    return this.view(r, await this.namesFor(user, [r]), user, await this.approver(user), localDay(new Date(), config.timezone));
  }

  // ------------------------------------------------------------------ apply
  async create(user: Principal, dto: Dto<typeof createLeaveRequestSchema>) {
    const { config } = await this.cfg.getConfig(user.organizationId);
    const type = config.leave.types.find((t) => t.key === dto.typeKey && t.active);
    if (!type) throw new AppError('INVALID_LEAVE_TYPE', 'This leave type is not available', 400);
    if (dto.halfDay !== 'NONE' && !config.leave.allowHalfDay) throw new AppError('HALF_DAY_DISABLED', 'Half-day leave is not enabled', 400);
    const today = localDay(new Date(), config.timezone);
    if (dto.startDate < addDays(today, -config.leave.backdateDays)) throw new AppError('BACKDATE_LIMIT', `Leave can be applied up to ${config.leave.backdateDays} days back`, 400);
    if ((Date.parse(dto.endDate) - Date.parse(dto.startDate)) / 86_400_000 >= MAX_SPAN_DAYS) throw new AppError('RANGE_TOO_LONG', 'A single request cannot span more than a year', 400);
    const { calendar } = await this.cfg.getCalendar(user.organizationId, dto.startDate, dto.endDate);
    const days = countLeaveDays(calendar, dto.startDate, dto.endDate, dto.halfDay);
    if (days <= 0) throw new AppError('NO_WORKING_DAYS', 'The selected dates have no working days (weekly off or holiday)', 400);
    if (type.maxConsecutiveDays && days > type.maxConsecutiveDays) throw new AppError('MAX_CONSECUTIVE_DAYS', `${type.name} is limited to ${type.maxConsecutiveDays} days at a time`, 400);

    let manager = null as { id: string } | null;
    if (user.managerId) manager = await this.prisma.user.findFirst({ where: { id: user.managerId, organizationId: user.organizationId, isActive: true }, select: { id: true } });
    const plan = planApprovalSteps(config.leave.approvalChain, !!manager);

    const created = await this.prisma.$transaction(async (tx) => {
      await lockUserLeave(tx, user.userId);
      const clash = await tx.leaveRequest.findMany({
        where: { userId: user.userId, organizationId: user.organizationId, status: { in: [...OPEN, 'APPROVED'] }, startDate: { lte: toDate(dto.endDate) }, endDate: { gte: toDate(dto.startDate) } },
        select: { id: true, startDate: true, endDate: true, halfDay: true },
      });
      const span = { startDate: dto.startDate, endDate: dto.endDate, halfDay: dto.halfDay };
      if (clash.some((c) => leaveOverlaps(span, { startDate: isoDay(c.startDate)!, endDate: isoDay(c.endDate)!, halfDay: c.halfDay }))) throw conflict('LEAVE_OVERLAP', 'You already have leave requested or approved for some of these dates');
      let unpaidDays = 0;
      if (type.needsBalance) {
        const available = roundDays((await balanceOf(tx, user.organizationId, user.userId, type.key)) - (await reservedOf(tx, user.organizationId, user.userId, type.key)));
        const verdict = evaluateBalance({ days, available, needsBalance: true, balanceExceeded: config.leave.balanceExceeded, confirmUnpaid: dto.confirmUnpaid });
        if (!verdict.ok) throw new AppError(verdict.code, verdict.code === 'INSUFFICIENT_BALANCE' ? 'Not enough leave balance for these dates' : 'The balance does not cover all days; confirm to take the extra days as unpaid', 409, { shortfall: verdict.shortfall, available: verdict.available });
        unpaidDays = verdict.unpaidDays;
      }
      const now = new Date();
      const req = await tx.leaveRequest.create({
        data: {
          organizationId: user.organizationId, userId: user.userId, typeKey: type.key, startDate: toDate(dto.startDate), endDate: toDate(dto.endDate), halfDay: dto.halfDay, days, unpaidDays, reason: dto.reason, status: plan.status,
          steps: { create: plan.steps.map((s) => ({ organizationId: user.organizationId, step: s.step, status: s.status, ...(s.status === 'SKIPPED' ? { comment: 'No manager assigned', decidedAt: now } : {}) })) },
        },
        include: { steps: true },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'leave.submitted', entityType: 'leave_request', entityId: req.id, metadata: { typeKey: type.key, startDate: dto.startDate, endDate: dto.endDate, days, unpaidDays, status: plan.status } });
      await this.outbox.publish(tx, {
        eventType: WORKFORCE_EVENTS.LEAVE_SUBMITTED, aggregateType: 'leave_request', aggregateId: req.id, organizationId: user.organizationId,
        payload: { organizationId: user.organizationId, requestId: req.id, userId: user.userId, status: plan.status }, idempotencyKey: `${WORKFORCE_EVENTS.LEAVE_SUBMITTED}:${req.id}`,
      });
      await this.notifyPending(tx, req, manager?.id ?? null);
      return req;
    });
    const ctx = await this.approver(user);
    return this.view(created, await this.namesFor(user, [created]), user, ctx, today);
  }

  private notifyPending(tx: Tx, req: { id: string; organizationId: string; status: string }, managerId: string | null) {
    const toManager = req.status === 'PENDING_MANAGER' && managerId;
    return this.outbox.publish(tx, {
      eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'leave_request', aggregateId: req.id, organizationId: req.organizationId,
      payload: {
        organizationId: req.organizationId, type: 'leave.pending', ...(toManager ? { userIds: [managerId] } : { roles: ['HR'] }), entity: { type: 'leave_request', id: req.id },
        dedupeKey: `leave.pending:${req.id}:${req.status}`, actionUrl: '/work/approvals', title: 'A leave request is waiting for your decision',
      },
      idempotencyKey: `notification.requested:leave.pending:${req.id}:${req.status}`,
    });
  }

  // ------------------------------------------------------------------ decide
  async decide(user: Principal, id: string, dto: Dto<typeof leaveDecisionSchema>) {
    const req = await this.load(user, id);
    const step = currentStep(req.status);
    if (!step) throw conflict('NOT_PENDING', 'This request is no longer waiting for a decision');
    if (req.userId === user.userId) throw new AppError('SELF_APPROVAL', 'You cannot decide on your own leave request', 403);
    const ctx = await this.approver(user);
    if (step === 'MANAGER' && !ctx.manager) throw new AppError('NOT_YOUR_STEP', 'This request is waiting for the manager step', 403);
    if (step === 'HR' && !ctx.hr) throw new AppError('NOT_YOUR_STEP', 'This request is waiting for the HR step', 403);
    if (!this.canAct(ctx, user, req)) throw notFound('Leave request'); // applicant outside the approver's team scope
    const { config } = await this.cfg.getConfig(user.organizationId);

    await this.prisma.$transaction(async (tx) => {
      await lockUserLeave(tx, req.userId);
      const cur = await tx.leaveRequest.findUnique({ where: { id }, include: { steps: true } });
      if (!cur || cur.status !== req.status) throw conflict('CONFLICT', 'This request was just decided by someone else; reload');
      const upd = await tx.leaveApprovalStep.updateMany({
        where: { requestId: id, step, status: 'PENDING' },
        data: { status: dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', actorId: user.userId, comment: dto.comment ?? null, decidedAt: new Date() },
      });
      if (upd.count !== 1) throw conflict('CONFLICT', 'This request was just decided by someone else; reload');
      const next = applyDecision(cur.steps.map((s) => ({ step: s.step, status: s.status })), step, dto.decision);
      const moved = await tx.leaveRequest.updateMany({ where: { id, status: cur.status }, data: { status: next.status } });
      if (moved.count !== 1) throw conflict('CONFLICT', 'This request was just decided by someone else; reload');
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'leave.step_decided', entityType: 'leave_request', entityId: id, metadata: { step, decision: dto.decision, from: cur.status, to: next.status, applicantId: req.userId } });
      await this.outbox.publish(tx, {
        eventType: WORKFORCE_EVENTS.LEAVE_STEP_DECIDED, aggregateType: 'leave_request', aggregateId: id, organizationId: user.organizationId,
        payload: { organizationId: user.organizationId, requestId: id, userId: req.userId, step, decision: dto.decision, status: next.status }, idempotencyKey: `${WORKFORCE_EVENTS.LEAVE_STEP_DECIDED}:${id}:${step}`,
      });
      if (next.status === 'APPROVED') await this.finalizeApproval(tx, user, req, config);
      if (next.status === 'PENDING_HR') await this.notifyPending(tx, { id, organizationId: user.organizationId, status: next.status }, null);
      if (next.status === 'APPROVED' || next.status === 'REJECTED') {
        const ev = next.status === 'APPROVED' ? WORKFORCE_EVENTS.LEAVE_APPROVED : WORKFORCE_EVENTS.LEAVE_REJECTED;
        await this.outbox.publish(tx, { eventType: ev, aggregateType: 'leave_request', aggregateId: id, organizationId: user.organizationId, payload: { organizationId: user.organizationId, requestId: id, userId: req.userId }, idempotencyKey: `${ev}:${id}` });
        await this.notifyApplicant(tx, req, next.status);
      }
    });
    return this.get(user, id);
  }

  private notifyApplicant(tx: Tx, req: { id: string; userId: string; organizationId: string }, status: string) {
    return this.outbox.publish(tx, {
      eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'leave_request', aggregateId: req.id, organizationId: req.organizationId,
      payload: { organizationId: req.organizationId, type: 'leave.status_changed', userIds: [req.userId], entity: { type: 'leave_request', id: req.id }, dedupeKey: `leave.status:${req.id}:${status}`, actionUrl: '/work/leave', title: `Your leave request was ${status.toLowerCase()}` },
      idempotencyKey: `notification.requested:leave.status:${req.id}:${status}`,
    });
  }

  /** Both steps approved: debit the paid part (one ledger row, unique key) and fix past days the nightly job already marked ABSENT. */
  private async finalizeApproval(tx: Tx, actor: Principal, req: LeaveRow, config: Awaited<ReturnType<WorkforceConfigService['getConfig']>>['config']) {
    const type = config.leave.types.find((t) => t.key === req.typeKey);
    const days = num(req.days);
    const paidDays = roundDays(days - num(req.unpaidDays));
    if (type?.isPaid && type.needsBalance && paidDays > 0) {
      const before = await balanceOf(tx, req.organizationId, req.userId, req.typeKey);
      if (before < paidDays) throw new AppError('INSUFFICIENT_BALANCE', 'The balance no longer covers this request; reject it or adjust the balance first', 409, { available: before, needed: paidDays });
      const txn = await tx.leaveBalanceTxn.create({
        data: {
          organizationId: req.organizationId, userId: req.userId, typeKey: req.typeKey, kind: 'DEBIT_LEAVE', amount: -paidDays, balanceBefore: before, balanceAfter: roundDays(before - paidDays),
          leaveRequestId: req.id, uniqueKey: `LV-DEBIT:${req.id}`, createdById: actor.userId, note: 'Approved leave',
        },
      });
      await this.audit.recordTx(tx, { organizationId: req.organizationId, actorId: actor.userId, action: 'leave.debited', entityType: 'leave_balance_txn', entityId: txn.id, metadata: { userId: req.userId, typeKey: req.typeKey, days: paidDays, requestId: req.id } });
    }
    // past days already closed as ABSENT by the system become leave days (human records are never touched)
    const start = isoDay(req.startDate)!;
    const end = isoDay(req.endDate)!;
    const today = localDay(new Date(), config.timezone);
    if (start >= today) return;
    const holidays = await tx.holiday.findMany({ where: { organizationId: req.organizationId, date: { gte: req.startDate, lte: req.endDate } } });
    const calendar = buildCalendar(config, holidays.map((h) => ({ date: isoDay(h.date)!, name: h.name, kind: h.kind, status: h.status })));
    const cover = leaveCoverage({ startDate: start, endDate: end, halfDay: req.halfDay, days, unpaidDays: num(req.unpaidDays) }, !!type?.isPaid, calendar);
    const records = await tx.attendanceRecord.findMany({ where: { userId: req.userId, date: { gte: req.startDate, lte: req.endDate }, source: 'SYSTEM', status: 'ABSENT' } });
    for (const rec of records) {
      const c = cover.get(isoDay(rec.date)!);
      if (!c || isoDay(rec.date)! >= today) continue;
      const status = c.kind === 'HALF' ? 'HALF_DAY' : c.kind;
      const upd = await tx.attendanceRecord.updateMany({ where: { id: rec.id, version: rec.version, status: 'ABSENT', source: 'SYSTEM' }, data: { status, version: { increment: 1 }, note: 'Approved leave' } });
      if (upd.count === 1) {
        await tx.attendanceCorrection.create({ data: { organizationId: req.organizationId, recordId: rec.id, userId: req.userId, date: rec.date, oldValue: { status: 'ABSENT' }, newValue: { status }, reason: 'Leave approved after the day closed', correctedById: actor.userId } });
      }
    }
  }

  // ------------------------------------------------------------------ cancel
  async cancel(user: Principal, id: string, dto: Dto<typeof cancelLeaveSchema>) {
    const req = await this.load(user, id);
    const ctx = await this.approver(user);
    if (req.userId !== user.userId && !ctx.hr) throw forbidden('Only the applicant or HR can cancel a leave request');
    const { config } = await this.cfg.getConfig(user.organizationId);
    const today = localDay(new Date(), config.timezone);
    const open = req.status === 'PENDING_MANAGER' || req.status === 'PENDING_HR';
    if (!open && !(req.status === 'APPROVED' && isoDay(req.startDate)! > today)) {
      throw new AppError('CANNOT_CANCEL', req.status === 'APPROVED' ? 'Leave that has already started cannot be cancelled; ask HR to adjust the balance' : 'This request can no longer be cancelled', 409);
    }
    await this.prisma.$transaction(async (tx) => {
      await lockUserLeave(tx, req.userId);
      const upd = await tx.leaveRequest.updateMany({ where: { id, status: req.status }, data: { status: 'CANCELLED', cancelReason: dto.reason } });
      if (upd.count !== 1) throw conflict('CONFLICT', 'This request just changed; reload');
      if (req.status === 'APPROVED') {
        const debit = await tx.leaveBalanceTxn.findFirst({ where: { organizationId: req.organizationId, leaveRequestId: id, kind: 'DEBIT_LEAVE' } });
        if (debit) {
          const before = await balanceOf(tx, req.organizationId, req.userId, req.typeKey);
          const back = -num(debit.amount);
          await tx.leaveBalanceTxn.createMany({
            data: [{ organizationId: req.organizationId, userId: req.userId, typeKey: req.typeKey, kind: 'REVERSAL', amount: back, balanceBefore: before, balanceAfter: roundDays(before + back), leaveRequestId: id, uniqueKey: `LV-REV:${id}`, createdById: user.userId, note: 'Leave cancelled before it started' }],
            skipDuplicates: true,
          });
        }
      }
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'leave.cancelled', entityType: 'leave_request', entityId: id, metadata: { from: req.status, applicantId: req.userId } });
      await this.outbox.publish(tx, { eventType: WORKFORCE_EVENTS.LEAVE_CANCELLED, aggregateType: 'leave_request', aggregateId: id, organizationId: user.organizationId, payload: { organizationId: user.organizationId, requestId: id, userId: req.userId }, idempotencyKey: `${WORKFORCE_EVENTS.LEAVE_CANCELLED}:${id}` });
      if (req.userId !== user.userId) await this.notifyApplicant(tx, req, 'CANCELLED');
    });
    return this.get(user, id);
  }
}
