import { PrismaClient } from '@prisma/client';

/** Idempotent DB guards (mirrors prisma/sql/guards.sql): audit_logs is append-only. */
export async function ensureDbGuards(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION salesos_block_audit_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
    END;
    $$ LANGUAGE plpgsql;`);
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM pg_trigger WHERE tgname = 'audit_logs_append_only'`,
  );
  if (Number(rows[0]?.n ?? 0) === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION salesos_block_audit_mutation();`);
  }
}
