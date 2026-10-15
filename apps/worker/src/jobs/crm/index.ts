import type { Job } from 'bullmq';
import { IDENTITY_EVENTS, CRM_EVENTS } from '@salesos/shared-types';
import { directDeps, processImportJob } from '@salesos/crm-core';
import type { JobContext, JobRegistry } from '../registry';
import { makeHandlers } from './handlers';
import { retryDeliveries } from './notifications';
import { scanAgeing, scanDueReminders, scanOverdue, scanReactivation, scanUnattended } from './scans';

export const CRM_SCAN_QUEUE = 'crm-scans';

/** Scheduled scans: every one is DB-driven and idempotent, so a worker restart loses nothing and duplicates nothing. */
export const SCAN_JOBS = [
  { name: 'due-reminders', everyMs: 30_000 },
  { name: 'overdue-escalation', everyMs: 60_000 },
  { name: 'delivery-retry', everyMs: 60_000 },
  { name: 'import-sweep', everyMs: 60_000 },
  { name: 'unattended-scan', everyMs: 5 * 60_000 },
  { name: 'reactivation-scan', everyMs: 60 * 60_000 },
  { name: 'ageing-scan', everyMs: 60 * 60_000 },
] as const;

export async function runScan(name: string, ctx: Pick<JobContext, 'prisma' | 'log'>, workerId: string) {
  const c = { prisma: ctx.prisma, log: ctx.log, workerId };
  switch (name) {
    case 'due-reminders':
      return scanDueReminders(c);
    case 'overdue-escalation':
      return scanOverdue(c);
    case 'unattended-scan':
      return scanUnattended(c);
    case 'ageing-scan':
      return scanAgeing(c);
    case 'reactivation-scan':
      return scanReactivation(c);
    case 'delivery-retry':
      return { retried: await retryDeliveries(ctx.prisma) };
    case 'import-sweep': {
      const jobs = await ctx.prisma.importJob.findMany({ where: { OR: [{ status: 'QUEUED' }, { status: 'RUNNING', lockedUntil: { lt: new Date() } }] }, select: { id: true }, take: 5, orderBy: { createdAt: 'asc' } });
      const out = [];
      for (const j of jobs) out.push(await processImportJob(ctx.prisma, directDeps(), j.id, { workerId }));
      return { processed: out.length };
    }
    default:
      throw new Error(`Unknown crm scan ${name}`);
  }
}

/**
 * CRM jobs (Agent D): event handlers (user.deactivated -> reassignment queue, task/lead notifications through the
 * NotificationPort, import requests) + repeatable DB-driven scans (reminders, overdue escalation, unattended, ageing,
 * reactivation, delivery retry, import sweep).
 */
export function register(registry: JobRegistry): void {
  registry.onEvent(IDENTITY_EVENTS.USER_DEACTIVATED, async (event, ctx) => {
    await makeHandlers(ctx.prisma)[IDENTITY_EVENTS.USER_DEACTIVATED](event);
  });
  for (const type of [CRM_EVENTS.TASK_DUE, CRM_EVENTS.TASK_REMINDER, CRM_EVENTS.TASK_OVERDUE, CRM_EVENTS.TASK_ESCALATED, CRM_EVENTS.LEAD_UNATTENDED, CRM_EVENTS.LEAD_ASSIGNED, CRM_EVENTS.LEAD_EXCEPTION_RAISED, CRM_EVENTS.IMPORT_REQUESTED] as const) {
    registry.onEvent(type, async (event, ctx) => {
      await makeHandlers(ctx.prisma)[type](event);
    });
  }
  registry.processor({
    queue: CRM_SCAN_QUEUE,
    concurrency: 1,
    process: async (job: Job, ctx) => {
      const res = await runScan(job.name, ctx, `scan-${process.pid}`);
      ctx.log.debug({ job: job.name, ...(res as object) }, 'crm scan finished');
      return res;
    },
  });
  for (const s of SCAN_JOBS) registry.repeatable({ queue: CRM_SCAN_QUEUE, name: s.name, everyMs: s.everyMs });
}
