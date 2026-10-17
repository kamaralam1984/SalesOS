import { Injectable } from '@nestjs/common';
import { Prisma, type Refund } from '@prisma/client';
import { REVENUE_EVENTS, type CreditedOwner, type RefundStatusPayload, type RevenueRefundApprovedPayload, type RevenueRefundProcessedPayload } from '@salesos/shared-types';
import type { z } from 'zod';
import type { approveRefundSchema, closeRefundSchema, createRefundSchema, listRefundsQuerySchema, processRefundSchema, reconcileRefundSchema, rejectRefundSchema, reviewRefundSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { D, canRefundTransition, dealMoney, money, round2, sum, type RefundStatus } from '../calc';
import { RevenueSupport, hasRole, isUniqueViolation, iso, primaryRole, recordAccess } from '../revenue.support';

type Permission = Parameters<RevenueSupport['access']['assertRecordAccess']>[1];
type Tx = Prisma.TransactionClient;

interface MoveSpec {
  to: RefundStatus;
  permission: Permission;
  /** authority + state rules; throws AppError */
  check?: (r: Refund) => void | Promise<void>;
  /** extra work inside the transaction; returns the column updates */
  apply: (r: Refund, tx: Tx, ctx: { actorRole: string | null; now: Date }) => Promise<Prisma.RefundUncheckedUpdateManyInput>;
  reason: string | null;
  eventType: string;
  notify?: (r: Refund) => { userIds?: string[]; roles?: string[]; title: string; body: string };
  payload?: (r: Refund, tx: Tx, ctx: { actorRole: string | null; now: Date }) => Promise<Record<string, unknown>>;
}

@Injectable()
export class RefundsService {
  constructor(private readonly s: RevenueSupport) {}

  private get prisma() {
    return this.s.prisma;
  }

  private dto(r: Refund, names: Map<string, string>, summaryOnly: boolean, leadName?: string | null) {
    if (summaryOnly) return { id: r.id, dealId: r.dealId, status: r.status, reasonCategory: r.reasonCategory, requestedAt: iso(r.requestedAt), currency: r.currency };
    const who = (id: string | null, role: string | null, at: Date | null) => (id ? { id, name: names.get(id) ?? null, role, at: iso(at) } : null);
    return {
      id: r.id,
      dealId: r.dealId,
      paymentId: r.paymentId,
      leadName: leadName ?? null,
      ownerId: r.ownerId,
      status: r.status,
      amount: money(r.amount),
      approvedAmount: r.approvedAmount ? money(r.approvedAmount) : null,
      processedAmount: r.processedAmount ? money(r.processedAmount) : null,
      currency: r.currency,
      reasonCategory: r.reasonCategory,
      reason: r.reason,
      recommendation: r.recommendation,
      requested: who(r.requestedById, r.requestedByRole, r.requestedAt),
      reviewed: who(r.reviewedById, r.reviewedByRole, r.reviewedAt),
      reviewNote: r.reviewNote,
      approved: who(r.approvedById, r.approvedByRole, r.approvedAt),
      approvalReason: r.approvalReason,
      rejected: who(r.rejectedById, r.rejectedByRole, r.rejectedAt),
      rejectionReason: r.rejectionReason,
      processed: who(r.processedById, r.processedByRole, r.processedAt),
      processMethod: r.processMethod,
      externalRef: r.externalRef,
      reconciled: who(r.reconciledById, r.reconciledByRole, r.reconciledAt),
      statementRef: r.statementRef,
      closedReason: r.closedReason,
      version: r.version,
      createdAt: iso(r.createdAt),
    };
  }

  private async loadRefund(user: Principal, id: string, permission: Permission): Promise<Refund> {
    const r = await this.prisma.refund.findFirst({ where: { id, organizationId: user.organizationId } });
    await this.s.access.assertRecordAccess(user, permission, r && recordAccess({ organizationId: r.organizationId, ownerId: r.ownerId, teamId: r.teamId }), 'Refund');
    return r!;
  }

  // ---- reads -----------------------------------------------------------------------------------------------------
  async list(user: Principal, q: z.infer<typeof listRefundsQuerySchema>) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'refunds:view', ownerField: 'ownerId', teamField: 'teamId' });
    const and: Prisma.RefundWhereInput[] = [];
    if (q.status) and.push({ status: { in: q.status.split(',').map((x) => x.trim()).filter(Boolean) as RefundStatus[] } });
    if (q.dealId) and.push({ dealId: q.dealId });
    if (q.ownerId) and.push({ ownerId: q.ownerId });
    const prior = (scoped.AND as Prisma.RefundWhereInput[] | undefined) ?? [];
    const where = { ...scoped, AND: [...prior, ...and] } as Prisma.RefundWhereInput;
    const rows = await this.prisma.refund.findMany({ where, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const total = q.page ? await this.prisma.refund.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    const page = res.data as Refund[];
    const summaryOnly = this.s.access.isSummaryOnly(user, 'refunds:view');
    const names = await this.s.userNames(page.flatMap((r) => [r.requestedById, r.reviewedById, r.approvedById, r.rejectedById, r.processedById, r.reconciledById]));
    const deals = summaryOnly ? [] : await this.prisma.deal.findMany({ where: { id: { in: page.map((r) => r.dealId) }, organizationId: user.organizationId }, select: { id: true, lead: { select: { fullName: true } } } });
    const lead = new Map(deals.map((d) => [d.id, d.lead.fullName]));
    return ok(page.map((r) => this.dto(r, names, summaryOnly, lead.get(r.dealId))), res.meta);
  }

  async get(user: Principal, id: string) {
    const r = await this.loadRefund(user, id, 'refunds:view');
    const summaryOnly = this.s.access.isSummaryOnly(user, 'refunds:view');
    if (summaryOnly) return this.dto(r, new Map(), true);
    const events = await this.prisma.refundEvent.findMany({ where: { refundId: id }, orderBy: { createdAt: 'asc' } });
    const names = await this.s.userNames([r.requestedById, r.reviewedById, r.approvedById, r.rejectedById, r.processedById, r.reconciledById, ...events.map((e) => e.actorId)]);
    const deal = await this.prisma.deal.findFirst({ where: { id: r.dealId }, select: { lead: { select: { fullName: true } } } });
    return { ...this.dto(r, names, false, deal?.lead.fullName), events: events.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, actorId: e.actorId, actorName: names.get(e.actorId) ?? null, actorRole: e.actorRole, reason: e.reason, at: iso(e.createdAt) })) };
  }

  // ---- request ---------------------------------------------------------------------------------------------------
  async request(user: Principal, b: z.infer<typeof createRefundSchema>, idempotencyKey?: string) {
    const deal = await this.prisma.deal.findFirst({ where: { id: b.dealId, organizationId: user.organizationId } });
    await this.s.access.assertRecordAccess(user, 'refunds:request', deal && recordAccess({ organizationId: deal.organizationId, ownerId: deal.ownerId, teamId: deal.teamId }), 'Deal');
    if (idempotencyKey) {
      const existing = await this.prisma.refund.findFirst({ where: { organizationId: user.organizationId, idempotencyKey } });
      if (existing) return this.replay(existing, b);
    }
    if (deal!.stage !== 'WON') throw new AppError('DEAL_NOT_WON', 'Refunds are requested against a won (booked) sale', 409, { stage: deal!.stage });
    try {
      const created = await this.s.tx(async (tx) => {
        await this.s.lockDeal(tx, user.organizationId, deal!.id);
        const [record, pays, refunds] = await Promise.all([
          tx.salesRecord.findUnique({ where: { dealId: deal!.id }, select: { saleValue: true, adjustments: { where: { status: 'APPROVED' }, select: { delta: true } } } }),
          tx.payment.findMany({ where: { dealId: deal!.id }, select: { id: true, status: true, amount: true } }),
          tx.refund.findMany({ where: { dealId: deal!.id }, select: { status: true, amount: true, approvedAmount: true, processedAmount: true, paymentId: true } }),
        ]);
        const m = dealMoney({ saleValue: record?.saleValue ?? 0n, approvedAdjustmentDeltas: record?.adjustments.map((a) => a.delta) ?? [], payments: pays, refunds });
        const amount = D(b.amount);
        if (amount.greaterThan(m.refundable)) throw new AppError('REFUND_EXCEEDS_COLLECTED', 'The refund cannot exceed verified collections minus refunds already requested or paid', 422, { refundable: money(m.refundable), requested: money(amount), collected: money(m.collected) });
        if (b.paymentId) {
          const pay = pays.find((p) => p.id === b.paymentId);
          if (!pay) throw notFound('Payment');
          if (pay.status !== 'VERIFIED' && pay.status !== 'RECONCILED') throw new AppError('PAYMENT_NOT_VERIFIED', 'Only a verified payment can be refunded', 422, { status: pay.status });
          const live = new Set(['REQUESTED', 'REVIEWED', 'APPROVED', 'PROCESSED', 'RECONCILED']);
          const used = sum(refunds.filter((r) => r.paymentId === b.paymentId && live.has(r.status)).map((r) => r.processedAmount ?? r.approvedAmount ?? r.amount));
          if (amount.greaterThan(D(pay.amount).minus(used))) throw new AppError('REFUND_EXCEEDS_PAYMENT', 'The refund cannot exceed what is left of that payment', 422, { left: money(D(pay.amount).minus(used)) });
        }
        const role = primaryRole(user);
        const r = await tx.refund.create({ data: { organizationId: user.organizationId, dealId: deal!.id, paymentId: b.paymentId ?? null, ownerId: deal!.ownerId, teamId: deal!.teamId, amount: round2(amount), currency: deal!.currency, reasonCategory: b.reasonCategory, reason: b.reason, idempotencyKey: idempotencyKey ?? null, requestedById: user.userId, requestedByRole: role } });
        await tx.refundEvent.create({ data: { organizationId: user.organizationId, refundId: r.id, fromStatus: null, toStatus: 'REQUESTED', actorId: user.userId, actorRole: role, reason: b.reason } });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'refund.requested', entityType: 'refund', entityId: r.id, metadata: { dealId: r.dealId, amount: money(r.amount), reasonCategory: r.reasonCategory } });
        await this.s.publish(tx, { eventType: REVENUE_EVENTS.REFUND_REQUESTED, aggregateType: 'refund', aggregateId: r.id, organizationId: user.organizationId, payload: this.statusPayload(r, null, 'REQUESTED', user.userId, role, b.reason), idempotencyKey: `refund.requested:${r.id}` });
        await this.s.notify(tx, { organizationId: user.organizationId, type: 'refund.status_changed', roles: ['SALES_TEAM_LEAD', 'SALES_MANAGER'], dedupeKey: `refund.requested:${r.id}`, title: 'Refund request to review', body: `A refund of ${money(r.amount)} INR was requested and needs a recommendation.`, entity: { type: 'refund', id: r.id }, actionUrl: '/revenue/refunds' });
        return r;
      });
      return this.get(user, created.id);
    } catch (e) {
      if (isUniqueViolation(e) && idempotencyKey) {
        const existing = await this.prisma.refund.findFirst({ where: { organizationId: user.organizationId, idempotencyKey } });
        if (existing) return this.replay(existing, b);
      }
      throw e;
    }
  }

  private replay(existing: Refund, b: z.infer<typeof createRefundSchema>) {
    if (existing.dealId !== b.dealId || !existing.amount.equals(D(b.amount))) throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with a different request', 422);
    return { ...this.dto(existing, new Map(), false), replayed: true };
  }

  private statusPayload(r: Refund, from: string | null, to: string, actorId: string, actorRole: string | null, reason: string | null): RefundStatusPayload & Record<string, unknown> {
    return { refundId: r.id, dealId: r.dealId, fromStatus: from, toStatus: to, actorId, actorRole, amount: money(r.amount), currency: r.currency, reason };
  }

  // ---- generic guarded transition --------------------------------------------------------------------------------
  private async move(user: Principal, id: string, spec: MoveSpec) {
    const r0 = await this.loadRefund(user, id, spec.permission);
    if (!canRefundTransition(r0.status as RefundStatus, spec.to)) throw new AppError('INVALID_TRANSITION', `A ${r0.status} refund cannot move to ${spec.to}`, 409, { from: r0.status, to: spec.to });
    await spec.check?.(r0);
    const role = primaryRole(user);
    try {
      await this.s.tx(async (tx) => {
        await this.s.lockDeal(tx, user.organizationId, r0.dealId);
        const now = new Date();
        const fresh = await tx.refund.findUniqueOrThrow({ where: { id } });
        if (fresh.status !== r0.status) throw new AppError('INVALID_TRANSITION', `This refund was just moved to ${fresh.status}`, 409, { from: fresh.status, to: spec.to });
        const data = await spec.apply(fresh, tx, { actorRole: role, now });
        const cas = await tx.refund.updateMany({ where: { id, organizationId: user.organizationId, status: r0.status }, data: { ...data, status: spec.to, version: { increment: 1 } } });
        if (cas.count !== 1) throw new AppError('INVALID_TRANSITION', 'This refund was just changed by someone else', 409);
        const after = await tx.refund.findUniqueOrThrow({ where: { id } });
        await tx.refundEvent.create({ data: { organizationId: user.organizationId, refundId: id, fromStatus: r0.status, toStatus: spec.to, actorId: user.userId, actorRole: role, reason: spec.reason } });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: spec.eventType, entityType: 'refund', entityId: id, metadata: { dealId: after.dealId, from: r0.status, to: spec.to, role, reason: spec.reason, amount: money(after.amount) } });
        const payload = spec.payload ? await spec.payload(after, tx, { actorRole: role, now }) : this.statusPayload(after, r0.status, spec.to, user.userId, role, spec.reason);
        await this.s.publish(tx, { eventType: spec.eventType, aggregateType: 'refund', aggregateId: id, organizationId: user.organizationId, payload, idempotencyKey: `${spec.eventType}:${id}` });
        const n = spec.notify?.(after);
        if (n) await this.s.notify(tx, { organizationId: user.organizationId, type: 'refund.status_changed', ...(n.userIds ? { userIds: n.userIds } : {}), ...(n.roles ? { roles: n.roles } : {}), dedupeKey: `${spec.eventType}:${id}`, title: n.title, body: n.body, entity: { type: 'refund', id }, actionUrl: '/revenue/refunds' });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('DUPLICATE_REFUND_REF', 'This external reference was already used for another refund', 409);
      throw e;
    }
    return this.get(user, id);
  }

  private notSelf(user: Principal, r: Refund, what: string) {
    if (r.requestedById === user.userId) throw new AppError('SEPARATION_OF_DUTIES', `You cannot ${what} a refund you requested`, 403);
  }

  review(user: Principal, id: string, b: z.infer<typeof reviewRefundSchema>) {
    return this.move(user, id, {
      to: 'REVIEWED', permission: 'refunds:review', reason: b.note, eventType: REVENUE_EVENTS.REFUND_REVIEWED,
      check: (r) => this.notSelf(user, r, 'review'),
      apply: async (_r, _tx, c) => ({ reviewedById: user.userId, reviewedByRole: c.actorRole, reviewedAt: c.now, reviewNote: b.note, recommendation: b.recommendation }),
      notify: (r) => ({ roles: ['FOUNDER_CEO', 'FINANCE'], title: 'Refund ready for a decision', body: `A reviewed refund of ${money(r.amount)} INR awaits approval.` }),
    });
  }

  approve(user: Principal, id: string, b: z.infer<typeof approveRefundSchema>) {
    return this.move(user, id, {
      to: 'APPROVED', permission: 'refunds:approve', reason: b.reason, eventType: REVENUE_EVENTS.REFUND_APPROVED,
      check: async (r) => {
        this.notSelf(user, r, 'approve');
        const approved = b.approvedAmount ? D(b.approvedAmount) : r.amount;
        if (approved.greaterThan(r.amount)) throw new AppError('APPROVED_EXCEEDS_REQUESTED', 'The approved amount cannot exceed the requested amount', 422, { requested: money(r.amount) });
        const st = await this.s.settings(this.prisma, user.organizationId);
        if (st.refundFounderThreshold && approved.greaterThan(st.refundFounderThreshold) && !hasRole(user, 'FOUNDER_CEO')) {
          throw new AppError('FOUNDER_APPROVAL_REQUIRED', 'Refunds above the configured threshold need the Founder', 403, { threshold: money(st.refundFounderThreshold) });
        }
      },
      apply: async (r, tx, c) => {
        const approved = b.approvedAmount ? D(b.approvedAmount) : r.amount;
        // re-check the cap under the deal lock against everything else that is live
        const others = await tx.refund.findMany({ where: { dealId: r.dealId, id: { not: r.id }, status: { in: ['REQUESTED', 'REVIEWED', 'APPROVED', 'PROCESSED', 'RECONCILED'] } }, select: { amount: true, approvedAmount: true, processedAmount: true } });
        const pays = await tx.payment.findMany({ where: { dealId: r.dealId, status: { in: ['VERIFIED', 'RECONCILED'] } }, select: { amount: true } });
        const left = sum(pays.map((p) => p.amount)).minus(sum(others.map((o) => o.processedAmount ?? o.approvedAmount ?? o.amount)));
        if (approved.greaterThan(left)) throw new AppError('REFUND_EXCEEDS_COLLECTED', 'Approving this amount would exceed what is still collected', 422, { available: money(left.isNegative() ? 0n : left) });
        return { approvedById: user.userId, approvedByRole: c.actorRole, approvedAt: c.now, approvedAmount: round2(approved), approvalReason: b.reason };
      },
      payload: async (r, tx, c) => this.approvedPayload(tx, r, user.userId, c.actorRole),
      notify: (r) => ({ roles: ['FINANCE'], title: 'Approved refund to process', body: `A refund of ${money(r.approvedAmount ?? r.amount)} INR was approved. Process it outside Sales OS and record the reference.` }),
    });
  }

  reject(user: Principal, id: string, b: z.infer<typeof rejectRefundSchema>) {
    return this.move(user, id, {
      to: 'REJECTED', permission: 'refunds:approve', reason: b.reason, eventType: REVENUE_EVENTS.REFUND_REJECTED,
      check: (r) => this.notSelf(user, r, 'reject'),
      apply: async (_r, _tx, c) => ({ rejectedById: user.userId, rejectedByRole: c.actorRole, rejectedAt: c.now, rejectionReason: b.reason }),
      notify: (r) => ({ userIds: [r.requestedById], title: 'Refund rejected', body: b.reason }),
    });
  }

  withdraw(user: Principal, id: string, b: z.infer<typeof closeRefundSchema>) {
    return this.move(user, id, {
      to: 'WITHDRAWN', permission: 'refunds:request', reason: b.reason, eventType: REVENUE_EVENTS.REFUND_WITHDRAWN,
      check: (r) => {
        if (r.requestedById !== user.userId && !hasRole(user, 'SALES_TEAM_LEAD', 'FOUNDER_CEO')) throw new AppError('FORBIDDEN', 'Only the requester or a Team Lead can withdraw a refund request', 403);
      },
      apply: async () => ({ closedReason: b.reason }),
    });
  }

  cancel(user: Principal, id: string, b: z.infer<typeof closeRefundSchema>) {
    return this.move(user, id, {
      to: 'CANCELLED', permission: 'refunds:approve', reason: b.reason, eventType: REVENUE_EVENTS.REFUND_CANCELLED,
      apply: async () => ({ closedReason: b.reason }),
      notify: (r) => ({ userIds: [r.requestedById], title: 'Approved refund cancelled', body: b.reason }),
    });
  }

  process(user: Principal, id: string, b: z.infer<typeof processRefundSchema>) {
    return this.move(user, id, {
      to: 'PROCESSED', permission: 'refunds:process', reason: `Paid out externally (${b.method}), ref ${b.externalRef}`, eventType: REVENUE_EVENTS.REFUND_PROCESSED,
      apply: async (r, tx, c) => {
        const pays = await tx.payment.findMany({ where: { dealId: r.dealId, status: { in: ['VERIFIED', 'RECONCILED'] } }, select: { amount: true } });
        const done = await tx.refund.findMany({ where: { dealId: r.dealId, id: { not: r.id }, status: { in: ['PROCESSED', 'RECONCILED'] } }, select: { processedAmount: true, approvedAmount: true, amount: true } });
        const payout = r.approvedAmount ?? r.amount;
        const left = sum(pays.map((p) => p.amount)).minus(sum(done.map((o) => o.processedAmount ?? o.approvedAmount ?? o.amount)));
        if (payout.greaterThan(left)) throw new AppError('REFUND_EXCEEDS_COLLECTED', 'Processing would refund more than was collected', 409, { available: money(left.isNegative() ? 0n : left) });
        return { processedById: user.userId, processedByRole: c.actorRole, processedAt: b.processedAt ? new Date(b.processedAt) : c.now, processedAmount: payout, processMethod: b.method, externalRef: b.externalRef };
      },
      payload: async (r, tx, c) => this.processedPayload(tx, r, user.userId, c.actorRole),
      notify: (r) => ({ userIds: [r.requestedById, r.ownerId], title: 'Refund processed', body: `${money(r.processedAmount ?? r.amount)} INR was recorded as paid out.` }),
    });
  }

  reconcile(user: Principal, id: string, b: z.infer<typeof reconcileRefundSchema>) {
    return this.move(user, id, {
      to: 'RECONCILED', permission: 'refunds:reconcile', reason: `Statement ${b.statementRef}`, eventType: REVENUE_EVENTS.REFUND_RECONCILED,
      apply: async (_r, _tx, c) => ({ reconciledById: user.userId, reconciledByRole: c.actorRole, reconciledAt: c.now, statementRef: b.statementRef }),
    });
  }

  // ---- event payloads (contract with Agent E) --------------------------------------------------------------------
  private async context(tx: Tx, r: Refund) {
    const [record, deal, payment] = await Promise.all([
      tx.salesRecord.findUnique({ where: { dealId: r.dealId }, select: { closedAt: true, programId: true, leadId: true, credits: { select: { userId: true, sharePct: true } } } }),
      tx.deal.findUniqueOrThrow({ where: { id: r.dealId }, select: { ownerId: true, programId: true, leadId: true } }),
      r.paymentId ? tx.payment.findUnique({ where: { id: r.paymentId }, select: { verifiedAt: true, paidAt: true } }) : tx.payment.findFirst({ where: { dealId: r.dealId, status: { in: ['VERIFIED', 'RECONCILED'] } }, orderBy: { verifiedAt: 'desc' }, select: { verifiedAt: true, paidAt: true } }),
    ]);
    const credited: CreditedOwner[] = (record?.credits ?? []).map((c) => ({ userId: c.userId, sharePct: money(c.sharePct) }));
    const top = [...credited].sort((a, b) => D(b.sharePct).comparedTo(D(a.sharePct)) || (a.userId === deal.ownerId ? -1 : 1))[0];
    return { credited, attributedUserId: top?.userId ?? deal.ownerId, saleClosedAt: record?.closedAt ?? null, programId: deal.programId, leadId: deal.leadId, collectedAt: payment?.verifiedAt ?? payment?.paidAt ?? null };
  }

  private async approvedPayload(tx: Tx, r: Refund, actorId: string, role: string | null): Promise<RevenueRefundApprovedPayload & Record<string, unknown>> {
    const c = await this.context(tx, r);
    return { refundId: r.id, organizationId: r.organizationId, dealId: r.dealId, paymentId: r.paymentId, leadId: c.leadId, programId: c.programId, currency: r.currency, requestedAmount: money(r.amount), amount: money(r.approvedAmount ?? r.amount), approvedAmount: money(r.approvedAmount ?? r.amount), requestedById: r.requestedById, approvedById: actorId, approvedByRole: role, approvedAt: (r.approvedAt ?? new Date()).toISOString(), saleClosedAt: iso(c.saleClosedAt), attributedUserId: c.attributedUserId, creditedOwners: c.credited };
  }

  private async processedPayload(tx: Tx, r: Refund, actorId: string, role: string | null): Promise<RevenueRefundProcessedPayload & Record<string, unknown>> {
    const c = await this.context(tx, r);
    return { refundId: r.id, organizationId: r.organizationId, dealId: r.dealId, paymentId: r.paymentId, attributedUserId: c.attributedUserId, amount: money(r.processedAmount ?? r.amount), currency: r.currency, processedAt: (r.processedAt ?? new Date()).toISOString(), paymentCollectedAt: iso(c.collectedAt), leadId: c.leadId, programId: c.programId, approvedAmount: money(r.approvedAmount ?? r.amount), processedById: actorId, processedByRole: role, externalRef: r.externalRef ?? '', saleClosedAt: iso(c.saleClosedAt), creditedOwners: c.credited };
  }
}
