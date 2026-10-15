import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { loadWorkerEnv } from './config';
import { createLogger } from './logger';
import { createRedis } from './redis';
import { QUEUES, makeQueue } from './queues';
import { startDispatcher } from './outbox/dispatcher';
import { startEventConsumer } from './outbox/event-consumer';
import { startHeartbeat, startHealthServer } from './health';
import { createErrorReporter, setErrorReporter, errorReporter } from './error-reporter';
import { buildRegistry, type JobContext } from './jobs/registry';

async function main() {
  const env = loadWorkerEnv();
  const log = createLogger(env.LOG_LEVEL);
  setErrorReporter(createErrorReporter({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV, release: env.RELEASE, service: 'salesos-worker' }));
  const redis = createRedis(env.REDIS_URL);
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  await prisma.$connect();

  const queues = new Map<string, Queue>();
  const queue = (name: string) => {
    let q = queues.get(name);
    if (!q) queues.set(name, (q = makeQueue(name, redis, env)));
    return q;
  };
  const ctx: JobContext = { prisma, log, env, connection: redis, queue };
  const registry = buildRegistry();

  const events = queue(QUEUES.DOMAIN_EVENTS);
  const deadLetter = queue(QUEUES.DEAD_LETTER);
  const consumer = startEventConsumer({ connection: redis, env, prisma, deadLetter, handlers: registry.handlers, ctx, log });
  const dispatcher = startDispatcher(
    prisma,
    events,
    { batchSize: env.OUTBOX_BATCH_SIZE, maxDispatchAttempts: env.OUTBOX_MAX_DISPATCH_ATTEMPTS, jobAttempts: env.EVENT_JOB_ATTEMPTS, jobBackoffMs: env.EVENT_JOB_BACKOFF_MS, pollMs: env.OUTBOX_POLL_MS },
    log,
  );

  const workers: Worker[] = [consumer];
  for (const spec of registry.processors) {
    workers.push(new Worker(spec.queue, (job) => spec.process(job, ctx), { connection: redis, prefix: env.BULLMQ_PREFIX, concurrency: spec.concurrency ?? 1, lockDuration: env.WORKER_LOCK_DURATION_MS, stalledInterval: env.WORKER_LOCK_DURATION_MS }));
  }
  for (const r of registry.repeatables) {
    await queue(r.queue).upsertJobScheduler(`${r.queue}:${r.name}`, r.pattern ? { pattern: r.pattern, tz: 'UTC' } : { every: r.everyMs ?? 60_000 }, { name: r.name, data: r.data ?? {} });
  }

  log.info({ processors: registry.processors.map((p) => p.queue), eventTypes: [...registry.handlers.keys()] }, 'worker started');

  for (const w of workers) w.on('error', (err) => log.error({ err: err.message }, 'worker error'));
  for (const w of workers) w.on('failed', (job, err) => { if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) errorReporter().capture(err, { route: `job:${job.name}`, requestId: job.id }); });
  const heartbeat = startHeartbeat(redis, env.BULLMQ_PREFIX, env.WORKER_HEARTBEAT_MS, log, { release: env.RELEASE });
  const healthServer = env.WORKER_HEALTH_PORT > 0 ? startHealthServer(env.WORKER_HEALTH_PORT, { prisma, redis, heartbeat, heartbeatMs: env.WORKER_HEARTBEAT_MS }, log) : undefined;
  process.on('unhandledRejection', (reason) => { errorReporter().capture(reason); log.error({ err: reason instanceof Error ? reason.message : String(reason) }, 'unhandledRejection'); });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Drain: stop taking new work, let in-flight jobs finish (Worker.close waits for active jobs); hard-exit after the grace period.
    setTimeout(() => { log.error('shutdown grace exceeded; exiting 1'); process.exit(1); }, env.WORKER_SHUTDOWN_GRACE_MS).unref();
    log.info({ signal }, 'shutting down');
    await heartbeat.stop();
    healthServer?.close();
    await dispatcher.stop();
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all([...queues.values()].map((q) => q.close()));
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
