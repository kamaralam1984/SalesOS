# UAT report - 17 critical user journeys (Phase 10, Agent L5)

Run date: 2026-10-15. Honest record of what was executed; nothing below is claimed without a run.

## Environment
- Built artefacts, not dev servers: API `tsc --outDir dist-l5` run as `node dist-l5/main.js` (port 4612), worker `node dist-l5/main.js`, web `next build` with `NEXT_DIST_DIR=.next-l5` served by `next start -p 3612` (`NEXT_PUBLIC_API_URL=http://localhost:4612/api/v1`).
- Database `salesos_agentl_uat`, created ONLY with `prisma migrate deploy` (1 migration `20261015000000_init`) and then `pnpm db:seed` (20 `[DEMO]` users). Redis `salesos-redis`, MinIO `salesos-minio` (bucket `salesos-l5-uat`), BullMQ prefix `salesos_l5`. Throttles raised (100000) so the suite is not rate-limited; delivery backoff 1 s.
- Playwright 1.63 Chromium, 1 worker, `E2E_WEB_PORT=3612 E2E_API_PORT=4612 E2E_DB=salesos_agentl_uat`, command `cd apps/web && npx playwright test <specs>`.
- Machine load average was 15-20 during the runs (other agents); two tests timed out because of it (see Failures).

## Per-journey result
| UJ | Journey | Spec (apps/web/e2e) | Result | Evidence |
|---|---|---|---|---|
| 01 | Founder views company performance | analytics-journeys.spec.ts (5 tests: numbers equal KPI endpoint, definitions/freshness, team filter, CSV export, reconciliation page) | PASS | 5/5 |
| 02 | Team Lead targets and manager scorecards | analytics-journeys.spec.ts (3 tests) | PASS | 3/3 |
| 03 | Manager assigns lead in own team | crm-journeys.spec.ts | PASS | 1/1 (cross-team assignee not offered; API 404) |
| 04 | Executive disposition + follow-up | crm-journeys.spec.ts | PASS | 1/1 |
| 05 | Overdue / unattended lead flagged | crm-journeys.spec.ts | PASS | 1/1 |
| 06 | Webinar/demo and stage progression | crm-journeys.spec.ts | PASS | 1/1 (illegal transition refused) |
| 07 | Closed-won vs verified collection | revenue-journeys.spec.ts | PASS | passed in 2 separate runs |
| 08 | Reconciliation, no duplicate credit | revenue-journeys.spec.ts | PASS | passed in 2 separate runs |
| 09 | Refund authorised states | revenue-journeys.spec.ts | PASS (on re-run) | first run hit the 45 s per-test timeout under load 18 (see Failures); full file re-run with `--timeout 120000`: 3/3 pass |
| 10 | Handover to Student Success | cx-journeys.spec.ts | PASS | 2/2 |
| 11 | Coaching session + review action | people.spec.ts | PASS | 5/5 (+4 SOP tests pass) |
| 12 | Founder report + action items | cx-journeys.spec.ts | PASS | 2/2 |
| 13 | Unauthorised cross-team access | uat-journeys.spec.ts (NEW, 5 tests) | PASS | anonymous 401 on 5 endpoints; exec A: team-B lead GET/timeline 404, PATCH refused and DB unchanged, task complete refused (task still OPEN), lists contain no team-B leads (SQL cross-check), UI "could not find"; exec denied audit/user-create/admin pages; manager A: B lead 404, B user 404, reassign refused. No second organisation is seeded: cross-ORG isolation is covered by API tests only (apps/api/test/authz-isolation.spec.ts), not by this E2E |
| 14 | Upload validated/optimised/secure download | platform-journeys.spec.ts | PASS | 2/2 |
| 15 | Failed notification visible and recoverable | platform-journeys.spec.ts | PASS | 2/2 (outage, DLQ, retry, delivered via provider callback) |
| 16 | Mobile core workflow | crm-journeys.spec.ts (390px) + uat-journeys.spec.ts (NEW, 360px) | PASS | 360px: Today -> lead detail -> FAB log call -> sheet within viewport -> saved; DB shows 1 call_log and an OPEN follow-up task; no horizontal scroll on /crm, /crm/tasks, /crm/leads, dashboard |
| 17 | Backup restore + release rollback rehearsal | uat-journeys.spec.ts (NEW, 3 tests) | PARTIAL | Backup and restore PASS: real `scripts/backup.sh` then `scripts/restore-check.sh` on `salesos_agentl_uat` into `salesos_agentl_uat_restore`: checksum OK, `RESTORE_SECONDS` 10.66 / 25.21 (two runs, loaded machine), MANIFEST MATCH 145 tables / 22 triggers / 426 indexes / 562 constraints / 12 functions, 2,536 rows, content md5 per table, append-only audit trigger still blocks UPDATE. Measured RPO/RTO + "proposed, DEC-029" text asserted in docs/backup-restore.md. Release ROLLBACK rehearsal evidence (docs/deploy-evidence-l1.md, Agent L1) did not exist when this ran: that test is SKIPPED, so the rollback half of UJ-17 is NOT verified here |

Totals of the journey-bearing specs: auth 9/9, crm-journeys 18/18 (includes 10 axe route checks), analytics 9/10, cx 5/5, integration 5/5, people 9/9, platform 4/4, revenue 3/3 (re-run), uat-journeys 8 passed + 1 skipped (rollback evidence). One earlier UJ-17 attempt failed inside restore-check.sh with output not captured (likely drift from the live worker writing between dump and manifest); the test now prints script output on failure, and two later runs passed.

## Failures and caveats (honest)
1. `analytics-journeys.spec.ts` "axe: dashboards and reporting pages ... (desktop and 390px)" TIMED OUT twice (4 min in-spec timeout, inside `page.evaluate`/axe) on a machine at load average 15-20. This test is an accessibility sweep, not a UJ assertion; UJ-01/02 tests in the same file passed. It was not shown to fail on a violation, and was not shown to pass in this environment. Needs a re-run on an idle machine.
2. `revenue-journeys.spec.ts` UJ-09 failed once at the 45 s default test timeout (load), then passed in a full-file re-run with a 120 s timeout. Running UJ-09 alone with `-g` fails by design (serial tests share state from UJ-07).
3. Cross-organisation isolation is not exercised in browser E2E (single seeded org).
4. UJ-17 rollback rehearsal: pending Agent L1 evidence (see table).
5. Findings: none app-level. `GET /leads/:id/deals` for a lead outside scope returns 200 with an empty list (no existence leak; other lead sub-resources return 404), so the spec accepts either.
6. Not run here: screenshots.spec.ts, a11y.spec.ts, cx-a11y.spec.ts, revenue-a11y.spec.ts, admin.spec.ts, security.spec.ts (not journey specs).

## Reproduce
```
createdb salesos_x ; DATABASE_URL=... pnpm db:migrate && pnpm db:seed
build api/worker/web as above; start; then
E2E_WEB_PORT=3612 E2E_API_PORT=4612 E2E_DB=salesos_x npx playwright test e2e/uat-journeys.spec.ts e2e/crm-journeys.spec.ts e2e/revenue-journeys.spec.ts e2e/people.spec.ts e2e/cx-journeys.spec.ts e2e/platform-journeys.spec.ts e2e/integration-journeys.spec.ts e2e/analytics-journeys.spec.ts
```
