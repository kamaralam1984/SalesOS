import type { PrismaService } from '../../common/prisma';

/**
 * Indexes the KPI queries need that the owning domains do not declare (we may not edit their Prisma files in a parallel wave).
 * Idempotent; include in the lead's consolidated migration. Chosen from EXPLAIN on the generated 50k-lead / 200k-activity dataset
 * (docs/analytics-report.md, "Query plans").
 */
export const ANALYTICS_INDEXES: ReadonlyArray<{ name: string; sql: string }> = [
  { name: 'call_logs_org_started_idx', sql: 'CREATE INDEX IF NOT EXISTS call_logs_org_started_idx ON call_logs (organization_id, started_at)' },
  { name: 'call_logs_org_user_started_idx', sql: 'CREATE INDEX IF NOT EXISTS call_logs_org_user_started_idx ON call_logs (organization_id, user_id, started_at)' },
  { name: 'leads_org_created_idx', sql: 'CREATE INDEX IF NOT EXISTS leads_org_created_idx ON leads (organization_id, created_at)' },
  { name: 'leads_org_open_owner_idx', sql: "CREATE INDEX IF NOT EXISTS leads_org_open_owner_idx ON leads (organization_id, assigned_to_id) WHERE stage_category = 'OPEN' AND merged_into_id IS NULL" },
  { name: 'leads_org_won_at_idx', sql: "CREATE INDEX IF NOT EXISTS leads_org_won_at_idx ON leads (organization_id, won_at) WHERE stage_category = 'WON'" },
  { name: 'sales_records_org_lead_closed_idx', sql: 'CREATE INDEX IF NOT EXISTS sales_records_org_lead_closed_idx ON sales_records (organization_id, lead_id, closed_at)' },
  { name: 'tasks_org_completed_idx', sql: "CREATE INDEX IF NOT EXISTS tasks_org_completed_idx ON tasks (organization_id, completed_at) WHERE status = 'DONE'" },
  { name: 'tasks_org_due_idx', sql: 'CREATE INDEX IF NOT EXISTS tasks_org_due_idx ON tasks (organization_id, due_at)' },
  { name: 'tasks_open_overdue_idx', sql: "CREATE INDEX IF NOT EXISTS tasks_open_overdue_idx ON tasks (organization_id, assigned_to_id, due_at) WHERE status = 'OPEN'" },
];

export async function ensureAnalyticsIndexes(prisma: PrismaService): Promise<void> {
  for (const i of ANALYTICS_INDEXES) {
    try {
      await prisma.$executeRawUnsafe(i.sql);
    } catch {
      // a concurrent boot (parallel test workers) may race on CREATE INDEX: the index exists afterwards
    }
  }
}
