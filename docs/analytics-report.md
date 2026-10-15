# Phase 5 report: dashboards, KPIs, reports, exports (Agent I)

Date 2026-10-15. Scope: `prisma/schema/analytics.prisma`, `apps/api/src/modules/reporting/**`, `apps/worker/src/jobs/analytics/**`, `apps/api/src/seed/domains/analytics.ts`, `packages/validation/src/reporting.ts`, web `(app)/dashboard/*` (role dashboards), `(app)/reporting/**`, `features/{dashboard,reporting}`, `lib/api/hooks/analytics.ts`, `nav/reporting.ts`, tests under `apps/api/test/analytics`, `apps/worker/test/analytics.spec.ts`, `apps/web/src/features/dashboard/*.test.*`, `apps/web/e2e/analytics-journeys.spec.ts`, `apps/api/perf`.
Verification (real runs) is in section 11. KPI definitions: `docs/kpi-dictionary.md` (generated from the registry, all formulas still "proposed default - awaiting owner approval").

## 1. Architecture in one picture

```
 dashboards  reports  exports  Founder report builder (REPORT_DATA_PROVIDER)  reconciliation  scheduler
      \         |        |                  |                                       |
       +--------+--------+------------------+---------------------------------------+
                         KpiService  (kpi/kpi.service.ts)  <- ONE role-scoped query layer
                  ScopeService (kpi:view scope  narrowed by the KPI's domain permission, then filters INTERSECTED)
                  registry (38 typed KPI definitions: defs/{revenue,crm,people,cx}.ts)  + KpiCache (Redis, scope-fingerprint keys)
                         |                                   |
        revenue/calc (pure money maths, reused)      SQL on base tables (crm, tasks, calls, people, cx)
```

Nothing in a dashboard, report or export computes its own number: panels that are not KPIs (pipeline, trends, exception grid, people status) use the same scope predicates (`kpi/sql.ts`) and reconcile in `GET /reports/reconciliation`.

## 2. KPI engine contract

`KpiService.run(user, id, query)` returns a `KpiResult`: `value`, `numerator`, `denominator` (decimal strings, rounded per the definition), `unit`, `currency`, `dateRange` (IST business dates) + `period`, `filters {applied, ignored, scopeLevel, narrowedByFilter}`, `definition {id, summary, formula, zeroDenominator, approvalStatus}`, `breakdown`, `caution`, `dataSource` (calls), `isEstimate`, `computedAt`, `freshness {kind LIVE|CACHED, ageSeconds, cadence}`, `status` (OK / NO_DATA / FORBIDDEN / RESTRICTED / ERROR) and `nullReason`.

- **Zero denominator** returns `value: null` + `nullReason`; the UI renders an em dash and the reason. Tested with an empty organisation (all 38 KPIs, no NaN/Infinity anywhere) and per KPI.
- **Call attempts vs unique clients** are separate KPIs (PRD-006, PRD-008) and both appear in PRD-001's breakdown; the data source mix (MANUAL / PROVIDER / DEVICE) is shown on every call KPI.
- **Scope**: `scope = narrower(scope(kpi:view), scope(KPI.requires))`; own = [self], team = `AccessService.visibleUsers`, org = all, summary = org aggregates without per-person breakdown. Filters (team, program, source, owner) are intersected: a team/owner outside the scope gives an empty user set (zero data, never wider). Lead visibility mirrors `AccessService.scopedWhere` (owner in scope OR in a led team).
- **Window**: `from`/`to` (inclusive IST dates) or `period` (WEEK/MONTH/QUARTER/YEAR) + `to`/`asOf`. Target KPIs use the target period containing `to` and measure period start .. min(asOf, period end). Ranges are capped at 800 days. Unknown or malformed query parameters are rejected (`strict` Zod).
- **Organisation overrides** live in `platform_settings` key `kpi` (conversion window, attribution window, stale/compliance thresholds, SOP new-joiner grace, demo exclusion, minimum samples). Defaults are in the dictionary.
- **Registry** (`kpi/registry.ts`): 38 KPIs = the 33 dictionary KPIs (28 JD + 5 Blueprint exception metrics) + KPI-REV-004 (enrolment achievement), KPI-SAL-006 (weekly forecast), KPI-PRD-006/007/008 (call attempts / connected calls / unique clients). Each definition carries id, name, definition, numerator, denominator, window, exclusions, source tables, rounding, owner, refresh, zero-denominator rule, formula, exact implementation text, decisions, required permission, minimum scope and supported filters. `docs/kpi-dictionary.md` is rendered from it; `test/analytics/dictionary-doc.spec.ts` fails if they diverge.
- **Domain permission per KPI** (`REQUIRES` map in the registry): targets:view, collections:view, leads:view, events:view, deals:view, forecasts:view, calls:view, tasks:view, satisfaction:view, refunds:view, complaints:view, action-items:view, founder-reports:view, sop:adoption:view, coaching:view, engagement:view. A viewer without it gets a FORBIDDEN tile (403 on the single-KPI endpoint). HR-grade aggregates (attrition, engagement, dashboard accuracy, reporting quality/timeliness) are `minScope: org`: managers/executives get RESTRICTED, HR (summary) and Founder/Team Lead see the aggregate only.

## 3. Endpoints (all `/api/v1`; see docs/api-catalogue.md for the table)

| Area | Routes | Notes |
|---|---|---|
| Dashboards | `GET /dashboard/ceo | team-lead | manager | salesperson | admin | system-health` | one payload per role: envelope (range, period, currency, filters, scope), `targets` (month/quarter/fiscal-year tiles per metric), `kpis`, `panels` (each panel carries OK / FORBIDDEN / ERROR so one failing panel never blanks the page). `salesperson` is always the caller's own scope (`ownerId = self` is forced). `admin` and `system-health` are the same operational-only payload (`businessData: false`: services latency, queue/backlog counts, last reconciliation result, process stats) |
| KPIs | `GET /kpis` (definitions + values, `ids`, `group`), `GET /kpis/definitions` (dictionary, no values, any role), `GET /kpis/filter-options` (teams/programs/sources/owners within the caller's scope), `GET /kpis/:id`, `GET /kpis/:id/history` (daily organisation snapshots, org-scope only) | |
| Reports | `GET /reports` (catalogue), `follow-ups`, `conversions` (`by=source|program|owner`), `funnel`, `revenue` (`by=program|owner`), `team-performance`, `weekly-founder`, `monthly-founder` | uniform shape: `columns`, `rows`, `summary`, `kpis` (definitions travel), `meta` (range, currency, applied filters, definitions, freshness, `detailWithheld`), `truncated`/`rowLimit` |
| Reconciliation | `GET /reports/reconciliation` (live), `POST /reports/reconciliation/run` (persists + audits) | section 6 |
| Exports | `POST /reports/exports`, `GET /reports/exports`, `GET /reports/exports/:id`, `GET /reports/exports/:id/download` | section 5 |
| Saved filters | `GET/POST /reports/saved-filters`, `DELETE /reports/saved-filters/:id` | per user, max 50, re-intersected with the current scope on every use |

Catalogue paths that changed: `/reports/weekly|monthly` -> `/reports/weekly-founder|monthly-founder`; `/reports/export[/:jobId]` -> `/reports/exports[/:id[/download]]`; `/dashboard/admin` added next to `/dashboard/system-health` (same handler). No new permission keys were needed (`docs/permissions-matrix.md` unchanged).

## 4. Dashboards (what each role gets)

| Dashboard | Content |
|---|---|
| Founder | revenue / collections / enrolments vs target for the month, quarter and fiscal year of the chosen date; 6-month and daily revenue trends; conversion (lead, webinar, demo, average deal value); pipeline value by stage (probability-weighted shown as an estimate); forecast + accuracy (named metric) + weekly forecast; forecast risk (no close date / slipped); manager performance table; team achievement, productivity, CRM compliance, follow-up compliance; risks (overdue, unassigned, no-next-action, stale, complaints, P1, SLA breaches, escalations, payments awaiting verification, refunds awaiting decision, deals past expected close, high-value open deals); customer experience tiles; action-item completion, reporting quality and timeliness, latest Founder report status; SOP adoption, dashboard accuracy, attrition, engagement. Weekly/monthly views via the period filter plus links to the report data. |
| Team Lead | target breakdown (revenue, collections), team and manager/individual achievement; today strip (call attempts, unique clients, connected, follow-ups, new leads, collections, revenue, closures, stage changes); manager and executive scorecards; funnel health and pipeline; exception queue, ageing, reactivation queue, forecast risks; coaching / 1:1 / review / PIP / succession counts (each shown only if the caller holds the permission), SOP adoption, coaching hours, incentive recommendation status counts; Founder-report status and timeliness. |
| Manager | team target and achievement, roster (target, revenue, calls as attempts / clients, follow-ups + on-time, overdue, active leads, won + conversion), activity and discipline tiles, workload, callbacks pending / overdue, active leads by stage, team exceptions, this week's KPI/KRA assignments, 1:1 / coaching / reviews / PIP counts. |
| Executive | own revenue and collections vs target, own activity (attempts vs clients, follow-ups, overdue), own results, own pipeline, approved incentive status (status only, no amounts). |
| Admin | system health only. |

Every tile: value with unit, definition popover (summary, formula, zero-denominator rule, approval status, link to the dictionary), date range, currency, applied/ignored filters, LIVE/CACHED freshness with time, caution / estimate / data-source labels. Charts use `ChartCard` (text summary + chart/table toggle). The filter bar (period, as-of date or custom range, team, program, source, person) writes to the URL; options come from `GET /kpis/filter-options` so the UI never offers anything outside the caller's scope, and the server intersects regardless. Export buttons appear only for `reports:export` holders. Loading / empty / error / permission-denied states exist at page level and per panel.

## 5. Exports

- `POST /reports/exports {report, format: CSV|XLSX, params, maxRows?}`: server-side check of `reports:export` plus the report's own permissions; scope = narrowest of them; applied filters + scope level + row cap stored on the record and in the audit entry `export.created`.
- Small exports (<= `EXPORT_SYNC_ROWS`, default 1000) are produced inline. Larger ones stay `QUEUED` and are produced by `ExportRunner` (claim with `FOR UPDATE SKIP LOCKED` + 5 minute lease, 3 attempts, then FAILED). Permission and requester activity are re-checked when the file is generated (a deactivated requester gets nothing).
- Row caps: CSV 100,000, XLSX 50,000 (`EXPORT_MAX_ROWS_CSV|XLSX`), per-request `maxRows`. Truncation is recorded (`truncated`, audit) and shown in the UI and in the XLSX "About" sheet.
- Files: CSV is RFC 4180 with UTF-8 BOM; XLSX (`exceljs` 4.4.0) has a "Report" sheet and an "About" sheet (report, time, range, scope, applied filters, row count, truncation, definitions). Text cells that start with `= + - @ TAB CR` are prefixed with `'` (spreadsheet formula injection). Empty cell = not computable (never 0).
- Storage: `report_exports.content` (bytea, private). It is never listed, only streamed after an authorisation check by `GET .../download` (requester only, still holding `reports:export`, READY, not expired; `Cache-Control: private, no-store`, `nosniff`, attachment). Deviation from the signed-URL/FileService option (docs/file-storage-policy.md): exports are short-lived derived files owned by one user and bounded by the row caps, so they do not go through the scanner/MIME pipeline, and nothing about them is reachable without the session. Retention 72 hours (`EXPORT_RETENTION_HOURS`); expired files lose their bytes (scheduler + worker maintenance), the row and audit trail stay.
- Audit: `export.created` (report, format, filters, scope, row cap), `export.completed` (row count, truncated, size), `export.downloaded`, `export.failed`.

## 6. Reconciliation (dashboard accuracy evidence)

`GET /reports/reconciliation` recomputes dashboard figures with independent SQL on the base tables (it does not reuse the KPI predicates or `revenue/calc`) and compares: new leads, unassigned, no-next-action, active-lead denominator of the ageing KPI, call attempts / completed / unique clients, overdue tasks, follow-ups completed, follow-up report rows vs the call-attempt KPI, and (organisation scope without filters) net revenue, net collections, revenue-report row totals by owner and by program, and the open pipeline deal count. Tolerance 0 for counts, 0.01 for money; money checks are `SKIPPED` with a reason in narrower scopes. `POST /reports/reconciliation/run` (and the nightly scheduler) persist a `kpi_reconciliation_runs` row + an audit entry; KPI-PRO-002 aggregates those runs (accuracy = passed / executed) and reports the lag since the last run. The test suite proves the check can fail: a dashboard layer that over-counts by one is reported as a mismatch.

## 7. Caching and invalidation

Redis, key = `<prefix>:v<orgVersion>:<org>:<kpi>:<scopeFingerprint>:<hash(window, period, asOf, program/source filters, config)>`. `scopeFingerprint` hashes the RESOLVED scope (level, detail flag, sorted user ids, team ids), never a role name, so two viewers share an entry only when they may see exactly the same records. Only KPIs with a TTL are cached (15-300 s, capped by `KPI_CACHE_TTL_SECONDS`, default 30 in production and off under test). Explicit invalidation = bumping `<prefix>:ver:<org>`; the worker (`jobs/analytics`) does it on ~50 KPI-relevant domain events, and `KpiCache.invalidateOrg` is available to the API. Data written without an outbox event (satisfaction responses, SOP acknowledgements, coaching sessions, engagement answers) becomes visible when the TTL expires. Redis down = no cache, never an error. Everything else (reports, exports, reconciliation, panels) is computed on demand.

## 8. Worker, scheduler and why the engine runs in the API

The KPI engine and `revenue/calc` live in `apps/api`; the worker cannot import them (the same constraint as KI-G-01). Therefore:
- **Worker** (`jobs/analytics`): KPI cache invalidation on domain events; `analytics-maintenance` every 15 minutes (expire export files, re-queue crashed exports, prune exports > 180 days and snapshots > 800 days).
- **API** (`ReportingScheduler`, `ExportRunner`, enabled outside tests, `ANALYTICS_SCHEDULER`/`EXPORT_RUNNER` env): large export generation, daily organisation snapshots (`kpi_snapshots`, org scope only), nightly reconciliation after 03:00 IST (once per day per organisation, actor null, `trigger = SCHEDULED`). All are DB-claimed/idempotent, so several API instances are safe.
Moving the engine into a framework-free package (like crm-core / cx-core) would let the worker run exports and snapshots; tracked as KI-I-02.

## 9. ReportDataProvider (Agent H's Founder-report builder)

`AnalyticsReportDataProvider` (`modules/reporting/founder/report-data.provider.ts`) implements the CX module's `ReportDataProvider`. `cx.module.ts` now imports `ReportingModule` and binds `{ provide: REPORT_DATA_PROVIDER, useExisting: AnalyticsReportDataProvider }` (one atomic edit in H's file; `PendingPhase5ReportDataProvider` stays as the fallback implementation). The report author's own Principal is used, so a Team Lead freezes only numbers they may see. Sections: revenue, funnel, team, customer, founder-support; each metric is `{kpiId, label, value (formatted with unit), unit, note}` where `note` carries the window, computation time, definition status, cautions and the data source. A number that cannot be computed is `null` with its reason. Published reports freeze these values (existing immutable snapshot). `test/cx/founder.spec.ts` was updated from "pending placeholders" to the real contract.

## 10. Data model and indexes

New file `prisma/schema/analytics.prisma` (plain UUID columns, no relations to other domains): `report_exports`, `kpi_snapshots`, `kpi_reconciliation_runs`, `saved_filters`. Indexes the KPI queries need that the owning domains do not declare are created idempotently at API boot (`analytics-indexes.ts`, include in the consolidated migration): `call_logs(organization_id, started_at)` and `(organization_id, user_id, started_at)`, `leads(organization_id, created_at)`, partial `leads(organization_id, assigned_to_id) WHERE stage_category='OPEN' AND merged_into_id IS NULL`, partial `leads(organization_id, won_at) WHERE stage_category='WON'`, `tasks(organization_id, completed_at) WHERE status='DONE'`, `tasks(organization_id, due_at)`, partial `tasks(organization_id, assigned_to_id, due_at) WHERE status='OPEN'`, `sales_records(organization_id, lead_id, closed_at)`.
Dependency added: `exceljs@4.4.0` (apps/api). Seed: `seedAnalytics` backdates `[DEMO]` users created in the last 7 days to 45 days ago so tenure-based KPI exclusions do not hide the demo data (KPI values themselves are never seeded).

## 11. Verification (real runs, 2026-10-15)

| Command | Result |
|---|---|
| `pnpm db:validate` / `pnpm db:push` (DB `salesos_agenti`) / `pnpm db:generate` | valid / in sync / OK |
| `pnpm lint` (all workspaces) | 0 errors; 3 pre-existing warnings in `features/crm/lead-dialogs.tsx` (react-hooks, not analytics) |
| `pnpm typecheck` (all workspaces) | clean |
| `pnpm --filter @salesos/api test` (whole suite, run before the last small edits) | 63 files, 1629 passed, 1 failed (the negative-authz coverage test, because `GET /kpis/filter-options` had no case yet: added) |
| after the fixes: analytics (5 files) + `negative-authz` + `cx/founder` | 8 files, **882 passed**, 0 failed (analytics alone: `kpi` 15, `scope` 15, `reports` 25, `exports` 13, `engine` 10, `dictionary-doc` 2 = 80 tests) |
| `pnpm --filter @salesos/worker test` (DB `salesos_agenti_wtest`) | 8 files, **65 passed** (`analytics.spec.ts`: 3) |
| `pnpm --filter @salesos/web test` | 49 files, **372 passed** (`features/dashboard`: format 7, components 26, i18n coverage 4; plus the nav and messages parity tests) |
| `pnpm build` (packages, api, worker, web with `NEXT_DIST_DIR`) | exit 0 |
| Playwright against real API :4109 (production build of web :3109, DB `salesos_agenti`, seeded): `analytics-journeys` + `auth` + `admin` + `a11y` | **28 passed**: UJ-01 Founder views company-level performance (tile values equal `/kpis`, definitions, freshness, chart table toggle, team filter, CSV export download, reconciliation page), UJ-02 Team Lead reviews targets and scorecards (equal the report), manager/executive/admin scoping, follow-up report + KPI dictionary, axe WCAG A/AA on 11 pages at 1280 px and 390 px (no horizontal scroll) |
| `pnpm --filter @salesos/api perf:analytics` | 4 passed (section 12) |

Not verified: Lighthouse / real-device testing; Hindi / Marathi copy review; the API-side scheduler across more than one running API instance; exports above 100k rows.

## 12. Performance budgets, measurements and query plans

Dataset (generated, anonymised, `salesos_agenti_perf`): **60,000 leads, 240,000 call logs, 120,000 tasks (360,000 activities)**, ~7k won deals with sales records / credits / payments, refunds, 3k open pipeline deals, 60 events with 12k attendances, targets for 5 managers. Machine shared with other agents' test runs, so numbers are indicative (single run of 1 cold + 3 warm per item, medians).

Budgets (documented targets; org scope, 60k leads): single KPI <= 750 ms; role dashboard <= 3.5 s cold; report <= 1.5 s; reconciliation <= 3.5 s; manager/executive scope faster than org scope. **All met** in the measured run:

| measurement | scope | cold ms | warm median ms |
|---|---|---|---|
| dashboard founder (25 KPIs + 9 target tiles + 8 panels) | founder | 2508 | 2302 |
| dashboard team-lead | founder | 1928 | 2097 |
| reconciliation (15 checks) | founder | 2633 | 2060 |
| report monthly-founder (33 KPIs) | founder | 1099 | 1040 |
| dashboard executive | executive | 952 | 845 |
| dashboard manager | manager | 856 | 797 |
| KPI-PRD-004 response time | founder | 591 | 651 |
| KPI-PRD-005 lead ageing | founder | 596 | 642 |
| report team-performance | founder | 498 | 555 |
| report follow-ups | founder | 360 | 432 |
| KPI-SAL-005 forecast accuracy (6 periods) | founder | 371 | 359 |
| report revenue (by owner) | founder | 248 | 247 |
| KPI-PRD-003 CRM compliance | founder | 236 | 178 |
| every other KPI | founder / manager | < 140 | < 140 |

Full per-KPI table: `apps/api/perf/last-run.md`; plans: `apps/api/perf/last-plans.txt`.

Query plans (EXPLAIN ANALYZE, BUFFERS):
- **Lead ageing** (`KPI-PRD-005`): one sequential scan of 60k leads (43.7k active rows) and two sorts for the medians; ~1.4 s under EXPLAIN instrumentation, ~0.6 s normally. Accepted: the answer needs every active lead; the partial index `leads_org_open_owner_idx` serves owner-scoped (manager / executive) reads. Medians are the dominant cost; dropping them would halve it.
- **CRM compliance** (`KPI-PRD-003`): was 459 ms because the correlated `EXISTS(open task)` ran twice per lead; rewritten with a MATERIALIZED CTE (now ~180 ms, index-only scan on `tasks_lead_id_status_idx`).
- **Webinar / demo to sale**: attribution subquery used `sales_records(organization_id, closed_at)` and filtered by lead; added `sales_records(organization_id, lead_id, closed_at)`.
- **Calls** use `call_logs_org_user_started_idx` (bitmap index scan, ~40 ms for 41k rows); **follow-ups / overdue** use the partial task indexes; **forecast accuracy** was parallelised across its six periods (432 -> ~360 ms).
- Dashboards run KPIs in chunks of 8 and panels concurrently with them; the founder dashboard is the heaviest page (about 70 statements).
Caching (30 s default in production) turns repeated dashboard loads into Redis reads; the numbers above are with the cache off.

## 13. Known issues and decisions needing the owner

See docs/known-issues.md (KI-I-*) and docs/decision-log.md (DEC-041..DEC-046). All 38 KPI formulas remain "proposed default - awaiting owner approval"; nothing in this phase was approved by the business owner.
