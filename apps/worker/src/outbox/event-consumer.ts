import { Worker, type ConnectionOptions, type Queue, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { DomainEvent } from '@salesos/shared-types';
import type { WorkerEnv } from '../config';
import type { Logger } from '../logger';
import { QUEUES } from '../queues';
import type { EventHandler, JobContext } from '../jobs/registry';

/**
 * Consumes relayed outbox events and fans them out to registered handlers.
 * Failure policy: a throwing handler fails the job -> BullMQ retries with exponential backoff
 * (EVENT_JOB_ATTEMPTS). When retries are exhausted the event is copied to the dead-letter queue and the
 * outbox row is flagged DEAD with the last error. Dead jobs are kept (removeOnFail:false) for replay.
 */
export function startEventConsumer(opts: {
  connection: ConnectionOptions;
  env: WorkerEnv;
  prisma: PrismaClient;
  deadLetter: Queue;
  handlers: Map<string, EventHandler[]>;
  ctx: JobContext;
  log: Logger;
}) {
  const { env, prisma, deadLetter, handlers, ctx, log } = opts;
  const worker = new Worker<DomainEvent>(
    QUEUES.DOMAIN_EVENTS,
    async (job: Job<DomainEvent>) => {
      const list = handlers.get(job.data.eventType) ?? [];
      if (list.length === 0) {
        log.debug({ eventId: job.data.id, type: job.data.eventType }, 'no subscribers for event');
        return;
      }
      for (const handler of list) await handler({ ...job.data, attempt: job.attemptsMade }, ctx);
    },
    { connection: opts.connection, prefix: env.BULLMQ_PREFIX, concurrency: env.EVENT_CONCURRENCY, lockDuration: env.WORKER_LOCK_DURATION_MS, stalledInterval: env.WORKER_LOCK_DURATION_MS },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    log.warn({ eventId: job.id, type: job.name, attempt: job.attemptsMade, exhausted, err: err.message }, 'event job failed');
    if (!exhausted) return;
    try {
      await deadLetter.add(job.name, { event: job.data, error: err.message, failedAt: new Date().toISOString() }, { jobId: `dead-${job.id}`, removeOnComplete: false, removeOnFail: false });
      await prisma.outboxEvent.updateMany({ where: { id: job.id }, data: { status: 'DEAD', lastError: err.message.slice(0, 500) } });
    } catch (e) {
      log.error({ err: (e as Error).message }, 'failed to dead-letter event');
    }
  });
  return worker;
}
