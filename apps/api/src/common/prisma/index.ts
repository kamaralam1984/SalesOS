export * from './prisma.service';
import type { Prisma } from '@prisma/client';
/** Prisma interactive-transaction client; pass to OutboxService.publish / AuditService.recordTx. */
export type Tx = Prisma.TransactionClient;
