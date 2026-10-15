import { REFUND_PROCESSED_EVENT } from '@salesos/shared-types';
import type { JobRegistry } from '../registry';
import { handleRefundProcessed } from './clawback';
import { queueProbationDue } from './probation-due';
import { queueSopReminders } from './sop-reminders';

/**
 * people jobs (Phase 6).
 * - refund.processed (published by the revenue phase): PROPOSE an incentive clawback adjustment. Never auto-applied.
 * - daily SOP acknowledgement reminders and probation-due reminders via the outbox.
 */
export function register(registry: JobRegistry): void {
  registry.onEvent(REFUND_PROCESSED_EVENT, async (event, ctx) => {
    const res = await handleRefundProcessed(event, ctx.prisma);
    ctx.log.info({ eventId: event.id, proposed: res.proposed }, 'incentive clawback evaluation');
  });

  registry.processor({
    queue: 'people-reminders',
    process: async (job, ctx) => {
      const sop = job.name === 'sop-ack-reminders' ? await queueSopReminders(ctx.prisma) : 0;
      const probation = job.name === 'probation-due' ? await queueProbationDue(ctx.prisma) : 0;
      ctx.log.info({ job: job.name, sop, probation }, 'people reminders queued');
      return { sop, probation };
    },
  });
  registry.repeatable({ queue: 'people-reminders', name: 'sop-ack-reminders', pattern: '0 4 * * *' });
  registry.repeatable({ queue: 'people-reminders', name: 'probation-due', pattern: '30 4 * * *' });
}
