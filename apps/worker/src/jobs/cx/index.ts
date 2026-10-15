import { createHandoverFromTrigger, runAllCxSweeps } from '@salesos/cx-core';
import { HANDOVER_TRIGGER_EVENTS } from '@salesos/shared-types';
import type { JobRegistry } from '../registry';

export const CX_SWEEP_QUEUE = 'cx-sweeps';

/**
 * cx jobs (Agent H, Phase 7).
 *  - Handover creation from WON sales: subscribes to `lead.won` (CRM) and `deal.closed` / `deal.won` (revenue). Idempotent: keyed on the
 *    outbox event id, then on the deal / lead (see createHandoverFromTrigger).
 *  - `cx-sweeps` (every 5 minutes): complaint SLA breach + escalation chain + auto-close, handover pending-alert timer (SUBMITTED ->
 *    OVERDUE -> team lead), action item / cross-functional task overdue + escalation, Founder report shells + due/overdue reminders.
 *    Every sweep is a compare-and-set + deterministic outbox keys, so concurrent workers and restarts never double-notify.
 */
export function register(registry: JobRegistry): void {
  for (const type of HANDOVER_TRIGGER_EVENTS) {
    registry.onEvent(type, async (event, ctx) => {
      const r = await createHandoverFromTrigger(ctx.prisma, { id: event.id, eventType: event.eventType, organizationId: event.organizationId, payload: event.payload });
      ctx.log.info({ eventId: event.id, type: event.eventType, ...r }, 'handover trigger processed');
    });
  }

  registry.processor({
    queue: CX_SWEEP_QUEUE,
    concurrency: 1,
    process: async (_job, ctx) => {
      const results = await runAllCxSweeps(ctx.prisma);
      for (const r of results) if (r.changed > 0) ctx.log.info({ job: r.job, ...r.details }, 'cx sweep changed records');
      return results;
    },
  });
  registry.repeatable({ queue: CX_SWEEP_QUEUE, name: 'cx-sweeps', everyMs: 5 * 60_000 });
}
