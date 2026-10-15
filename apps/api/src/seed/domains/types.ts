import type { PrismaClient } from '@prisma/client';

export interface SeedContext {
  prisma: PrismaClient;
  organizationId: string;
  /** demo user local-part (e.g. 'exec.a1', 'manager.b') -> user id */
  userIds: Map<string, string>;
}
