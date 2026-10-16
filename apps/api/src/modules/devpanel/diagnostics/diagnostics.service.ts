import { Inject, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Principal } from '../../../common/authz';
import { AuditService } from '../../../common/audit/audit.service';
import { APP_ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { notFound } from '../../../common/http/errors';
import { OpsProbeService } from '../../../common/observability/ops-probe.service';
import { PrismaService } from '../../../common/prisma';
import { RedisService } from '../../../common/security/redis.module';
import { pageArgs, pageResult, type PageQuery } from '../../../common/pagination/pagination';
import {
  DB_DOWN_MS, DB_SLOW_MS, DIAG_AUDIT, HEALTH_SAMPLES, LAST_ERROR_MAX_CHARS, OUTBOX_DOWN_SECONDS, OUTBOX_SLOW_SECONDS, REDIS_DOWN_MS, REDIS_SLOW_MS, RETRY_ALL_MAX, SLOW_REQUEST_MS, ERROR_BUFFER_SIZE,
} from './diagnostics.constants';
import { ErrorBufferService } from './error-buffer.service';

export type Verdict = 'ok' | 'slow' | 'down' | 'unknown';

export const verdictFor = (ms: number | null, slow: number, down: number): Verdict => (ms === null || ms >= down ? 'down' : ms >= slow ? 'slow' : 'ok');

/** Removes things that could carry secrets/PII out of a stored error string, then truncates. */
export function sanitiseError(s: string | null): string | null {
  if (!s) return null;
  const clean = s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(bearer|token|secret|password|authorization|apikey|api_key)\b\s*[=:]?\s*\S+/gi, '$1=[redacted]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]*:[^\s/@]*@/gi, '[url-credentials]@')
    .replace(/\?[^\s"')]+/g, '?[query]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
  return clean.length > LAST_ERROR_MAX_CHARS ? `${clean.slice(0, LAST_ERROR_MAX_CHARS)}…` : clean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly probe: OpsProbeService,
    private readonly audit: AuditService,
    private readonly buf: ErrorBufferService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  private async sample(fn: () => Promise<unknown>): Promise<number | null> {
    const times: number[] = [];
    for (let i = 0; i < HEALTH_SAMPLES; i++) {
      const t0 = process.hrtime.bigint();
      try {
        await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000).unref())]);
      } catch {
        return null;
      }
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return Math.round(median(times) * 10) / 10;
  }

  async health() {
    const [dbMs, redisMs, worker, outbox] = await Promise.all([
      this.sample(() => this.prisma.$queryRaw`SELECT 1`),
      this.redis.ensureConnected().then(() => this.sample(() => this.redis.ping())).catch(() => null),
      this.probe.worker(),
      this.probe.outbox(),
    ]);
    const workerVerdict: Verdict = worker.status === 'ok' ? 'ok' : worker.status === 'stale' ? 'slow' : 'unknown';
    const outboxVerdict: Verdict = !outbox
      ? 'unknown'
      : outbox.oldestPendingSeconds >= OUTBOX_DOWN_SECONDS
        ? 'down'
        : outbox.oldestPendingSeconds >= OUTBOX_SLOW_SECONDS || outbox.dead > 0
          ? 'slow'
          : 'ok';
    return {
      checkedAt: new Date().toISOString(),
      thresholds: { dbSlowMs: DB_SLOW_MS, dbDownMs: DB_DOWN_MS, redisSlowMs: REDIS_SLOW_MS, redisDownMs: REDIS_DOWN_MS, outboxSlowSeconds: OUTBOX_SLOW_SECONDS, outboxDownSeconds: OUTBOX_DOWN_SECONDS },
      database: { latencyMs: dbMs, samples: HEALTH_SAMPLES, verdict: verdictFor(dbMs, DB_SLOW_MS, DB_DOWN_MS) },
      redis: { latencyMs: redisMs, samples: HEALTH_SAMPLES, verdict: verdictFor(redisMs, REDIS_SLOW_MS, REDIS_DOWN_MS) },
      worker: { ...worker, verdict: workerVerdict },
      outbox: { ...(outbox ?? { pending: null, dead: null, oldestPendingSeconds: null }), verdict: outboxVerdict },
    };
  }

  async listJobs(u: Principal, q: PageQuery) {
    const where = { organizationId: u.organizationId, status: 'DEAD' as const };
    const [rows, total] = await Promise.all([
      this.prisma.outboxEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) }),
      this.prisma.outboxEvent.count({ where }),
    ]);
    const res = pageResult(rows, q);
    const data = (res.data as typeof rows).map((r) => ({
      id: r.id,
      source: 'outbox' as const,
      eventType: r.eventType,
      aggregateType: r.aggregateType,
      attempts: r.attempts,
      lastError: sanitiseError(r.lastError),
      createdAt: r.createdAt.toISOString(),
      availableAt: r.availableAt.toISOString(),
    }));
    return { data, meta: { ...res.meta, total } };
  }

  async retry(u: Principal, id: string) {
    const r = await this.prisma.$transaction(async (tx) => {
      const res = await tx.outboxEvent.updateMany({
        where: { id, organizationId: u.organizationId, status: 'DEAD' },
        data: { status: 'PENDING', attempts: 0, availableAt: new Date(), lastError: null },
      });
      if (res.count) await this.audit.recordTx(tx, { organizationId: u.organizationId, actorId: u.userId, action: DIAG_AUDIT.JOB_RETRIED, entityType: 'outbox_event', entityId: id });
      return res;
    });
    if (!r.count) throw notFound('Dead job');
    return { id, requeued: true };
  }

  async retryAll(u: Principal) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.outboxEvent.findMany({ where: { organizationId: u.organizationId, status: 'DEAD' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: RETRY_ALL_MAX, select: { id: true } });
      const ids = rows.map((x) => x.id);
      const res = ids.length
        ? await tx.outboxEvent.updateMany({
            where: { id: { in: ids }, organizationId: u.organizationId, status: 'DEAD' },
            data: { status: 'PENDING', attempts: 0, availableAt: new Date(), lastError: null },
          })
        : { count: 0 };
      if (res.count) await this.audit.recordTx(tx, { organizationId: u.organizationId, actorId: u.userId, action: DIAG_AUDIT.JOBS_RETRIED_ALL, entityType: 'outbox_event', metadata: { requeued: res.count, cap: RETRY_ALL_MAX } });
      const remaining = await tx.outboxEvent.count({ where: { organizationId: u.organizationId, status: 'DEAD' } });
      return { requeued: res.count, remaining, cap: RETRY_ALL_MAX };
    });
  }

  /** Discard = take the event out of the DEAD queue without redelivering. The row is kept (DISPATCHED, no dispatchedAt, reason in lastError). */
  async discard(u: Principal, id: string, reason: string) {
    const r = await this.prisma.$transaction(async (tx) => {
      const res = await tx.outboxEvent.updateMany({
        where: { id, organizationId: u.organizationId, status: 'DEAD' },
        data: { status: 'DISPATCHED', lastError: `DISCARDED by developer: ${reason}`.slice(0, 500) },
      });
      if (res.count) await this.audit.recordTx(tx, { organizationId: u.organizationId, actorId: u.userId, action: DIAG_AUDIT.JOB_DISCARDED, entityType: 'outbox_event', entityId: id, metadata: { reason } });
      return res;
    });
    if (!r.count) throw notFound('Dead job');
    return { id, discarded: true };
  }

  errors(kind: 'all' | 'error' | 'slow', limit: number) {
    return {
      scope: 'process-memory' as const,
      note: 'Per-process ring buffer; resets on restart and does not include other API instances.',
      bufferSize: ERROR_BUFFER_SIZE,
      slowThresholdMs: SLOW_REQUEST_MS,
      capturingSince: this.buf.startedAt,
      held: this.buf.size(),
      items: this.buf.list(kind, limit),
    };
  }

  async migrations() {
    try {
      const exists = await this.prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('public._prisma_migrations')::text AS t`;
      if (!exists[0]?.t) return { available: false as const, reason: 'The _prisma_migrations table does not exist (database created with prisma db push, not migrate deploy).' };
      const rows = await this.prisma.$queryRaw<Array<{ migration_name: string; started_at: Date; finished_at: Date | null; rolled_back_at: Date | null; applied_steps_count: number }>>`
        SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at DESC, migration_name DESC LIMIT 100`;
      const total = await this.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM _prisma_migrations`;
      const items = rows.map((r) => ({
        name: r.migration_name,
        startedAt: r.started_at.toISOString(),
        finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
        rolledBackAt: r.rolled_back_at ? r.rolled_back_at.toISOString() : null,
        appliedSteps: Number(r.applied_steps_count),
        state: r.rolled_back_at ? ('rolled_back' as const) : r.finished_at ? ('applied' as const) : ('unfinished' as const),
      }));
      const problems = items.filter((i) => i.state !== 'applied').map((i) => i.name);
      return { available: true as const, count: Number(total[0]?.n ?? items.length), latest: items[0] ?? null, problems, items };
    } catch {
      return { available: false as const, reason: 'The migrations table could not be read.' };
    }
  }

  build() {
    let version = process.env.npm_package_version ?? 'unknown';
    try {
      const v = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version;
      if (v) version = v;
    } catch {
      /* keep fallback */
    }
    return {
      version,
      gitCommit: this.env.GIT_COMMIT ?? null,
      buildTime: this.env.BUILD_TIME ?? null,
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
      uptimeSeconds: Math.round(process.uptime()),
      platform: `${process.platform}/${process.arch}`,
    };
  }
}
