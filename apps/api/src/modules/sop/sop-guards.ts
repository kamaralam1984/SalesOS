import type { PrismaClient } from '@prisma/client';

/**
 * DB-level immutability for approved SOP versions (defence in depth; the service also refuses edits).
 * Once a version is APPROVED/SUPERSEDED/RETIRED its content columns can never change and it cannot be deleted;
 * only the lifecycle moves APPROVED -> SUPERSEDED|RETIRED and SUPERSEDED -> RETIRED are allowed.
 */
export async function ensureSopGuards(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION salesos_sop_version_immutable() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('APPROVED','SUPERSEDED','RETIRED') THEN
          RAISE EXCEPTION 'approved SOP versions are immutable (DELETE blocked)' USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN OLD;
      END IF;
      IF OLD.status IN ('APPROVED','SUPERSEDED','RETIRED') THEN
        IF NEW.body IS DISTINCT FROM OLD.body OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.change_summary IS DISTINCT FROM OLD.change_summary OR NEW.document_id IS DISTINCT FROM OLD.document_id
           OR NEW.version_number IS DISTINCT FROM OLD.version_number OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
           OR NEW.attachment_file_ids IS DISTINCT FROM OLD.attachment_file_ids OR NEW.approved_by_id IS DISTINCT FROM OLD.approved_by_id
           OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
          RAISE EXCEPTION 'approved SOP versions are immutable (content change blocked)' USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
             (OLD.status = 'APPROVED' AND NEW.status IN ('SUPERSEDED','RETIRED')) OR (OLD.status = 'SUPERSEDED' AND NEW.status = 'RETIRED')) THEN
          RAISE EXCEPTION 'illegal SOP version status change % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;`);
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM pg_trigger WHERE tgname = 'sop_versions_immutable'`);
  if (Number(rows[0]?.n ?? 0) === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER sop_versions_immutable BEFORE UPDATE OR DELETE ON sop_versions
      FOR EACH ROW EXECUTE FUNCTION salesos_sop_version_immutable();`);
  }
}
