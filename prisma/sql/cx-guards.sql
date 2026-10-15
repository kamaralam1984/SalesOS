-- Phase 7 (CX / Founder reporting) DB-level guards that Prisma cannot express. Idempotent; applied by the API at boot
-- (CxModule.onModuleInit -> ensureCxGuards) and by test setup. Include in the lead's consolidated migration.

-- 1. Founder report snapshots are IMMUTABLE: no UPDATE, no DELETE (a correction is a NEW report version + snapshot).
CREATE OR REPLACE FUNCTION salesos_block_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'founder_report_snapshots is immutable (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS founder_report_snapshots_immutable ON founder_report_snapshots;
CREATE TRIGGER founder_report_snapshots_immutable
  BEFORE UPDATE OR DELETE ON founder_report_snapshots
  FOR EACH ROW EXECUTE FUNCTION salesos_block_snapshot_mutation();

-- 2. A PUBLISHED founder report row is frozen except the Founder review columns (rating, review_note, reviewed_*).
CREATE OR REPLACE FUNCTION salesos_freeze_published_report() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'a published founder report cannot be deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'PUBLISHED' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.sections IS DISTINCT FROM OLD.sections
    OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.due_at IS DISTINCT FROM OLD.due_at
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.published_by_id IS DISTINCT FROM OLD.published_by_id
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.on_time IS DISTINCT FROM OLD.on_time
    OR NEW.completeness_pct IS DISTINCT FROM OLD.completeness_pct
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
  ) THEN
    RAISE EXCEPTION 'a published founder report is immutable (only the review columns may change)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS founder_reports_freeze_published ON founder_reports;
CREATE TRIGGER founder_reports_freeze_published
  BEFORE UPDATE OR DELETE ON founder_reports
  FOR EACH ROW EXECUTE FUNCTION salesos_freeze_published_report();

-- 3. At most ONE open (not yet completed) handover per learner: the lead.won (CRM) and deal.closed (revenue) events for the same
--    sale are consumed concurrently, so uniqueness must be enforced by the database, not by a read-then-write check.
CREATE UNIQUE INDEX IF NOT EXISTS handover_one_open_per_lead
  ON handover_records (organization_id, lead_id)
  WHERE lead_id IS NOT NULL AND status <> 'COMPLETED';
