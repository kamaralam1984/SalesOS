#!/usr/bin/env bash
# Object storage (MinIO/S3/R2) backup via the MinIO client `mc` (must be installed; NOT run in CI/dev here).
#   MC_ALIAS_SRC=prod MC_ALIAS_DST=backup BUCKET=salesos-private scripts/backup-objects.sh
# Mirrors a bucket to a second location (different host/account) with --preserve; uploaded files are private (docs/file-storage-policy.md).
# Restore: `mc mirror --preserve <dst>/<bucket> <src>/<bucket>`; verify with `mc diff`. Prefer bucket versioning on top (`mc version enable`).
set -euo pipefail
: "${MC_ALIAS_SRC:?}" "${MC_ALIAS_DST:?}" "${BUCKET:?}"
command -v mc >/dev/null || { echo "mc (MinIO client) not installed" >&2; exit 2; }
mc mirror --preserve --overwrite "$MC_ALIAS_SRC/$BUCKET" "$MC_ALIAS_DST/$BUCKET-backup-$(date -u +%Y%m%d)"
mc diff "$MC_ALIAS_SRC/$BUCKET" "$MC_ALIAS_DST/$BUCKET-backup-$(date -u +%Y%m%d)" && echo "object backup verified: no differences"
