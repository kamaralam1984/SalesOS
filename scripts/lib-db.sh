#!/usr/bin/env bash
# Shared helpers for backup.sh / restore-check.sh. Sourced, not executed.
# MODE=docker (default): run pg tools inside the container PG_CONTAINER (dev/staging on this machine: salesos-postgres).
# MODE=local: use pg tools on PATH with PGHOST/PGPORT/PGUSER/PGPASSWORD (production hosts).
MODE="${MODE:-docker}"
PG_CONTAINER="${PG_CONTAINER:-salesos-postgres}"
PG_USER="${PG_USER:-salesos}"

pg() { # pg <tool> args...   (stdin passes through)
  local tool="$1"; shift
  if [ "$MODE" = docker ]; then docker exec -i "$PG_CONTAINER" "$tool" -U "$PG_USER" "$@"; else "$tool" "$@"; fi
}
psql_db() { local db="$1"; shift; pg psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
now_s() { date +%s.%N; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.2f", b-a}'; }

# Deterministic structural + content fingerprint of the public schema. One line per object.
#   T|table|rowcount|md5(all rows, ordered by row text)   TRG|table.trigger|md5(def)   IDX|name|md5(def)
#   CON|table.name|md5(def)   FN|name|md5(def)   EXT|name   SEQ|name   ENUM|name|labels
manifest_sql() {
  cat <<'SQL'
SELECT 'T|'||c.relname||'|'||
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text||'|'||
  (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) as h from public.%I t', c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
UNION ALL SELECT 'TRG|'||tgrelid::regclass||'.'||tgname||'|'||md5(pg_get_triggerdef(oid)) FROM pg_trigger WHERE NOT tgisinternal
UNION ALL SELECT 'IDX|'||indexname||'|'||md5(indexdef) FROM pg_indexes WHERE schemaname='public'
UNION ALL SELECT 'CON|'||conrelid::regclass||'.'||conname||'|'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
UNION ALL SELECT 'FN|'||proname||'|'||md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace
UNION ALL SELECT 'EXT|'||extname FROM pg_extension
UNION ALL SELECT 'ENUM|'||t.typname||'|'||(SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid) FROM pg_type t WHERE t.typtype='e' AND t.typnamespace='public'::regnamespace
ORDER BY 1;
SQL
}
manifest() { manifest_sql | psql_db "$1" -At; }
