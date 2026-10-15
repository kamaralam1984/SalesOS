-- Workforce append-only guards (DEC-048). Idempotent. Shipped inside migration 20261015180000_workforce (exact copy; a test asserts they match)
-- and re-applied by apps/api/src/common/prisma/workforce-guards.ts in dev/test (DB_AUTO_DDL).
CREATE OR REPLACE FUNCTION salesos_wf_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attendance_corrections_append_only ON attendance_corrections;
CREATE TRIGGER attendance_corrections_append_only BEFORE UPDATE OR DELETE ON attendance_corrections FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();
DROP TRIGGER IF EXISTS attendance_corrections_no_truncate ON attendance_corrections;
CREATE TRIGGER attendance_corrections_no_truncate BEFORE TRUNCATE ON attendance_corrections FOR EACH STATEMENT EXECUTE FUNCTION salesos_wf_block_mutation();

DROP TRIGGER IF EXISTS leave_balance_txns_append_only ON leave_balance_txns;
CREATE TRIGGER leave_balance_txns_append_only BEFORE UPDATE OR DELETE ON leave_balance_txns FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();
DROP TRIGGER IF EXISTS leave_balance_txns_no_truncate ON leave_balance_txns;
CREATE TRIGGER leave_balance_txns_no_truncate BEFORE TRUNCATE ON leave_balance_txns FOR EACH STATEMENT EXECUTE FUNCTION salesos_wf_block_mutation();

DROP TRIGGER IF EXISTS goal_updates_append_only ON goal_updates;
CREATE TRIGGER goal_updates_append_only BEFORE UPDATE OR DELETE ON goal_updates FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();

DROP TRIGGER IF EXISTS work_task_events_append_only ON work_task_events;
CREATE TRIGGER work_task_events_append_only BEFORE UPDATE OR DELETE ON work_task_events FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();

DROP TRIGGER IF EXISTS salary_structures_append_only ON salary_structures;
CREATE TRIGGER salary_structures_append_only BEFORE UPDATE OR DELETE ON salary_structures FOR EACH ROW EXECUTE FUNCTION salesos_wf_block_mutation();
