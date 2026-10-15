import type { JobRegistry } from '../registry';
import { queueForecastSnapshotReminders, queueOverdueInstallments, queueTargetRisk, queueVerificationBacklog } from './scans';

/**
 * revenue jobs (Phase 4). Scan-only: they raise de-duplicated notifications through the outbox and never change money.
 * - 09:00 IST daily  : overdue expected installments -> deal owner
 * - 09:15 IST daily  : payments waiting >24h for verification -> Finance
 * - 06:30 IST daily  : Mondays / 1st of month: remind to take the period-start forecast snapshot
 * - 10:00 IST daily  : revenue targets behind the straight-line pace -> owner + manager (once per ISO week)
 * Refund events (`refund.approved`, `refund.processed`) are consumed by the people module (incentive clawback proposals).
 */
export function register(registry: JobRegistry): void {
  registry.processor({
    queue: 'revenue-scans',
    process: async (job, ctx) => {
      const out: Record<string, number> = {};
      if (job.name === 'overdue-installments') out.overdue = await queueOverdueInstallments(ctx.prisma);
      if (job.name === 'verification-backlog') out.backlog = await queueVerificationBacklog(ctx.prisma);
      if (job.name === 'target-risk') out.atRisk = await queueTargetRisk(ctx.prisma);
      if (job.name === 'forecast-snapshot-reminder') out.reminders = await queueForecastSnapshotReminders(ctx.prisma);
      ctx.log.info({ job: job.name, ...out }, 'revenue scan complete');
      return out;
    },
  });
  registry.repeatable({ queue: 'revenue-scans', name: 'overdue-installments', pattern: '30 3 * * *' });
  registry.repeatable({ queue: 'revenue-scans', name: 'verification-backlog', pattern: '45 3 * * *' });
  registry.repeatable({ queue: 'revenue-scans', name: 'forecast-snapshot-reminder', pattern: '0 1 * * *' });
  registry.repeatable({ queue: 'revenue-scans', name: 'target-risk', pattern: '30 4 * * *' });
}
