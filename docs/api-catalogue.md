# API Catalogue (Phase 0 plan)

Date: 2026-10-14. Base path `/api/v1`. Source: `BP` = Blueprint section 6, `new` = added from Master Spec/JD. All endpoints require authentication, deny-by-default authorization with the permission key shown (see docs/permissions-matrix.md for scope rules), org-scoped IDOR-safe lookups, Zod-validated input, bounded pagination, rate limiting, and OpenAPI examples. Mutating endpoints write audit entries per the matrix; creates that can be retried accept `Idempotency-Key`. Response envelope: `{data, meta:{requestId, pagination?}, error?}`; errors use stable codes.

Endpoint names are the contract for agents; if an implementing agent must deviate, update this file and note it in the final report.


## Health and platform (P1)

| Method | Path | Permission key | Phase | Source | Status |
|---|---|---|---|---|---|
| GET | /api/v1/health | `public (liveness)` | P1 | - | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/ready | `public (readiness, no secrets)` | P1 | - | IMPLEMENTED (verified: apps/api tests); same handler also at `/api/v1/health/ready` |
| GET | /api/v1/openapi.json | `public in dev, auth in prod` | P1 | - | IMPLEMENTED; disabled when ENABLE_DOCS=false (default in production) instead of auth-gated. Swagger UI at `/api/docs` |
| GET | /api/v1/stream | `notifications:view (SSE)` | P3 | - | IMPLEMENTED (verified: apps/api/test/crm/stream.spec.ts); see "Leads, calls, tasks (P3)" |

## Auth (P2) [Blueprint]

| Method | Path | Permission key | Phase | Source | Status |
|---|---|---|---|---|---|
| POST | /api/v1/auth/login | `auth:login` | P2 | BP | IMPLEMENTED (verified: apps/api tests); public, throttled, lockout |
| POST | /api/v1/auth/logout | `auth:session:revoke-own` | P2 | BP | IMPLEMENTED (verified: apps/api tests) (key corrected from auth:me:view) |
| GET | /api/v1/auth/me | `auth:me:view` | P2 | BP | IMPLEMENTED (verified: apps/api tests); returns effective permissions, scope summary, csrfToken |
| POST | /api/v1/auth/password/forgot | `auth:login` | P2 | new | IMPLEMENTED (verified: apps/api tests); always 200, token via outbox email stub |
| POST | /api/v1/auth/password/reset | `auth:login` | P2 | new | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/auth/invite/accept | `auth:login` | P2 | new | IMPLEMENTED (verified: apps/api tests) (added) |
| POST | /api/v1/auth/sessions/revoke | `auth:session:revoke-own` | P2 | new | IMPLEMENTED (verified: apps/api tests); revokes OTHER sessions |
| GET | /api/v1/auth/csrf | `auth:me:view` | P2 | new | IMPLEMENTED (verified: apps/api tests); requires a session (key corrected) |

## Users, teams, audit (P2)

| Method | Path | Permission key | Phase | Source | Status |
|---|---|---|---|---|---|
| GET | /api/v1/users | `users:view` | P2 | BP | IMPLEMENTED (verified: apps/api tests); scope own/team/org, `summary` = id/name/isActive only |
| POST | /api/v1/users | `users:create` + `users:role:assign` | P2 | BP | IMPLEMENTED (verified: apps/api tests); sends invite via outbox |
| GET | /api/v1/users/:id | `users:view` | P2 | new | IMPLEMENTED (verified: apps/api tests); out-of-scope = 404 |
| PATCH | /api/v1/users/:id | `users:update` | P2 | BP | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/users/:id/deactivate | `users:deactivate` | P2 | new | IMPLEMENTED (verified: apps/api tests); revokes sessions, outbox `user.deactivated` |
| POST | /api/v1/users/:id/reactivate | `users:deactivate` | P2 | new | IMPLEMENTED (verified: apps/api tests) (added) |
| POST | /api/v1/users/:id/roles | `users:role:assign` (+ `users:role:assign-sensitive` for Founder/HR/Finance) | P2 | new | IMPLEMENTED (verified: apps/api tests); body `{roles: [...]}` replaces the role set; audited |
| GET | /api/v1/delegations | `users:delegation:manage` | P2 | new | IMPLEMENTED (verified: apps/api tests) (path deviates from `/users/:id/delegations`) |
| POST | /api/v1/delegations | `users:delegation:manage` | P2 | new | IMPLEMENTED (verified: apps/api tests); replaces POST /users/:id/delegations (body has delegatorId/delegateId/endsAt) |
| DELETE | /api/v1/delegations/:id | `users:delegation:manage` | P2 | new | IMPLEMENTED (verified: apps/api tests) (revoke) |
| GET | /api/v1/teams | `teams:view` | P2 | BP | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/teams | `teams:create` | P2 | BP | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/teams/:id | `teams:view` | P2 | new | IMPLEMENTED (verified: apps/api/test/users-teams.spec.ts); 404 outside scope, lead + soft-limit info |
| PATCH | /api/v1/teams/:id | `teams:update` | P2 | new | NOT_STARTED (rename/lead change) |
| DELETE | /api/v1/teams/:id | `teams:delete` | P2 | new | IMPLEMENTED (verified: apps/api tests) (added; empty teams only) |
| GET | /api/v1/teams/:id/members | `teams:view` | P2 | new | IMPLEMENTED (verified: apps/api tests); warns above soft limit |
| POST | /api/v1/teams/:id/members | `teams:update` | P2 | new | IMPLEMENTED (verified: apps/api tests); warns above soft limit |
| DELETE | /api/v1/teams/:id/members/:userId | `teams:update` | P2 | new | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/audit-logs | `audit:view` | P2 | BP | IMPLEMENTED (verified: apps/api tests); org/team scope by actor; `?page=` returns total; money/HR metadata redacted for callers without that domain permission |
| GET | /api/v1/audit-logs/export | `audit:export` | P2 | new | IMPLEMENTED (verified: apps/api/test/users-teams.spec.ts); CSV, same scope + redaction as the list, capped at 10000 rows (`AUDIT_EXPORT_MAX_ROWS`, headers `x-export-rows`, `x-export-truncated`), formula-injection safe, the export is audited (`audit.exported`) |
| GET | /api/v1/org/settings | `settings:view` | P2 | new | IMPLEMENTED (verified: apps/api tests) (catalogue path was /settings) |
| PATCH | /api/v1/org/settings | `settings:update` | P2 | new | IMPLEMENTED (verified: apps/api tests); audited as policy change |
| GET | /api/v1/permissions/catalogue | `users:role:assign` | P2 | new | IMPLEMENTED (verified: apps/api tests) (added) |

## Leads, calls, tasks (P3)

Status: all rows below are implemented by Agent D (Phase 3). Backend routes verified by real-DB tests under `apps/api/test/crm/` plus the shared `negative-authz.spec.ts` table. Static `/leads/*` routes are registered before `/leads/:id`.

| Method | Path | Permission key | Source | Status |
|---|---|---|---|---|
| GET | /api/v1/leads | `leads:view` | BP | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts, authz.spec.ts) |
| POST | /api/v1/leads | `leads:create` | BP | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts (Idempotency-Key)) |
| GET | /api/v1/leads/export | `leads:export` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts) |
| GET | /api/v1/leads/ageing | `leads:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts) |
| GET | /api/v1/leads/workspace | `leads:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/calls.spec.ts, authz.spec.ts) |
| GET | /api/v1/leads/meta | `leads:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/authz.spec.ts) |
| GET | /api/v1/leads/:id | `leads:view` | BP | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts, authz.spec.ts) |
| PATCH | /api/v1/leads/:id | `leads:update` | BP | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts) |
| POST | /api/v1/leads/import/preview | `leads:import` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/imports.spec.ts) |
| POST | /api/v1/leads/import | `leads:import` | BP | IMPLEMENTED (verified: apps/api/test/crm/imports.spec.ts (raw text/csv or JSON; Idempotency-Key or content hash)) |
| GET | /api/v1/leads/import | `imports:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/imports.spec.ts) |
| GET | /api/v1/leads/import/:jobId | `imports:view` | new | IMPLEMENTED (verified: apps/api/test/crm/imports.spec.ts) |
| GET | /api/v1/leads/import/:jobId/errors | `imports:view` | new | IMPLEMENTED (verified: apps/api/test/crm/imports.spec.ts (?format=csv downloadable report)) |
| POST | /api/v1/leads/import/:jobId/retry | `imports:manage` | new | IMPLEMENTED (verified: apps/api/test/crm/imports.spec.ts) |
| POST | /api/v1/leads/:id/assign | `leads:assign` | BP | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts, queues.spec.ts) |
| POST | /api/v1/leads/:id/status | `leads:status:change` | BP | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts) |
| GET | /api/v1/leads/:id/timeline | `leads:timeline:view` | BP | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts, authz.spec.ts) |
| POST | /api/v1/leads/:id/calls | `calls:create` | BP | IMPLEMENTED (verified: apps/api/test/crm/calls.spec.ts (atomicity, automation)) |
| GET | /api/v1/leads/:id/calls | `calls:view` | BP | IMPLEMENTED (verified: apps/api/test/crm/calls.spec.ts) |
| POST | /api/v1/leads/:id/notes | `leads:notes:create` | new | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts) |
| POST | /api/v1/leads/:id/tasks | `tasks:create` | BP | IMPLEMENTED (verified: apps/api/test/crm/tasks.spec.ts) |
| POST | /api/v1/leads/:id/events | `leads:status:change + events:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/events.spec.ts) |
| GET | /api/v1/leads/exceptions | `leads:exceptions:view` | new | IMPLEMENTED (verified: apps/api/test/crm/queues.spec.ts) |
| POST | /api/v1/leads/exceptions/:id/resolve | `leads:reassignment-queue:resolve` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/queues.spec.ts) |
| GET | /api/v1/leads/duplicates | `leads:duplicates:review` | new | IMPLEMENTED (verified: apps/api/test/crm/duplicates.spec.ts) |
| POST | /api/v1/leads/duplicates/:id/merge | `leads:duplicates:review` | new | IMPLEMENTED (verified: apps/api/test/crm/duplicates.spec.ts) |
| POST | /api/v1/leads/duplicates/:id/dismiss | `leads:duplicates:review` | new | IMPLEMENTED (verified: apps/api/test/crm/duplicates.spec.ts) |
| GET | /api/v1/leads/reactivation | `leads:reactivation:view` | new | IMPLEMENTED (verified: apps/api/test/crm/queues.spec.ts) |
| POST | /api/v1/leads/reactivation/:id/reactivate | `leads:assign` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/queues.spec.ts) |
| GET | /api/v1/leads/views | `leads:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/authz.spec.ts) |
| POST | /api/v1/leads/views | `leads:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/authz.spec.ts) |
| DELETE | /api/v1/leads/views/:id | `leads:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/authz.spec.ts) |
| GET | /api/v1/reassignment-queue | `leads:exceptions:view` | new | IMPLEMENTED (verified: apps/api/test/crm/queues.spec.ts) |
| POST | /api/v1/reassignment-queue/bulk-assign | `leads:reassignment-queue:resolve` | new | IMPLEMENTED (verified: apps/api/test/crm/queues.spec.ts) |
| GET | /api/v1/tasks | `tasks:view` | BP | IMPLEMENTED (verified: apps/api/test/crm/tasks.spec.ts) |
| POST | /api/v1/tasks | `tasks:create` | BP (Blueprint /tasks) | IMPLEMENTED (verified: apps/api/test/crm/tasks.spec.ts) |
| GET | /api/v1/tasks/calendar | `tasks:view` | new | IMPLEMENTED (verified: apps/api/test/crm/tasks.spec.ts) |
| PATCH | /api/v1/tasks/:id | `tasks:update` | new | IMPLEMENTED (verified: apps/api/test/crm/tasks.spec.ts) |
| POST | /api/v1/tasks/:id/complete | `tasks:update` | BP | IMPLEMENTED (verified: apps/api/test/crm/tasks.spec.ts (atomic CAS, concurrent completes)) |
| POST | /api/v1/tasks/:id/reassign | `tasks:reassign` | new | IMPLEMENTED (verified: apps/api/test/crm/tasks.spec.ts) |
| GET | /api/v1/lead-sources | `sources:view` | new | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| POST | /api/v1/lead-sources | `sources:manage` | new | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| PATCH | /api/v1/lead-sources/:id | `sources:manage` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/negative-authz.spec.ts) |
| GET | /api/v1/campaigns | `sources:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/negative-authz.spec.ts) |
| POST | /api/v1/campaigns | `sources:manage` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| GET | /api/v1/programs | `programs:view` | new | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| POST | /api/v1/programs | `programs:manage` | new | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| PATCH | /api/v1/programs/:id | `programs:manage` | new | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| GET | /api/v1/lead-stages | `settings:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| POST | /api/v1/lead-stages | `settings:update` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| PATCH | /api/v1/lead-stages/:id | `settings:update` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| GET | /api/v1/lost-reasons | `settings:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| POST | /api/v1/lost-reasons | `settings:update` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| PATCH | /api/v1/lost-reasons/:id | `settings:update` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| GET | /api/v1/automation-rules | `settings:view` | new | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| POST | /api/v1/automation-rules | `settings:update` | new (added: create/override per team) | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts, calls.spec.ts) |
| PATCH | /api/v1/automation-rules/:id | `settings:update` | new | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| GET | /api/v1/assignment-rules | `settings:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/config.spec.ts) |
| PUT | /api/v1/assignment-rules | `settings:update` | new (added: round-robin per team) | IMPLEMENTED (verified: apps/api/test/crm/leads.spec.ts, config.spec.ts) |
| GET | /api/v1/events | `events:view` | new | IMPLEMENTED (verified: apps/api/test/crm/events.spec.ts) |
| POST | /api/v1/events | `events:manage` | new | IMPLEMENTED (verified: apps/api/test/crm/events.spec.ts) |
| GET | /api/v1/events/:id | `events:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/events.spec.ts) |
| PATCH | /api/v1/events/:id | `events:manage` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/events.spec.ts) |
| GET | /api/v1/events/:id/attendance | `events:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/events.spec.ts) |
| POST | /api/v1/events/:id/attendance | `events:manage` | new | IMPLEMENTED (verified: apps/api/test/crm/events.spec.ts) |
| GET | /api/v1/stream | `notifications:view (SSE)` | new | IMPLEMENTED (verified: apps/api/test/crm/stream.spec.ts (scope-filtered, Last-Event-ID)) |
| GET | /api/v1/stream/poll | `notifications:view` | new (added: polling fallback) | IMPLEMENTED (verified: apps/api/test/crm/stream.spec.ts) |
| GET | /api/v1/crm-notifications | `notifications:view` | new (added: in-app rows written by the CRM worker) | IMPLEMENTED (verified: apps/api/test/crm/stream.spec.ts) |
| POST | /api/v1/crm-notifications/:id/read | `notifications:view` | new (added) | IMPLEMENTED (verified: apps/api/test/crm/stream.spec.ts) |
| GET | /api/v1/jobs/dlq | `jobs:dlq:view` | new | IMPLEMENTED (verified: apps/api/test/crm/authz.spec.ts (outbox DEAD rows)) |
| POST | /api/v1/jobs/dlq/:id/retry | `jobs:dlq:retry` | new | IMPLEMENTED (verified: apps/api/test/crm/authz.spec.ts) |

## Revenue (P4)

All P4 routes are IMPLEMENTED and negative-authz covered in `apps/api/test/negative-authz.spec.ts`; money is a 2-dp string; `Idempotency-Key` is honoured on `POST /leads/:id/deals`, `/deals/:id/close`, `/collections`, `/refunds`. Details: `docs/revenue-report.md`.

| Method | Path | Permission key | Phase | Source | Status |
|---|---|---|---|---|---|
| GET | /api/v1/targets/periods | `targets:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts) |
| POST | /api/v1/targets/periods | `targets:create` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts) |
| GET | /api/v1/targets | `targets:view` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts) |
| POST | /api/v1/targets | `targets:create` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts (sum validation, concurrency, proration)) |
| GET | /api/v1/targets/:id | `targets:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts) |
| PATCH | /api/v1/targets/:id | `targets:update` | P4 | new (proposes a revision) | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts) |
| POST | /api/v1/targets/:id/approve | `targets:approve` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts) |
| GET | /api/v1/targets/:id/breakdown | `targets:view` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts) |
| GET | /api/v1/targets/:id/revisions | `targets:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts) |
| GET | /api/v1/targets/:id/achievement | `targets:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/targets.spec.ts) |
| GET | /api/v1/deals | `deals:view` | P4 | BP | IMPLEMENTED (verified: apps/api/test/revenue/isolation.spec.ts) |
| GET | /api/v1/deals/pipeline | `deals:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/isolation.spec.ts) |
| GET | /api/v1/leads/:id/deals | `deals:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts) |
| POST | /api/v1/leads/:id/deals | `deals:create` | P4 | BP | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts) |
| GET | /api/v1/deals/:id | `deals:view` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec,.ts isolation.spec) |
| PATCH | /api/v1/deals/:id | `deals:update` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts) |
| POST | /api/v1/deals/:id/close | `deals:close` | P4 | BP | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts (atomic rollback, idempotent)) |
| POST | /api/v1/deals/:id/escalate | `deals:escalate` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts) |
| POST | /api/v1/deals/:id/blockers/:blockerId/resolve | `deals:escalate` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts) |
| POST | /api/v1/deals/:id/reopen | `deals:update` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts) |
| POST | /api/v1/deals/:id/adjustments | `sales-adjustments:create` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts) |
| POST | /api/v1/deals/:id/adjustments/:adjustmentId/decision | `sales-adjustments:create` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts) |
| GET | /api/v1/collections | `collections:view` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/collections.spec.ts) |
| GET | /api/v1/collections/daily | `collections:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/collections.spec.ts) |
| GET | /api/v1/collections/reconciliation | `collections:reconcile` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/collections.spec.ts (totals reconcile)) |
| POST | /api/v1/collections/reconciliation/run | `collections:reconcile` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/collections.spec.ts) |
| POST | /api/v1/collections | `collections:create` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/collections.spec.ts (concurrent idempotency, duplicate ref)) |
| GET | /api/v1/collections/:id | `collections:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/collections.spec.ts) |
| POST | /api/v1/collections/:id/verify | `collections:verify` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/collections.spec.ts) |
| POST | /api/v1/collections/:id/reject | `collections:verify` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/collections.spec.ts) |
| POST | /api/v1/collections/:id/reverse | `collections:reconcile` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/collections.spec.ts) |
| GET | /api/v1/refunds | `refunds:view` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| POST | /api/v1/refunds | `refunds:request` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| GET | /api/v1/refunds/:id | `refunds:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| POST | /api/v1/refunds/:id/review | `refunds:review` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| POST | /api/v1/refunds/:id/approve | `refunds:approve` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| POST | /api/v1/refunds/:id/reject | `refunds:approve` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| POST | /api/v1/refunds/:id/withdraw | `refunds:request` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| POST | /api/v1/refunds/:id/cancel | `refunds:approve` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| POST | /api/v1/refunds/:id/process | `refunds:process` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| POST | /api/v1/refunds/:id/reconcile | `refunds:reconcile` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/refunds.spec.ts) |
| GET | /api/v1/forecasts | `forecasts:view` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/forecasts.spec.ts) |
| GET | /api/v1/forecasts/preview | `forecasts:create` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/forecasts.spec.ts) |
| GET | /api/v1/forecasts/accuracy | `forecasts:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/forecasts.spec.ts) |
| POST | /api/v1/forecasts | `forecasts:create` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/forecasts.spec.ts) |
| GET | /api/v1/forecasts/:id/snapshots | `forecasts:view` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/forecasts.spec.ts) |
| GET | /api/v1/revenue/programs | `deals:view | proposals:view | targets:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| GET | /api/v1/pricing/prices | `proposals:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| GET | /api/v1/pricing/programs/:programId/prices | `proposals:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| GET | /api/v1/proposals | `proposals:view` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| POST | /api/v1/proposals | `proposals:create` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| GET | /api/v1/proposals/:id | `proposals:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| POST | /api/v1/proposals/:id/submit | `proposals:create` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| POST | /api/v1/proposals/:id/withdraw | `proposals:create` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| POST | /api/v1/proposals/:id/decision | `proposals:approve` | P4 | new | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| GET | /api/v1/feedback | `market-intel:view` | P4 | new (was /market-intel) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| POST | /api/v1/feedback | `market-intel:create` | P4 | new (was /market-intel) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| PATCH | /api/v1/feedback/:id | `market-intel:create` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| GET | /api/v1/growth-opportunities | `market-intel:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| POST | /api/v1/growth-opportunities | `market-intel:create` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| PATCH | /api/v1/growth-opportunities/:id | `market-intel:create` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| GET | /api/v1/revenue/settings | `forecasts:view | targets:view | deals:view` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| PATCH | /api/v1/revenue/settings | `proposals:approve (Founder)` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| PATCH | /api/v1/revenue/programs/:programId/threshold | `proposals:approve (Founder)` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/deals.spec.ts) |
| GET | /api/v1/strategy-plans | `targets:view (manager and above)` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| POST | /api/v1/strategy-plans | `targets:update` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| PATCH | /api/v1/strategy-plans/:id | `targets:update` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/negative-authz.spec.ts) |
| POST | /api/v1/strategy-plans/:id/initiatives | `targets:update` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |
| PATCH | /api/v1/strategy-initiatives/:id | `targets:update` | P4 | new (added) | IMPLEMENTED (verified: apps/api/test/revenue/pricing-intel.spec.ts) |

## Dashboards and reports (P5)

All rows implemented by Agent I; per-route negative authorization cases are in `apps/api/test/negative-authz.spec.ts`. Details and contracts: docs/analytics-report.md.

| Method | Path | Permission key | Phase | Source | Status |
|---|---|---|---|---|---|
| GET | /api/v1/dashboard/ceo | `dashboard:ceo:view` | P5 | BP | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). Founder: targets (month/quarter/FY), KPIs, panels |
| GET | /api/v1/dashboard/team-lead | `dashboard:team-lead:view` | P5 | new | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). target breakdown, today strip, scorecards, exceptions, people status |
| GET | /api/v1/dashboard/manager | `dashboard:manager:view` | P5 | BP | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). roster, workload, callbacks, KRA, coaching |
| GET | /api/v1/dashboard/salesperson | `dashboard:salesperson:view` | P5 | BP | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). always the caller's own scope |
| GET | /api/v1/dashboard/admin | `dashboard:system-health:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/scope.spec.ts). system health only, `businessData:false` |
| GET | /api/v1/dashboard/system-health | `dashboard:system-health:view` | P5 | new | IMPLEMENTED (verified: apps/api/test/analytics/scope.spec.ts). alias of /dashboard/admin |
| GET | /api/v1/kpis/definitions | `kpi:definitions:view` | P5 | new | IMPLEMENTED (verified: apps/api/test/analytics/kpi.spec.ts). dictionary without values (any role incl. Admin) |
| GET | /api/v1/kpis | `kpi:view` | P5 | new | IMPLEMENTED (verified: apps/api/test/analytics/scope.spec.ts). definitions + values; `ids`, `group`, window, filters |
| GET | /api/v1/kpis/filter-options | `kpi:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/scope.spec.ts). teams/programs/sources/owners within the caller's scope |
| GET | /api/v1/kpis/:id | `kpi:view` | P5 | new | IMPLEMENTED (verified: apps/api/test/analytics/kpi.spec.ts). one KPI with breakdown, definition, freshness |
| GET | /api/v1/kpis/:id/history | `kpi:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/engine.spec.ts). daily org-level snapshots; org scope only |
| GET | /api/v1/reports | `reports:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). report catalogue |
| GET | /api/v1/reports/follow-ups | `reports:view` | P5 | BP | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts) |
| GET | /api/v1/reports/conversions | `reports:view` | P5 | BP | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). `by=source|program|owner` |
| GET | /api/v1/reports/funnel | `reports:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts) |
| GET | /api/v1/reports/revenue | `kpi:view` + `targets:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). `by=program|owner`; Finance (summary) allowed, owner names hidden |
| GET | /api/v1/reports/team-performance | `reports:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts) |
| GET | /api/v1/reports/weekly-founder | `reports:view` | P5 | new (renamed from /reports/weekly) | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). same numbers the Founder-report builder receives |
| GET | /api/v1/reports/monthly-founder | `reports:view` | P5 | new (renamed from /reports/monthly) | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts) |
| GET | /api/v1/reports/reconciliation | `reports:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). independent-SQL checks, dashboard accuracy evidence |
| POST | /api/v1/reports/reconciliation/run | `reports:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/reports.spec.ts). persists + audits a run |
| POST | /api/v1/reports/exports | `reports:export` | P5 | new (renamed from /reports/export) | IMPLEMENTED (verified: apps/api/test/analytics/exports.spec.ts). CSV/XLSX, server-side permission + scope, row caps, audited; large ones queued |
| GET | /api/v1/reports/exports | `reports:export` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/exports.spec.ts). my exports |
| GET | /api/v1/reports/exports/:id | `reports:export` | P5 | new (renamed from /reports/export/:jobId) | IMPLEMENTED (verified: apps/api/test/analytics/exports.spec.ts). requester only |
| GET | /api/v1/reports/exports/:id/download | `reports:export` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/exports.spec.ts). authorised stream, audited, expires |
| GET | /api/v1/reports/saved-filters | `reports:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/exports.spec.ts) |
| POST | /api/v1/reports/saved-filters | `reports:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/exports.spec.ts) |
| DELETE | /api/v1/reports/saved-filters/:id | `reports:view` | P5 | new (added) | IMPLEMENTED (verified: apps/api/test/analytics/exports.spec.ts) |

## SOP (P6)

Status 2026-10-15 (Agent E): every route below is implemented and covered by tests in apps/api/test (sop.spec.ts, people-negative-authz.spec.ts, negative-authz.spec.ts rows). Routes beyond the original catalogue (get document/version, edit draft, submit, reject, retire, remind, acknowledgement history, gap update) are additions needed by the approval workflow.

| Method | Path | Permission key | Phase | Status |
|---|---|---|---|---|
| GET | /api/v1/sop | `sop:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/sop | `sop:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/sop/:id | `sop:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/sop/:id/acknowledgements | `sop:adoption:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/sop/:id/retire | `sop:approve` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/sop/:id/versions | `sop:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/sop/:id/versions | `sop:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/sop/adoption | `sop:adoption:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/sop/gaps | `sop:gaps:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/sop/gaps | `sop:gaps:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/sop/gaps/:id | `sop:gaps:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/sop/versions/:id | `sop:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/sop/versions/:id | `sop:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/sop/versions/:id/acknowledge | `sop:acknowledge` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/sop/versions/:id/approve | `sop:approve` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/sop/versions/:id/reject | `sop:approve` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/sop/versions/:id/remind | `sop:create` + `sop:adoption:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/sop/versions/:id/submit | `sop:create` | P6 | IMPLEMENTED (verified: apps/api tests) |

## Coaching and people (P6)

Includes incentives, engagement and resources. Additions beyond the original catalogue: coaching hours/actions, KPI definitions, scorecard upsert, review submit/acknowledge/get, PIP draft edit/acknowledge/checkpoints, recognition programs, incentive policy edit + adjustments, hiring candidates/profiles/feedback, onboarding templates/items, probation, expectations, succession positions, employee list/upsert (PUT), engagement surveys, resource assignments. Notes: employee profile reads are audited (hr.record_viewed); interview notes are redacted for non-HR/non-hiring-manager callers; incentive recommendations return a status-only projection to the employee concerned.

| Method | Path | Permission key | Phase | Status |
|---|---|---|---|---|
| GET | /api/v1/coaching/actions | `coaching:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/coaching/actions/:id | `coaching:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/coaching/hours | `coaching:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/coaching/one-on-ones | `coaching:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/coaching/one-on-ones | `coaching:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/coaching/sessions | `coaching:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/coaching/sessions | `coaching:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/coaching/sessions/:id | `coaching:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/coaching/sessions/:id | `coaching:update` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/engagement/responses | `engagement:respond` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/engagement/results | `engagement:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/engagement/surveys | `engagement:respond` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/engagement/surveys | `hr:records:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/incentives/adjustments | `incentives:recommendation:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/incentives/policies | `incentives:policy:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/incentives/policies | `incentives:policy:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/incentives/policies/:id | `incentives:policy:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/incentives/policies/:id/approve | `incentives:policy:approve` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/incentives/recommendations | `incentives:recommendation:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/incentives/recommendations | `incentives:recommendation:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/incentives/recommendations/:id | `incentives:recommendation:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/incentives/recommendations/:id/mark-paid | `incentives:recommendation:mark-paid` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/incentives/recommendations/:id/transition | `incentives:recommendation:create` or `incentives:recommendation:approve` or `incentives:recommendation:mark-paid` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/competencies | `reviews:view` or `hiring:view` or `onboarding:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/people/competencies/:id | `reviews:approve` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/employees | `hr:records:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/employees/:id | `hr:records:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PUT | /api/v1/people/employees/:id | `hr:records:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/expectations | `onboarding:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/expectations | `onboarding:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/expectations/:id/acknowledge | `onboarding:view` | P6 | IMPLEMENTED (verified: apps/api/test/people-expectations.spec.ts); the holder of the role acknowledges the CURRENT text (bound to a content hash), idempotent, audited |
| GET | /api/v1/people/expectations/adoption | `onboarding:view` | P6 | IMPLEMENTED (verified: apps/api/test/people-expectations.spec.ts); counts + pending names within scope (team or org), 403 for own scope |
| GET | /api/v1/people/hiring | `hiring:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/hiring | `hiring:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/people/hiring/:id | `hiring:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/hiring/candidates | `hiring:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/hiring/candidates | `hiring:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/hiring/candidates/:id | `hiring:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/hiring/candidates/:id/feedback | `hiring:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/hiring/candidates/:id/stage | `hiring:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/hiring/profiles | `hiring:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PUT | /api/v1/people/hiring/profiles | `hiring:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/kpi-assignments | `kpi-assignments:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/kpi-assignments | `kpi-assignments:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/kpi-definitions | `kpi-assignments:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/kpi-definitions | `kpi-assignments:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/onboarding | `onboarding:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/onboarding | `onboarding:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/people/onboarding/items/:id | `onboarding:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/onboarding/templates | `onboarding:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/onboarding/templates | `onboarding:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/pips | `pip:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/pips | `pip:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/pips/:id | `pip:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/people/pips/:id | `pip:update` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/pips/:id/acknowledge | `pip:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/pips/:id/approve | `pip:approve` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/people/pips/:id/checkpoints/:cid | `pip:update` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/pips/:id/transition | `pip:update` or `pip:approve` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/probation | `onboarding:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/probation/:id/complete | `onboarding:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/recognition-programs | `recognition:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/recognition-programs | `recognition:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/recognitions | `recognition:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/recognitions | `recognition:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/reviews | `reviews:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/reviews | `reviews:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/reviews/:id | `reviews:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/people/reviews/:id | `reviews:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/reviews/:id/acknowledge | `reviews:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/reviews/:id/approve | `reviews:approve` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/reviews/:id/submit | `reviews:create` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/scorecards | `scorecards:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/scorecards | `kpi-assignments:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/succession | `succession:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/succession | `succession:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| DELETE | /api/v1/people/succession/candidates/:id | `succession:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/people/succession/positions | `succession:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/people/team-members | `coaching:view` or `kpi-assignments:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/resources | `resources:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/resources | `resources:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| POST | /api/v1/resources/:id/assign | `resources:manage` | P6 | IMPLEMENTED (verified: apps/api tests) |
| GET | /api/v1/resources/assignments | `resources:view` | P6 | IMPLEMENTED (verified: apps/api tests) |
| PATCH | /api/v1/resources/assignments/:id | `resources:view` | P6 | IMPLEMENTED (verified: apps/api tests) |

## CX, handover, collaboration, Founder (P7)

All implemented by Agent H (see docs/cx-report.md). Additions beyond the original catalogue: watchlist, notes, escalation detail/transition, satisfaction stats and survey templates, refunds view/analytics/root-cause, handover template/edit/request-info/complete, xf-task assignees/dependencies/confirm/escalate, plan links, insights list, CX settings, founder report metrics/new-version/risk register, action-item metrics/detail, assignable users.

| Method | Path | Permission key | Phase | Status |
|---|---|---|---|---|
| GET | /api/v1/cx/assignable-users | `complaints:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). people the caller may assign CX work to (id + name); purpose complaint, action-item or escalation-target |
| GET | /api/v1/cx/complaints | `complaints:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). list (scoped by owner/creator), filters status, priority, category, owner, lead, open, breached, q |
| GET | /api/v1/cx/complaints/trends | `complaints:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). volume, resolution rate, SLA adherence, time to resolve, root causes, categories, priorities |
| POST | /api/v1/cx/complaints | `complaints:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). owner auto-assigned to manager when omitted; SLA deadlines from DEC-017 table |
| GET | /api/v1/cx/complaints/:id | `complaints:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). detail with SLA remaining and state history |
| POST | /api/v1/cx/complaints/:id/transition | `complaints:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). section-7 machine; 409 ILLEGAL_TRANSITION, 422 FIELDS_REQUIRED |
| GET | /api/v1/cx/relationships/watchlist | `relationships:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). key prospects + own watch list |
| POST | /api/v1/cx/relationships/watchlist | `relationships:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). watch a prospect |
| DELETE | /api/v1/cx/relationships/watchlist/:leadId | `relationships:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). stop watching |
| GET | /api/v1/cx/relationships/:leadId | `relationships:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). timeline; summary-scope roles get a minimum-data projection |
| POST | /api/v1/cx/relationships/:leadId/notes | `relationships:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). relationship note (NOTE/PROMISE/PREFERENCE/MILESTONE) |
| GET | /api/v1/cx/escalations | `complaints:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). high-value / complex-conversation escalations |
| POST | /api/v1/cx/escalations | `complaints:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). raise from a lead |
| GET | /api/v1/cx/escalations/:id | `complaints:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). detail + history |
| POST | /api/v1/cx/escalations/:id/transition | `OPEN -> IN_REVIEW -> RESOLVED` | P7 | IMPLEMENTED (verified: apps/api/test/cx). CANCELLED |
| GET | /api/v1/cx/satisfaction | `satisfaction:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). responses (scoped) |
| GET | /api/v1/cx/satisfaction/stats | `satisfaction:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). KPI-CX-001/004 inputs (mean, % satisfied, NPS, low-sample flag) |
| POST | /api/v1/cx/satisfaction | `satisfaction:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). consentGiven=true mandatory |
| GET | /api/v1/cx/survey-templates | `satisfaction:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). active question sets (+ built-ins) |
| POST | /api/v1/cx/survey-templates | `settings:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). new question set (retires the active one of that kind) |
| PATCH | /api/v1/cx/survey-templates/:id | `settings:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). edit questions (version+1) / activate |
| GET | /api/v1/cx/refunds | `refunds:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). read-only tracking view of revenue refunds (requested/approved/processed separately); summary scope = no money |
| GET | /api/v1/cx/refunds/analytics | `refunds:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). KPI-CX-002 like-for-like inputs per programme x month |
| POST | /api/v1/cx/refunds/:refundId/root-cause | `refunds:view` + `complaints:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). tag refund root cause (CX-owned table) |
| GET | /api/v1/handovers | `handover:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). inbox/list; Student Success never sees drafts; Operations gets status-only rows |
| GET | /api/v1/handovers/template | `handover:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). required checklist fields (configurable) |
| POST | /api/v1/handovers | `handover:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). manual creation for a WON sale (normally auto-created from deal.closed / lead.won) |
| GET | /api/v1/handovers/:id | `handover:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). detail, checklist, history |
| PATCH | /api/v1/handovers/:id | `handover:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). edit checklist fields (DRAFT / INFO_REQUESTED only) |
| POST | /api/v1/handovers/:id/submit | `handover:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). 422 HANDOVER_INCOMPLETE lists missing fields |
| POST | /api/v1/handovers/:id/acknowledge | `handover:acknowledge` | P7 | IMPLEMENTED (verified: apps/api/test/cx). SUBMITTED|OVERDUE -> ACKNOWLEDGED |
| POST | /api/v1/handovers/:id/request-info | `handover:acknowledge` | P7 | IMPLEMENTED (verified: apps/api/test/cx). SUBMITTED -> INFO_REQUESTED (+ CRM task for the seller) |
| POST | /api/v1/handovers/:id/complete | `handover:acknowledge` | P7 | IMPLEMENTED (verified: apps/api/test/cx). ACKNOWLEDGED -> COMPLETED (+ enrolment-experience survey request) |
| GET | /api/v1/xf-tasks | `xf-tasks:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). department-scoped visibility |
| GET | /api/v1/xf-tasks/assignees | `xf-tasks:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). users of a department (id + name) |
| POST | /api/v1/xf-tasks | `xf-tasks:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). owner must be in the department; PII rejected for Marketing/Community/Operations |
| GET | /api/v1/xf-tasks/:id | `xf-tasks:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). detail, comments, dependencies, history |
| PATCH | /api/v1/xf-tasks/:id | `xf-tasks:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). details and section-8 transitions |
| POST | /api/v1/xf-tasks/:id/comments | `xf-tasks:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). comment |
| POST | /api/v1/xf-tasks/:id/dependencies | `xf-tasks:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). add dependency (cycle-safe) |
| POST | /api/v1/xf-tasks/:id/confirm | `xf-tasks:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). requester confirms completion |
| POST | /api/v1/xf-tasks/:id/escalate | `xf-tasks:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). manual escalation (notifies manager + Team Lead) |
| GET | /api/v1/collaboration/plan-links | `xf-tasks:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). campaign / webinar / event / lead-gen plans with planned vs actual intake |
| POST | /api/v1/collaboration/plan-links | `xf-tasks:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). create plan link |
| GET | /api/v1/dev-panel/features/summary | `devpanel:features:view` | Dev | IMPLEMENTED (verified: apps/api/test/devpanel/features.spec.ts). roles/users that have Feature-access overrides |
| GET | /api/v1/dev-panel/features | `devpanel:features:view` | Dev | IMPLEMENTED (verified). every permission for a role or user: default, override, effective scope (`?subjectType=ROLE\|USER&subject=`) |
| PUT | /api/v1/dev-panel/features | `devpanel:features:manage` | Dev | IMPLEMENTED (verified). batch ON/OFF/DEFAULT switches in one transaction; sensitive grants need `confirmSensitive`; devpanel:* keys, the Developer role and your own access are refused; audited with before/after |
| POST | /api/v1/dev-panel/features/reset | `devpanel:features:manage` | Dev | IMPLEMENTED (verified). remove every override of one role/user; audited |
| PATCH | /api/v1/collaboration/plan-links/:id | `xf-tasks:update` | P7 | IMPLEMENTED_UNTESTED. edit plan (title, window, planned leads, sales note, program/campaign/source) or move status PLANNED→ACTIVE→COMPLETED / CANCELLED; closed plans are final (409); audited |
| GET | /api/v1/cx/insights | `insights:share` | P7 | IMPLEMENTED (verified: apps/api/test/cx). insights shared with my department |
| POST | /api/v1/cx/insights | `insights:share` | P7 | IMPLEMENTED (verified: apps/api/test/cx). share an insight (minimum data) |
| GET | /api/v1/cx/settings | `settings:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). effective CX configuration + defaults |
| PATCH | /api/v1/cx/settings | `settings:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). complaint SLA, handover timers/checklist, report cadence (validated, audited) |
| GET | /api/v1/founder-reports | `founder-reports:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). history |
| GET | /api/v1/founder-reports/metrics | `founder-reports:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). KPI-FND-002/003 inputs |
| POST | /api/v1/founder-reports | `founder-reports:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). start a draft (idempotent per period) |
| GET | /api/v1/founder-reports/:id | `founder-reports:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). draft with live data sections / published with versions |
| PATCH | /api/v1/founder-reports/:id | `founder-reports:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). edit draft; 409 REPORT_IMMUTABLE once published |
| POST | /api/v1/founder-reports/:id/submit | `founder-reports:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). publish = immutable snapshot + SHA-256 (idempotent) |
| GET | /api/v1/founder-reports/:id/snapshot | `founder-reports:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). frozen content + integrity check |
| POST | /api/v1/founder-reports/:id/new-version | `founder-reports:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). correction as a new version |
| POST | /api/v1/founder-reports/:id/review | `founder-reports:review` | P7 | IMPLEMENTED (verified: apps/api/test/cx). rating 1-5 + note (not part of the snapshot) |
| GET | /api/v1/risk-register | `founder-reports:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). risks |
| POST | /api/v1/risk-register | `founder-reports:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). raise a risk |
| PATCH | /api/v1/risk-register/:id | `founder-reports:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). update / resolve |
| GET | /api/v1/action-items | `action-items:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). scoped list |
| GET | /api/v1/action-items/metrics | `action-items:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). KPI-FND-001 inputs |
| POST | /api/v1/action-items | `action-items:create` | P7 | IMPLEMENTED (verified: apps/api/test/cx). owner, due date |
| GET | /api/v1/action-items/:id | `action-items:view` | P7 | IMPLEMENTED (verified: apps/api/test/cx). detail + history |
| PATCH | /api/v1/action-items/:id | `action-items:update` | P7 | IMPLEMENTED (verified: apps/api/test/cx). section-8 transitions; completion needs note + evidence |

## Notifications, files, integrations, AI, devices (P8/P9)

Implemented by Agent F (see docs/platform-report.md). Source column: `BP` = Blueprint, `new` = added from Master Spec.

| Method | Path | Permission key | Phase | Status / notes |
|---|---|---|---|---|
| GET | /api/v1/notifications | `notifications:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - own notifications; cursor pagination, `status`, `type`, `since` (polling fallback), meta.unreadCount |
| GET | /api/v1/notifications/stream | `notifications:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - SSE scoped to the caller (events ready/notification/unread); distinct from the CRM task stream `/stream` |
| GET | /api/v1/notifications/unread-count | `notifications:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) |
| GET | /api/v1/notifications/types | `notifications:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - catalogue of 26 types |
| POST | /api/v1/notifications/read-all | `notifications:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) |
| POST | /api/v1/notifications/:id/read | `notifications:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - 404 for anyone but the owner |
| POST | /api/v1/notifications/:id/dismiss | `notifications:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) |
| GET | /api/v1/notifications/preferences | `notifications:manage-prefs` | P8 | IMPLEMENTED (verified: apps/api/test/platform) |
| PUT | /api/v1/notifications/preferences | `notifications:manage-prefs` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - per type/channel + personal quiet hours |
| GET | /api/v1/notifications/rules | `notifications:config` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - org rules + working/quiet hours + digest |
| PATCH | /api/v1/notifications/rules | `notifications:config` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - audited |
| POST | /api/v1/files | `files:upload` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - multipart streaming; abuse suite; async processing |
| GET | /api/v1/files | `files:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - own/team/org scope by uploader, or by entity (`entityType`+`entityId`) |
| GET | /api/v1/files/settings | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - limits/quota/TTL/retention + scanner/PDF honesty notes |
| PATCH | /api/v1/files/settings | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - audited |
| GET | /api/v1/files/:id | `files:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - status/progress/scan/processing note |
| GET | /api/v1/files/:id/download-url | `files:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - signed URL, TTL <= 300 s, attachment |
| GET | /api/v1/files/:id/download | `files:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - authenticated stream, nosniff, no-store |
| POST | /api/v1/files/:id/attach | `files:upload` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - entity resolver decides; unregistered types rejected |
| POST | /api/v1/files/:id/retry | `files:delete` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - recovery of FAILED processing |
| DELETE | /api/v1/files/:id | `files:delete` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - soft delete, audited, purge after retention |
| GET | /api/v1/recordings | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - BLOCKED (DEC-014): always 403 RECORDINGS_DISABLED |
| POST | /api/v1/recordings | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - BLOCKED (DEC-014): always 403 RECORDINGS_DISABLED |
| POST | /api/v1/integrations/telephony/webhook | `public + HMAC signature + replay check` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - raw-body HMAC, +-300 s, replay store; call events -> CallEventPort (source PROVIDER) |
| POST | /api/v1/integrations/webhooks/:provider | `public + HMAC signature + replay check` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - delivery.status callbacks (only path to DELIVERED) and call.event |
| GET | /api/v1/integrations | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - provider catalogue + config view; secrets never returned |
| GET | /api/v1/integrations/health | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - delivery counts, dead letters, failed files |
| GET | /api/v1/integrations/failures | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - journey 15: failed deliveries/files/dead events with recovery hints |
| GET | /api/v1/integrations/deliveries | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - delivery log |
| GET | /api/v1/integrations/deliveries/:id | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - with status-transition history |
| POST | /api/v1/integrations/deliveries/:id/retry | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - FAILED/DEAD_LETTER -> QUEUED, audited |
| GET | /api/v1/integrations/consent | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) |
| PUT | /api/v1/integrations/consent | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - opt-in / opt-out, audited |
| PATCH | /api/v1/integrations/:provider | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - enable/mode/settings/write-only secrets; blocked providers 409 |
| POST | /api/v1/integrations/:provider/health | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) |
| POST | /api/v1/integrations/:provider/test | `integrations:manage` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - queue a test message (sandbox never reaches a person) |
| GET | /api/v1/ai/status | `ai:use` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - {enabled} for UI gating (other AI routes 404 when the flag is off) |
| GET | /api/v1/ai/config | `ai:config` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - no keys |
| PATCH | /api/v1/ai/config | `ai:config` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - audited; flag default OFF |
| GET | /api/v1/ai/usage | `ai:usage:view` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - usage, latency, failures, estimated cost |
| POST | /api/v1/ai/summarize | `ai:use` | P8 | IMPLEMENTED (verified: apps/api/test/platform) |
| POST | /api/v1/ai/extract | `ai:use` | P8 | IMPLEMENTED (verified: apps/api/test/platform) |
| POST | /api/v1/ai/draft-followup | `ai:use` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - draft only; never sent |
| GET | /api/v1/ai/call-brief/:leadId | `ai:use` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - needs a CrmContextProvider (Agent D); otherwise insufficient data |
| GET | /api/v1/ai/lead-priority | `ai:use` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - rule-based, factors listed |
| GET | /api/v1/ai/suggestions | `ai:use` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - own |
| GET | /api/v1/ai/suggestions/:id | `ai:use` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - own |
| PATCH | /api/v1/ai/suggestions/:id | `ai:use` | P8 | IMPLEMENTED (verified: apps/api/test/platform) - ACCEPT / EDIT / REJECT, audited, executes nothing |
| GET | /api/v1/devices/settings | `integrations:manage` | P9 | IMPLEMENTED (verified: apps/api/test/platform) - flag `devices.enabled` (default off; Android go/no-go NO-GO) |
| PATCH | /api/v1/devices/settings | `integrations:manage` | P9 | IMPLEMENTED (verified: apps/api/test/platform) |
| POST | /api/v1/devices/register | `devices:register` | P9 | IMPLEMENTED (verified: apps/api/test/platform) - 403 DEVICES_DISABLED while flag off; needs disclosure acceptance; PENDING until approved |
| GET | /api/v1/devices | `devices:register` or `integrations:manage` | P9 | IMPLEMENTED (verified: apps/api/test/platform) - own / org |
| POST | /api/v1/devices/:id/approve | `integrations:manage` | P9 | IMPLEMENTED (verified: apps/api/test/platform) |
| DELETE | /api/v1/devices/:id | `devices:register` or `integrations:manage` | P9 | IMPLEMENTED (verified: apps/api/test/platform) - revoke (owner or admin) |

Total endpoints: 205.

Cross-cutting: `Idempotency-Key` header on POST /leads/import, POST /collections, POST /refunds, POST /deals/:id/close, webhooks. SSE stream `/api/v1/stream` carries notification/task events with per-user authorization and polling fallback `GET /notifications?since=`.

## Workforce (DEC-048)

81 routes under `/api/v1/workforce/*` (attendance, holidays, leave, earned-leave, goals, tasks, payroll, directory, HR, reports, settings). Extracted from the controllers on 2026-10-15; request/response contracts, permission keys and semantics: `docs/workforce-report.md` section 3, permission keys: `docs/permissions-matrix.md` (workforce section). Every route is covered by `apps/api/test/workforce/cases*.ts`.

| Method | Path |
|---|---|
| POST | `/api/v1/workforce/attendance/check-in` |
| POST | `/api/v1/workforce/attendance/check-out` |
| GET | `/api/v1/workforce/attendance/today` |
| GET | `/api/v1/workforce/attendance/month` |
| POST | `/api/v1/workforce/attendance/meeting-join` |
| GET | `/api/v1/workforce/attendance/day` |
| GET | `/api/v1/workforce/attendance/team-summary` |
| PUT | `/api/v1/workforce/attendance/records` |
| GET | `/api/v1/workforce/attendance/corrections` |
| GET | `/api/v1/workforce/directory` |
| GET | `/api/v1/workforce/directory/departments` |
| GET | `/api/v1/workforce/directory/:userId` |
| GET | `/api/v1/workforce/directory` |
| GET | `/api/v1/workforce/directory` |
| GET | `/api/v1/workforce/directory` |
| POST | `/api/v1/workforce/directory` |
| DELETE | `/api/v1/workforce/directory/:id` |
| GET | `/api/v1/workforce/earned-leave/progress` |
| GET | `/api/v1/workforce/earned-leave/transactions` |
| POST | `/api/v1/workforce/earned-leave/run` |
| POST | `/api/v1/workforce/goals` |
| GET | `/api/v1/workforce/goals` |
| GET | `/api/v1/workforce/goals/summary` |
| GET | `/api/v1/workforce/goals/:id` |
| GET | `/api/v1/workforce/goals/:id/export` |
| PATCH | `/api/v1/workforce/goals/:id` |
| POST | `/api/v1/workforce/goals/:id/progress` |
| POST | `/api/v1/workforce/goals/:id/milestones` |
| PATCH | `/api/v1/workforce/goals/:id/milestones/:milestoneId` |
| POST | `/api/v1/workforce/goals/:id/comment` |
| POST | `/api/v1/workforce/goals/:id/submit` |
| POST | `/api/v1/workforce/goals/:id/verify` |
| POST | `/api/v1/workforce/goals/:id/return` |
| POST | `/api/v1/workforce/goals/:id/cancel` |
| GET | `/api/v1/workforce/holidays` |
| POST | `/api/v1/workforce/holidays` |
| POST | `/api/v1/workforce/holidays/suggest` |
| PATCH | `/api/v1/workforce/holidays/:id` |
| DELETE | `/api/v1/workforce/holidays/:id` |
| POST | `/api/v1/workforce/holidays/:id/approve` |
| GET | `/api/v1/workforce/hr/profiles/:userId` |
| PATCH | `/api/v1/workforce/hr/profiles/:userId` |
| GET | `/api/v1/workforce/hr/birthdays` |
| GET | `/api/v1/workforce/birthdays/upcoming` |
| GET | `/api/v1/workforce/hr/probation` |
| GET | `/api/v1/workforce/hr/probation/:userId/history` |
| POST | `/api/v1/workforce/hr/probation/:userId/decision` |
| GET | `/api/v1/workforce/hr/joiners/options` |
| POST | `/api/v1/workforce/hr/joiners` |
| GET | `/api/v1/workforce/leave/types` |
| GET | `/api/v1/workforce/leave/balances` |
| POST | `/api/v1/workforce/leave/balances/adjust` |
| GET | `/api/v1/workforce/leave/ledger` |
| GET | `/api/v1/workforce/leave/calendar` |
| POST | `/api/v1/workforce/leave/requests` |
| GET | `/api/v1/workforce/leave/requests` |
| GET | `/api/v1/workforce/leave/requests/:id` |
| POST | `/api/v1/workforce/leave/requests/:id/decision` |
| POST | `/api/v1/workforce/leave/requests/:id/cancel` |
| GET | `/api/v1/workforce/payroll/structures` |
| GET | `/api/v1/workforce/payroll/structures/:userId` |
| POST | `/api/v1/workforce/payroll/structures` |
| POST | `/api/v1/workforce/payroll/runs` |
| GET | `/api/v1/workforce/payroll/runs` |
| GET | `/api/v1/workforce/payroll/runs/:id` |
| POST | `/api/v1/workforce/payroll/runs/:id/calculate` |
| POST | `/api/v1/workforce/payroll/runs/:id/payslips/:slipId/adjustments` |
| DELETE | `/api/v1/workforce/payroll/runs/:id/payslips/:slipId/adjustments/:adjustmentId` |
| POST | `/api/v1/workforce/payroll/runs/:id/approve` |
| POST | `/api/v1/workforce/payroll/runs/:id/send-back` |
| POST | `/api/v1/workforce/payroll/runs/:id/mark-paid` |
| POST | `/api/v1/workforce/payroll/runs/:id/cancel` |
| GET | `/api/v1/workforce/payroll/runs/:id/export` |
| GET | `/api/v1/workforce/payroll/payslips/mine` |
| GET | `/api/v1/workforce/payroll/payslips/:id` |
| GET | `/api/v1/workforce/reports/:report` |
| GET | `/api/v1/workforce/reports/:report/export` |
| GET | `/api/v1/workforce/settings` |
| PATCH | `/api/v1/workforce/settings` |
| POST | `/api/v1/workforce/tasks` |
| GET | `/api/v1/workforce/tasks` |
| GET | `/api/v1/workforce/tasks/summary` |
| GET | `/api/v1/workforce/tasks/:id` |
| PATCH | `/api/v1/workforce/tasks/:id` |
| POST | `/api/v1/workforce/tasks/:id/transition` |
| POST | `/api/v1/workforce/tasks/:id/comment` |

## Developer Panel / maintenance mode

State lives in Redis (`<BULLMQ_PREFIX>:devpanel:maintenance`), cached ~2s in memory. It fails OPEN: if Redis is unreachable or the value is malformed, maintenance is treated as OFF and a warning is logged. While ON, a global interceptor answers `503 {code:'MAINTENANCE', message, details:{eta}}` plus `Retry-After` to authenticated callers without `devpanel:access`. Always allowed: `/health`, `/health/ready`, `/ready`, `/metrics`, `/auth/{login,logout,me,csrf,sessions/revoke,password/forgot,password/reset,invite/accept}`, `/maintenance/status`, and inbound provider webhooks (`/integrations/telephony/webhook`, `/integrations/webhooks/:provider`; blocking them would lose events). The list is in `apps/api/src/modules/devpanel/maintenance/maintenance.guard-logic.ts`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/dev-panel/maintenance` | `devpanel:access` | `{enabled, message, eta, enabledAt, enabledBy:{id,name}}` |
| POST | `/api/v1/dev-panel/maintenance/enable` | `devpanel:access` + `devpanel:maintenance:manage` | body `{message (3-300), eta? (future ISO)}`; idempotent (re-enable updates message); audit `devpanel.maintenance_enabled` |
| POST | `/api/v1/dev-panel/maintenance/disable` | same | audit `devpanel.maintenance_disabled` |
| GET | `/api/v1/maintenance/status` | public, rate limited | `{enabled, message, eta}` only, no actor info |


## Account approval and password reset (identity)

| Method and path | Permission | Notes |
|---|---|---|
| `POST /users` | `users:create` (Founder, HR, Developer) | Creates the account as PENDING; no invite, no login. HR may give employee roles only. |
| `GET /users/pending` | `users:approve` | Accounts waiting for approval; `canApprove` is false for the creator (while another approver exists) and for leadership accounts when the caller is HR. |
| `POST /users/:id/approve` | `users:approve` | Creator cannot approve (403 `SELF_APPROVAL`) unless there is no other approver. Returns `{ invite: { link, expiresAt } }` once. |
| `POST /users/:id/reject` | `users:approve` | Body `{ reason? }`. Account is closed. |
| `POST /users/:id/invite-link` | `users:create` | Re-issue the invite for an APPROVED account that has no password yet (409 while pending/rejected). |
| `GET /users/password-resets` | `users:password:reset` | Pending "forgot password" requests. |
| `POST /users/password-resets/:requestId/issue` | `users:password:reset` | One-time reset link, returned once. |
| `POST /users/password-resets/:requestId/dismiss` | `users:password:reset` | |
| `POST /users/password-resets/direct` | `users:password:reset` | Body `{ email }`; reset link for someone who did not ask. |
| `POST /auth/password/forgot` | public | Same answer for every email; a real, approved account gets a pending request (no e-mail). |


## Company Zoom meetings (workforce)

| Method and path | Permission | Notes |
|---|---|---|
| `GET /meetings/active` | `meetings:view` (everyone) | Meetings addressed to the caller that are on now or coming up (max 10), with the Zoom link and the caller's `joinedAt`. |
| `POST /meetings/:id/join` | `meetings:view` | Records the first Join; 404 unless the meeting is on, not cancelled and addressed to the caller. |
| `GET /meetings` | `meetings:manage` (Founder, HR, Developer) | Filters: `status`, `q`, `from`, `to` (IST dates), `audience` (EVERYONE/SELECTED), `roleKey`, `teamId`, `userId`. Each row has `audience`, `invitedCount`, `joinedCount`. |
| `GET /meetings/options` | `meetings:manage` | Roles, teams and people for the audience pickers. |
| `GET /meetings/:id` | `meetings:manage` | Invited people with who has joined. |
| `POST /meetings` | `meetings:manage` | `{ title, url (https zoom.us only), startsAt (ISO with offset), durationMinutes (15-480), note?, audience: { everyone, roles[], teamIds[], userIds[] } }`; 400 for non-Zoom links, past/too-far times, unknown teams/people or an audience nobody matches. |
| `DELETE /meetings/:id` | `meetings:manage` | Cancels (kept in the list as CANCELLED), audited. |
