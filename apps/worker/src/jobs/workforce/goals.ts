import type { PrismaClient } from '@prisma/client';
import type { JobRegistry } from '../registry';
import { PLATFORM_EVENTS, WORKFORCE_EVENTS } from '@salesos/shared-types';
import { computeGoalRisk, daysToTarget, goalProgressPct, goalTaskPolicy, localDay, type GoalTaskPolicy } from '@salesos/workforce-core';

export const WORKFORCE_GOALS_QUEUE = 'workforce-goals';
const BATCH = 500;
const MAX_GOALS_PER_RUN = 20_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface GoalSweepResult { scanned: number; recomputed: number; queued: number }

/**
 * Daily goal sweep (idempotent; safe to run hourly and after a restart):
 *  - recompute `risk` of every ACTIVE goal from progress, elapsed share of the cycle and `goals.atRiskGapPct` (no version bump: it is derived data);
 *  - AT_RISK / OVERDUE goals raise ONE `goal.at_risk` event + notification per goal per business day (outbox idempotency key + notification dedupe key);
 *  - target-date reminders at `goals.reminderDaysBeforeTarget` days before the target date (once per goal and offset).
 * Notifications are generic (no goal text).
 */
export async function runGoalSweep(prisma: PrismaClient, now = new Date()): Promise<GoalSweepResult> {
  const res: GoalSweepResult = { scanned: 0, recomputed: 0, queued: 0 };
  const policies = new Map<string, GoalTaskPolicy>();
  const policyFor = async (orgId: string) => {
    let p = policies.get(orgId);
    if (!p) {
      const row = await prisma.workforceSetting.findUnique({ where: { organizationId: orgId } });
      p = goalTaskPolicy(row?.config);
      policies.set(orgId, p);
    }
    return p;
  };
  let cursor: string | undefined;
  while (res.scanned < MAX_GOALS_PER_RUN) {
    const goals = await prisma.goal.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (goals.length === 0) break;
    cursor = goals[goals.length - 1]!.id;
    const outbox: Array<{ eventType: string; aggregateType: string; aggregateId: string; organizationId: string; payload: object; idempotencyKey: string; availableAt: Date }> = [];
    for (const g of goals) {
      res.scanned++;
      const p = await policyFor(g.organizationId);
      const today = localDay(now, p.timezone);
      const start = iso(g.startDate);
      const target = iso(g.targetDate);
      const pct = goalProgressPct({ currentValue: g.currentValue.toString(), targetValue: g.targetValue?.toString() ?? null, manualPct: g.progressPct });
      const risk = computeGoalRisk({ status: 'ACTIVE', progressPct: pct, startDay: start, targetDay: target, today, atRiskGapPct: p.atRiskGapPct });
      if (risk !== g.risk) {
        const u = await prisma.goal.updateMany({ where: { id: g.id, status: 'ACTIVE', risk: { not: risk } }, data: { risk } });
        res.recomputed += u.count;
      }
      const recipients = [...new Set([g.ownerId, g.reviewerId].filter((x): x is string => !!x))];
      const base = { aggregateType: 'goal', aggregateId: g.id, organizationId: g.organizationId, availableAt: now };
      if (risk === 'AT_RISK' || risk === 'OVERDUE') {
        const key = `goal.at_risk:${g.id}:${today}`;
        outbox.push({ ...base, eventType: WORKFORCE_EVENTS.GOAL_AT_RISK, payload: { goalId: g.id, organizationId: g.organizationId, ownerId: g.ownerId, risk, day: today }, idempotencyKey: key });
        outbox.push({
          ...base, eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, idempotencyKey: `notification.requested:${key}`,
          payload: { organizationId: g.organizationId, type: 'goal.at_risk', userIds: recipients, entity: { type: 'goal', id: g.id }, dedupeKey: key, actionUrl: `/work/goals/${g.id}`, title: risk === 'OVERDUE' ? 'A goal is overdue' : 'A goal is at risk' },
        });
      }
      const left = daysToTarget(target, today);
      if (left >= 0 && pct < 100 && p.reminderDaysBeforeTarget.includes(left)) {
        const key = `goal.reminder:${g.id}:${target}:${left}`;
        outbox.push({
          ...base, eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, idempotencyKey: `notification.requested:${key}`,
          payload: { organizationId: g.organizationId, type: 'goal.update', userIds: [g.ownerId], entity: { type: 'goal', id: g.id }, dedupeKey: key, actionUrl: `/work/goals/${g.id}`, title: left === 0 ? 'A goal is due today' : 'A goal target date is approaching' },
        });
      }
    }
    if (outbox.length > 0) {
      const created = await prisma.outboxEvent.createMany({ data: outbox.map((o) => ({ ...o, payload: o.payload as object })), skipDuplicates: true });
      res.queued += created.count;
    }
    if (goals.length < BATCH) break;
  }
  return res;
}

export function registerGoals(registry: JobRegistry): void {
  registry.processor({
    queue: WORKFORCE_GOALS_QUEUE,
    concurrency: 1,
    process: async (_job, ctx) => {
      const r = await runGoalSweep(ctx.prisma);
      if (r.queued > 0) ctx.log.info({ job: 'workforce-goal-sweep', ...r }, 'workforce sweep queued notifications');
      return r;
    },
  });
  registry.repeatable({ queue: WORKFORCE_GOALS_QUEUE, name: 'workforce-goal-sweep', everyMs: 60 * 60_000 });
}
