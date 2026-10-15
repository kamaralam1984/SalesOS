# Deployment Runbook (draft, Phase 0; rehearsed in Phase 10)

Date: 2026-10-14. Hosting target undecided (DEC-040). This runbook assumes the worst case: a **shared VPS** hosting unrelated sites.

## 0. Golden rules
1. Never restart, stop, reconfigure or overwrite anything not named `salesos-*`. Never run global `nginx -s reload` without validating config (`nginx -t`) and confirming it only adds a new server block file; prefer adding one file `/etc/nginx/conf.d/salesos.conf` (or sites-available/salesos) and reloading only after `nginx -t` passes.
2. Inventory first, change second, back up before touching.
3. Staging before production; reversible release; rollback rehearsed.
4. No destructive DB operation without a verified backup and owner approval; never `migrate reset` on shared data.
5. Secrets only via env/secret store; never commit.

## 1. Pre-deployment inventory (shared VPS) - record in docs/deployment-inventory.md (private)
```
ss -tulpn                      # listening ports
docker ps -a ; docker network ls ; docker volume ls
pm2 list ; systemctl list-units --type=service --state=running
nginx -T                       # read-only dump of full config (save copy)
crontab -l ; ls /etc/cron.d
df -h ; free -m ; nproc
```
Record: domains, reverse-proxy routes, ports in use, PM2/systemd names, DBs and connection strings (names only), env var names, TLS certs and expiry, disk/CPU headroom. Choose ports not in use (dev reference: web 3100, api 4100, Postgres 5533, Redis 6391, MinIO 9100/9101). Back up configs: `cp -a /etc/nginx /root/backup-nginx-<date>`; `pm2 save` copy; `pg_dumpall` only for DBs that SalesOS owns.

## 2. Naming and isolation
Service/container/unit names `salesos-web`, `salesos-api`, `salesos-worker`, `salesos-postgres`, `salesos-redis`; deploy dir `/srv/salesos/<release>`; own Linux user; own DB role with least privilege (separate roles for migrations vs runtime vs backups); separate Redis DB/instance; systemd units or compose project `salesos`; firewall only exposes 443 via the existing proxy.

## 3. Environments
| Env | Purpose | Data |
|---|---|---|
| dev (docker compose, this machine) | development | [DEMO] seed only |
| staging | UAT, smoke, role journeys, rollback rehearsal | anonymised/[DEMO] |
| prod | live | real |
Config per env through environment variables validated at startup (fail fast); `.env.example` placeholders only.

## 4. Release procedure
1. Tag release candidate; CI green (lint, typecheck, tests, build, audit, secret scan).
2. Staging: backup DB -> apply migrations (`prisma migrate deploy`) -> deploy images/builds to a new release dir -> health/readiness -> smoke tests -> role-based journeys UJ-01..17 subset -> sign-off.
3. Production window: announce; `pg_dump` + checksum; confirm restore command ready.
4. Deploy: migrations that are backward compatible first (expand/contract); start new `salesos-api`/`worker` alongside; switch proxy upstream for SalesOS server block only; watch logs/metrics 15 min.
5. Verify: `/ready`, login, create lead, follow-up reminder fires, KPI reconciliation check.
6. Record in CHANGELOG with known defects.

## 5. Rollback
- App: switch upstream symlink/`current` back to previous release dir; restart only `salesos-*` units.
- DB: migrations written expand/contract so previous app version still works; destructive steps deferred to a later release. If a migration must be reverted: restore from pre-release dump into a side DB, verify, then swap with owner approval (downtime).
- Worker: drain (graceful shutdown) before switching; outbox retains pending events.
- Rehearse rollback on staging before first prod release (UJ-17); record timings.

## 6. Health, monitoring, alerts
`/health` liveness, `/ready` (DB, Redis, storage), structured JSON logs with request IDs, error monitoring hook, alerts: API 5xx rate, p95 latency, outbox lag > 2 min, DLQ size > 0, queue depth, worker down, disk > 80%, backup failure, cert expiry < 14 days.

## 7. Worker restarts
`systemctl restart salesos-worker` (or compose service) is safe by design (ADR-003); verify no duplicate reminders afterwards.

## 8. TLS and headers
Terminate TLS at the existing/own proxy; HSTS; verify CSP/headers on staging; do not change global TLS settings.

## 9. Checklist before go-live
Backups configured + restore drill done; RPO/RTO agreed; runbook reviewed; on-call contact; secrets rotated from staging; admin account bootstrap via one-time script (no default password); demo data absent in prod.

<!-- L1-BEGIN: container artefacts, staging stack and expand/contract policy (Agent L1) -->
## L1. Container artefacts, staging stack, migrations policy

### L1.1 Artefacts (all in the repo; nothing here touches a real server)
| Artefact | Path |
|---|---|
| API / worker / web / tools images | `deploy/docker/{api,worker,web,tools}.Dockerfile` (build context = repo root; base `node:24.11.1-slim`, non-root uid 10001, tini, HEALTHCHECK) |
| Compose (staging, self-contained infra) | `docker-compose.staging.yml` + `.env.staging.example` |
| Compose (production, external DB/Redis/S3) | `docker-compose.prod.yml` + `.env.production.example` |
| Reverse proxy example | `deploy/nginx/salesos.conf.example` (TLS, headers, gzip, rate limits, SSE with `proxy_buffering off`) |
| systemd / PM2 alternatives | `deploy/systemd/salesos-{api,worker,web}.service`, `deploy/pm2/ecosystem.config.cjs` (always name apps; never `pm2 restart all`) |
| Read-only VPS inventory | `scripts/vps-inventory.sh` (run on the target host only; changes nothing) |
| Smoke | `scripts/smoke-staging.mjs` (role-based API journeys) + Playwright `e2e/auth.spec.ts` with `E2E_BASE_URL` |

Build: `docker build -f deploy/docker/api.Dockerfile -t salesos-api:<ver> .` (same for worker/tools). Web: add `--build-arg NEXT_PUBLIC_API_URL=https://<public-origin>/api/v1` (inlined at build time: one web image per public API origin). Migrations/seed run from the `tools` image: `migrate | status | resolve | seed` (`seed` needs `ALLOW_DEMO_SEED=yes` and is for staging only; the demo seed refuses NODE_ENV=production).

### L1.2 Shared-VPS checklist (before the first deploy)
- [ ] Run `scripts/vps-inventory.sh 3100 4100 4200` on the host; save output privately; confirm chosen ports are free.
- [ ] `cp -a /etc/nginx /root/backup-nginx-$(date +%F)`; add ONE new file for SalesOS; `nginx -t` then `nginx -s reload` (never restart).
- [ ] Use only `salesos-*` names; compose project `salesos`; bind app ports to 127.0.0.1.
- [ ] Never run `docker system prune`, `pm2 restart all`, `systemctl restart nginx` or anything unnamed.
- [ ] Verified backup before every migration; DB roles split (runtime vs migrator).

### L1.3 Expand/contract migration policy (rollback-safe releases)
A release N+1 must remain runnable by release N's code against the migrated schema, so the app can be rolled back without a DB restore.
1. **Expand** (release N+1): additive only: new tables, new nullable columns or columns with defaults, new indexes (`CREATE INDEX CONCURRENTLY` for big tables), new enum values. App N+1 writes both old and new shapes if needed.
2. **Migrate/backfill** in the background (idempotent batches), verify.
3. **Contract** (release N+2, at least one release later, after N+1 is proven): drop old columns/tables, add NOT NULL / tighten constraints, remove dual-writes.
4. Forbidden in one step: rename/drop column or table, change a column type, add NOT NULL without default, drop an enum value. Do these as expand -> backfill -> contract.
5. Rollback = redeploy image N (compose: set `RELEASE=N`, `up -d`); the DB stays at N+1 (additive). Restore from backup only if data was corrupted. Rehearsed: `docs/deploy-evidence-l1.md`.
6. Each migration is reviewed against this list in the PR; `pnpm migration-check` must pass; migrations are never edited after being applied anywhere.
<!-- L1-END -->
