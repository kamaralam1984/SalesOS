import { loadEncryptionKey, notify, processDueDeliveries, ProviderRegistry } from '@salesos/platform-core';
import { PLATFORM_EVENTS } from '@salesos/shared-types';
import { randomUUID } from 'node:crypto';
import type { JobRegistry } from '../registry';


/** Delivery worker: claims due QUEUED deliveries, hands them to provider adapters, retries with backoff, dead-letters. */
export function registerDeliveryJobs(registry: JobRegistry): void {
  const providers = new ProviderRegistry();
  registry.processor({
    queue: 'platform-deliveries',
    concurrency: 1,
    process: async (_job, ctx) => {
      const res = await processDueDeliveries(ctx.prisma, {
        registry: providers,
        key: loadEncryptionKey(),
        backoffBaseMs: Number(process.env.DELIVERY_BACKOFF_BASE_MS ?? 30_000),
        log: ctx.log,
        onDeadLetter: async (d) => {
          // visible + recoverable: tell the admins and publish an event; the delivery row stays DEAD_LETTER for admin retry
          await ctx.prisma.outboxEvent.createMany({
            data: [{ id: randomUUID(), eventType: PLATFORM_EVENTS.DELIVERY_DEAD_LETTERED, aggregateType: 'notification_delivery', aggregateId: d.id, organizationId: d.organizationId, payload: { deliveryId: d.id, channel: d.channel, errorCode: d.errorCode }, idempotencyKey: `delivery.dead:${d.id}` }],
            skipDuplicates: true,
          });
          await notify(ctx.prisma, {
            organizationId: d.organizationId, type: 'system.delivery_failed', roles: ['ADMIN', 'FOUNDER_CEO'], entity: { type: 'notification_delivery', id: d.id },
            dedupeKey: `delivery.dead:${d.id}`, title: `A ${d.channel.toLowerCase()} message could not be delivered`, body: `Error ${d.errorCode ?? 'unknown'}. Review it under Admin > Integrations.`, actionUrl: '/admin/integrations',
          });
        },
      });
      if (res.claimed > 0) ctx.log.info(res, 'deliveries processed');
      return res;
    },
  });
  registry.repeatable({ queue: 'platform-deliveries', name: 'tick', everyMs: Number(process.env.DELIVERY_TICK_MS ?? 5_000) });
}
