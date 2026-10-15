import { randomUUID } from 'node:crypto';
import type { DeliveryStatus, IntegrationKind, NotificationChannel, Prisma, PrismaClient } from '@prisma/client';
import type { Db } from '../settings';
import { decryptSecret } from '../crypto';
import { buildIcs } from './ics';
import { ProviderError, type ProviderRegistry } from './providers';
import { canTransition, type DeliverySource } from './state-machine';

export interface EnqueueInput {
  organizationId: string;
  notificationId?: string | null;
  userId?: string | null;
  channel: NotificationChannel;
  kind: IntegrationKind;
  toAddress: string | null;
  subject?: string | null;
  body: string;
  idempotencyKey: string;
  notBefore?: Date;
  /** external recipient (lead/contact): requires an explicit OPTED_IN consent record */
  requireConsent?: boolean;
  calendar?: { startsAt: string; endsAt?: string; title?: string };
  maxAttempts?: number;
}

export type EnqueueOutcome = { id: string; status: DeliveryStatus; created: boolean };

async function recordEvent(db: Db, deliveryId: string, from: DeliveryStatus | null, to: DeliveryStatus, source: DeliverySource, detail: object = {}) {
  await db.notificationDeliveryEvent.create({ data: { deliveryId, fromStatus: from, toStatus: to, source, detail: detail as Prisma.InputJsonValue } });
}

/**
 * Queue an outbound message on an external channel. The row is created QUEUED, or SUPPRESSED with an error code when the
 * channel is not configured, the recipient has no address, or consent is missing / withdrawn. Visible in the delivery log.
 */
export async function enqueueDelivery(db: Db, input: EnqueueInput): Promise<EnqueueOutcome> {
  const existing = await db.notificationDelivery.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } } });
  if (existing) return { id: existing.id, status: existing.status, created: false };

  const cfg = await db.integrationConfig.findFirst({ where: { organizationId: input.organizationId, kind: input.kind, enabled: true }, orderBy: { createdAt: 'asc' } });
  let status: DeliveryStatus = 'QUEUED';
  let errorCode: string | null = null;
  let body = input.body;
  const address = input.toAddress?.trim().toLowerCase() || null;

  if (!cfg) { status = 'SUPPRESSED'; errorCode = 'CHANNEL_NOT_CONFIGURED'; }
  else if (!address) { status = 'SUPPRESSED'; errorCode = 'NO_ADDRESS'; }
  else {
    const consent = await db.consentRecord.findUnique({ where: { organizationId_channel_address: { organizationId: input.organizationId, channel: input.channel, address } } });
    if (consent?.status === 'OPTED_OUT') { status = 'SUPPRESSED'; errorCode = 'OPTED_OUT'; }
    else if (input.requireConsent && consent?.status !== 'OPTED_IN') { status = 'SUPPRESSED'; errorCode = 'NO_CONSENT'; }
  }
  if (status === 'QUEUED' && input.channel === 'CALENDAR') {
    const starts = input.calendar?.startsAt ? new Date(input.calendar.startsAt) : null;
    if (!starts || Number.isNaN(starts.getTime())) { status = 'SUPPRESSED'; errorCode = 'NO_CALENDAR_EVENT'; }
    else {
      body = buildIcs({ uid: input.idempotencyKey, title: input.calendar?.title ?? input.subject ?? 'Follow-up', description: input.body, startsAt: starts, endsAt: input.calendar?.endsAt ? new Date(input.calendar.endsAt) : undefined });
    }
  }
  const id = randomUUID();
  const res = await db.notificationDelivery.createMany({
    data: [{
      id, organizationId: input.organizationId, notificationId: input.notificationId ?? null, userId: input.userId ?? null, channel: input.channel,
      provider: cfg?.provider ?? 'none', toAddress: address ?? '', subject: input.subject ?? null, body, status, errorCode,
      idempotencyKey: input.idempotencyKey, nextAttemptAt: input.notBefore ?? new Date(), maxAttempts: input.maxAttempts ?? 5,
    }],
    skipDuplicates: true,
  });
  if (res.count === 0) {
    const again = await db.notificationDelivery.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } } });
    return { id: again!.id, status: again!.status, created: false };
  }
  await recordEvent(db, id, null, status, 'SYSTEM', errorCode ? { errorCode } : {});
  return { id, status, created: true };
}

export interface TransitionPatch {
  providerReference?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  nextAttemptAt?: Date;
  attempts?: number;
}

/**
 * The ONLY writer of delivery.status. Enforces the machine (queued -> sent -> delivered/failed) and refuses DELIVERED
 * unless the source is a verified PROVIDER_CALLBACK. Optimistic: returns false when the row is no longer in `from`.
 */
export async function transitionDelivery(
  db: Db, deliveryId: string, from: DeliveryStatus, to: DeliveryStatus, source: DeliverySource, patch: TransitionPatch = {}, detail: object = {},
): Promise<boolean> {
  if (!canTransition(from, to, source)) throw new Error(`Illegal delivery transition ${from} -> ${to} by ${source}`);
  const now = new Date();
  const res = await db.notificationDelivery.updateMany({
    where: { id: deliveryId, status: from },
    data: {
      status: to,
      ...(patch.providerReference !== undefined ? { providerReference: patch.providerReference } : {}),
      ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
      ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage?.slice(0, 500) ?? null } : {}),
      ...(patch.nextAttemptAt ? { nextAttemptAt: patch.nextAttemptAt } : {}),
      ...(patch.attempts !== undefined ? { attempts: patch.attempts, lastAttemptAt: now } : {}),
      ...(to === 'SENT' ? { sentAt: now } : {}),
      ...(to === 'DELIVERED' ? { deliveredAt: now } : {}),
    },
  });
  if (res.count === 0) return false;
  await recordEvent(db, deliveryId, from, to, source, detail);
  return true;
}

export function backoffMs(attempt: number, baseMs = 30_000, capMs = 3_600_000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export interface ProcessOptions {
  registry: ProviderRegistry;
  key: Buffer;
  now?: Date;
  limit?: number;
  leaseMs?: number;
  backoffBaseMs?: number;
  onDeadLetter?: (d: { id: string; organizationId: string; channel: NotificationChannel; errorCode: string | null }) => Promise<void>;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}
export interface ProcessResult { claimed: number; sent: number; retried: number; deadLettered: number }

/** Claim due QUEUED rows (SKIP LOCKED + lease so a crashed worker's rows come back) and hand them to the provider adapters. */
export async function processDueDeliveries(prisma: PrismaClient, opts: ProcessOptions): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const lease = new Date(now.getTime() + (opts.leaseMs ?? 5 * 60_000));
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE notification_deliveries SET next_attempt_at = ${lease}
    WHERE id IN (SELECT id FROM notification_deliveries WHERE status = 'QUEUED' AND next_attempt_at <= ${now}
                 ORDER BY next_attempt_at LIMIT ${opts.limit ?? 25} FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  const out: ProcessResult = { claimed: claimed.length, sent: 0, retried: 0, deadLettered: 0 };
  for (const { id } of claimed) {
    const d = await prisma.notificationDelivery.findUnique({ where: { id } });
    if (!d || d.status !== 'QUEUED') continue;
    const attempt = d.attempts + 1;
    try {
      const provider = opts.registry.get(d.provider);
      if (!provider) throw new ProviderError('PROVIDER_UNKNOWN', `unknown provider ${d.provider}`, false);
      const cfgRow = await prisma.integrationConfig.findUnique({ where: { organizationId_provider: { organizationId: d.organizationId, provider: d.provider } } });
      if (!cfgRow || !cfgRow.enabled) throw new ProviderError('CHANNEL_DISABLED', 'integration disabled', true);
      const secret = cfgRow.secretCipher ? decryptSecret(cfgRow.secretCipher, opts.key) : undefined;
      const r = await provider.send(
        { deliveryId: d.id, to: d.toAddress, subject: d.subject, body: d.body },
        { settings: (cfgRow.settings ?? {}) as Record<string, unknown>, secret, mode: cfgRow.mode },
      );
      await transitionDelivery(prisma, d.id, 'QUEUED', 'SENT', 'WORKER', { providerReference: r.providerReference, attempts: attempt, errorCode: null, errorMessage: null }, { attempt });
      out.sent++;
    } catch (err) {
      const perr = err instanceof ProviderError ? err : new ProviderError('SEND_ERROR', err instanceof Error ? err.message : 'unknown error', true);
      await transitionDelivery(prisma, d.id, 'QUEUED', 'FAILED', 'WORKER', { errorCode: perr.code, errorMessage: perr.message, attempts: attempt }, { attempt, retryable: perr.retryable });
      if (perr.retryable && attempt < d.maxAttempts) {
        const next = new Date(now.getTime() + backoffMs(attempt, opts.backoffBaseMs));
        await transitionDelivery(prisma, d.id, 'FAILED', 'QUEUED', 'WORKER', { nextAttemptAt: next }, { retryAt: next.toISOString() });
        out.retried++;
      } else {
        await transitionDelivery(prisma, d.id, 'FAILED', 'DEAD_LETTER', 'WORKER', {}, { reason: perr.retryable ? 'attempts exhausted' : 'non-retryable' });
        out.deadLettered++;
        opts.log?.warn({ deliveryId: d.id, code: perr.code }, 'delivery dead-lettered');
        await opts.onDeadLetter?.({ id: d.id, organizationId: d.organizationId, channel: d.channel, errorCode: perr.code });
      }
    }
  }
  return out;
}

/** Admin / recovery: put a FAILED or DEAD_LETTER delivery back on the queue with a fresh attempt budget. */
export async function requeueDelivery(db: Db, deliveryId: string, organizationId: string): Promise<boolean> {
  const d = await db.notificationDelivery.findFirst({ where: { id: deliveryId, organizationId } });
  if (!d || (d.status !== 'FAILED' && d.status !== 'DEAD_LETTER')) return false;
  return transitionDelivery(db, d.id, d.status, 'QUEUED', 'ADMIN', { nextAttemptAt: new Date(), attempts: 0, errorCode: null, errorMessage: null }, { requeued: true });
}

export interface ProviderCallback {
  organizationId: string;
  provider: string;
  providerReference: string;
  status: 'delivered' | 'failed' | 'bounced' | 'opted_out';
  errorCode?: string;
}

export type CallbackOutcome = 'APPLIED' | 'IGNORED_UNKNOWN_REFERENCE' | 'IGNORED_STATE';

/** Apply a VERIFIED provider status callback. The signature check happens in the webhook layer before this is called. */
export async function applyProviderCallback(db: Db, cb: ProviderCallback): Promise<CallbackOutcome> {
  const d = await db.notificationDelivery.findFirst({ where: { organizationId: cb.organizationId, provider: cb.provider, providerReference: cb.providerReference } });
  if (!d) return 'IGNORED_UNKNOWN_REFERENCE';
  if (cb.status === 'opted_out' && d.toAddress) {
    await db.consentRecord.upsert({
      where: { organizationId_channel_address: { organizationId: d.organizationId, channel: d.channel, address: d.toAddress } },
      create: { organizationId: d.organizationId, channel: d.channel, address: d.toAddress, status: 'OPTED_OUT', source: 'provider_callback' },
      update: { status: 'OPTED_OUT', source: 'provider_callback', recordedAt: new Date() },
    });
  }
  if (d.status !== 'SENT') return 'IGNORED_STATE'; // e.g. callback for a QUEUED row: never skip the SENT step
  const to: DeliveryStatus = cb.status === 'delivered' ? 'DELIVERED' : 'FAILED';
  const ok = await transitionDelivery(db, d.id, 'SENT', to, 'PROVIDER_CALLBACK', to === 'FAILED' ? { errorCode: cb.errorCode ?? cb.status.toUpperCase() } : { errorCode: null }, { providerStatus: cb.status });
  return ok ? 'APPLIED' : 'IGNORED_STATE';
}
