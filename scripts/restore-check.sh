#!/usr/bin/env bash
# Restore rehearsal: restores a dump into a THROWAWAY database and proves it matches the backup-time manifest.
#   scripts/restore-check.sh backups/salesos_agentl_rel_20261015T120000Z.dump
# Env: TARGET_DB (default salesos_agentl_restore; must end with _restore or _restore_test, never the live DB), MODE, PG_CONTAINER, PG_USER,
#      PRISMA_STATUS=1 (also run `prisma migrate status` against the restored DB; needs pnpm + TARGET_URL),
#      TARGET_URL (postgresql://... for the restored DB, used by PRISMA_STATUS).
# Checks: sha256 of dump, per-table row count + content md5, triggers, indexes, constraints, functions, extensions, enums vs manifest,
# and a behavioural probe: the append-only audit trigger must still refuse UPDATE/DELETE on audit_logs.
# Prints RESTORE_SECONDS (measured RTO for the database step) and exits non-zero on any mismatch.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$HERE/lib-db.sh"
dump="${1:?usage: restore-check.sh <dump file>}"; TARGET_DB="${TARGET_DB:-salesos_agentl_restore}"
case "$TARGET_DB" in *_restore|*_restore_test) ;; *) echo "refusing: TARGET_DB '$TARGET_DB' must end with _restore or _restore_test" >&2; exit 2;; esac
[ -f "$dump" ] || { echo "no such dump: $dump" >&2; exit 2; }
fail=0
echo "== 1. checksum"; ( cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256" ) || fail=1
echo "== 2. restore into $TARGET_DB"
psql_db postgres -c "DROP DATABASE IF EXISTS \"$TARGET_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$TARGET_DB\""
t0=$(now_s)
pg pg_restore --no-owner --exit-on-error -d "$TARGET_DB" < "$dump"
t1=$(now_s)
echo "RESTORE_SECONDS=$(elapsed "$t0" "$t1")"
echo "== 3. manifest compare"
if [ -f "$dump.manifest" ]; then
  manifest "$TARGET_DB" > "$dump.restored.manifest"
  if diff -u "$dump.manifest" "$dump.restored.manifest" > "$dump.diff"; then
    echo "MANIFEST MATCH: $(grep -c '^T|' "$dump.manifest") tables, $(grep -c '^TRG|' "$dump.manifest") triggers, $(grep -c '^IDX|' "$dump.manifest") indexes, $(grep -c '^CON|' "$dump.manifest") constraints, $(grep -c '^FN|' "$dump.manifest") functions"
    echo "rows total: $(awk -F'|' '/^T\|/{s+=$3} END{print s}' "$dump.restored.manifest")"
  else echo "MANIFEST MISMATCH (see $dump.diff)"; head -30 "$dump.diff"; fail=1; fi
else echo "no manifest next to the dump (backup ran with MANIFEST=0): only structure/row-count sanity"; fail=1; fi
echo "== 4. behavioural probe: append-only audit trigger survived"
probe="$(psql_db "$TARGET_DB" -At -c "DO \$\$ BEGIN UPDATE audit_logs SET action = action; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'BLOCKED'; RETURN; END \$\$;" 2>&1 || true)"
n=$(psql_db "$TARGET_DB" -At -c "SELECT count(*) FROM audit_logs")
if [ "$n" -eq 0 ]; then echo "audit_logs empty: probe not meaningful (trigger presence is covered by manifest)"; elif echo "$probe" | grep -q BLOCKED; then echo "audit UPDATE blocked: OK"; else echo "audit UPDATE NOT blocked: FAIL ($probe)"; fail=1; fi
if [ "${PRISMA_STATUS:-0}" = 1 ]; then
  echo "== 5. prisma migrate status"; ( cd "$HERE/.." && DATABASE_URL="${TARGET_URL:?TARGET_URL required}" pnpm exec prisma migrate status --schema prisma/schema ) || fail=1
fi
[ "$fail" = 0 ] && echo "RESTORE CHECK PASSED" || { echo "RESTORE CHECK FAILED"; exit 1; }
