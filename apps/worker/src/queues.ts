import { Queue, type ConnectionOptions } from 'bullmq';
import type { WorkerEnv } from './config';

export const QUEUES = {
  /** Outbox relay target: one job per outbox event (jobId = outbox id => idempotent). */
  DOMAIN_EVENTS: 'domain-events',
  /** Jobs that exhausted retries land here for inspection/replay. */
  DEAD_LETTER: 'domain-events-dead',
} as const;

export const makeQueue = (name: string, connection: ConnectionOptions, env: Pick<WorkerEnv, 'BULLMQ_PREFIX'>) =>
  new Queue(name, { connection, prefix: env.BULLMQ_PREFIX });
