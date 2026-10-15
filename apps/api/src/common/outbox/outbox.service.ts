import { Global, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService, type Tx } from '../prisma';

export interface OutboxEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  organizationId?: string | null;
  payload: Record<string, unknown>;
  /** Business idempotency key: publishing the same key twice stores a single event. */
  idempotencyKey?: string;
  /** Delay delivery until this time (e.g. reminders). */
  availableAt?: Date;
}

/**
 * Transactional outbox. `publish` MUST be called with the caller's Prisma transaction client so the event
 * commits (or rolls back) together with the business change. The worker's dispatcher relays rows to BullMQ.
 *
 *   await prisma.$transaction(async (tx) => {
 *     await tx.lead.update(...);
 *     await outbox.publish(tx, { eventType: 'lead.assigned', aggregateType: 'lead', aggregateId: id, organizationId, payload });
 *   });
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the event id, or null when an event with the same idempotencyKey already exists. */
  async publish(tx: Tx, input: OutboxEventInput): Promise<string | null> {
    const id = randomUUID();
    const res = await tx.outboxEvent.createMany({
      data: [
        {
          id,
          eventType: input.eventType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          organizationId: input.organizationId ?? null,
          payload: input.payload as Prisma.InputJsonValue,
          idempotencyKey: input.idempotencyKey,
          availableAt: input.availableAt ?? new Date(),
        },
      ],
      skipDuplicates: true,
    });
    return res.count === 1 ? id : null;
  }

  /** For callers that have no surrounding transaction. Prefer `publish` inside the business tx. */
  publishStandalone(input: OutboxEventInput): Promise<string | null> {
    return this.prisma.$transaction((tx) => this.publish(tx, input));
  }
}

@Global()
@Module({ providers: [OutboxService], exports: [OutboxService] })
export class OutboxModule {}
