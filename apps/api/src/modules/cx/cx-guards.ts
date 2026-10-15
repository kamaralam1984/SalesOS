import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

/** Locates prisma/sql/cx-guards.sql from both src (ts) and dist layouts. */
function sqlPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../../../../prisma/sql/cx-guards.sql'), // apps/api/src/modules/cx -> repo root
    path.resolve(__dirname, '../../../../../../prisma/sql/cx-guards.sql'), // apps/api/dist/modules/cx
    path.resolve(process.cwd(), 'prisma/sql/cx-guards.sql'),
    path.resolve(process.cwd(), '../../prisma/sql/cx-guards.sql'),
  ];
  const hit = candidates.find((c) => fs.existsSync(c));
  if (!hit) throw new Error(`cx-guards.sql not found (looked in ${candidates.join(', ')})`);
  return hit;
}

/** Applies the immutability triggers (idempotent: CREATE OR REPLACE / DROP IF EXISTS + CREATE). */
export async function ensureCxGuards(prisma: PrismaClient): Promise<void> {
  const sql = fs.readFileSync(sqlPath(), 'utf8');
  // split on the statement terminators that are not inside $$ bodies
  const statements: string[] = [];
  let cur = '';
  let inBody = false;
  for (const line of sql.split('\n')) {
    if (line.trim().startsWith('--')) continue;
    cur += `${line}\n`;
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
    if (!inBody && line.trim().endsWith(';')) {
      statements.push(cur.trim());
      cur = '';
    }
  }
  // serialize concurrent boots (parallel test workers) with an advisory lock
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(7001001)');
    for (const s of statements) await tx.$executeRawUnsafe(s);
  });
}
