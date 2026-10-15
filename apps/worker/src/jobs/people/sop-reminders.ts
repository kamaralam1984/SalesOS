import type { PrismaClient } from '@prisma/client';
import { SOP_EVENTS } from '@salesos/shared-types';

/** A version must have been effective this many days before users are reminded again by the scheduled job. */
export const SOP_REMINDER_GRACE_DAYS = 3;

/**
 * Daily job body: for every mandatory, effective SOP version, queue one reminder per user that has not acknowledged it.
 * Idempotent per (version, user, day) through the outbox idempotency key. Returns the number of reminders queued.
 */
export async function queueSopReminders(prisma: PrismaClient, now = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const today = new Date(day);
  const graceCutoff = new Date(today.getTime() - SOP_REMINDER_GRACE_DAYS * 86_400_000);
  const versions = await prisma.sopVersion.findMany({
    where: { status: 'APPROVED', effectiveDate: { lte: graceCutoff }, document: { isMandatory: true, status: 'ACTIVE' } },
    include: { document: true },
  });
  let queued = 0;
  for (const v of versions) {
    const users = await prisma.user.findMany({
      where: {
        organizationId: v.organizationId, isActive: true,
        ...(v.document.audienceRoles.length ? { roleAssignments: { some: { role: { key: { in: v.document.audienceRoles } } } } } : {}),
        NOT: { id: { in: (await prisma.sopAcknowledgement.findMany({ where: { versionId: v.id }, select: { userId: true } })).map((a) => a.userId) } },
      },
      select: { id: true },
    });
    if (users.length === 0) continue;
    const res = await prisma.outboxEvent.createMany({
      data: users.map((u) => ({
        eventType: SOP_EVENTS.ACK_REMINDER, aggregateType: 'sop_version', aggregateId: v.id, organizationId: v.organizationId,
        payload: { organizationId: v.organizationId, versionId: v.id, documentId: v.documentId, documentTitle: v.document.title, userId: u.id },
        idempotencyKey: `sop-ack-reminder:daily:${v.id}:${u.id}:${day}`, availableAt: now,
      })),
      skipDuplicates: true,
    });
    queued += res.count;
  }
  return queued;
}
