import type { PrismaClient } from '@prisma/client';

/**
 * Boot-time DDL (guard triggers, analytics indexes) is convenient in dev/test but needs schema-owner rights.
 * In production the migration role owns the schema (`prisma migrate deploy`) and the application role has NO DDL, so
 * auto-DDL is off by default there and the API instead VERIFIES that the guards exist (fail closed).
 */
export function autoDdlEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.DB_AUTO_DDL;
  if (v !== undefined && v !== '') return v === 'true' || v === '1';
  return env.NODE_ENV !== 'production';
}

/** Triggers that make audit/money history append-only; the API refuses to start without them when it may not create them. */
export const REQUIRED_GUARD_TRIGGERS = ['audit_logs_append_only', 'sop_versions_immutable', 'founder_report_snapshots_immutable', 'payments_no_delete', 'refund_events_immutable', 'audit_logs_no_truncate'] as const;

export async function verifyDbGuards(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`);
  const have = new Set(rows.map((r) => r.tgname));
  const missing = REQUIRED_GUARD_TRIGGERS.filter((t) => !have.has(t));
  if (missing.length) throw new Error(`Database guards missing (${missing.join(', ')}): run "prisma migrate deploy" with the migration role; the application role cannot create them`);
}
