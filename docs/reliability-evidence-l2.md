# Reliability evidence (Agent L2, Phase 10 task 2)

Date: 2026-10-15. Every result below comes from a command that was run in this session; counts are copied from the runner output. Environment: shared dev machine, Postgres 16 (`salesos-postgres`) + Redis 7 (`salesos-redis`), databases `salesos_agentl_rel` (seeded, drill source), `salesos_agentl_restore`, `salesos_agentl_test`, `salesos_agentl_wtest`. Nothing outside those databases and the `salesos-*` infra was touched; dependency-outage tests use an in-process TCP forwarder, never stop shared services.

## What was added
| Area | Files |
|---|---|
| Backup / restore | `scripts/backup.sh`, `scripts/restore-check.sh`, `scripts/lib-db.sh`, `scripts/backup-objects.sh` (not run) |
| Health / readiness | `apps/api/src/common/health/health.controller.ts` (uses `OpsProbeService`; adds worker heartbeat info), `apps/worker/src/health.ts` (heartbeat + optional HTTP `/health`,`/ready` via `WORKER_HEALTH_PORT`) |
| Metrics | `apps/api/src/common/observability/{metrics.service,metrics.controller,ops-probe.service,observability.module}.ts`, `GET /metrics`, env `METRICS_TOKEN` |
| Error hook | `common/observability/error-reporter.ts` (API) and `apps/worker/src/error-reporter.ts` (copy), env `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `RELEASE`; wired in `AllExceptionsFilter` (5xx), unhandled rejections, exhausted worker jobs |
| Shutdown | `apps/api/src/main.ts` (SIGTERM/SIGINT -> `app.close()` -> exit 0, watchdog `SHUTDOWN_GRACE_MS` 25 s), `apps/worker/src/main.ts` (drain + watchdog `WORKER_SHUTDOWN_GRACE_MS`) |
| Worker recovery tuning | `WORKER_LOCK_DURATION_MS` (lock + stall check interval, default 30 s as BullMQ), `WORKER_HEARTBEAT_MS` |
| Docs | `docs/monitoring.md`, `docs/backup-restore.md` (drill results, proposed targets), this file |
| Tests | `apps/api/test/reliability.spec.ts`, `apps/api/test/error-reporter.spec.ts`, `apps/api/test-proc/api-process.spec.ts`, `apps/worker/test-proc/worker-recovery.spec.ts` (+ `fixture-worker.cjs`) |

`pnpm --filter @salesos/api test:proc` and `pnpm --filter @salesos/worker test:proc` build to a temporary `dist-l2`, spawn real processes, and delete `dist-l2` afterwards. They are separate from the default `test` scripts (they need ~1-2 min and fork processes).

## Backup and restore rehearsal (scripts run for real)
See docs/backup-restore.md "Drill results": dump 1.46 s / 642 KB, `pg_restore` 7.77 s (RTO of the DB step), manifest MATCH on 145 tables (1,530 rows, content md5 per table), 22 triggers, 426 indexes, 562 constraints, 12 functions; audit append-only trigger still blocks UPDATE; `prisma migrate status` up to date. Negative control: a dropped trigger and an edited row in the copy were reported by the manifest diff. Demo-sized data only; production-scale RTO is NOT measured.

## Automated tests
| Test | Result |
|---|---|
| `apps/api/test/reliability.spec.ts` (7 tests): all-green ready; Redis outage (login, `/auth/me`, `/dashboard/ceo` keep working, `/ready` 503 naming redis, limiter fails open, auto-recovery); DB outage (`/health` 200, `/ready` 503 naming database, data call fails with envelope in < 15 s, auto-recovery incl. new login); request-id generation/echo/rejection of malformed ids/in error envelope; `/metrics` content; `/metrics` token 401/200, prod-without-token 404, non-loopback 404 | 7 passed |
| `apps/api/test/error-reporter.spec.ts` (3): no-op without DSN, DSN parsing + payload content, transport failure never throws | 3 passed |
| `apps/api/test-proc/api-process.spec.ts` (3) real compiled API process: JSON log line has `service`, `level`, `time`, `req.id`, `res.statusCode`, `responseTime`; Authorization/cookie values and query strings never appear in logs; SIGTERM with an unfinished in-flight request: new connections refused, the request is answered, exit code 0 | 3 passed |
| `apps/worker/test-proc/worker-recovery.spec.ts` (5) real worker processes: (1) kill -9 while the handler is running -> second worker recovers the stalled job after the lock expires, exactly 1 notification and 1 CRM ledger row; (2) kill -9 after the handler committed but before ack -> redelivered, still exactly 1 notification (idempotent dedupe key); (3) events written while no worker runs are processed on start; (4) heartbeat key has TTL and disappears after kill -9; (5) SIGTERM mid-job: job finishes, process exits 0, not re-run | 5 passed |
| Lint (`eslint`) on changed api/worker sources and tests | clean |
| `tsc --noEmit` api and worker | clean |
