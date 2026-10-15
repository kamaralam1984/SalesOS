import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6391'),
  BULLMQ_PREFIX: z.string().min(1).default('salesos'),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  OUTBOX_MAX_DISPATCH_ATTEMPTS: z.coerce.number().int().min(1).default(8),
  EVENT_JOB_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  EVENT_JOB_BACKOFF_MS: z.coerce.number().int().min(10).default(2000),
  /** BullMQ lock/stall check interval. Lower = faster recovery of jobs held by a killed worker (default BullMQ: 30 s). */
  WORKER_LOCK_DURATION_MS: z.coerce.number().int().min(1000).default(30_000),
  /** Heartbeat to Redis (read by the API /ready and /metrics). */
  WORKER_HEARTBEAT_MS: z.coerce.number().int().min(500).default(10_000),
  /** Optional tiny HTTP server (GET /health liveness, GET /ready readiness). 0/unset = disabled. */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(0),
  WORKER_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).default(25_000),
  SENTRY_DSN: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  SENTRY_ENVIRONMENT: z.string().optional(),
  RELEASE: z.string().optional(),
  EVENT_CONCURRENCY: z.coerce.number().int().min(1).default(5),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  // Same production refusals as the API (apps/api/src/config/env.ts): no development database credentials.
  try {
    const pw = decodeURIComponent(new URL(env.DATABASE_URL).password);
    if (!pw || ['salesos_dev_only', 'postgres', 'password', 'admin', 'root', '123456', 'salesos'].includes(pw.toLowerCase()) || /dev[-_]?only|change[-_]?me/i.test(pw)) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'The database password is empty or a known development default; use the application role (docs/security-review.md)' });
    }
  } catch { /* url validated above */ }
});
export type WorkerEnv = z.infer<typeof schema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const r = schema.safeParse(source);
  if (!r.success) {
    throw new Error(`Invalid worker environment:\n${r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return r.data;
}
