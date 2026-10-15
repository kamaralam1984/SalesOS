import { Injectable } from '@nestjs/common';
import { Prisma, type Payment } from '@prisma/client';
import { REVENUE_EVENTS, type PaymentEventPayload } from '@salesos/shared-types';
import type { z } from 'zod';
import type { dailyCollectionsQuerySchema, listPaymentsQuerySchema, reconcileRunSchema, reconciliationQuerySchema, recordPaymentSchema, rejectPaymentSchema, reversePaymentSchema, verifyPaymentSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { D, ZERO, addDays, canPaymentTransition, dealMoney, istDate, istRange, money, pct1, sum, type PaymentStatus } from '../calc';
import { DealMoneyService } from '../deals/deal-money.service';
import { RevenueSupport, hasRole, isUniqueViolation, iso, isoDay, primaryRole, recordAccess } from '../revenue.support';

type Rec = z.infer<typeof recordPaymentSchema>;

@Injectable()
export class CollectionsService {
  constructor(
    private readonly s: RevenueSupport,
    private readonly dealMoney: DealMoneyService,
  ) {}

  private get prisma() {
    return this.s.prisma;
  }

  private dto(p: Payment, names?: Map<string, string>) {
    return {
      id: p.id,
      dealId: p.dealId,
      ownerId: p.ownerId,
      teamId: p.teamId,
      status: p.status,
      amount: money(p.amount),
      expectedAmount: p.expectedAmount ? money(p.expectedAmount) : null,
      currency: p.currency,
      dueDate: isoDay(p.dueDate),
      method: p.method,
      provider: p.provider,
      externalTransactionRef: p.externalTransactionRef,
      paidAt: iso(p.paidAt),
      note: p.note,
      proofFileId: p.proofFileId,
      recordedById: p.recordedById,
      recordedByName: p.recordedById ? names?.get(p.recordedById) ?? null : null,
      recordedAt: iso(p.recordedAt),
      verifiedById: p.verifiedById,
      verifiedByName: p.verifiedById ? names?.get(p.verifiedById) ?? null : null,
      verifiedAt: iso(p.verifiedAt),
      rejectedAt: iso(p.rejectedAt),
      rejectReason: p.rejectReason,
      reconciledAt: iso(p.reconciledAt),
      statementRef: p.statementRef,
      reversedAt: iso(p.reversedAt),
      reverseReason: p.reverseReason,
      createdAt: iso(p.createdAt),
      version: p.version,
    };
  }

  private async loadPayment(user: Principal, id: string, permission: Parameters<RevenueSupport['access']['assertRecordAccess']>[1]) {
    const p = await this.prisma.payment.findFirst({ where: { id, organizationId: user.organizationId } });
    await this.s.access.assertRecordAccess(user, permission, p && recordAccess({ organizationId: p.organizationId, ownerId: p.ownerId, teamId: p.teamId }), 'Payment');
    return p!;
  }

  // ---- reads -----------------------------------------------------------------------------------------------------
  async list(user: Principal, q: z.infer<typeof listPaymentsQuerySchema>) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'collections:view', ownerField: 'ownerId', teamField: 'teamId' });
    const and: Prisma.PaymentWhereInput[] = [];
    if (q.status) and.push({ status: { in: q.status.split(',').map((x) => x.trim()).filter(Boolean) as PaymentStatus[] } });
    if (q.dealId) and.push({ dealId: q.dealId });
    if (q.ownerId) and.push({ ownerId: q.ownerId });
    if (q.teamId) and.push({ teamId: q.teamId });
    if (q.programId) and.push({ deal: { programId: q.programId } });
    if (q.from) and.push({ OR: [{ verifiedAt: { gte: istRange(q.from, q.from).from } }, { verifiedAt: null, createdAt: { gte: istRange(q.from, q.from).from } }] });
    if (q.to) and.push({ createdAt: { lt: istRange(q.to, q.to).to } });
    const prior = (scoped.AND as Prisma.PaymentWhereInput[] | undefined) ?? [];
    const where = { ...scoped, AND: [...prior, ...and] } as Prisma.PaymentWhereInput;
    const rows = await this.prisma.payment.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const total = q.page ? await this.prisma.payment.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    const page = res.data as Payment[];
    const names = await this.s.userNames(page.flatMap((p) => [p.recordedById, p.verifiedById]));
    const deals = await this.prisma.deal.findMany({ where: { id: { in: page.map((p) => p.dealId) }, organizationId: user.organizationId }, select: { id: true, programId: true, lead: { select: { fullName: true } }, program: { select: { name: true } } } });
    const dm = new Map(deals.map((d) => [d.id, d]));
    return ok(page.map((p) => ({ ...this.dto(p, names), leadName: dm.get(p.dealId)?.lead.fullName ?? null, programName: dm.get(p.dealId)?.program.name ?? null })), res.meta);
  }

  async get(user: Principal, id: string) {
    const p = await this.loadPayment(user, id, 'collections:view');
    const events = await this.prisma.paymentEvent.findMany({ where: { paymentId: id }, orderBy: { createdAt: 'asc' } });
    const names = await this.s.userNames([p.recordedById, p.verifiedById, ...events.map((e) => e.actorId)]);
    return { ...this.dto(p, names), events: events.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, actorId: e.actorId, actorName: e.actorId ? names.get(e.actorId) ?? null : null, actorRole: e.actorRole, reason: e.reason, at: iso(e.createdAt) })) };
  }

  /** Daily collections (IST days): verified vs unverified (recorded, awaiting Finance), plus verified by program. */
  async daily(user: Principal, q: z.infer<typeof dailyCollectionsQuerySchema>) {
    if (q.to < q.from) throw new AppError('VALIDATION_ERROR', 'to must not be before from', 400);
    const scoped = await this.s.access.scopedWhere(user, { permission: 'collections:view', ownerField: 'ownerId', teamField: 'teamId' });
    const { from, to } = istRange(q.from, q.to);
    const prior = (scoped.AND as Prisma.PaymentWhereInput[] | undefined) ?? [];
    const rows = await this.prisma.payment.findMany({
      where: { ...scoped, AND: [...prior, { OR: [{ status: { in: ['VERIFIED', 'RECONCILED'] }, verifiedAt: { gte: from, lt: to } }, { status: 'RECORDED', recordedAt: { gte: from, lt: to } }] }] } as Prisma.PaymentWhereInput,
      select: { id: true, status: true, amount: true, verifiedAt: true, recordedAt: true, deal: { select: { programId: true, program: { select: { name: true } } } } },
      take: 20000,
    });
    const days = new Map<string, { verified: Prisma.Decimal; unverified: Prisma.Decimal }>();
    const progs = new Map<string, { name: string; verified: Prisma.Decimal }>();
    for (const r of rows) {
      const verified = r.status === 'VERIFIED' || r.status === 'RECONCILED';
      const at = verified ? r.verifiedAt! : r.recordedAt!;
      const key = istDate(at);
      const cur = days.get(key) ?? { verified: ZERO, unverified: ZERO };
      days.set(key, verified ? { ...cur, verified: cur.verified.plus(r.amount) } : { ...cur, unverified: cur.unverified.plus(r.amount) });
      if (verified) {
        const pg = progs.get(r.deal.programId) ?? { name: r.deal.program.name, verified: ZERO };
        progs.set(r.deal.programId, { ...pg, verified: pg.verified.plus(r.amount) });
      }
    }
    const series: Array<{ date: string; verified: string; unverified: string }> = [];
    for (let d = q.from; d <= q.to; d = addDays(d, 1)) {
      const v = days.get(d);
      series.push({ date: d, verified: money(v?.verified), unverified: money(v?.unverified) });
      if (series.length > 400) break;
    }
    return {
      currency: 'INR',
      from: q.from,
      to: q.to,
      series,
      totals: { verified: money(sum([...days.values()].map((v) => v.verified))), unverified: money(sum([...days.values()].map((v) => v.unverified))) },
      byProgram: [...progs].map(([programId, v]) => ({ programId, programName: v.name, verified: money(v.verified) })),
    };
  }

  // ---- record (idempotent, duplicate-safe) -----------------------------------------------------------------------
  async record(user: Principal, b: Rec, idempotencyKey?: string) {
    const deal = await this.prisma.deal.findFirst({ where: { id: b.dealId, organizationId: user.organizationId } });
    await this.s.access.assertRecordAccess(user, 'collections:create', deal && recordAccess({ organizationId: deal.organizationId, ownerId: deal.ownerId, teamId: deal.teamId }), 'Deal');
    const d = deal!;
    if (d.stage !== 'WON') throw new AppError('DEAL_NOT_WON', 'Payments are recorded against a Closed-Won sale (current stage: ' + d.stage + ')', 409, { stage: d.stage });
    if (b.currency !== d.currency) throw new AppError('CURRENCY_MISMATCH', 'The payment currency must match the deal currency', 422);

    if (idempotencyKey) {
      const existing = await this.prisma.payment.findFirst({ where: { organizationId: user.organizationId, idempotencyKey } });
      if (existing) return this.replay(user, existing, b);
    }
    try {
      const saved = await this.s.tx(async (tx) => {
        const now = new Date();
        const data = {
          amount: D(b.amount), currency: 'INR', method: b.method, provider: b.provider, externalTransactionRef: b.externalTransactionRef, idempotencyKey: idempotencyKey ?? null,
          paidAt: new Date(b.paidAt), note: b.note ?? null, proofFileId: b.proofFileId ?? null, status: 'RECORDED' as const, recordedById: user.userId, recordedAt: now,
          rejectedAt: null, rejectedById: null, rejectReason: null, version: { increment: 1 },
        };
        let p: Payment;
        let from: PaymentStatus | null = null;
        if (b.expectedPaymentId) {
          const cur = await tx.payment.findFirst({ where: { id: b.expectedPaymentId, organizationId: user.organizationId, dealId: d.id } });
          if (!cur) throw notFound('Expected payment');
          if (!canPaymentTransition(cur.status as PaymentStatus, 'RECORDED')) throw new AppError('INVALID_TRANSITION', `A ${cur.status} payment cannot be recorded again`, 409, { status: cur.status });
          from = cur.status as PaymentStatus;
          const cas = await tx.payment.updateMany({ where: { id: cur.id, status: cur.status }, data });
          if (cas.count !== 1) throw new AppError('INVALID_TRANSITION', 'This payment was just changed by someone else', 409);
          p = await tx.payment.findUniqueOrThrow({ where: { id: cur.id } });
        } else {
          p = await tx.payment.create({ data: { organizationId: user.organizationId, dealId: d.id, ownerId: d.ownerId, teamId: d.teamId, ...data, version: 1 } });
        }
        await tx.paymentEvent.create({ data: { organizationId: user.organizationId, paymentId: p.id, fromStatus: from, toStatus: 'RECORDED', actorId: user.userId, actorRole: primaryRole(user), reason: b.note ?? null } });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'payment.recorded', entityType: 'payment', entityId: p.id, metadata: { dealId: d.id, amount: money(p.amount), provider: p.provider, externalTransactionRef: p.externalTransactionRef } });
        await this.s.publish(tx, { eventType: REVENUE_EVENTS.PAYMENT_RECORDED, aggregateType: 'payment', aggregateId: p.id, organizationId: user.organizationId, payload: await this.eventPayload(tx, p, user.userId, 'RECORDED'), idempotencyKey: `payment.recorded:${p.id}:${p.version}` });
        await this.s.notify(tx, { organizationId: user.organizationId, type: 'collection.status_changed', roles: ['FINANCE'], dedupeKey: `payment.recorded:${p.id}:${p.version}`, title: 'Payment awaiting verification', body: `A payment of ${money(p.amount)} INR was recorded and needs Finance verification.`, entity: { type: 'payment', id: p.id }, actionUrl: '/revenue/collections' });
        return p;
      });
      return { ...this.dto(saved), replayed: false };
    } catch (e) {
      if (isUniqueViolation(e)) {
        if (idempotencyKey) {
          const existing = await this.prisma.payment.findFirst({ where: { organizationId: user.organizationId, idempotencyKey } });
          if (existing) return this.replay(user, existing, b);
        }
        const dup = await this.prisma.payment.findFirst({ where: { organizationId: user.organizationId, provider: b.provider, externalTransactionRef: b.externalTransactionRef }, select: { id: true, status: true, dealId: true } });
        throw new AppError('DUPLICATE_PAYMENT', 'A payment with this transaction reference was already recorded. No credit was given.', 409, dup ? { existingPaymentId: dup.id, status: dup.status } : undefined);
      }
      throw e;
    }
  }

  private async replay(user: Principal, existing: Payment, b: Rec) {
    if (existing.dealId !== b.dealId || !existing.amount.equals(D(b.amount)) || existing.externalTransactionRef !== b.externalTransactionRef) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with a different request', 422);
    }
    return { ...this.dto(existing), replayed: true };
  }

  private async eventPayload(tx: Prisma.TransactionClient, p: Payment, actorId: string | null, status: string): Promise<PaymentEventPayload & Record<string, unknown>> {
    return { paymentId: p.id, dealId: p.dealId, status, amount: money(p.amount), currency: p.currency, ownerId: p.ownerId, actorId, externalTransactionRef: p.externalTransactionRef, provider: p.provider, creditedOwners: await this.s.creditedOwners(tx, p.dealId), at: new Date().toISOString() };
  }

  // ---- verify / reject (Finance) ---------------------------------------------------------------------------------
  async verify(user: Principal, id: string, b: z.infer<typeof verifyPaymentSchema>) {
    const p0 = await this.loadPayment(user, id, 'collections:verify');
    if (p0.recordedById === user.userId) throw new AppError('SEPARATION_OF_DUTIES', 'The person who recorded a payment cannot verify it', 403);
    if (!canPaymentTransition(p0.status as PaymentStatus, 'VERIFIED')) throw new AppError('INVALID_TRANSITION', `A ${p0.status} payment cannot be verified`, 409, { status: p0.status });
    const settings = await this.s.settings(this.prisma, user.organizationId);
    if (b.confirmedAmount && D(b.confirmedAmount).minus(p0.amount).abs().greaterThan(settings.paymentTolerance)) {
      throw new AppError('AMOUNT_MISMATCH', 'The confirmed amount differs from the recorded amount beyond the tolerance. Reject the payment with a reason instead.', 422, { recorded: money(p0.amount), confirmed: money(b.confirmedAmount), tolerance: money(settings.paymentTolerance) });
    }
    const out = await this.s.tx(async (tx) => {
      await this.s.lockDeal(tx, user.organizationId, p0.dealId); // serialise credit per deal: no double credit, no overpayment race
      const cas = await tx.payment.updateMany({ where: { id, organizationId: user.organizationId, status: 'RECORDED' }, data: { status: 'VERIFIED', verifiedById: user.userId, verifiedAt: new Date(), version: { increment: 1 } } });
      if (cas.count !== 1) throw new AppError('INVALID_TRANSITION', 'This payment is no longer awaiting verification', 409);
      const p = await tx.payment.findUniqueOrThrow({ where: { id } });
      const [record, pays, refunds] = await Promise.all([
        tx.salesRecord.findUnique({ where: { dealId: p.dealId }, select: { saleValue: true, adjustments: { where: { status: 'APPROVED' }, select: { delta: true } } } }),
        tx.payment.findMany({ where: { dealId: p.dealId }, select: { status: true, amount: true } }),
        tx.refund.findMany({ where: { dealId: p.dealId }, select: { status: true, amount: true, approvedAmount: true, processedAmount: true } }),
      ]);
      if (!record) throw new AppError('DEAL_NOT_WON', 'There is no booked sale for this payment', 409);
      const m = dealMoney({ saleValue: record.saleValue, approvedAdjustmentDeltas: record.adjustments.map((a) => a.delta), payments: pays, refunds });
      if (m.overCollected.greaterThan(settings.paymentTolerance)) {
        throw new AppError('OVERPAYMENT', 'Verifying this payment would collect more than the sale value. Check for a duplicate or record an adjustment first.', 422, { saleValue: money(m.saleValue), collectedAfter: money(m.collected), overBy: money(m.overCollected) });
      }
      await tx.paymentEvent.create({ data: { organizationId: user.organizationId, paymentId: id, fromStatus: 'RECORDED', toStatus: 'VERIFIED', actorId: user.userId, actorRole: primaryRole(user), reason: b.note ?? null } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'payment.verified', entityType: 'payment', entityId: id, metadata: { dealId: p.dealId, amount: money(p.amount), collectedAfter: money(m.collected) } });
      await this.s.publish(tx, { eventType: REVENUE_EVENTS.PAYMENT_VERIFIED, aggregateType: 'payment', aggregateId: id, organizationId: user.organizationId, payload: await this.eventPayload(tx, p, user.userId, 'VERIFIED'), idempotencyKey: `payment.verified:${id}` });
      await this.s.notify(tx, { organizationId: user.organizationId, type: 'collection.status_changed', userIds: [...new Set([p.ownerId, ...(p.recordedById ? [p.recordedById] : [])])], dedupeKey: `payment.verified:${id}`, title: 'Payment verified', body: `${money(p.amount)} INR was verified by Finance.`, entity: { type: 'payment', id }, actionUrl: `/revenue/deals/${p.dealId}` });
      return p;
    });
    return this.dto(out);
  }

  async reject(user: Principal, id: string, b: z.infer<typeof rejectPaymentSchema>) {
    const p0 = await this.loadPayment(user, id, 'collections:verify');
    if (!canPaymentTransition(p0.status as PaymentStatus, 'REJECTED')) throw new AppError('INVALID_TRANSITION', `A ${p0.status} payment cannot be rejected`, 409, { status: p0.status });
    const out = await this.s.tx(async (tx) => {
      const cas = await tx.payment.updateMany({ where: { id, organizationId: user.organizationId, status: 'RECORDED' }, data: { status: 'REJECTED', rejectedById: user.userId, rejectedAt: new Date(), rejectReason: b.reason, version: { increment: 1 } } });
      if (cas.count !== 1) throw new AppError('INVALID_TRANSITION', 'This payment is no longer awaiting verification', 409);
      const p = await tx.payment.findUniqueOrThrow({ where: { id } });
      await tx.paymentEvent.create({ data: { organizationId: user.organizationId, paymentId: id, fromStatus: 'RECORDED', toStatus: 'REJECTED', actorId: user.userId, actorRole: primaryRole(user), reason: b.reason } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'payment.rejected', entityType: 'payment', entityId: id, metadata: { dealId: p.dealId, reason: b.reason } });
      await this.s.publish(tx, { eventType: REVENUE_EVENTS.PAYMENT_REJECTED, aggregateType: 'payment', aggregateId: id, organizationId: user.organizationId, payload: await this.eventPayload(tx, p, user.userId, 'REJECTED'), idempotencyKey: `payment.rejected:${id}:${p.version}` });
      if (p.recordedById) await this.s.notify(tx, { organizationId: user.organizationId, type: 'collection.status_changed', userIds: [p.recordedById], dedupeKey: `payment.rejected:${id}:${p.version}`, title: 'Payment rejected by Finance', body: b.reason, entity: { type: 'payment', id }, actionUrl: `/revenue/deals/${p.dealId}`, severity: 'WARNING' });
      return p;
    });
    return this.dto(out);
  }

  /** VERIFIED -> REVERSED (Finance or Founder, reason mandatory; blocked while processed refunds would exceed what is left). */
  async reverse(user: Principal, id: string, b: z.infer<typeof reversePaymentSchema>) {
    const p0 = await this.loadPayment(user, id, 'collections:reconcile');
    if (!hasRole(user, 'FINANCE', 'FOUNDER_CEO')) throw new AppError('FORBIDDEN', 'Only Finance or the Founder can reverse a verified payment', 403);
    if (!canPaymentTransition(p0.status as PaymentStatus, 'REVERSED')) throw new AppError('INVALID_TRANSITION', `A ${p0.status} payment cannot be reversed`, 409, { status: p0.status });
    const out = await this.s.tx(async (tx) => {
      await this.s.lockDeal(tx, user.organizationId, p0.dealId);
      const cas = await tx.payment.updateMany({ where: { id, organizationId: user.organizationId, status: 'VERIFIED' }, data: { status: 'REVERSED', reversedById: user.userId, reversedAt: new Date(), reverseReason: b.reason, version: { increment: 1 } } });
      if (cas.count !== 1) throw new AppError('INVALID_TRANSITION', 'Only a verified, unreconciled payment can be reversed', 409);
      const p = await tx.payment.findUniqueOrThrow({ where: { id } });
      const [pays, refunds] = await Promise.all([tx.payment.findMany({ where: { dealId: p.dealId }, select: { status: true, amount: true } }), tx.refund.findMany({ where: { dealId: p.dealId }, select: { status: true, amount: true, approvedAmount: true, processedAmount: true } })]);
      const m = dealMoney({ saleValue: ZERO, payments: pays, refunds });
      if (m.collected.minus(m.refunded).isNegative()) throw new AppError('REFUND_EXCEEDS_COLLECTED', 'Reversing this payment would leave less collected than already refunded', 409);
      await tx.paymentEvent.create({ data: { organizationId: user.organizationId, paymentId: id, fromStatus: 'VERIFIED', toStatus: 'REVERSED', actorId: user.userId, actorRole: primaryRole(user), reason: b.reason } });
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'payment.reversed', entityType: 'payment', entityId: id, metadata: { dealId: p.dealId, amount: money(p.amount), reason: b.reason } });
      await this.s.publish(tx, { eventType: REVENUE_EVENTS.PAYMENT_REVERSED, aggregateType: 'payment', aggregateId: id, organizationId: user.organizationId, payload: await this.eventPayload(tx, p, user.userId, 'REVERSED'), idempotencyKey: `payment.reversed:${id}` });
      return p;
    });
    return this.dto(out);
  }

  // ---- reconciliation --------------------------------------------------------------------------------------------
  async reconciliation(user: Principal, q: z.infer<typeof reconciliationQuerySchema>) {
    const org = user.organizationId;
    const [salesAgg, adjAgg, payAgg, refAgg] = await Promise.all([
      this.prisma.salesRecord.aggregate({ where: { organizationId: org, deal: { stage: { not: 'CANCELLED' } } }, _sum: { saleValue: true }, _count: { _all: true } }),
      this.prisma.saleAdjustment.aggregate({ where: { organizationId: org, status: 'APPROVED', salesRecord: { deal: { stage: { not: 'CANCELLED' } } } }, _sum: { delta: true } }),
      this.prisma.payment.groupBy({ by: ['status'], where: { organizationId: org }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.refund.groupBy({ by: ['status'], where: { organizationId: org }, _sum: { processedAmount: true, approvedAmount: true } }),
    ]);
    const pay = (s: string) => payAgg.find((x) => x.status === s)?._sum.amount ?? ZERO;
    const netSale = D(salesAgg._sum.saleValue).plus(D(adjAgg._sum.delta));
    const verified = D(pay('VERIFIED')).plus(pay('RECONCILED'));
    const refunded = D(refAgg.find((r) => r.status === 'PROCESSED')?._sum.processedAmount).plus(D(refAgg.find((r) => r.status === 'RECONCILED')?._sum.processedAmount));
    const totals = {
      currency: 'INR',
      bookedSales: money(netSale),
      collectedVerified: money(verified),
      reconciled: money(pay('RECONCILED')),
      verifiedAwaitingReconciliation: money(pay('VERIFIED')),
      pendingVerification: money(pay('RECORDED')),
      expected: money(pay('EXPECTED')),
      reversed: money(pay('REVERSED')),
      refundedProcessed: money(refunded),
      netCollections: money(verified.minus(refunded)),
      outstandingDue: money(netSale.minus(verified).isNegative() ? ZERO : netSale.minus(verified)),
      collectionPct: pct1(verified, netSale),
      saleCount: salesAgg._count._all,
    };
    if (q.view === 'unreconciled') {
      const where = { organizationId: org, status: 'VERIFIED' as const };
      const rows = await this.prisma.payment.findMany({ where, orderBy: [{ verifiedAt: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
      const res = pageResult(rows, q);
      const names = await this.s.userNames((res.data as Payment[]).flatMap((p) => [p.recordedById, p.verifiedById]));
      return ok({ totals, view: q.view, items: (res.data as Payment[]).map((p) => this.dto(p, names)) }, res.meta);
    }
    if (q.view === 'deal-mismatch') {
      const deals = await this.prisma.deal.findMany({ where: { organizationId: org, stage: 'WON' }, select: { id: true, leadId: true, programId: true, closedAt: true, lead: { select: { fullName: true } } }, orderBy: [{ closedAt: 'desc' }, { id: 'desc' }], take: 500 });
      const mm = await this.dealMoney.forDeals(org, deals.map((d) => d.id));
      const items = deals
        .map((d) => ({ d, m: mm.get(d.id)! }))
        .filter((x) => x.m && (!x.m.amountDue.isZero() || !x.m.overCollected.isZero() || !x.m.pendingVerification.isZero()))
        .map(({ d, m }) => ({ dealId: d.id, leadName: d.lead.fullName, closedAt: iso(d.closedAt), saleValue: money(m.saleValue), collected: money(m.collected), pendingVerification: money(m.pendingVerification), amountDue: money(m.amountDue), overCollected: money(m.overCollected), flag: !m.overCollected.isZero() ? 'OVER_COLLECTED' : !m.pendingVerification.isZero() ? 'PENDING_VERIFICATION' : 'DUE' }));
      return ok({ totals, view: q.view, items });
    }
    const dups = await this.prisma.$queryRaw<{ deal_id: string; amount: Prisma.Decimal; day: string; ids: string[]; refs: string[]; n: bigint }[]>`
      SELECT deal_id::text, amount, to_char(paid_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day, array_agg(id::text ORDER BY created_at) AS ids,
             array_agg(coalesce(external_transaction_ref, '')) AS refs, count(*)::bigint AS n
      FROM payments WHERE organization_id = ${org}::uuid AND status IN ('RECORDED','VERIFIED','RECONCILED') AND paid_at IS NOT NULL
      GROUP BY deal_id, amount, to_char(paid_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') HAVING count(*) > 1 ORDER BY max(created_at) DESC LIMIT 200`;
    return ok({ totals, view: q.view, items: dups.map((x) => ({ dealId: x.deal_id, amount: money(x.amount), day: x.day, paymentIds: x.ids, references: x.refs, count: Number(x.n), note: 'Same deal, amount and day with different references: check for a duplicate credit' })) });
  }

  /** Matches Finance's bank/gateway statement lines (and/or explicit payment ids) to VERIFIED payments and locks them RECONCILED. */
  async runReconciliation(user: Principal, b: z.infer<typeof reconcileRunSchema>) {
    const matched: Array<{ paymentId: string; externalTransactionRef: string | null; amount: string }> = [];
    const unmatched: Array<{ externalTransactionRef: string | null; paymentId?: string; amount?: string; reason: string }> = [];
    const targets: Payment[] = [];
    for (const line of b.lines ?? []) {
      const rows = await this.prisma.payment.findMany({ where: { organizationId: user.organizationId, externalTransactionRef: line.externalTransactionRef, ...(line.provider ? { provider: line.provider } : {}) } });
      if (rows.length === 0) unmatched.push({ externalTransactionRef: line.externalTransactionRef, amount: money(line.amount), reason: 'NOT_FOUND' });
      else if (rows.length > 1) unmatched.push({ externalTransactionRef: line.externalTransactionRef, amount: money(line.amount), reason: 'AMBIGUOUS_PROVIDER' });
      else if (rows[0]!.status === 'RECONCILED') unmatched.push({ externalTransactionRef: line.externalTransactionRef, paymentId: rows[0]!.id, reason: 'ALREADY_RECONCILED' });
      else if (rows[0]!.status !== 'VERIFIED') unmatched.push({ externalTransactionRef: line.externalTransactionRef, paymentId: rows[0]!.id, reason: `NOT_VERIFIED_${rows[0]!.status}` });
      else if (!rows[0]!.amount.equals(D(line.amount))) unmatched.push({ externalTransactionRef: line.externalTransactionRef, paymentId: rows[0]!.id, amount: money(line.amount), reason: 'AMOUNT_MISMATCH' });
      else targets.push(rows[0]!);
    }
    if (b.paymentIds?.length) {
      const rows = await this.prisma.payment.findMany({ where: { organizationId: user.organizationId, id: { in: b.paymentIds } } });
      for (const id of b.paymentIds) {
        const r = rows.find((x) => x.id === id);
        if (!r) unmatched.push({ externalTransactionRef: null, paymentId: id, reason: 'NOT_FOUND' });
        else if (r.status !== 'VERIFIED') unmatched.push({ externalTransactionRef: r.externalTransactionRef, paymentId: id, reason: r.status === 'RECONCILED' ? 'ALREADY_RECONCILED' : `NOT_VERIFIED_${r.status}` });
        else if (!targets.some((t) => t.id === id)) targets.push(r);
      }
    }
    for (const p of targets) {
      const done = await this.s.tx(async (tx) => {
        const cas = await tx.payment.updateMany({ where: { id: p.id, organizationId: user.organizationId, status: 'VERIFIED' }, data: { status: 'RECONCILED', reconciledById: user.userId, reconciledAt: new Date(), statementRef: b.statementRef, version: { increment: 1 } } });
        if (cas.count !== 1) return false;
        const fresh = await tx.payment.findUniqueOrThrow({ where: { id: p.id } });
        await tx.paymentEvent.create({ data: { organizationId: user.organizationId, paymentId: p.id, fromStatus: 'VERIFIED', toStatus: 'RECONCILED', actorId: user.userId, actorRole: primaryRole(user), reason: `Statement ${b.statementRef}` } });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'payment.reconciled', entityType: 'payment', entityId: p.id, metadata: { dealId: p.dealId, statementRef: b.statementRef, amount: money(p.amount) } });
        await this.s.publish(tx, { eventType: REVENUE_EVENTS.PAYMENT_RECONCILED, aggregateType: 'payment', aggregateId: p.id, organizationId: user.organizationId, payload: await this.eventPayload(tx, fresh, user.userId, 'RECONCILED'), idempotencyKey: `payment.reconciled:${p.id}` });
        return true;
      });
      if (done) matched.push({ paymentId: p.id, externalTransactionRef: p.externalTransactionRef, amount: money(p.amount) });
      else unmatched.push({ externalTransactionRef: p.externalTransactionRef, paymentId: p.id, reason: 'ALREADY_RECONCILED' });
    }
    return { statementRef: b.statementRef, matched, unmatched, matchedCount: matched.length, unmatchedCount: unmatched.length };
  }
}

