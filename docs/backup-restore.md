# Backup and Restore (Phase 10: scripts written and a restore drill executed; see section "Drill results")

Date: 2026-10-14. Targets are PROPOSED (DEC-029) and are not guarantees: RPO <= 24 h (daily), improving to <= 15 min with WAL archiving/PITR if a managed DB is chosen; RTO <= 4 h. The owner must agree. A backup that has not been restored in a drill is not counted as a backup.

## Scope
| Asset | Method | Frequency | Retention (proposed) |
|---|---|---|---|
| PostgreSQL | `pg_dump -Fc` (logical) of the `salesos` database; optional WAL archiving/PITR | daily 02:30 IST (+ before every migration) | 14 daily, 8 weekly, 6 monthly |
| Object storage | bucket versioning + replication or `mc mirror` to separate location | daily | follow file retention |
| Redis | AOF enabled; Redis is a transport (PostgreSQL is truth, ADR-003) - not backed up as source of truth | n/a | n/a |
| Config/env | secrets manager export (encrypted) + infra files in repo | on change | keep last 10 |

## Rules
- Dumps are encrypted at rest (age/gpg) and stored off the application host; access least-privilege.
- Never run restores against production data without explicit owner approval; drills restore into a throwaway DB (`salesos_restore_test`) / throwaway containers named `salesos-*` only.
- On the shared dev machine: do not touch other projects' databases or volumes.

## Backup procedure (example, adapt to final hosting)
```
pg_dump -Fc -h <host> -p <port> -U <backup_role> salesos -f salesos_$(date -u +%Y%m%dT%H%M%SZ).dump
sha256sum salesos_*.dump > salesos_*.dump.sha256
# encrypt + upload; record in backup log
```

## Restore procedure (drill)
1. Create empty database `salesos_restore_test`.
2. `pg_restore -d salesos_restore_test --no-owner --clean --if-exists <dump>`.
3. Run `prisma migrate status` against it; run smoke SQL: row counts for key tables, latest audit_log timestamp, sum of payments equals sum recorded in last backup report.
4. Start api against it on an isolated port; run smoke tests + one login + KPI reconciliation check (KPI-PRO-002).
5. Restore object storage sample; verify checksums of 20 random files.
6. Record: dump timestamp, restore duration (measured RTO), data-loss window (measured RPO), issues. Store in docs/backup-restore-log.md (created at first drill).

## Disaster scenarios
Accidental delete (restore to side DB, copy back rows); bad migration (rollback plan in runbook); host loss (rebuild from IaC + restore); ransomware (offline/immutable copy).

## Test schedule
Drill before first production release (UJ-17), then quarterly. Failures are known-issues entries.


## Database migrations: deploy, re-run, rollback and restore (integration pass)

**What exists.** One consolidated initial migration `prisma/schema/migrations/20261015000000_init/migration.sql` = Prisma DDL for the whole schema + the database guards (`prisma/sql/*.sql`: audit append-only, immutable founder-report snapshots, immutable SOP versions, revenue immutability triggers, partial unique indexes, analytics indexes), all idempotent. (With a multi-file schema folder Prisma keeps the migrations directory inside the schema folder.) Regenerate before the first production deploy with `pnpm db:guards:export && pnpm db:migration:build`; afterwards add incremental migrations only.

**Apply.** `pnpm db:migrate` (= `prisma migrate deploy --schema prisma/schema`). It applies only what is pending, so running it again (every deploy, every container start) is a no-op. `pnpm migration-check` proves, on a throwaway database `salesos_migcheck_<random>`: deploy on an empty database, second run is a no-op, `migrate status` is up to date, no schema drift against `prisma/schema` (only the known guard indexes Prisma cannot model), every trigger exists and the audit trigger and the FKs really refuse bad writes. CI runs it on every push and also builds the api/worker test databases ONLY from the migrations (`TEST_DB_MODE=migrate`).

**A database that was created earlier with `db push`** (development databases) must be baselined once, never re-initialised: `prisma migrate resolve --applied 20261015000000_init --schema prisma/schema`, then check with `pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema --exit-code`. Older `db push` databases do not have the FK constraints: run the diff and apply the printed statements after cleaning orphan rows (`SELECT ... WHERE user_id NOT IN (SELECT id FROM users)`).

**Rollback approach (no automatic down-migrations).**
1. Before every production migration take `pg_dump -Fc` (the "before every migration" backup above) and record its checksum.
2. Migrations are written expand/contract: add nullable columns/tables first, deploy code that can work with both shapes, backfill, and only in a later release add constraints or drop old columns. A failed migration runs in one transaction per file, so a failed statement leaves nothing half applied; fix the SQL and re-run `migrate deploy` (a migration recorded as failed is cleared with `prisma migrate resolve --rolled-back <name>` after the cause is understood).
3. If a deployed migration must be reverted: prefer a forward fix migration. If data was damaged, restore the pre-migration dump into a side database (`salesos_restore_test`), compare, and copy rows back; for a full revert restore the dump over a stopped application and redeploy the previous image (the previous release still matches the restored shape).
4. The guards are idempotent SQL: they can be re-applied to any database at any time (`psql -f prisma/sql/<file>.sql`), and the API re-applies them at boot, so restoring a dump from before a guard existed heals itself on first boot.
5. Never run `migrate reset` or `db push --force-reset` against a database that holds anything but throwaway data.

**Restore drill addition.** After `pg_restore`, run `pnpm migration-check` against the same server (it does not touch the restored database) and `prisma migrate status` against the restored database; the restored database must report all migrations applied.


## Scripts (Phase 10)
- `scripts/backup.sh` - `pg_dump -Fc` (via `docker exec` into `salesos-postgres` by default; `MODE=local` for a real host), writes `<db>_<UTC stamp>.dump`, `.sha256`, and `.manifest` (per-table row count + content md5, triggers, indexes, constraints, functions, extensions, enums), optional `age` encryption (`AGE_RECIPIENT`), prunes to `KEEP_DAILY` (default 14). Read-only on the source DB.
- `scripts/restore-check.sh <dump>` - verifies the checksum, restores into a throwaway DB (`TARGET_DB`, must end in `_restore`/`_restore_test`; default `salesos_agentl_restore`), compares the restored database with the backup-time manifest (exit 1 on any difference), probes that the append-only audit trigger still blocks UPDATE, optionally runs `prisma migrate status` (`PRISMA_STATUS=1 TARGET_URL=...`), and prints `RESTORE_SECONDS`.
- `scripts/backup-objects.sh` - object storage mirror with the MinIO client (`mc`); NOT executed in this environment (no `mc`, no second storage target available).

## Drill results (measured 2026-10-15, dev machine, shared Postgres 16 container, otherwise idle apart from other agents)
Source: `salesos_agentl_rel` = migrate deploy + demo seed ([DEMO] data only). This is a SMALL database: it proves the procedure and correctness, not production-scale timings.

| Measure | Result |
|---|---|
| Database size / dump size | 145 tables, 1,530 rows; dump 642,037 bytes |
| Backup duration (dump) | 1.46 s (manifest 0.95 s) |
| Restore duration (`pg_restore` into empty DB) = measured RTO of the database step | 7.77 s |
| Integrity | sha256 OK; manifest MATCH: 145 tables with identical row counts and content md5, 22 triggers, 426 indexes, 562 constraints, 12 functions, extensions and enums identical |
| Behaviour after restore | `UPDATE audit_logs` still refused by the append-only trigger; `prisma migrate status`: "Database schema is up to date" |
| Detection works | negative check: dropping a trigger and editing a row in the restored copy made the manifest diff report both |

Measured RPO: a logical dump is a point-in-time snapshot taken at dump start; data written afterwards is lost on restore. With the proposed daily schedule the worst-case loss window is therefore the time since the last completed dump (<= 24 h plus the 1.5 s dump time here). The drill does not measure WAL/PITR (not configured), so no sub-daily RPO is claimed.

Estimating production RTO (NOT measured): restore time grows roughly linearly with data size and index count; re-measure at the 50k-lead volume before relying on the 4 h figure. The full RTO also includes provisioning a host, restoring object storage, deploying the release and DNS/TLS, which this drill did not time.

### Proposed targets awaiting owner decision DEC-029
RPO <= 24 h (daily dump, 14 daily / 8 weekly / 6 monthly, off-host encrypted copy), improving to <= 15 min only if WAL archiving/PITR on a managed DB is chosen; RTO <= 4 h. These are PROPOSED, not guarantees, and remain "default - awaiting owner approval" until the Founder/Ops owner approves DEC-029. Measured numbers above are well inside the proposed targets for the demo-sized database only.

### Object storage (MinIO / S3 / R2) backup note
Files are private objects (docs/file-storage-policy.md); the database stores metadata and keys, so DB restore without objects leaves dangling file records and the reverse leaves orphans. Back up both within the same window: enable bucket versioning and mirror to a second location/account (`scripts/backup-objects.sh`, or provider-native replication). Restore drill: mirror back to a scratch bucket, then compare `mc diff` and sha256 of a random 20-file sample against `files.checksum` rows. Not yet rehearsed here (no mirror target) - tracked in docs/known-issues.md / traceability as untested.

### Redis
Not a source of truth (ADR-003): the outbox is in PostgreSQL. Losing Redis loses only queued BullMQ jobs and cache; pending outbox rows are re-relayed (idempotent job ids). Proven by `apps/worker/test-proc/worker-recovery.spec.ts`.

### Job recovery after worker crash
See docs/reliability-evidence-l2.md: a worker killed with SIGKILL mid-job is replaced by a second worker which completes the job after the lock expires (`WORKER_LOCK_DURATION_MS`, default 30 s), with exactly one notification.
