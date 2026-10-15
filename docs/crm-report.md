# CRM core report and integration guide (Phase 3, Agent D)

Date: 2026-10-15. Scope: leads, calls, tasks, follow-up engine, queues, imports, webinars/events/demos, configuration, live updates.
Everything here is implemented; real test results are in section 11. Decisions used are the defaults from `docs/decision-log.md` (DEC-006, 008, 010, 011, 020, 026, 031, 038, 039) and are all configurable.

## 1. Layout

```
prisma/schema/crm.prisma                 all CRM models (db push only, no migrations)
packages/crm-core                        NEW workspace package @salesos/crm-core (framework free, Prisma tx based)
   working-hours.ts  phone.ts  csv.ts  rules.ts  stages.ts  config.ts  leads.ts  import.ts  deps.ts  errors.ts
packages/shared-types/src/events/crm.ts  CRM_EVENTS, payload types, NotificationPort contract
packages/validation/src/crm.ts           every request schema (strict Zod)
apps/api/src/modules/crm/**              controllers + services (leads, calls, tasks, imports, queues, config, events, stream)
apps/api/src/common/authz/permissions/crm.ts   unchanged (matrix keys were pre-seeded)
apps/worker/src/jobs/crm/**              handlers, scans, notifications (NotificationPort default = in-app)
apps/api/src/seed/domains/crm.ts         [DEMO] data (idempotent)
apps/web/src/app/(app)/crm/**, apps/web/src/features/crm/**, apps/web/src/nav/crm.ts   UI (section 10)
apps/api/test/crm/*.spec.ts, apps/worker/test/crm.spec.ts   tests
```

Why `@salesos/crm-core`: the API (request path) and the worker (CSV imports, `user.deactivated`, scans) must create leads, assign, transition and raise exceptions with identical rules. The package holds that logic once. It takes the caller's transaction client plus a `CoreDeps { audit, publish }` pair: the API injects `AuditService`/`OutboxService` wrappers (request id/IP are attached automatically), the worker uses `directDeps()` that writes the same `audit_logs` / `outbox_events` rows. Root `build:packages` builds it; vitest aliases point at its source.

Deviation (reconcile step): CRM tables carry `organization_id` / user ids as indexed UUID columns **without** `@relation` to `organizations`/`users`/`teams` (to avoid ~40 back-relation edits in `identity.prisma` during the parallel wave). Integrity is enforced in services (every write validates org + target user). Relations inside the CRM domain are real FKs. The lead may add the FKs at consolidation.

Enum names that would collide with other domains were prefixed: `LeadConsentStatus`, `LeadNoteVisibility`, `CrmDeliveryStatus`. `Event` is `CrmEvent` (table `events`). Call `source` values are `MANUAL | DEVICE | PROVIDER` (the traceability text says `*_VERIFIED`; the lead's brief wins).

## 2. Data model (tables)

`lead_sources`, `lead_campaigns`, `programs`, `leads`, `lead_assignments`, `lead_status_history`, `lead_notes`, `lead_contacts`, `duplicate_candidates`, `lead_merges`, `call_logs`, `call_notes`, `tasks`, `lead_exceptions` (materialised exception queue), `reassignment_queue`, `reactivation_queue`, `events` + `event_attendance` (webinars/demos/events), `import_jobs`, `import_errors`, `lead_stage_config`, `lost_reason_config`, `automation_rules` (org/team), `assignment_rules` (round-robin per team), `crm_notification_deliveries`, `lead_saved_views`. Outbox/audit/idempotency tables are Agent B's.

Key columns: `leads.phone_e164` (+ `phone_raw`, `phone_valid` = flagged raw), consent (`consent_status/at/source`), `program_id`, `interest_level`, `next_action_at/type`, `estimated_value` (Decimal), `lost_reason`, `last_activity_at` (meaningful activity), `duplicate_flag`, `merged_into_id`, `version`. Indexes required by the Blueprint exist and are asserted by `test/crm/indexes.spec.ts` (leads `(org, assigned_to, status, created_at DESC)`, tasks `(status, due_at, assigned_to)`, call_logs `(lead_id, created_at DESC)`).

## 3. Lead lifecycle (docs/state-machines.md section 1, implemented exactly)

`evaluateTransition()` (crm-core `stages.ts`) is the only place that decides legality; `transitionLeadTx()` is the only writer of `leads.status` (history row + audit + outbox in the same transaction, row lock via `SELECT ... FOR UPDATE`).
- Stages and lost reasons are rows (`lead_stage_config`, `lost_reason_config`), seeded with the DEC-006 defaults; each stage has `category` (OPEN/WON/LOST/NURTURE), `skippable`, `canClose`, `allowedNext`. Forward moves: listed edge or only skippable stages in between; backward moves need a reason; WON is terminal; LOST only from OPEN and needs a configured reason (+ note for OTHER); NURTURE only from LOST (system); reopen only to CONTACT_ATTEMPTED and only by holders of `leads:assign` (managers/team lead/founder).
- Illegal transitions: `409 INVALID_TRANSITION` (state unchanged). **LOST is never automatic**: no code path sets it except an explicit human status change or LOST disposition (test: 8 failed calls leave the lead OPEN and write no `lead.lost` audit).
- Webinar/demo attendance moves the lead along WEBINAR_*/DEMO_* stages only where the machine allows (otherwise the lead stays and a warning is returned).

## 4. Calls, dispositions and automation (one transaction)

`POST /leads/:id/calls` writes in ONE transaction: `call_logs` (source always MANUAL; a `source` field in the body is rejected), `call_notes`, completion of the linked task, status-history rows (one per hop, e.g. NEW to CONTACT_ATTEMPTED to CONNECTED), lead counters, the automation task(s), exception sync, audit, outbox. Fault injection at three points (`CRM_FAULT_INJECTOR` provider) proves full rollback (calls.spec.ts).

| Outcome | Required | Effect (defaults, DEC-026; configurable org < team via `automation_rules`) |
|---|---|---|
| CONNECTED | interest + next action time | next-action task of the chosen type; path to CONNECTED; resets counters |
| NO_ANSWER | - | retry CALL task +180 working minutes; at most 3/day (then next working day); 5 total then MANAGER_REVIEW exception + review task for the manager. Never LOST |
| BUSY | optional callback time | CALLBACK task at the requested time (honoured exactly, warning if outside hours) else +60 working minutes |
| SWITCHED_OFF | - | retry +1 working day; 3 consecutive then MANAGER_REVIEW |
| CALLBACK | callback time | HIGH priority, pinned CALLBACK task; reminder 15 min before due |
| FAILED | - | valid outcome; retry task only when chosen or rule `FAILED.createRetryTask` |
| WON | positive value | path to WON, `won_value/won_at`, open tasks resolved, ONBOARDING task, `lead.won` event |
| LOST | reason (+note) | LOST, open tasks cancelled, history kept, reactivation entry per lost-reason rule |

Working hours: `WORKING_HOURS` rule (default Mon-Sat 09:00-19:00 Asia/Kolkata, holidays list), implemented without external libs (`working-hours.ts`: `addWorkingMinutes/Days`, `workingMinutesBetween`, `nextWorkingTime`; tested incl. Sunday, holidays, another timezone).

## 5. Worker, reliability and notifications

Event handlers (registered in `apps/worker/src/jobs/crm/index.ts`): `user.deactivated` (reassignment queue), `task.due|reminder|overdue|escalated`, `lead.unattended`, `lead.assigned`, `lead.exception_raised`, `import.requested`.
Scans (BullMQ repeatables on queue `crm-scans`, every one DB-driven and idempotent): `due-reminders` 30 s, `overdue-escalation` 60 s, `delivery-retry` 60 s, `import-sweep` 60 s, `unattended-scan` 5 min, `reactivation-scan` 1 h, `ageing-scan` 1 h.
- **Atomic task locking**: `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING` with an expiring lease (`locked_until`). A crashed worker's lease expires and the next scan finishes the work; concurrent workers never process the same task (worker test: 4 workers x 12 tasks = 12 events).
- **No duplicate reminders**: outbox idempotency keys `task.due:<task>:<dueAt>`, `task.reminder:...`, `task.overdue:<task>:<dueAt>:<level>`, `lead.unattended:<lead>:<window>`; notification rows are keyed `(organization, <kind>:<entity>:<window>:<recipient>:<channel>)`. Rescheduling changes the due time, which opens a new window and resets `overdue_level`/`reminded_at`.
- **Overdue ladder (DEC-026)**: level 1 owner at due+0, level 2 owner again after +4 h, level 3 manager after 1 working day, level 4 team lead after 3 working days (thresholds from the `OVERDUE` rule, elapsed time counted in working minutes).
- **Restart**: nothing lives only in Redis. Scans read the DB; imports resume from `import_jobs.processed_rows` (rows are idempotent through `import_row_key`); `import-sweep` re-claims jobs whose lease expired; the outbox relay is Agent B's.
- **Delivery tracking**: `crm_notification_deliveries` (QUEUED -> SENT -> DELIVERED | FAILED, attempts, `provider_reference`, `provider_error_code`, `next_attempt_at`, bounded to 5 attempts with exponential backoff; orphaned QUEUED rows are retried). In-app rows become DELIVERED only when the user reads them.

### NotificationPort (for Agent F / the notifications module)
`packages/shared-types/src/events/crm.ts` defines `NotificationPort.send(CrmNotification) -> NotificationResult` and `CRM_EVENTS`. The CRM worker builds `CrmNotification` objects with stable `idempotencyKey`s and calls the active port (`setNotificationPort()` in `apps/worker/src/jobs/crm/notifications.ts`; default `InAppNotificationPort` stores rows in `crm_notification_deliveries`). To plug in email/push/WhatsApp, implement the port (it must treat a repeated key as a no-op) and call `setNotificationPort(yourPort)` at worker start, or subscribe to the same outbox events (`task.due`, `task.reminder`, `task.overdue`, `task.escalated`, `lead.unattended`, `lead.assigned`) with your own handler. `GET /crm-notifications` and the SSE `notification` events expose the in-app rows meanwhile; the shell bell is yours to wire.

## 6. Imports

`POST /leads/import` accepts raw `text/csv` (body up to 5 MB, `?fileName=&options=<json>`) or JSON `{csv, options}` (the global JSON parser limit is 100 kB). Header `Idempotency-Key` or, when absent, a content hash scoped to the user makes the upload idempotent (same job returned, `meta.idempotentReplay`). The request only stores the job (QUEUED) and publishes `import.requested`; the worker (or the sweep) processes it with progress (`processed_rows`), row-level `import_errors` (errors and `WARN_*` warnings, original values kept), `COMPLETED | COMPLETED_WITH_ERRORS | FAILED`, retry endpoint (`imports:manage`), downloadable CSV report (`/errors?format=csv`). Rows: invalid phone is imported as flagged raw (warning), duplicates are imported and flagged, never merged.

## 7. Assignment, reassignment, queues

Manual assignment (reason mandatory, history in `lead_assignments`, audit `ownership.changed`, previous owner's open tasks move with the lead), configurable round-robin per team (`assignment_rules`: enabled flag, daily cap, excluded users on leave, source/program filters, persisted pointer under a row lock, DEC-008). `user.deactivated` -> one `reassignment_queue` entry per open lead and per open task (unique `open_key`, idempotent per event), leads flagged `OWNER_DEACTIVATED`, manager notified once; managers resolve in bulk (`POST /reassignment-queue/bulk-assign`, per-entry results). Exception queue = `lead_exceptions` (NO_OWNER, NO_NEXT_ACTION, UNATTENDED, MANAGER_REVIEW, OWNER_DEACTIVATED) maintained in the same transaction as every change plus the worker scans, so the invariant "every active lead has an owner AND a next action, or is visible in the queue" cannot silently break. Reactivation queue per DEC-031 (BAD_TIMING 30 d, NO_RESPONSE_EXHAUSTED 45 d, PRICE 60 d, configurable per reason; excluded reasons and withdrawn consent never enter; max 2 attempts; LOST to NURTURE by the scan; reactivation reopens, assigns round-robin/manual and creates a task).

## 8. Duplicates, merge, consent

Detection on create/update/import (phone exact, e-mail case-insensitive, name + phone-suffix fuzzy) creates `duplicate_candidates` and flags both leads; never merges. Review: side-by-side list, `dismiss` or `merge` (winner choice, per-field "take from other", reason). Merge moves calls/notes/tasks/history/assignments/attendance to the winner, hides the loser (`merged_into_id`), stores full before/after snapshots in `lead_merges`, audits `lead.merged` without contact PII, more restrictive consent wins, unmerge unsupported (DEC-011). Consent fields (`consent_status/at/source`) are editable (audited) and withdrawal/DND closes reactivation entries.

## 9. Live updates (SSE + polling fallback)

`GET /stream` (Server-Sent Events, `Last-Event-ID`/`?since=`) emits `task`, `notification`, `exceptions`, `cursor`, `ready`, `bye`; max lifetime 10 min so permission changes apply on reconnect (`CRM_STREAM_MAX_MS`, poll interval `CRM_STREAM_POLL_MS`, default 3 s). Every query is built from the caller's permissions + `scopedWhere` (peer executives and sibling managers receive nothing about each other's records: stream.spec.ts). `GET /stream/poll?since=` returns the same payload (5 s look-back overlap for commit visibility; clients de-duplicate by `id@updatedAt`).

## 10. UI (apps/web)

Routes under `/crm` (all mobile-first, loading / empty / error / success / permission-denied states, i18n en/hi/mr, `tel:` links, no mock data):
`/crm` executive workspace (today's tasks, pinned callbacks, priority leads with last contact, last objection and webinar/demo status, one-hand flow), `/crm/leads` (search, filters, saved views, sort, create), `/crm/leads/[id]` (stage stepper, `tel:` dial button, mandatory disposition sheet labelled MANUAL with +3h / tomorrow 10:00 / custom quick picks, quick note, task creation, assign/reassign with reason, status change, timeline, calls, tasks and events tabs), `/crm/tasks`, `/crm/calendar` (agenda / week / month), `/crm/overdue`, `/crm/exceptions`, `/crm/reassignment` (bulk assign with per-entry result), `/crm/duplicates` (side-by-side, winner choice, per-field take, confirm), `/crm/reactivation`, `/crm/imports` (upload, mapping preview, options, live progress, error/warning table, CSV report download, retry), `/crm/events` and `/crm/events/[id]` (attendance with only legal next states), `/crm/settings` (programs, sources/campaigns, stages, lost reasons, automation rules with team override, round-robin). Manager screens are hidden/denied for own-scope roles (`minScope`). Live updates use `EventSource('/stream')` with credentials and fall back to `/stream/poll`; an indicator shows which mode is active.
Return-from-dialer (BP-AND-002): tapping a `tel:` link stores a pending call (30 min expiry, storage failures tolerated); when the tab becomes visible again the disposition sheet opens, and an "Unlogged call" banner stays on CRM pages until logged or dismissed. Manual logging has no device dependency.
Known UI gaps (closed by the integration pass): task edit/reschedule dialog (lead page, task list, calendar), lead-field edit form, reassignment history (queue page History tab + lead Overview ownership panel) and the notification bell all exist now. Still open: timeline shows actor names without links.

## 11. Verification (real runs, 2026-10-15)

| Command | Result |
|---|---|
| `pnpm db:validate` / `pnpm db:push` (DB `salesos_agentd`) | schema valid / database in sync |
| `pnpm --filter @salesos/api exec vitest run` (DB `salesos_agentd_test`, whole suite incl. other agents) | 53 files, 1458 tests passed (CRM: 13 files under `apps/api/test/crm/` + 71 route rows in `negative-authz.spec.ts`) |
| `pnpm --filter @salesos/worker exec vitest run` (DB `salesos_agentd_wtest`, Redis) | 6 files, 57 tests passed (CRM: 19 in `test/crm.spec.ts`) |
| `pnpm --filter @salesos/web exec vitest run` | 41 files, 308 tests passed (CRM: 28 in `src/features/crm/*.test.tsx`) |
| Playwright `apps/web/e2e/crm-journeys.spec.ts` against the real API (built `node dist/main.js`, :4104) and a production web build (:3104, `NEXT_DIST_DIR=.next-agentd`) | 17 passed: UJ-03, UJ-04, UJ-05, UJ-06, UJ-16 (390px), CRM extras, SSE live, axe WCAG A/AA on 10 CRM pages |
| `tsc --noEmit` | clean in api, worker, crm-core, validation, shared-types, web |
| `eslint` | 0 errors in api, worker, crm-core; web CRM files 0 errors (3 `react-hooks/incompatible-library` warnings from react-hook-form `watch`) |
| `pnpm --filter @salesos/api build`, `@salesos/worker build`, `next build` | all succeed; built API booted and served `/ready` |

Test map: duplicate/import idempotency (`imports.spec.ts`, `duplicates.spec.ts`), call+task+history atomicity with injected failures (`calls.spec.ts`), reminders survive worker restart / no duplicates / atomic claim (worker `crm.spec.ts`), deactivated owner to reassignment queue (`queues.spec.ts`, worker), cross-team isolation: manager sibling, executive peer, cross-org (`authz.spec.ts`), LOST never auto-set (`queues.spec.ts`), state-machine illegal transitions (`core.spec.ts`, `leads.spec.ts`, `events.spec.ts`), working-hours scheduling (`core.spec.ts`), pagination bounds (`leads.spec.ts`, `tasks.spec.ts`), SSE scope filter (`stream.spec.ts`), index presence and planner use (`indexes.spec.ts`), seed (`seed.spec.ts`).

Operational notes for other agents: several agents share `apps/web/.next` and `apps/web/test-results`; use `NEXT_DIST_DIR=.next-<agent>` (supported by `next.config.ts` now) and `playwright test --output <dir>`. The API cannot run under `tsx` (esbuild drops decorator metadata); run `node dist/main.js` after `pnpm --filter @salesos/api build`.

## 12. How later phases consume this domain

- **Lead / Program / LeadSource / LeadCampaign** are the master records: Revenue (P4) links `deals.lead_id`, `program_id`; use `Program.id` for versioned pricing and `Lead.program_id` / `lead_sources` for attribution. Do not mutate `leads.status` directly: call `transitionLeadTx` (crm-core) or `POST /leads/:id/status`; to close a deal, `transitionLeadTx(..., toKey: 'WON', wonValue)` runs the WON side effects and publishes `lead.won`.
- **Events**: `lead.created`, `lead.assigned`, `lead.status_changed`, `lead.won`, `lead.lost`, `lead.merged`, `lead.exception_raised`, `lead.unattended`, `call.logged`, `task.created|completed|due|reminder|overdue|escalated`, `reassignment.queued`, `attendance.changed`, `import.requested` (payload types in `packages/shared-types/src/events/crm.ts`). Subscribe with `registry.onEvent(CRM_EVENTS.LEAD_WON, handler)`; handlers must be idempotent.
- **Tasks** (`tasks`): P7 `xf-tasks` are a separate cross-functional table; CRM tasks are lead-centric follow-ups. Onboarding/handover tasks are created on WON with `type=ONBOARDING`.
- **Webinar/demo** (`events`, `event_attendance`): `status` follows docs/state-machines.md section 2. `CONVERTED` / `NOT_CONVERTED` are derived values reserved for the system (Phase 4/5 attribution job per DEC-010); the API rejects manual setting (`DERIVED_STATUS`). `joined_at` is the attribution anchor.
- **KPIs (P5)**: lead ageing helper `leadAgeing()` (creation and last-activity), `leads.last_activity_at`, `first_contact_at`, `call_attempt_count`, `lead_status_history`, `call_logs` (source MANUAL vs verified), `lead_exceptions`, `reactivation_queue.outcome`. CRM compliance (DEC-038) and first-response time (DEC-039) are reporting work for P5; the raw facts are stored.
- **Permissions**: matrix keys unchanged; added no keys. `GET /jobs/dlq` reads outbox rows with status DEAD (platform may take it over).

## 13. Decisions, deviations and known gaps

1. Working-hours engine is bespoke (Intl based) instead of a library: fixed offsets and DST-free India are covered; other timezones are tested for one DST-free-week case only.
2. `GET /leads/import/:jobId/errors` returns raw CSV for `?format=csv` (not enveloped) and the normal envelope otherwise.
3. Notification delivery is in-app only (no e-mail/WhatsApp provider yet: DEC-013).
4. Recording references (`recording_assets`) intentionally not built (DEC-014).
5. CRM compliance KPI (JD-DASH-010) and the deal entity (BP-LIFE-007 `/deals/:id/close`) belong to P5/P4; P3 supplies the data and lead-level won/lost.
6. FK constraints to identity tables are not declared (see section 1).
7. `rawCsv` stays on `import_jobs` for retries; a retention task (P10) should purge it.
8. Another agent's `cx/relationships.service.ts` filters `tasks.status` with `OPEN|IN_PROGRESS|OVERDUE|ESCALATED`; the CRM task status enum is `OPEN | DONE | CANCELLED` (overdue is computed). Reported to the lead.
