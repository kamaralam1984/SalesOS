import { Prisma, type PrismaClient } from '@prisma/client';
import { PEOPLE_EVENTS, REFUND_PROCESSED_EVENT, type RefundProcessedPayload } from '@salesos/shared-types';
import type { DomainEvent } from '@salesos/shared-types';

export interface PaidRecommendation {
  id: string;
  employeeId: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date;
  approvedAmount: Prisma.Decimal;
  basisAmount: Prisma.Decimal | null;
  currency: string;
  clawbackWindowDays: number;
}

export interface ClawbackPlan { recommendationId: string; proposedAmount: string; currency: string; reason: string }

const DAY = 86_400_000;

/**
 * PURE. Chooses the PAID recommendation a refund should claw back from and the PROPOSED amount.
 * - Window: refund.processedAt must be within `clawbackWindowDays` after the sale (paymentCollectedAt when known,
 *   otherwise after the incentive payout date).
 * - Target: the recommendation whose period contains the collection date; otherwise the most recent payout.
 * - Amount: refund x (approved / basis) (proportional share), never more than the approved amount.
 * Never applied automatically: the caller only creates a PROPOSAL (DEC-015).
 */
export function planClawback(refund: Pick<RefundProcessedPayload, 'amount' | 'currency' | 'processedAt' | 'paymentCollectedAt'>, paid: PaidRecommendation[]): ClawbackPlan | null {
  const processed = new Date(refund.processedAt).getTime();
  const collected = refund.paymentCollectedAt ? new Date(refund.paymentCollectedAt) : null;
  const sameCurrency = paid.filter((p) => p.currency === refund.currency);
  const candidates = collected ? sameCurrency.filter((p) => p.periodStart.getTime() <= collected.getTime() && collected.getTime() <= p.periodEnd.getTime() + DAY - 1) : [];
  const target = (candidates.length ? candidates : [...sameCurrency].sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime()).slice(0, 1))[0];
  if (!target) return null;
  const anchor = (collected ?? target.paidAt).getTime();
  if (processed < anchor) return null;
  if (processed - anchor > target.clawbackWindowDays * DAY) return null;
  const refundAmt = new Prisma.Decimal(refund.amount);
  if (refundAmt.lte(0) || target.approvedAmount.lte(0)) return null;
  const ratio = target.basisAmount && target.basisAmount.gt(0) ? target.approvedAmount.div(target.basisAmount) : new Prisma.Decimal(1);
  const proposed = Prisma.Decimal.min(target.approvedAmount, refundAmt.times(ratio)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (proposed.lte(0)) return null;
  return { recommendationId: target.id, proposedAmount: proposed.toFixed(2), currency: target.currency, reason: `Refund ${refund.amount} ${refund.currency} processed within ${target.clawbackWindowDays}-day window` };
}

/** Idempotent per (recommendation, refund): unique constraint + status guard. */
export async function handleRefundProcessed(event: DomainEvent, prisma: PrismaClient): Promise<{ proposed: boolean }> {
  const p = event.payload as RefundProcessedPayload;
  if (!p.attributedUserId || !p.organizationId) return { proposed: false };
  const recs = await prisma.incentiveRecommendation.findMany({
    where: { organizationId: p.organizationId, employeeId: p.attributedUserId, status: { in: ['PAID', 'CLAWBACK_PROPOSED'] } },
    include: { policy: { select: { structure: true } } },
  });
  const paid: PaidRecommendation[] = recs.map((r) => {
    const breakdown = r.breakdown as { netBasisAmount?: string } | null;
    return {
      id: r.id, employeeId: r.employeeId, periodStart: r.periodStart, periodEnd: r.periodEnd, paidAt: r.paidAt ?? r.updatedAt, approvedAmount: r.approvedAmount ?? r.computedAmount,
      basisAmount: breakdown?.netBasisAmount ? new Prisma.Decimal(breakdown.netBasisAmount) : null, currency: r.currency,
      clawbackWindowDays: Number((r.policy.structure as { clawbackWindowDays?: number }).clawbackWindowDays ?? 30),
    };
  });
  const plan = planClawback(p, paid);
  if (!plan) return { proposed: false };
  const rec = recs.find((r) => r.id === plan.recommendationId)!;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.incentiveAdjustment.findUnique({ where: { recommendationId_refundId: { recommendationId: plan.recommendationId, refundId: p.refundId } } });
    if (existing) return { proposed: false };
    await tx.incentiveAdjustment.create({ data: { organizationId: p.organizationId, recommendationId: plan.recommendationId, employeeId: rec.employeeId, refundId: p.refundId, proposedAmount: new Prisma.Decimal(plan.proposedAmount), currency: plan.currency, reason: plan.reason } });
    // PAID -> CLAWBACK_PROPOSED only from PAID; CLAWBACK_PROPOSED may collect further proposals, status unchanged.
    const moved = await tx.incentiveRecommendation.updateMany({ where: { id: plan.recommendationId, status: 'PAID' }, data: { status: 'CLAWBACK_PROPOSED', version: { increment: 1 } } });
    if (moved.count === 1) {
      await tx.peopleStateLog.create({ data: { organizationId: p.organizationId, entityType: 'incentive', entityId: plan.recommendationId, fromStatus: 'PAID', toStatus: 'CLAWBACK_PROPOSED', actorId: null, note: plan.reason } });
    }
    await tx.auditLog.create({ data: { organizationId: p.organizationId, actorId: null, action: 'incentive.clawback_proposed', entityType: 'incentive_recommendation', entityId: plan.recommendationId, metadata: { refundId: p.refundId, proposedAmount: plan.proposedAmount, eventId: event.id } } });
    await tx.outboxEvent.createMany({
      data: [{ eventType: PEOPLE_EVENTS.INCENTIVE_CLAWBACK_PROPOSED, aggregateType: 'incentive_recommendation', aggregateId: plan.recommendationId, organizationId: p.organizationId, payload: { recommendationId: plan.recommendationId, organizationId: p.organizationId, employeeId: rec.employeeId, from: 'PAID', to: 'CLAWBACK_PROPOSED', actorId: null }, idempotencyKey: `incentive.clawback_proposed:${plan.recommendationId}:${p.refundId}`, availableAt: new Date() }],
      skipDuplicates: true,
    });
    return { proposed: true };
  });
}

export { REFUND_PROCESSED_EVENT };
