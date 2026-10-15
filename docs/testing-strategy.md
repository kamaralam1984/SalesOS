# Testing Strategy

Date: 2026-10-14. Honesty rule: report only real command output; never claim an unrun test passed. A requirement is VERIFIED only when a test mapped in docs/requirements-traceability.md actually ran and passed.

## Gates (every phase)
`pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm prisma validate && migration check && pnpm build`. Fix failures; never suppress lint/type errors or skip tests.

## Pyramid
| Layer | Tool | Scope | Notes |
|---|---|---|---|
| Unit | Vitest/Jest | KPI formulas, state-machine transition functions, E.164 normaliser, decimal money math, policy scope resolver, round-robin, retry delay with working hours | pure, fast; table-driven; zero-denominator cases |
| API integration | Jest/Vitest + supertest on NestJS | Every endpoint: happy path, validation, authz allow/deny per role, org isolation, IDOR | **Real Postgres test DB** (own DB per agent `salesos_<agent>_test`), real Redis for queue tests; no DB mocking |
| Migration | prisma migrate on empty DB + on seeded DB; diff check | forward-only; rollback rehearsal documented | |
| Worker | integration with Redis+Postgres | outbox relay, retry/backoff, DLQ, kill-worker-mid-job recovery, no duplicate reminders | fault injection |
| E2E | Playwright | 17 critical journeys (UJ-01..17), mobile + desktop viewports, role-based | where feasible; screenshots on failure |
| Accessibility | axe via Playwright | style-guide page + each primary screen; keyboard + reduced-motion checks | manual screen-reader spot check pre-launch |
| Security | custom suites + audit tools | authz sweep (route enumeration), CSRF, XSS payloads, upload abuse, webhook forgery/replay, rate limits, header tests | see docs/security.md |
| Performance | k6/autocannon + EXPLAIN | dashboard queries, lead list, import 50k rows; budgets: p95 API read < 300 ms @ 50 rps with 200k leads (proposed) | anonymised data |
| Responsive | Playwright viewports 360, 768, 1280, 1920 | layout, bottom nav, table-to-cards | |
| Dependency/secret | `pnpm audit`, gitleaks-style scan | CI | |

## Must-have automated tests (by area)
- Authorization: per endpoint negative tests; cross-team, cross-org, sibling manager, exec-to-exec, Admin without HR/Finance, deactivated session rejected.
- CRM: duplicate flagging, import idempotency (re-run = 0 new), call+task+history atomicity (fault injected rollback), Lost never auto-set on NO_ANSWER, owner deactivation -> reassignment queue, E.164 edge cases.
- Reliability: reminder survives worker restart; no duplicate notifications; DLQ then retry; delivery status never DELIVERED before provider confirmation.
- Money: Decimal precision, duplicate external ref blocked, refund state authority, Closed-Won != collected, totals reconcile to fixtures, adjustments not edits.
- KPIs: each KPI vs fixture dataset; zero-denominator returns null; scope; export audit.
- People/SOP: SOP version + acknowledgement history, HR data isolation, incentive workflow permissions, PIP transitions.
- CX: handover journey, escalation journey, snapshot immutability, data minimisation for cross-functional roles.
- Files: extension/MIME mismatch, traversal names, oversize, zip bomb, executable, scan failure, signed URL expiry.
- AI: failure does not break CRM; flag off; prompt-injection fixtures; no write capability.
- PWA: no private data in Cache Storage.

## Fixtures
Deterministic seed dataset `[DEMO]`-labelled; separate KPI fixture set with hand-computed expected values stored beside tests. Anonymised load data generator (no real PII).

## Evidence
Each phase report lists commands run with pass/fail counts; traceability Test column cites test file paths.


## Analytics (Phase 5) additions
- **Hand-computed fixture** (`apps/api/test/analytics/fixture.ts`): July 2026 IST data for one organisation; every KPI assertion in `kpi.spec.ts` / `scope.spec.ts` carries its arithmetic in a comment. Changing a fixture row means re-doing the sum next to the assertion.
- **Doc sync**: `dictionary-doc.spec.ts` fails if `docs/kpi-dictionary.md` differs from the registry (`pnpm --filter @salesos/api docs:kpi` regenerates).
- **Performance**: `pnpm --filter @salesos/api perf:analytics` (dedicated DB `PERF_DATABASE_URL`, default `salesos_<agent>_perf`; generates >= 50k leads and >= 200k activities with SQL `generate_series`, anonymised) prints cold/warm timings per KPI/dashboard/report and EXPLAIN (ANALYZE, BUFFERS) of the slowest statements; results are copied into docs/analytics-report.md.
- **Web**: component tests mock only the HTTP client; Playwright `e2e/analytics-journeys.spec.ts` runs UJ-01/UJ-02 against the real API and DB, including axe at 1280px and 390px.
