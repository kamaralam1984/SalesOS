import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { splitSql } from './security-guards';

function sqlPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../../../../prisma/sql/workforce-guards.sql'),
    path.resolve(__dirname, '../../../../../../prisma/sql/workforce-guards.sql'),
    path.resolve(process.cwd(), 'prisma/sql/workforce-guards.sql'),
    path.resolve(process.cwd(), '../../prisma/sql/workforce-guards.sql'),
  ];
  const hit = candidates.find((c) => fs.existsSync(c));
  if (!hit) throw new Error(`workforce-guards.sql not found (looked in ${candidates.join(', ')})`);
  return hit;
}

/** Dev/test equivalent of the 20261015180000_workforce migration guards (append-only ledgers/history). Idempotent. */
export async function ensureWorkforceGuards(prisma: PrismaClient): Promise<void> {
  const statements = splitSql(fs.readFileSync(sqlPath(), 'utf8'));
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(7001003)');
    for (const s of statements) await tx.$executeRawUnsafe(s);
  });
}
