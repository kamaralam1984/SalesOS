import type { PrismaClient } from '@prisma/client';
import { asElDb, runEarnedLeaveForUser, runEarnedLeaveYearEnd } from '@salesos/workforce-core';
import type { JobRegistry } from '../registry';

export const WORKFORCE_EARNED_LEAVE_QUEUE = 'workforce-earned-leave';
const BATCH = 200;
const MAX_USERS_PER_RUN = 50_000;

export interface EarnedLeaveSweepResult { users: number; credits: number; expired: number; failed: number }

/**
 * Daily Earned Leave sweep (idempotent; hourly + after restarts is safe). Runs the SAME transactional engine as the API
 * (`runEarnedLeaveForUser`): per-employee advisory lock, `processedThrough` watermark and the unique key `EL:<userId>:<n>` make a
 * duplicate credit impossible however often or concurrently it runs. Days without an attendance row are evaluated from the calendar,
 * approved leave and `attendance.autoMarkAbsent` exactly as the day-close job would have written them, so the two jobs need no ordering.
 * Year-end expiry (policy: carry-forward disabled) only acts in January and writes at most one EXPIRY row per employee and year.
 * One failing employee never stops the sweep.
 */
export async function runEarnedLeaveSweep(prisma: PrismaClient, now = new Date(), log?: { warn: (o: object, m: string) => void }): Promise<EarnedLeaveSweepResult> {
  const out: EarnedLeaveSweepResult = { users: 0, credits: 0, expired: 0, failed: 0 };
  const db = asElDb(prisma);
  let cursor: string | undefined;
  while (out.users < MAX_USERS_PER_RUN) {
    const users = await prisma.user.findMany({
      where: { isActive: true }, orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, organizationId: true },
    });
    if (users.length === 0) break;
    cursor = users[users.length - 1]!.id;
    for (const u of users) {
      out.users++;
      try {
        const r = await runEarnedLeaveForUser(db, { organizationId: u.organizationId, userId: u.id, now });
        out.credits += r.credits.length;
        out.expired += (await runEarnedLeaveYearEnd(db, { organizationId: u.organizationId, userId: u.id, now })).expired > 0 ? 1 : 0;
      } catch (e) {
        out.failed++;
        log?.warn({ userId: u.id, err: e instanceof Error ? e.message : String(e) }, 'earned leave run failed for one employee');
      }
    }
    if (users.length < BATCH) break;
  }
  return out;
}

export function registerEarnedLeave(registry: JobRegistry): void {
  registry.processor({
    queue: WORKFORCE_EARNED_LEAVE_QUEUE,
    concurrency: 1,
    process: async (_job, ctx) => {
      const r = await runEarnedLeaveSweep(ctx.prisma, new Date(), ctx.log);
      if (r.credits > 0 || r.failed > 0) ctx.log.info({ job: 'workforce-earned-leave', ...r }, 'workforce earned leave sweep finished');
      return r;
    },
  });
  registry.repeatable({ queue: WORKFORCE_EARNED_LEAVE_QUEUE, name: 'workforce-earned-leave', everyMs: 60 * 60_000 });
}
