import type { PrismaClient } from '@prisma/client';

/**
 * Database-level immutability for financial history (MS-FIN-002, MS-FIN-011). Applied idempotently at API boot and by the seed.
 * Application code never needs to rely on "we just don't update it": the database refuses.
 */
const IMMUTABLE_TABLES = ['sales_credits', 'deal_status_history', 'payment_events', 'refund_events', 'forecast_snapshots', 'program_prices', 'pricing_proposal_events'] as const;
const NO_DELETE_TABLES = ['sales_records', 'sale_adjustments', 'target_revisions', 'payments', 'refunds'] as const;

const FUNCTIONS: string[] = `
CREATE OR REPLACE FUNCTION salesos_rev_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION salesos_rev_block_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION salesos_rev_sales_records_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sales_records are immutable: use a sale adjustment record' USING ERRCODE = 'restrict_violation';
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION salesos_rev_adjustment_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'PENDING'
     OR NEW.delta <> OLD.delta OR NEW.reason <> OLD.reason OR NEW.kind <> OLD.kind
     OR NEW.sales_record_id <> OLD.sales_record_id OR NEW.deal_id <> OLD.deal_id
     OR NEW.credit_allocations::text <> OLD.credit_allocations::text
     OR NEW.created_by_id <> OLD.created_by_id THEN
    RAISE EXCEPTION 'sale_adjustments are immutable once recorded (only PENDING -> APPROVED/REJECTED)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION salesos_rev_revision_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'PENDING'
     OR NEW.new_amount <> OLD.new_amount OR NEW.old_amount IS DISTINCT FROM OLD.old_amount
     OR NEW.reason <> OLD.reason OR NEW.proposed_by_id <> OLD.proposed_by_id OR NEW.target_id <> OLD.target_id THEN
    RAISE EXCEPTION 'target_revisions are append-only (only PENDING -> APPROVED/REJECTED)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION salesos_rev_payment_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('RECONCILED', 'REVERSED') THEN
    RAISE EXCEPTION 'payment is locked (status %)', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'VERIFIED' AND (NEW.amount <> OLD.amount OR NEW.external_transaction_ref IS DISTINCT FROM OLD.external_transaction_ref OR NEW.deal_id <> OLD.deal_id) THEN
    RAISE EXCEPTION 'a verified payment amount/reference cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION salesos_rev_refund_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('PROCESSED', 'RECONCILED') AND (NEW.processed_amount IS DISTINCT FROM OLD.processed_amount OR NEW.approved_amount IS DISTINCT FROM OLD.approved_amount OR NEW.amount <> OLD.amount) THEN
    RAISE EXCEPTION 'a processed refund amount cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('REJECTED', 'WITHDRAWN', 'RECONCILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'refund is in terminal status %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION salesos_rev_target_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.original_amount <> OLD.original_amount THEN
    RAISE EXCEPTION 'targets.original_amount is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
`.split(/(?<=LANGUAGE plpgsql;)\s*\n/).map((x) => x.trim()).filter(Boolean);

async function ensureTrigger(tx: PrismaClient, name: string, table: string, timing: string, fn: string) {
  const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM pg_trigger WHERE tgname = '${name}'`);
  if (Number(rows[0]?.n ?? 0) === 0) {
    await tx.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE ${timing} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  }
}

export async function ensureRevenueGuards(prisma: PrismaClient): Promise<void> {
  // advisory lock: two processes booting at once must not race on CREATE TRIGGER
  await prisma.$transaction(
    async (txc) => {
      const tx = txc as unknown as PrismaClient;
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(727401)`);
      for (const fn of FUNCTIONS) await tx.$executeRawUnsafe(fn);
      for (const t of IMMUTABLE_TABLES) await ensureTrigger(tx, `${t}_immutable`, t, 'UPDATE OR DELETE', 'salesos_rev_block_mutation');
      for (const t of NO_DELETE_TABLES) await ensureTrigger(tx, `${t}_no_delete`, t, 'DELETE', 'salesos_rev_block_delete');
      await ensureTrigger(tx, 'sales_records_immutable', 'sales_records', 'UPDATE', 'salesos_rev_sales_records_immutable');
      await ensureTrigger(tx, 'sale_adjustments_guard', 'sale_adjustments', 'UPDATE', 'salesos_rev_adjustment_guard');
      await ensureTrigger(tx, 'target_revisions_guard', 'target_revisions', 'UPDATE', 'salesos_rev_revision_guard');
      await ensureTrigger(tx, 'payments_guard', 'payments', 'UPDATE', 'salesos_rev_payment_guard');
      await ensureTrigger(tx, 'refunds_guard', 'refunds', 'UPDATE', 'salesos_rev_refund_guard');
      await ensureTrigger(tx, 'targets_guard', 'targets', 'UPDATE', 'salesos_rev_target_guard');
      await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS forecast_snapshots_one_period_start ON forecast_snapshots (forecast_id) WHERE kind = 'PERIOD_START'`);
    },
    { timeout: 30_000 },
  );
}
