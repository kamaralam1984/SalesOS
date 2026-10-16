#!/usr/bin/env bash
# Run ON THE SERVER once: writes /srv/salesos/.env.infra and .env.production (chmod 600) with freshly generated secrets.
# Never prints a secret. Refuses to overwrite existing files. Usage: gen-env.sh <domain> <release> <minio-image>
set -euo pipefail
domain="${1:?domain}"; release="${2:?release}"; minio_image="${3:?minio image}"
cd /srv/salesos
[ -e .env.infra ] || [ -e .env.production ] && { echo "refusing: .env.infra or .env.production already exists" >&2; exit 1; }
umask 077
hex() { openssl rand -hex "${1:-24}"; }
pg_admin_pw="$(hex)"; migrator_pw="$(hex)"; app_pw="$(hex)"; redis_pw="$(hex)"; minio_user="s3$(hex 6)"; minio_pw="$(hex 24)"
session="$(openssl rand -base64 48 | tr -d '\n')"; enc="$(openssl rand -base64 32 | tr -d '\n')"
cat > .env.infra <<ENV
RELEASE=${release}
MINIO_IMAGE=${minio_image}
PG_ADMIN_USER=pgadmin_$(hex 3)
PG_ADMIN_PASSWORD=${pg_admin_pw}
PG_MIGRATOR_PASSWORD=${migrator_pw}
PG_APP_PASSWORD=${app_pw}
REDIS_PASSWORD=${redis_pw}
MINIO_ROOT_USER=${minio_user}
MINIO_ROOT_PASSWORD=${minio_pw}
MIGRATE_DATABASE_URL=postgresql://salesos_migrator:${migrator_pw}@postgres:5432/salesos?schema=public
ENV
cat > .env.production <<ENV
COMPOSE_PROJECT_NAME=salesos
RELEASE=${release}
DATABASE_URL=postgresql://salesos_app:${app_pw}@postgres:5432/salesos?schema=public
REDIS_URL=redis://:${redis_pw}@redis:6379
BULLMQ_PREFIX=salesos
S3_ENDPOINT=http://minio:9000
S3_REGION=ap-south-1
S3_BUCKET=salesos-prod-private
S3_ACCESS_KEY=${minio_user}
S3_SECRET_KEY=${minio_pw}
LOG_LEVEL=info
SESSION_SECRET=${session}
PLATFORM_ENCRYPTION_KEY=${enc}
CORS_ORIGINS=https://${domain}
APP_BASE_URL=https://${domain}
TRUST_PROXY=true
THROTTLE_STORAGE=redis
ENABLE_DOCS=false
ENV
chmod 600 .env.infra .env.production
echo "wrote /srv/salesos/.env.infra and .env.production (600). No secret was printed."
