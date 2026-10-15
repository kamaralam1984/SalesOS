import type { PrismaClient } from '@prisma/client';
import type { JobRegistry } from '../registry';
import { PLATFORM_EVENTS, WORKFORCE_EVENTS } from '@salesos/shared-types';
import { goalTaskPolicy, TASK_OPEN, type GoalTaskPolicy } from '@salesos/workforce-core';

export const WORKFORCE_TASKS_QUEUE = 'workforce-tasks';
const BATCH = 500;
const MAX_PER_RUN = 20_000;
const MAX_REMINDER_HOURS = 240;

export interface TaskSweepResult { scanned: number; queued: number }

/**
 * Work-task due / overdue sweep (idempotent; keys are stable per task and due instant, so restarts and concurrent workers never double-notify):
 *  - due within `tasks.reminderHoursBeforeDue`: one `work_task.update` ("due soon") to the assignee;
 *  - past due and still open: one `work_task.overdue` to the assignee (the assigner when the task waits in REVIEW) and to the assigner.
 * Changing the due date creates a new key, so a rescheduled task is reminded again for the new date. Notifications are generic.
 */
export async function runTaskSweep(prisma: PrismaClient, now = new Date()): Promise<TaskSweepResult> {
  const res: TaskSweepResult = { scanned: 0, queued: 0 };
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
  const horizon = new Date(now.getTime() + MAX_REMINDER_HOURS * 3_600_000);
  let cursor: string | undefined;
  while (res.scanned < MAX_PER_RUN) {
    const tasks = await prisma.workTask.findMany({
      where: { status: { in: [...TASK_OPEN] }, dueAt: { not: null, lte: horizon } },
      orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (tasks.length === 0) break;
    cursor = tasks[tasks.length - 1]!.id;
    const rows: Array<{ eventType: string; aggregateType: string; aggregateId: string; organizationId: string; payload: object; idempotencyKey: string; availableAt: Date }> = [];
    for (const t of tasks) {
      res.scanned++;
      const p = await policyFor(t.organizationId);
      const due = t.dueAt!;
      const base = { aggregateType: 'work_task', aggregateId: t.id, organizationId: t.organizationId, availableAt: now };
      const notif = (key: string, type: string, userIds: string[], title: string) =>
        rows.push({ ...base, eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, idempotencyKey: `notification.requested:${key}`, payload: { organizationId: t.organizationId, type, userIds, entity: { type: 'work_task', id: t.id }, dedupeKey: key, actionUrl: `/work/tasks/${t.id}`, title } });
      if (due.getTime() < now.getTime()) {
        const key = `work_task.overdue:${t.id}:${due.getTime()}`;
        const recipients = [...new Set([t.status === 'REVIEW' ? null : t.assigneeId, t.assignerId].filter((x): x is string => !!x))];
        rows.push({ ...base, eventType: WORKFORCE_EVENTS.WORK_TASK_OVERDUE, idempotencyKey: key, payload: { taskId: t.id, organizationId: t.organizationId, assigneeId: t.assigneeId, assignerId: t.assignerId } });
        notif(key, 'work_task.overdue', recipients, 'A task is overdue');
      } else if (p.reminderHoursBeforeDue > 0 && due.getTime() - now.getTime() <= p.reminderHoursBeforeDue * 3_600_000 && t.status !== 'REVIEW') {
        notif(`work_task.due:${t.id}:${due.getTime()}`, 'work_task.update', [t.assigneeId], 'A task is due soon');
      }
    }
    if (rows.length > 0) {
      const r = await prisma.outboxEvent.createMany({ data: rows, skipDuplicates: true });
      res.queued += r.count;
    }
    if (tasks.length < BATCH) break;
  }
  return res;
}

export function registerTasks(registry: JobRegistry): void {
  registry.processor({
    queue: WORKFORCE_TASKS_QUEUE,
    concurrency: 1,
    process: async (_job, ctx) => {
      const r = await runTaskSweep(ctx.prisma);
      if (r.queued > 0) ctx.log.info({ job: 'workforce-task-sweep', ...r }, 'workforce sweep queued notifications');
      return r;
    },
  });
  registry.repeatable({ queue: WORKFORCE_TASKS_QUEUE, name: 'workforce-task-sweep', everyMs: 15 * 60_000 });
}
