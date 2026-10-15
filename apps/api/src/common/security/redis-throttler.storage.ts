import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';

const LUA = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {hits, ttl}
`;

/**
 * Redis-backed fixed-window counter so limits hold across API replicas. If Redis is unreachable the limiter DEGRADES to per-process
 * in-memory counters (still enforcing the limit for this replica) instead of failing open; auth lockout is DB-backed regardless.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly local = new Map<string, { hits: number; expiresAt: number }>();
  /** true while the last Redis call failed (exposed for tests / health) */
  degraded = false;

  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'salesos:throttle:',
  ) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number): Promise<ThrottlerStorageRecord> {
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const [hits, pttl] = (await this.redis.eval(LUA, 1, this.prefix + key, ttl)) as [number, number];
      this.degraded = false;
      const timeToExpire = Math.max(0, Math.ceil(pttl / 1000));
      const isBlocked = hits > limit;
      return {
        totalHits: hits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire: isBlocked ? Math.max(timeToExpire, Math.ceil(blockDuration / 1000)) : 0,
      };
    } catch {
      this.degraded = true;
      const now = Date.now();
      if (this.local.size > 10_000) for (const [k, v] of this.local) if (v.expiresAt <= now) this.local.delete(k);
      const cur = this.local.get(key);
      const rec = cur && cur.expiresAt > now ? cur : { hits: 0, expiresAt: now + ttl };
      rec.hits += 1;
      this.local.set(key, rec);
      const timeToExpire = Math.max(0, Math.ceil((rec.expiresAt - now) / 1000));
      const isBlocked = rec.hits > limit;
      return { totalHits: rec.hits, timeToExpire, isBlocked, timeToBlockExpire: isBlocked ? Math.max(timeToExpire, Math.ceil(blockDuration / 1000)) : 0 };
    }
  }
}
