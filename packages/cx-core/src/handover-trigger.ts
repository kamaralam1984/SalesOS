import { Prisma, type PrismaClient } from '@prisma/client';
import { CX_EVENTS, type HandoverTriggerPayload } from '@salesos/shared-types';
import { LANGUAGES } from './constants';
import { auditSystem, emitCx, logState } from './db';

export interface HandoverTriggerEvent {
  id: string;
  eventType: string;
  organizationId: string | null;
  payload: unknown;
}

export type HandoverTriggerResult =
  | { created: true; handoverId: string }
  | { created: false; reason: 'NOT_WON' | 'NO_ORGANIZATION' | 'NO_OWNER' | 'NO_REFERENCE' | 'DUPLICATE' | 'ATTACHED_DEAL'; handoverId?: string };

const num = (v: unknown): Prisma.Decimal | null => {
  if (v === null || v === undefined || v === '') return null;
  try {
    const d = new Prisma.Decimal(v as string | number);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
};
const first = <T>(...vals: Array<T | null | undefined>): T | null => vals.find((v) => v !== null && v !== undefined) ?? null;

/**
 * Creates a DRAFT handover for a won sale (state machine section 6, "(create) -> DRAFT: system on WON").
 * Idempotent: keyed on the outbox event id, then on (organization, deal), then on the lead.
 * Pre-fills ONLY what the handover needs from the lead/deal (name, contact, language, program, amounts); consents,
 * promises, goals, notes are never pre-filled: the sales owner must enter them before submit.
 */
export async function createHandoverFromTrigger(prisma: PrismaClient, event: HandoverTriggerEvent): Promise<HandoverTriggerResult> {
  const first = await attempt(prisma, event);
  // lead.won and deal.closed are consumed concurrently: the loser of the race hits the one-open-handover-per-learner index and
  // simply runs again, finding the winner's row (it then attaches its deal id / fills the gaps).
  if (first === 'RACE') {
    const second = await attempt(prisma, event);
    return second === 'RACE' ? { created: false, reason: 'DUPLICATE' } : second;
  }
  return first;
}

async function attempt(prisma: PrismaClient, event: HandoverTriggerEvent): Promise<HandoverTriggerResult | 'RACE'> {
  const orgId = event.organizationId;
  if (!orgId) return { created: false, reason: 'NO_ORGANIZATION' };
  const p = (event.payload ?? {}) as HandoverTriggerPayload;
  const outcome = (p.outcome ?? p.status ?? 'WON').toString().toUpperCase();
  if (event.eventType === 'deal.closed' && outcome !== 'WON') return { created: false, reason: 'NOT_WON' };

  const dealId = first(p.dealId, event.eventType === 'deal.closed' || event.eventType === 'deal.won' ? p.id : null);
  const deal = dealId ? await prisma.deal.findFirst({ where: { id: dealId, organizationId: orgId }, include: { salesRecord: { select: { saleValue: true } } } }) : null;
  const leadId = p.leadId ?? deal?.leadId ?? null;
  if (!dealId && !leadId) return { created: false, reason: 'NO_REFERENCE' };

  const byEvent = await prisma.handoverRecord.findUnique({ where: { sourceEventId: event.id } });
  if (byEvent) return { created: false, reason: 'DUPLICATE', handoverId: byEvent.id };
  if (dealId) {
    const byDeal = await prisma.handoverRecord.findFirst({ where: { organizationId: orgId, dealId } });
    if (byDeal) return { created: false, reason: 'DUPLICATE', handoverId: byDeal.id };
    if (leadId) {
      const byLead = await prisma.handoverRecord.findFirst({ where: { organizationId: orgId, leadId, dealId: null, status: { not: 'COMPLETED' } } });
      if (byLead) {
        await attachDeal(prisma, byLead, dealId, deal);
        return { created: false, reason: 'ATTACHED_DEAL', handoverId: byLead.id };
      }
    }
  } else if (leadId) {
    const byLead = await prisma.handoverRecord.findFirst({ where: { organizationId: orgId, leadId, status: { not: 'COMPLETED' } } });
    if (byLead) return { created: false, reason: 'DUPLICATE', handoverId: byLead.id };
  }

  const lead = leadId ? await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId } }) : null;
  const ownerId = first(p.ownerId, p.assignedToId, p.creditedOwnerId, deal?.ownerId, lead?.assignedToId);
  if (!ownerId) return { created: false, reason: 'NO_OWNER' };
  const owner = await prisma.user.findFirst({ where: { id: ownerId, organizationId: orgId }, select: { id: true } });
  if (!owner) return { created: false, reason: 'NO_OWNER' };

  const programId = first(p.programId, deal?.programId, lead?.programId);
  const program = programId ? await prisma.program.findFirst({ where: { id: programId, organizationId: orgId }, select: { id: true, name: true } }) : null;
  const total = num(first(p.saleValue, p.finalAmount, p.amount, p.value, deal?.salesRecord?.saleValue?.toString(), deal?.amount?.toString()));
  // amount paid = VERIFIED payments only (Closed-Won never implies paid); the seller confirms the flag before submit
  const paidAgg = dealId ? await prisma.payment.aggregate({ where: { organizationId: orgId, dealId, status: { in: ['VERIFIED', 'RECONCILED'] } }, _sum: { amount: true } }) : null;
  const verifiedPaid = paidAgg?._sum.amount ?? null;
  const collected = num(first(p.amountCollected, p.collected)) ?? verifiedPaid;
  const lang = lead?.preferredLanguage?.toUpperCase().slice(0, 2);

  try {
    const h = await prisma.$transaction(async (tx) => {
      const row = await tx.handoverRecord.create({
        data: {
          organizationId: orgId,
          dealId,
          leadId,
          programId: program?.id ?? null,
          programName: program?.name ?? null,
          ownerId,
          teamId: lead?.teamId ?? null,
          sourceEventId: event.id,
          learnerName: lead?.fullName ?? null,
          learnerContact: lead?.phoneE164 ?? lead?.phoneRaw ?? lead?.email ?? null,
          languagePreference: lang && (LANGUAGES as readonly string[]).includes(lang) ? lang : null,
          // amounts are only pre-filled when the revenue deal is known (lead.won alone cannot tell what was collected)
          amountPaid: collected ?? (dealId && total ? new Prisma.Decimal(0) : null),
          paymentVerified: verifiedPaid && verifiedPaid.gt(0) ? true : null,
          amountDue: dealId || collected ? (total ? (collected ? Prisma.Decimal.max(total.minus(collected), new Prisma.Decimal(0)) : total) : null) : null,
          currency: (p.currency ?? deal?.currency ?? lead?.currency ?? 'INR').toUpperCase().slice(0, 3),
        },
      });
      await logState(tx, { organizationId: orgId, entityType: 'handover', entityId: row.id, from: null, to: 'DRAFT', note: `created from ${event.eventType}` });
      await auditSystem(tx, { organizationId: orgId, action: 'handover.created', entityType: 'handover', entityId: row.id, metadata: { trigger: event.eventType, dealId, leadId } });
      await emitCx(tx, {
        organizationId: orgId,
        eventType: CX_EVENTS.HANDOVER_CREATED,
        aggregateType: 'handover',
        aggregateId: row.id,
        payload: { organizationId: orgId, handoverId: row.id, status: 'DRAFT', ownerId, dealId, leadId, notifyUserIds: [ownerId] },
        key: `handover.created:${row.id}`,
      });
      return row;
    });
    return { created: true, handoverId: h.id };
  } catch (e) {
    // unique violation from a concurrent consumer (same event / same deal / same open learner): run again to find the winner
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'RACE';
    throw e;
  }
}

type DealWithSale = Awaited<ReturnType<PrismaClient['deal']['findFirst']>> & { salesRecord?: { saleValue: Prisma.Decimal } | null };

/** Attaches the revenue deal to a handover created earlier from lead.won, filling ONLY fields that are still empty. */
async function attachDeal(prisma: PrismaClient, h: { id: string; organizationId: string; programId: string | null; programName: string | null; amountPaid: Prisma.Decimal | null; amountDue: Prisma.Decimal | null; paymentVerified: boolean | null }, dealId: string, deal: DealWithSale | null): Promise<void> {
  const data: Prisma.HandoverRecordUncheckedUpdateInput = { dealId };
  if (deal) {
    if (!h.programId) {
      const program = await prisma.program.findFirst({ where: { id: deal.programId, organizationId: h.organizationId }, select: { id: true, name: true } });
      if (program) { data.programId = program.id; if (!h.programName) data.programName = program.name; }
    }
    const total = num(deal.salesRecord?.saleValue?.toString() ?? deal.amount?.toString());
    const paidAgg = await prisma.payment.aggregate({ where: { organizationId: h.organizationId, dealId, status: { in: ['VERIFIED', 'RECONCILED'] } }, _sum: { amount: true } });
    const paid = paidAgg._sum.amount ?? null;
    if (total && h.amountDue === null) data.amountDue = paid ? Prisma.Decimal.max(total.minus(paid), new Prisma.Decimal(0)) : total;
    if (h.amountPaid === null) data.amountPaid = paid ?? new Prisma.Decimal(0);
    if (h.paymentVerified === null && paid && paid.gt(0)) data.paymentVerified = true;
  }
  try {
    await prisma.handoverRecord.update({ where: { id: h.id }, data });
  } catch (e) {
    // the deal id was attached by the concurrent consumer first: nothing left to do
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
  }
}
