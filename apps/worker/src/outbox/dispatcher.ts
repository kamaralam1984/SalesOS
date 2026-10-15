import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { DomainEvent } from '@salesos/shared-types';
import type { Logger } from '../logger';

export interface DispatcherOptions {
  batchSize: number;
  maxDispatchAttempts: number;
  jobAttempts: number;
  jobBackoffMs: number;
}

interface Row {
  id: string;
  organization_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  created_at: Date;
}

/** Backoff for failed relay attempts (outbox -> BullMQ), capped at 5 minutes. */
export const relayBackoffMs = (attempts: number) => Math.min(2 ** attempts * 1000, 300_000);

/**
 * Relays PENDING outbox rows to BullMQ.
 *  - Rows are claimed with FOR UPDATE SKIP LOCKED so several dispatchers can run concurrently.
 *  - The BullMQ jobId is the outbox id, so re-relaying after a crash between `queue.add` and the DB update
 *    cannot create a duplicate job.
 *  - A relay failure schedules a retry with exponential backoff; after maxDispatchAttempts the row is DEAD.
 * Returns the number of events relayed in this pass.
 */
export async function dispatchOnce(prisma: PrismaClient, queue: Queue, opts: DispatcherOptions, log?: Logger): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`
        SELECT id::text, organization_id::text, aggregate_type, aggregate_id, event_type, payload, attempts, created_at
        FROM outbox_events
        WHERE status = 'PENDING' AND available_at <= now()
        ORDER BY created_at, id
        LIMIT ${opts.batchSize}
        FOR UPDATE SKIP LOCKED`;
      let relayed = 0;
      for (const row of rows) {
        const event: DomainEvent = {
          id: row.id,
          eventType: row.event_type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          organizationId: row.organization_id,
          payload: row.payload,
          occurredAt: row.created_at.toISOString(),
          attempt: row.attempts,
        };
        try {
          await queue.add(row.event_type, event, {
            jobId: row.id,
            attempts: opts.jobAttempts,
            backoff: { type: 'exponential', delay: opts.jobBackoffMs },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: false,
          });
          await tx.outboxEvent.update({ where: { id: row.id }, data: { status: 'DISPATCHED', dispatchedAt: new Date() } });
          relayed++;
        } catch (err) {
          const attempts = row.attempts + 1;
          const dead = attempts >= opts.maxDispatchAttempts;
          log?.warn({ eventId: row.id, attempts, dead, err: (err as Error).message }, 'outbox relay failed');
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: {
              attempts,
              lastError: String((err as Error).message).slice(0, 500),
              status: dead ? 'DEAD' : 'PENDING',
              availableAt: new Date(Date.now() + relayBackoffMs(attempts)),
            },
          });
        }
      }
      return relayed;
    },
    { timeout: 30_000 },
  );
}

/** Polling loop; resolves `stop()` after the in-flight pass finishes. */
export function startDispatcher(prisma: PrismaClient, queue: Queue, opts: DispatcherOptions & { pollMs: number }, log: Logger) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    try {
      while (!stopped && (await dispatchOnce(prisma, queue, opts, log)) === opts.batchSize) {
        /* drain while batches are full */
      }
    } catch (err) {
      log.error({ err: (err as Error).message }, 'outbox dispatcher pass failed');
    }
    if (!stopped) timer = setTimeout(() => (running = tick()), opts.pollMs);
  };
  running = tick();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
