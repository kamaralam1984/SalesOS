import Redis from 'ioredis';

/**
 * Domain events after which cached KPI values may be stale. The API caches KPI results under a key that contains a per-organisation
 * version (`<prefix>:ver:<org>`); bumping the version makes every cached entry of the organisation unreachable (explicit invalidation).
 * The prefix MUST match the API (`ANALYTICS_CACHE_PREFIX`, default `salesos:kpi`).
 */
export const KPI_INVALIDATING_EVENTS: readonly string[] = [
  // CRM
  'lead.created', 'lead.assigned', 'lead.status_changed', 'lead.won', 'lead.lost', 'lead.merged', 'lead.exception_raised', 'reassignment.queued',
  'call.logged', 'task.created', 'task.completed', 'task.overdue', 'attendance.changed',
  // revenue
  'deal.created', 'deal.status_changed', 'deal.won', 'deal.closed', 'deal.cancelled', 'deal.reopened', 'sale.adjusted',
  'payment.expected', 'payment.recorded', 'payment.verified', 'payment.rejected', 'payment.reversed', 'payment.reconciled',
  'refund.requested', 'refund.reviewed', 'refund.approved', 'refund.rejected', 'refund.processed', 'refund.reconciled', 'refund.withdrawn', 'refund.cancelled',
  'target.revision_decided', 'forecast.snapshot_taken',
  // customer experience and Founder support
  'complaint.created', 'complaint.updated', 'complaint.acknowledged', 'complaint.escalated', 'complaint.resolved', 'complaint.closed', 'complaint.reopened',
  'action_item.created', 'action_item.completed', 'action_item.overdue', 'founder_report.published', 'handover.created', 'handover.completed',
  // people and process
  'sop.version_approved', 'sop.acknowledged', 'coaching.session_recorded', 'engagement.responded', 'incentive.approved', 'incentive.paid', 'review.approved', 'pip.activated', 'pip.completed',
  // identity (scope of every KPI depends on the active user set and the hierarchy)
  'user.deactivated', 'user.roles_changed',
];

let client: Redis | null = null;
const redis = (url: string): Redis => {
  client ??= new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
  client.on('error', () => undefined);
  return client;
};

export const cachePrefix = () => process.env.ANALYTICS_CACHE_PREFIX ?? 'salesos:kpi';

/** Bump the organisation's KPI cache version. Idempotent in effect: extra bumps only cost a recompute. */
export async function bumpOrgVersion(redisUrl: string, organizationId: string): Promise<number> {
  const r = redis(redisUrl);
  if (r.status === 'wait') await r.connect();
  return r.incr(`${cachePrefix()}:ver:${organizationId}`);
}

export async function closeAnalyticsRedis(): Promise<void> {
  if (client) {
    client.disconnect();
    client = null;
  }
}
