import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

function sqlPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../../../../prisma/sql/security-guards.sql'), // apps/api/src/common/prisma -> repo root
    path.resolve(__dirname, '../../../../../../prisma/sql/security-guards.sql'), // apps/api/dist/common/prisma
    path.resolve(process.cwd(), 'prisma/sql/security-guards.sql'),
    path.resolve(process.cwd(), '../../prisma/sql/security-guards.sql'),
  ];
  const hit = candidates.find((c) => fs.existsSync(c));
  if (!hit) throw new Error(`security-guards.sql not found (looked in ${candidates.join(', ')})`);
  return hit;
}

/** Splits on statement terminators that are not inside $$ bodies. */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inBody = false;
  for (const line of sql.split('\n')) {
    if (line.trim().startsWith('--')) continue;
    cur += `${line}\n`;
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
    if (!inBody && line.trim().endsWith(';')) { out.push(cur.trim()); cur = ''; }
  }
  return out;
}

/** Dev/test equivalent of the 20261015140000_security_hardening migration (statement-level TRUNCATE blocks). Idempotent. */
export async function ensureSecurityGuards(prisma: PrismaClient): Promise<void> {
  const statements = splitSql(fs.readFileSync(sqlPath(), 'utf8'));
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(7001002)');
    for (const s of statements) await tx.$executeRawUnsafe(s);
  });
}
