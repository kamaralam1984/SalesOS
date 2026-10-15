# Release rollback rehearsal (UJ-17, rollback half) - 2026-10-15

Environment: throw-away databases `salesos_audit_rb` and `salesos_audit_rb_restore` on the shared dev Postgres container. No staging or other service was touched. Scale: tiny database (145 tables, 844 rows), so this proves the procedure and correctness, NOT production timings.

Scenario: previous release = migrations `20261015000000_init` + `20261015140000_security_hardening`; new release adds `20261015170000_department_learner_rank` (expand-only: nullable/defaulted columns).

| Step | Command | Result |
|---|---|---|
| 1 Previous release | `prisma migrate deploy` with the two earlier migrations | applied, 47.8 s (cold database) |
| 2 Backup before release | `DB=salesos_audit_rb scripts/backup.sh` | dump 587,025 bytes, sha256 recorded, manifest 145 tables, dump 0.64 s |
| 3 New release | `prisma migrate deploy --schema prisma/schema` | new migration applied, 3.06 s |
| 4 Expand-only check | `information_schema.columns` | `users.department`, `leads.learner_earned_revenue`, `leads.learner_earned_at` nullable; `improvement_plans.proposed_by_manager` NOT NULL DEFAULT false. A previous-release app does not write these columns, so it keeps working against the new shape |
| 5 Existing data | row counts after migrate | unchanged (programs 6) |
| 6 Rollback | `TARGET_DB=salesos_audit_rb_restore scripts/restore-check.sh <dump>` | checksum OK; restore 52.45 s; MANIFEST MATCH (145 tables, 27 triggers, 426 indexes, 562 constraints, 13 functions); RESTORE CHECK PASSED; restored DB has no `users.department` column = previous-release shape confirmed |

Observed side finding: running the NEW code (bootstrap) against the OLD schema fails with "The column `users.department` does not exist". So the order must be migrate first, then start the new app; rolling back the app alone onto a migrated database is safe (expand-only), rolling the database back needs the restore above and the previous app image.

Not done / limits: audit_logs was empty in the rehearsal DB so the append-only probe was not meaningful (covered by the manifest and by the UAT drill); the app-image switch itself (nginx/pm2 upstream) was not rehearsed here; timings are for a tiny database. Rerun on staging with a production-sized dump before the first release.
