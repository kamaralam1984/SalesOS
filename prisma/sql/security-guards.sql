-- Phase 10 (security hardening) database guards. Idempotent. Shipped as the incremental migration
-- 20261015140000_security_hardening (an exact copy: apps/api/test/security/db-roles.spec.ts asserts they match) and re-applied by
-- apps/api/src/common/prisma/security-guards.ts in dev/test (DB_AUTO_DDL).
--
-- TRUNCATE does not fire row-level UPDATE/DELETE triggers, so audit_logs_append_only alone does not stop `TRUNCATE audit_logs`.
-- These statement-level triggers close that gap for the append-only history tables, even for the table owner.
CREATE OR REPLACE FUNCTION salesos_block_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (TRUNCATE blocked)', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION salesos_block_truncate();
DROP TRIGGER IF EXISTS payment_events_no_truncate ON payment_events;
CREATE TRIGGER payment_events_no_truncate BEFORE TRUNCATE ON payment_events FOR EACH STATEMENT EXECUTE FUNCTION salesos_block_truncate();
DROP TRIGGER IF EXISTS refund_events_no_truncate ON refund_events;
CREATE TRIGGER refund_events_no_truncate BEFORE TRUNCATE ON refund_events FOR EACH STATEMENT EXECUTE FUNCTION salesos_block_truncate();
DROP TRIGGER IF EXISTS deal_status_history_no_truncate ON deal_status_history;
CREATE TRIGGER deal_status_history_no_truncate BEFORE TRUNCATE ON deal_status_history FOR EACH STATEMENT EXECUTE FUNCTION salesos_block_truncate();
DROP TRIGGER IF EXISTS founder_report_snapshots_no_truncate ON founder_report_snapshots;
CREATE TRIGGER founder_report_snapshots_no_truncate BEFORE TRUNCATE ON founder_report_snapshots FOR EACH STATEMENT EXECUTE FUNCTION salesos_block_truncate();
