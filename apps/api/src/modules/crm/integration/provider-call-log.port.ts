import type { CallOutcome } from '@prisma/client';
import { normalizePhone } from '@salesos/crm-core';
import type { CallEventPort, ProviderCallEventInput } from '@salesos/shared-types';
import type { PrismaService } from '../../../common/prisma';

const OUTCOME: Record<ProviderCallEventInput['status'], CallOutcome | null> = {
  RINGING: null, // not a result yet
  ANSWERED: 'CONNECTED',
  COMPLETED: 'CONNECTED',
  NO_ANSWER: 'NO_ANSWER',
  BUSY: 'BUSY',
  FAILED: 'FAILED',
};

/**
 * Decorates the storing port: after the verified provider event is stored, evidence of the call is written to
 * `call_logs` with source = PROVIDER. This is the ONLY writer of source = PROVIDER and it is reachable only through
 * the signature-verified webhook route (`ingest` is not exposed on any other route); the manual disposition endpoint
 * still forces MANUAL and rejects `source` in the body.
 *
 * It records evidence only. It does not run the disposition automation (tasks, status changes): those stay with the
 * rep's own disposition, so a provider event can never move a lead (e.g. to LOST). The row is matched to a lead by
 * the E.164 number inside the organisation; an unmatched or ambiguous number leaves only the provider event.
 */
export class ProviderCallLogPort implements CallEventPort {
  constructor(private readonly inner: CallEventPort, private readonly prisma: PrismaService) {}

  async ingest(e: ProviderCallEventInput): Promise<void> {
    await this.inner.ingest(e);
    const outcome = OUTCOME[e.status];
    if (!outcome) return;
    const number = e.direction === 'OUTBOUND' ? e.toNumber : e.fromNumber;
    const phone = normalizePhone(number);
    if (!phone.e164) return;
    const leads = await this.prisma.lead.findMany({ where: { organizationId: e.organizationId, phoneE164: phone.e164, mergedIntoId: null }, select: { id: true, assignedToId: true }, take: 5 });
    const agent = e.userId ? await this.prisma.user.findFirst({ where: { id: e.userId, organizationId: e.organizationId, isActive: true }, select: { id: true } }) : null;
    const lead = leads.length === 1 ? leads[0] : agent ? leads.find((l) => l.assignedToId === agent.id) : undefined;
    const userId = agent?.id ?? lead?.assignedToId;
    if (!lead || !userId) return;
    const key = `provider:${e.provider}:${e.providerCallId}`;
    const startedAt = e.startedAt ? new Date(e.startedAt) : new Date();
    await this.prisma.callLog.upsert({
      where: { organizationId_idempotencyKey: { organizationId: e.organizationId, idempotencyKey: key } },
      create: { organizationId: e.organizationId, leadId: lead.id, userId, source: 'PROVIDER', direction: e.direction, outcome, providerCallId: e.providerCallId, startedAt, durationSeconds: e.durationSec ?? null, idempotencyKey: key },
      // a later event (e.g. COMPLETED after ANSWERED) refines the same evidence row; the source never changes
      update: { outcome, durationSeconds: e.durationSec ?? undefined },
    });
  }
}
