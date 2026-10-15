/* Test fixture: the REAL worker pipeline (dispatcher + event consumer + registry from the compiled dist) with an optional
 * artificial delay inside the first/last event handler so a test can kill -9 or SIGTERM the process mid-job.
 *   FIXTURE_SLOW_MODE=before|after  FIXTURE_SLOW_MS=60000  FIXTURE_DIST=dist-l2 */
const path = require('node:path');
const dist = path.resolve(__dirname, '..', process.env.FIXTURE_DIST || 'dist-l2');
const { PrismaClient } = require('@prisma/client');
const { loadWorkerEnv } = require(path.join(dist, 'config.js'));
const { createLogger } = require(path.join(dist, 'logger.js'));
const { createRedis } = require(path.join(dist, 'redis.js'));
const { QUEUES, makeQueue } = require(path.join(dist, 'queues.js'));
const { startDispatcher } = require(path.join(dist, 'outbox/dispatcher.js'));
const { startEventConsumer } = require(path.join(dist, 'outbox/event-consumer.js'));
const { buildRegistry } = require(path.join(dist, 'jobs/registry.js'));
const { startHeartbeat } = require(path.join(dist, 'health.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const env = loadWorkerEnv();
  const log = createLogger(env.LOG_LEVEL);
  const redis = createRedis(env.REDIS_URL);
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  await prisma.$connect();
  const queues = new Map();
  const queue = (name) => { if (!queues.has(name)) queues.set(name, makeQueue(name, redis, env)); return queues.get(name); };
  const ctx = { prisma, log, env, connection: redis, queue };
  const registry = buildRegistry();
  const mode = process.env.FIXTURE_SLOW_MODE;
  const slowMs = Number(process.env.FIXTURE_SLOW_MS || 0);
  if (mode && slowMs) {
    for (const [type, list] of registry.handlers) {
      if (type !== process.env.FIXTURE_SLOW_EVENT) continue;
      const wrapped = list.map((h, i) => {
        if (mode === 'before' && i === 0) return async (ev, c) => { console.log('STARTED ' + ev.id); await sleep(slowMs); return h(ev, c); };
        if (mode === 'after' && i === list.length - 1) return async (ev, c) => { await h(ev, c); console.log('HANDLED ' + ev.id); await sleep(slowMs); };
        return h;
      });
      registry.handlers.set(type, wrapped);
    }
  }
  const deadLetter = queue(QUEUES.DEAD_LETTER);
  const consumer = startEventConsumer({ connection: redis, env, prisma, deadLetter, handlers: registry.handlers, ctx, log });
  const dispatcher = startDispatcher(prisma, queue(QUEUES.DOMAIN_EVENTS), { batchSize: env.OUTBOX_BATCH_SIZE, maxDispatchAttempts: env.OUTBOX_MAX_DISPATCH_ATTEMPTS, jobAttempts: env.EVENT_JOB_ATTEMPTS, jobBackoffMs: env.EVENT_JOB_BACKOFF_MS, pollMs: env.OUTBOX_POLL_MS }, log);
  const heartbeat = startHeartbeat(redis, env.BULLMQ_PREFIX, env.WORKER_HEARTBEAT_MS, log);
  console.log('READY ' + process.pid);
  const shutdown = async (sig) => {
    console.log('SHUTDOWN ' + sig);
    await heartbeat.stop();
    await dispatcher.stop();
    await consumer.close(); // waits for the in-flight job
    for (const q of queues.values()) await q.close();
    await prisma.$disconnect();
    redis.disconnect();
    console.log('DRAINED');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
})().catch((e) => { console.error(e); process.exit(1); });
