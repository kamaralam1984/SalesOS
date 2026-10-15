import { Throttle } from '@nestjs/throttler';

/**
 * Tighter per-route limits for expensive or abuse-prone operations, on top of the global limit (THROTTLE_LIMIT) and the auth
 * limits. Counters live in the same store as the global limiter (Redis in production, so they hold across replicas and restarts).
 * Values are read per request so operations can tune them (and tests can lower them) through the environment:
 *   THROTTLE_<KIND>_LIMIT  requests per window per client IP   |   THROTTLE_HEAVY_TTL_MS  window (default 60 000)
 */
export const HEAVY_DEFAULTS = { UPLOAD: 60, IMPORT: 10, EXPORT: 20, AI: 30, REPORT: 20, DOWNLOAD: 120, ADMIN_ACTION: 30 } as const;
export type HeavyKind = keyof typeof HEAVY_DEFAULTS;

export const heavyLimit = (kind: HeavyKind): number => {
  const v = Number(process.env[`THROTTLE_${kind}_LIMIT`]);
  return Number.isFinite(v) && v > 0 ? v : HEAVY_DEFAULTS[kind];
};

export const Limited = (kind: HeavyKind) =>
  Throttle({ default: { limit: () => heavyLimit(kind), ttl: () => Number(process.env.THROTTLE_HEAVY_TTL_MS) || 60_000 } });
