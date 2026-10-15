import type { PrismaClient } from '@prisma/client';
import type { JobRegistry } from '../registry';
import { PLATFORM_EVENTS } from '@salesos/shared-types';
import { dayDiff, hrPolicy, localDay, probationEnd, PROBATION_DECISION_BASE, reminderDueToday, type HrPolicy } from '@salesos/workforce-core';

export const WORKFORCE_PROBATION_QUEUE = 'workforce-probation';
const BATCH = 500;
const MAX_PER_RUN = 20_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface ProbationSweepResult { scanned: number; queued: number }

/**
 * Probation reminders (idempotent; stable keys per employee, probation end date and offset, so reruns and restarts never double-notify):
 *  - `hr.probationReminderDays` before the end date: ONE `probation.ending_soon` notification to HR and the line manager;
 *  - an extension moves the end date, which produces a new key, so the extended probation is reminded again;
 *  - employees already CONFIRMED (latest decision), exited, or deactivated are skipped.
 * Notifications are generic (no names, no narrative).
 */
export async function runProbationSweep(prisma: PrismaClient, now = new Date()): Promise<ProbationSweepResult> {
  const res: ProbationSweepResult = { scanned: 0, queued: 0 };
  const policies = new Map<string, HrPolicy>();
  const policyFor = async (orgId: string) => {
    let p = policies.get(orgId);
    if (!p) {
      const row = await prisma.workforceSetting.findUnique({ where: { organizationId: orgId } });
      p = hrPolicy(row?.config);
      policies.set(orgId, p);
    }
    return p;
  };
  let cursor: string | undefined;
  while (res.scanned < MAX_PER_RUN) {
    const profiles = await prisma.employeeProfile.findMany({
      where: { joinDate: { not: null }, exitDate: null, user: { isActive: true } },
      orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { user: { select: { managerId: true } } },
    });
    if (profiles.length === 0) break;
    cursor = profiles[profiles.length - 1]!.id;
    const latest = new Map<string, string | null>();
    const decisions = await prisma.probationReview.findMany({
      where: { employeeId: { in: profiles.map((p) => p.userId) }, checkpointDay: { gte: PROBATION_DECISION_BASE } },
      orderBy: { checkpointDay: 'asc' }, select: { employeeId: true, outcome: true },
    });
    for (const d of decisions) latest.set(d.employeeId, d.outcome);
    const confirmed = new Set([...latest].filter(([, o]) => o === 'CONFIRM').map(([id]) => id));
    const rows: Array<{ eventType: string; aggregateType: string; aggregateId: string; organizationId: string; payload: object; idempotencyKey: string; availableAt: Date }> = [];
    for (const p of profiles) {
      res.scanned++;
      if (confirmed.has(p.userId)) continue;
      const policy = await policyFor(p.organizationId);
      const today = localDay(now, policy.timezone);
      const end = probationEnd(iso(p.joinDate!), p.probationMonths ?? policy.probationDefaultMonths, p.probationEndDate ? iso(p.probationEndDate) : null);
      const left = dayDiff(today, end);
      if (!reminderDueToday(left, policy.probationReminderDays)) continue;
      const key = `probation.ending_soon:${p.userId}:${end}:${left}`;
      const userIds = p.user.managerId ? [p.user.managerId] : [];
      rows.push({
        eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'employee_profile', aggregateId: p.id, organizationId: p.organizationId, availableAt: now,
        idempotencyKey: `notification.requested:${key}`,
        payload: {
          organizationId: p.organizationId, type: 'probation.ending_soon', roles: ['HR'], ...(userIds.length ? { userIds } : {}),
          entity: { type: 'employee_profile', id: p.id }, dedupeKey: key, actionUrl: '/work/hr/probation',
          title: left === 0 ? 'A probation period ends today' : 'A probation period is ending soon',
        },
      });
    }
    if (rows.length > 0) {
      const r = await prisma.outboxEvent.createMany({ data: rows, skipDuplicates: true });
      res.queued += r.count;
    }
    if (profiles.length < BATCH) break;
  }
  return res;
}

export function registerProbation(registry: JobRegistry): void {
  registry.processor({
    queue: WORKFORCE_PROBATION_QUEUE,
    concurrency: 1,
    process: async (_job, ctx) => {
      const r = await runProbationSweep(ctx.prisma);
      if (r.queued > 0) ctx.log.info({ job: 'workforce-probation-sweep', ...r }, 'workforce sweep queued notifications');
      return r;
    },
  });
  registry.repeatable({ queue: WORKFORCE_PROBATION_QUEUE, name: 'workforce-probation-sweep', everyMs: 60 * 60_000 });
}
