import type { PrismaClient } from '@prisma/client';
import { PEOPLE_EVENTS } from '@salesos/shared-types';

/** Queue a `probation.review_due` event for scheduled probation reviews due within `daysAhead` days (or overdue). */
export async function queueProbationDue(prisma: PrismaClient, now = new Date(), daysAhead = 3): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const horizon = new Date(new Date(day).getTime() + daysAhead * 86_400_000);
  const due = await prisma.probationReview.findMany({ where: { status: 'SCHEDULED', dueDate: { lte: horizon } } });
  if (due.length === 0) return 0;
  const res = await prisma.outboxEvent.createMany({
    data: due.map((r) => ({
      eventType: PEOPLE_EVENTS.PROBATION_DUE, aggregateType: 'probation_review', aggregateId: r.id, organizationId: r.organizationId,
      payload: { organizationId: r.organizationId, probationReviewId: r.id, employeeId: r.employeeId, checkpointDay: r.checkpointDay, dueDate: r.dueDate.toISOString().slice(0, 10) },
      idempotencyKey: `probation-due:${r.id}:${day}`, availableAt: now,
    })),
    skipDuplicates: true,
  });
  return res.count;
}
