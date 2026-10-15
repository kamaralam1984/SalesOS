import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma';
import { RedisService } from '../security/redis.module';

export type WorkerStatus = { status: 'ok' | 'stale' | 'unknown'; instances: number; lastHeartbeatAgeSeconds: number | null };

export const heartbeatKeyPrefix = (bullPrefix: string) => `${bullPrefix}:worker:heartbeat:`;
/** A worker heartbeat older than this is "stale" (the worker writes every 10 s with a 30 s TTL). */
export const HEARTBEAT_STALE_SECONDS = 25;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms).unref())]);

@Injectable()
export class OpsProbeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async database(): Promise<boolean> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, 3000);
      return true;
    } catch {
      return false;
    }
  }

  async redisUp(): Promise<boolean> {
    try {
      await this.redis.ensureConnected();
      return (await withTimeout(this.redis.ping(), 2000)) === 'PONG';
    } catch {
      return false;
    }
  }

  /** Reads worker heartbeats written by apps/worker (Redis keys with TTL). Never throws. */
  async worker(): Promise<WorkerStatus> {
    try {
      await this.redis.ensureConnected();
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await withTimeout(this.redis.scan(cursor, 'MATCH', `${heartbeatKeyPrefix(this.env.BULLMQ_PREFIX)}*`, 'COUNT', 100), 2000);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0' && keys.length < 50);
      if (keys.length === 0) return { status: 'unknown', instances: 0, lastHeartbeatAgeSeconds: null };
      const values = await withTimeout(this.redis.mget(...keys), 2000);
      const ages = values
        .map((v) => (v ? Number((JSON.parse(v) as { at?: number }).at) : NaN))
        .filter((n) => Number.isFinite(n))
        .map((at) => Math.max(0, (Date.now() - at) / 1000));
      if (ages.length === 0) return { status: 'unknown', instances: 0, lastHeartbeatAgeSeconds: null };
      const youngest = Math.min(...ages);
      return { status: youngest <= HEARTBEAT_STALE_SECONDS ? 'ok' : 'stale', instances: ages.length, lastHeartbeatAgeSeconds: Math.round(youngest * 10) / 10 };
    } catch {
      return { status: 'unknown', instances: 0, lastHeartbeatAgeSeconds: null };
    }
  }

  /** Outbox backlog: pending / dead counts and the age of the oldest due PENDING event. */
  async outbox(): Promise<{ pending: number; dead: number; oldestPendingSeconds: number } | null> {
    try {
      const rows = await withTimeout(
        this.prisma.$queryRaw<Array<{ pending: bigint; dead: bigint; oldest: number | null }>>`
          SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending,
                 count(*) FILTER (WHERE status = 'DEAD') AS dead,
                 EXTRACT(EPOCH FROM (now() - min(available_at) FILTER (WHERE status = 'PENDING' AND available_at <= now()))) AS oldest
          FROM outbox_events WHERE status IN ('PENDING','DEAD')`,
        3000,
      );
      const r = rows[0]!;
      return { pending: Number(r.pending), dead: Number(r.dead), oldestPendingSeconds: r.oldest == null ? 0 : Math.max(0, Number(r.oldest)) };
    } catch {
      return null;
    }
  }
}
