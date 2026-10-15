import type { DeliveryStatus } from '@prisma/client';

export type DeliverySource = 'WORKER' | 'PROVIDER_CALLBACK' | 'ADMIN' | 'SYSTEM';

/**
 * queued -> sent -> delivered | failed     (delivered/failed-after-sent ONLY from a verified provider callback)
 * queued -> failed -> queued (retry, backoff) | dead_letter -> queued (admin requeue)
 * "sent" means "accepted by the provider". Nothing is ever "delivered" without provider confirmation.
 */
const RULES: Array<{ from: DeliveryStatus | '*'; to: DeliveryStatus; sources: DeliverySource[] }> = [
  { from: 'QUEUED', to: 'SENT', sources: ['WORKER'] },
  { from: 'QUEUED', to: 'FAILED', sources: ['WORKER'] },
  { from: 'QUEUED', to: 'CANCELLED', sources: ['ADMIN'] },
  { from: 'FAILED', to: 'QUEUED', sources: ['WORKER', 'ADMIN'] },
  { from: 'FAILED', to: 'DEAD_LETTER', sources: ['WORKER'] },
  { from: 'DEAD_LETTER', to: 'QUEUED', sources: ['ADMIN'] },
  { from: 'SENT', to: 'DELIVERED', sources: ['PROVIDER_CALLBACK'] },
  { from: 'SENT', to: 'FAILED', sources: ['PROVIDER_CALLBACK'] },
];

export function canTransition(from: DeliveryStatus, to: DeliveryStatus, source: DeliverySource): boolean {
  return RULES.some((r) => (r.from === '*' || r.from === from) && r.to === to && r.sources.includes(source));
}
