import type { JobRegistry } from '../registry';
import { bumpOrgVersion, KPI_INVALIDATING_EVENTS } from './invalidate';
import { runAnalyticsMaintenance } from './maintenance';

/**
 * analytics jobs (Phase 5).
 *  - every domain event that can change a KPI bumps the organisation's KPI cache version (explicit invalidation of authorization-aware keys);
 *  - `analytics-maintenance` (every 15 minutes) expires export files, re-queues crashed exports and prunes old rows.
 */
export function register(registry: JobRegistry): void {
  for (const type of KPI_INVALIDATING_EVENTS) {
    registry.onEvent(type, async (event, ctx) => {
      if (!event.organizationId) return;
      await bumpOrgVersion(ctx.env.REDIS_URL, event.organizationId);
    });
  }
  registry.processor({
    queue: 'analytics-maintenance',
    concurrency: 1,
    process: async (_job, ctx) => {
      const out = await runAnalyticsMaintenance(ctx.prisma);
      ctx.log.info(out, 'analytics maintenance done');
      return out;
    },
  });
  registry.repeatable({ queue: 'analytics-maintenance', name: 'maintenance', pattern: '*/15 * * * *' });
}
