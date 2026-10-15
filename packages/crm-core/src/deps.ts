import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface AuditIn {
  organizationId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OutboxIn {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  organizationId: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  availableAt?: Date;
}

/**
 * Side-effect writers injected by the host. The API passes wrappers around AuditService (adds requestId/ip) and
 * OutboxService; the worker passes `directDeps()`. Both always receive the caller's transaction client.
 */
export interface CoreDeps {
  audit(tx: Tx, e: AuditIn): Promise<void>;
  publish(tx: Tx, e: OutboxIn): Promise<string | null>;
}

export function directDeps(): CoreDeps {
  return {
    async audit(tx, e) {
      await tx.auditLog.create({
        data: {
          organizationId: e.organizationId,
          actorId: e.actorId ?? null,
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId ?? null,
          metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    },
    async publish(tx, e) {
      const id = randomUUID();
      const res = await tx.outboxEvent.createMany({
        data: [
          {
            id,
            eventType: e.eventType,
            aggregateType: e.aggregateType,
            aggregateId: e.aggregateId,
            organizationId: e.organizationId,
            payload: e.payload as Prisma.InputJsonValue,
            idempotencyKey: e.idempotencyKey,
            availableAt: e.availableAt ?? new Date(),
          },
        ],
        skipDuplicates: true,
      });
      return res.count === 1 ? id : null;
    },
  };
}
