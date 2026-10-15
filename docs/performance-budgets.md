# Performance budgets and measured results (Phase 10, Agent L fork L3)

Date: 2026-10-15. Evidence, plans and caveats: `docs/performance-evidence-l3.md`. Scripts: `scripts/perf/seed-scale.sql`, `scripts/perf/load.mjs`.

## Budgets (proposed targets; owner to confirm, DEC-029 family)
| Area | Budget (p95 unless stated, API process on a 2 vCPU / 4 GB node, 10 concurrent users) |
|---|---|
| Login | 600 ms |
| Lead list / task list (25 rows) | 300 ms |
| Lead detail, timeline | 300 ms |
| Create call (disposition tx) | 500 ms |
| Dashboards (cached) / cold | 500 ms / 2 s |
| Reports (cold) | 2 s |
| Leads CSV export (10k-row cap) | 6 s |
| Any list | bounded page size (max 100), export cap 10k rows, errors < 0.5 % |
| Web (Lighthouse mobile, normal machine) | LCP <= 2.5 s, TBT <= 300 ms, CLS <= 0.1, first-load JS <= 300 kB gzip/route |
| DB | no seq scan of a > 100k-row table on interactive endpoints (aggregates for org-wide dashboards excepted, cached 15-300 s) |

## Dataset
Demo seed plus 55,000 anonymised leads ("Perf Lead 00xxxxx", synthetic phones), 220,015 calls, 110,038 tasks, 6,420 deals, 6,417 payments in DB `salesos_agentl_perf` (total 55,054 leads, 330k activities).

## Measured results (final state, after the two fixes below)
Environment caveat: the host was shared with other agents (load average 17-29 on 4 cores) during every run, and the load generator ran on the same host. Numbers are pessimistic and noisy; treat them as relative, not as capacity figures. API ran as `node dist/main.js` (NODE_ENV=development because the production env validator, correctly, rejects http origins and dev DB passwords), pool = Prisma default 9 connections, memory throttler relaxed.

| scenario | conc | req | rps | p50 ms | p95 ms | p99 ms | err % | verdict vs budget |
|---|---|---|---|---|---|---|---|---|
| login (argon2) | 3 | 89 | 8.9 | 335 | 503 | 715 | 0 | within |
| lead list, executive | 10 | 269 | 33.6 | 279 | 466 | 551 | 0 | p95 over (queueing on one Node process under host load; server time ~25 ms/request) |
| lead list, founder | 10 | 274 | 27.4 | 321 | 696 | 765 | 0 | over |
| lead list + filter + search | 10 | 383 | 38.3 | 249 | 395 | 597 | 0 | over |
| lead detail | 10 | 313 | 31.3 | 291 | 526 | 852 | 0 | over |
| lead timeline | 10 | 282 | 28.2 | 339 | 584 | 717 | 0 | over |
| create call (after fix) | 10 | 104 | 13.0 | 763 | 1220 | 1447 | 0 | over |
| task list | 10 | 412 | 41.2 | 187 | 341 | 1861 | 0 | borderline |
| dashboard executive | 10 | 29 | 3.6 | 1144 | 6876 | 6886 | 0 | over (cold = ~135 SQL statements; cached 30 s) |
| dashboard founder (ceo) | 4 | 8 | 1.0 | 4234 | 4387 | 4387 | 0 | over |
| dashboard team lead | 4 | 12 | 1.5 | 3484 | 5201 | 5201 | 0 | over |
| report funnel | 4 | 323 | 32.3 | 101 | 176 | 1453 | 0 | within |
| report team-performance | 4 | 18 | 2.3 | 2235 | 2558 | 2558 | 0 | over |
| report follow-ups | 4 | 25 | 3.1 | 1434 | 2076 | 2826 | 0 | borderline |
| leads CSV export (10k rows, 2.1 MB) | 2 | 6 | 0.6 | 4427 | 5188 | 5188 | 0 | within |
| report export create | 2 | 100 | 10 | 10 | 1433 | 2752 | 87 (HTTP 429) | rate limit by design (13 accepted) |
Rows for login, lead detail/timeline, task list, funnel, export, export-create come from the full pass before the two fixes (neither fix touches them); lead list exec, create call and dashboards/reports were re-run after the fixes. No row was cherry-picked; earlier runs are in the evidence file.

Dashboards remain the slowest area and are NOT within budget in this environment. KPI single-flight removed the cold-cache stampede (earlier run: 11 requests in 12 s at p50 13 s), but a cold dashboard still issues ~135 statements. Recommended follow-ups (not done): precomputed snapshots for founder/team-lead tiles, batching KPIs that scan the same table.

## Defects found and fixed
1. Connection-pool deadlock (high): `CrmSupport.managerOf` queried through the pool while the call-disposition transaction held a connection. With >= `connection_limit` (default 9) concurrent POST /leads/:id/calls, every connection was "idle in transaction", requests waited the 10 s pool timeout and returned 500 (Prisma P2024). Before: conc 10 gave p50 10.6 s, 33 % errors; conc 12 gave 16 % errors. Fix: pass the tx client (`apps/api/src/modules/crm/crm.support.ts`, `calls/calls.service.ts`). After: conc 12 and 24 both 0 errors (138 and 150 requests). No automated regression test was added (needs a deliberately tiny pool); load.mjs `create-call` at CONC > pool size reproduces it.
2. KPI cold-cache stampede (medium): identical concurrent KPI computations now share one in-flight promise keyed by the authorization-aware cache key (`reporting/kpi/kpi.service.ts`).
3. Per-lead NOT EXISTS probe (26.7k index probes, 80k buffers) replaced by one hash anti-join in the risk panel and the follow-up compliance KPI: EXPLAIN ANALYZE 335 ms -> 119 ms on 55k leads (`reporting/dashboards/panels.ts`, `reporting/kpi/defs/crm.ts`). `apps/api` analytics + calls suites: 95 tests passed (7 files; `vitest run test/analytics test/crm/calls.spec.ts`).

## Indexes
No migration was added: EXPLAIN showed the existing indexes are used for the per-user and per-window aggregates (call_logs 53 ms org-wide, 6 ms per user; tasks per user 13 ms). Candidate (not applied): `tasks (organization_id, assigned_to_id, due_at)` + partial `(organization_id, assigned_to_id, completed_at)` gave 13.2 -> 5.3 ms for a per-user scope, deemed too small for the write cost. Org-wide task aggregates seq-scan by design (35 ms).

## Unbounded / N+1 checks
- Lists reject limits above their caps (leads limit 101, tasks 1000, users/exports 100000 -> VALIDATION_ERROR); leads CSV export capped at 10,000 rows with `x-export-truncated`.
- Statement counts per request are constant in page size (leads list: 12 statements at limit 25 and 100; tasks 8; lead detail 23; timeline 14; workspace 21), so no N+1 on list endpoints.

## Operational recommendations
- Set `connection_limit` (e.g. 20-30) and `pool_timeout` in `DATABASE_URL` for api and worker; default 9 is too small for production.
- Run the API with >= 2 instances behind nginx; one Node process saturates around 30-40 list requests/s on this host.

## Web bundle (next build, Turbopack, NEXT_DIST_DIR=.next-l3, removed after)
Static JS 137 chunks = 4.87 MB raw / 1.43 MB gzip across all routes; CSS 69 kB. Largest chunks: zod 434 kB raw (two zod majors: validation uses 3.25, web 4.6), a 391 kB shared vendor chunk, react-dom 229 kB. Next 16 prints no per-route size table; a client-reference-manifest estimate gives 460-580 kB gzip per route, an upper bound (it lists all chunks referenced by the route including lazy ones). Opportunity: dedupe zod and avoid importing the whole validation package client-side (not done).

## Lighthouse 12.8.1 (mobile emulation, headless Chromium from Playwright, run against `next start`)
| page | perf | a11y | best practices | LCP | TBT | CLS | transfer |
|---|---|---|---|---|---|---|---|
| /login | 56 | 100 | 93 | 3.3 s | 4.7 s | 0 | 696 KiB |
| /dashboard/executive | 43 | 100 | 100 | 8.4 s | 7.2 s | 0 | 648 KiB |
| /crm/leads | 39 | 100 | 96 | 11.0 s | 10.5 s | 0.017 | 749 KiB |
| /crm/leads/[id] | 42 | 100 | 96 | 9.6 s | 8.3 s | 0.001 | 724 KiB |
| /crm/tasks | 38 | 100 | 96 | 11.0 s | 10.5 s | 0.029 | 769 KiB |
Performance scores are NOT trustworthy: Lighthouse's benchmarkIndex was 175-670 (healthy machines report ~1000+) because the host was under load 17+, and mobile mode applies 4x CPU throttling. Accessibility 100 on all five pages is a real signal. Re-run on an idle machine before using the performance numbers. Main-thread cost is dominated by script evaluation (react-dom, zod chunk) and style/layout.
