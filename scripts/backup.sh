#!/usr/bin/env bash
# SalesOS PostgreSQL logical backup (pg_dump -Fc) + checksum + content manifest. Read-only on the source DB.
#   scripts/backup.sh                       # DB=salesos, OUT_DIR=./backups
#   DB=salesos_agentl_rel OUT_DIR=/srv/backups scripts/backup.sh
# Env: DB, OUT_DIR, MODE=docker|local, PG_CONTAINER, PG_USER, MANIFEST=1 (0 skips row-level checksums),
#      AGE_RECIPIENT (if set and `age` is installed, the dump is also encrypted to <dump>.age; ship the .age off-host),
#      KEEP_DAILY=14 (prune older *.dump in OUT_DIR for this DB; 0 disables pruning).
# Never point this at a DB you do not own. A backup counts only after scripts/restore-check.sh passed on it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$HERE/lib-db.sh"
DB="${DB:-salesos}"; OUT_DIR="${OUT_DIR:-./backups}"; MANIFEST="${MANIFEST:-1}"; KEEP_DAILY="${KEEP_DAILY:-14}"
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"; dump="$OUT_DIR/${DB}_${stamp}.dump"
t0=$(now_s)
umask 077
pg pg_dump -Fc --no-owner -d "$DB" > "$dump.partial"
mv "$dump.partial" "$dump"
t1=$(now_s)
( cd "$OUT_DIR" && sha256sum "$(basename "$dump")" > "$(basename "$dump").sha256" )
if [ "$MANIFEST" = 1 ]; then manifest "$DB" > "$dump.manifest"; fi
t2=$(now_s)
if [ -n "${AGE_RECIPIENT:-}" ] && command -v age >/dev/null; then age -r "$AGE_RECIPIENT" -o "$dump.age" "$dump"; echo "encrypted: $dump.age"; fi
if [ "$KEEP_DAILY" != 0 ]; then ls -1t "$OUT_DIR/${DB}_"*.dump 2>/dev/null | tail -n +$((KEEP_DAILY+1)) | while read -r f; do rm -f "$f" "$f.sha256" "$f.manifest" "$f.age"; done; fi
echo "backup ok: $dump"
echo "  size_bytes=$(stat -c %s "$dump") dump_seconds=$(elapsed "$t0" "$t1") manifest_seconds=$(elapsed "$t1" "$t2")"
echo "  sha256=$(cut -d' ' -f1 "$dump.sha256")"
echo "  tables=$(grep -c '^T|' "$dump.manifest" 2>/dev/null || echo n/a)"
