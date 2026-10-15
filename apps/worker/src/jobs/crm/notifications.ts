import { Prisma, type PrismaClient } from '@prisma/client';
import type { CrmNotification, NotificationPort, NotificationResult } from '@salesos/shared-types';
import { createCrmNotificationPort } from '@salesos/platform-core';

/**
 * KI-F-04: the platform notifier is the ONLY in-app inbox. The CRM routes every notification through
 * `createCrmNotificationPort(prisma)` (dedupe, preferences, quiet hours, channels). `crm_notification_deliveries`
 * stays as the CRM's idempotency + retry ledger (status mirrors the platform result), not as a second inbox.
 * Tests / alternative channels can replace the port with setNotificationPort().
 */
let override: NotificationPort | null = null;
export const setNotificationPort = (p: NotificationPort | null) => {
  override = p;
};
export const getNotificationPort = (prisma: PrismaClient): NotificationPort => override ?? createCrmNotificationPort(prisma);

export const MAX_DELIVERY_ATTEMPTS = 5;
const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** attempts, 3_600_000);

/**
 * Idempotent enqueue + delivery. The unique (organization_id, idempotency_key) row is the claim: only the process
 * that inserts it attempts the delivery, so a retried event or two workers can never double-notify.
 */
export async function enqueueNotification(prisma: PrismaClient, n: CrmNotification, p: NotificationPort = getNotificationPort(prisma)): Promise<{ id: string | null; created: boolean; status: string }> {
  const ins = await prisma.crmNotificationDelivery.createMany({
    data: [{ organizationId: n.organizationId, recipientId: n.recipientId, kind: n.kind, channel: n.channel, title: n.title, body: n.body ?? null, severity: n.severity ?? 'info', entityType: n.entityType ?? null, entityId: n.entityId ?? null, data: (n.data ?? {}) as Prisma.InputJsonValue, idempotencyKey: n.idempotencyKey, status: 'QUEUED' }],
    skipDuplicates: true,
  });
  const row = await prisma.crmNotificationDelivery.findFirstOrThrow({ where: { organizationId: n.organizationId, idempotencyKey: n.idempotencyKey } });
  if (ins.count === 0) return { id: row.id, created: false, status: row.status };
  await attemptDelivery(prisma, row.id, p);
  const after = await prisma.crmNotificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
  return { id: row.id, created: true, status: after.status };
}

async function attemptDelivery(prisma: PrismaClient, id: string, p: NotificationPort): Promise<void> {
  // compare-and-set claim of the attempt: only one worker proceeds for a given attempts value
  const row = await prisma.crmNotificationDelivery.findUniqueOrThrow({ where: { id } });
  const claimed = await prisma.crmNotificationDelivery.updateMany({ where: { id, attempts: row.attempts, status: { in: ['QUEUED', 'FAILED'] } }, data: { attempts: { increment: 1 } } });
  if (claimed.count === 0) return;
  let result: NotificationResult;
  try {
    result = await p.send({ organizationId: row.organizationId, recipientId: row.recipientId, kind: row.kind, channel: row.channel, title: row.title, body: row.body ?? undefined, severity: row.severity as 'info', entityType: row.entityType ?? undefined, entityId: row.entityId ?? undefined, data: row.data as Record<string, unknown>, idempotencyKey: row.idempotencyKey });
  } catch (e) {
    result = { status: 'FAILED', errorCode: (e as Error).message.slice(0, 100) };
  }
  const attempts = row.attempts + 1;
  await prisma.crmNotificationDelivery.update({
    where: { id },
    data:
      result.status === 'FAILED'
        ? { status: 'FAILED', providerErrorCode: result.errorCode ?? 'UNKNOWN', nextAttemptAt: attempts < MAX_DELIVERY_ATTEMPTS ? new Date(Date.now() + backoffMs(attempts)) : null }
        : { status: result.status, providerReference: result.providerReference ?? null, providerErrorCode: null, sentAt: new Date(), deliveredAt: result.status === 'DELIVERED' ? new Date() : null, nextAttemptAt: null },
  });
}

/** Retry sweep: re-attempt FAILED (backoff elapsed) and orphaned QUEUED rows (worker died between insert and send). */
export async function retryDeliveries(prisma: PrismaClient, now = new Date(), p: NotificationPort = getNotificationPort(prisma)): Promise<number> {
  const rows = await prisma.crmNotificationDelivery.findMany({
    where: { attempts: { lt: MAX_DELIVERY_ATTEMPTS }, OR: [{ status: 'FAILED', nextAttemptAt: { lte: now } }, { status: 'QUEUED', createdAt: { lt: new Date(now.getTime() - 60_000) } }] },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  for (const r of rows) await attemptDelivery(prisma, r.id, p);
  return rows.length;
}
