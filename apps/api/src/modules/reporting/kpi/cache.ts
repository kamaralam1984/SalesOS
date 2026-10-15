import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '../../../common/security/redis.module';
import type { KpiComputed } from './types';

export interface CachedKpi {
  computed: KpiComputed;
  computedAt: string;
}

const PREFIX = () => process.env.ANALYTICS_CACHE_PREFIX ?? 'salesos:kpi';
/** global switch: KPI_CACHE_TTL_SECONDS=0 disables caching entirely (default 30 s upper bound per KPI) */
export const cacheCap = (): number => {
  const raw = process.env.KPI_CACHE_TTL_SECONDS;
  if (raw === undefined) return process.env.NODE_ENV === 'test' ? 0 : 30;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);

/**
 * Authorization-aware KPI cache. The key contains a fingerprint of the caller's RESOLVED scope (level, detail flag, sorted user ids,
 * team ids), never just the role name, so two viewers share an entry only when they are allowed to see exactly the same records.
 * Explicit invalidation = bumping the per-organisation version (worker domain-event handlers and `invalidateOrg`).
 */
@Injectable()
export class KpiCache {
  private readonly log = new Logger('KpiCache');
  constructor(@Optional() private readonly redis?: RedisService) {}

  scopeFingerprint(scope: { level: string; detail: boolean; userIds: string[] | null; teamIds: string[] }): string {
    return sha({ l: scope.level, d: scope.detail, u: scope.userIds === null ? null : [...scope.userIds].sort(), t: [...scope.teamIds].sort() });
  }

  private async ready(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      await this.redis.ensureConnected();
      return this.redis.status === 'ready';
    } catch {
      return false;
    }
  }

  private async version(orgId: string): Promise<string> {
    return (await this.redis!.get(`${PREFIX()}:ver:${orgId}`)) ?? '0';
  }

  async key(orgId: string, kpiId: string, scopeFp: string, params: unknown): Promise<string | null> {
    if (!(await this.ready())) return null;
    try {
      return `${PREFIX()}:v${await this.version(orgId)}:${orgId}:${kpiId}:${scopeFp}:${sha(params)}`;
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<CachedKpi | null> {
    try {
      const raw = await this.redis!.get(key);
      return raw ? (JSON.parse(raw) as CachedKpi) : null;
    } catch (e) {
      this.log.warn(`cache read failed: ${(e as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: CachedKpi, ttlSeconds: number): Promise<void> {
    try {
      await this.redis!.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttlSeconds)));
    } catch (e) {
      this.log.warn(`cache write failed: ${(e as Error).message}`);
    }
  }

  /** Explicit invalidation: every cached KPI of the organisation becomes unreachable (entries expire by TTL). */
  async invalidateOrg(orgId: string): Promise<void> {
    if (!(await this.ready())) return;
    try {
      await this.redis!.incr(`${PREFIX()}:ver:${orgId}`);
    } catch (e) {
      this.log.warn(`cache invalidation failed: ${(e as Error).message}`);
    }
  }
}
