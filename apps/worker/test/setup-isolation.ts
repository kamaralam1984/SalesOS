import { afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { WORKER_TEST_DB } from './global-setup';

/**
 * Per-file isolation for the worker suite (they share one database and run sequentially). The outbox relay takes the oldest
 * PENDING rows of ANY organisation, so rows an earlier spec left behind starve later ones (order sensitivity). Every spec file
 * starts and ends without PENDING outbox rows; specs create their own organisation, so nothing else is shared.
 */
const url = process.env.TEST_WORKER_DATABASE_URL ?? WORKER_TEST_DB;
const purge = async () => {
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await prisma.$executeRaw`DELETE FROM outbox_events WHERE status = 'PENDING'`;
  } finally {
    await prisma.$disconnect();
  }
};
beforeAll(purge);
afterAll(purge);
