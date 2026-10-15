# Phase 7 report: customer experience, collaboration, Founder reporting, Student Success handover (Agent H)

Scope: JD sections 6, 7, 8. Code: `prisma/schema/cx.prisma`, `packages/cx-core`, `apps/api/src/modules/{cx,collaboration}`, `apps/worker/src/jobs/cx`, `apps/web/src/{features/cx,features/collaboration,app/(app)/cx,app/(app)/collaboration,nav/cx.ts,nav/collaboration.ts}`, `apps/api/test/cx`, `apps/web/e2e/cx-journeys.spec.ts`.

## 1. What exists

| Area | Delivered |
|---|---|
| Relationship management | `GET /cx/relationships/:leadId` aggregates lead stage history, calls, shared notes (private notes only for their author), relationship notes, complaints, escalations, satisfaction, handover and event attendance, read through the caller's scope. Summary-scope roles (Student Success) get a minimum-data projection (name, stage, programme, language, handover status; no contact data, notes, calls or deals). Key-prospect watchlist (per user) + CRM `is_key_prospect`, with a 72 h "stale" signal. High-value / complex-conversation escalations (owner, blocker, requested help, Team Lead, Founder involvement, resolution) with their own state machine. |
| Complaints | Owner (auto-assigned to the creator's manager and flagged when omitted), P1-P4, category, DEC-017 SLA clocks in business hours (first response stops at acknowledgement; reopen restarts a new clock), breach detection + escalation chain job, full section-7 state machine, mandatory root cause on resolve, 7-day auto-close, trend endpoint (volume, resolution rate, SLA adherence, time to resolve, root causes, categories, priorities). |
| Satisfaction / enrolment experience | CSAT / NPS / enrolment-experience capture with configurable question templates (built-ins when none configured), respondent reference, mandatory consent + consent timestamp, response timestamp, template version snapshot, 7-day enrolment window flag, stats with the minimum-sample caution (n < 5). |
| Refunds view | `GET /cx/refunds` reads the revenue `refunds` table (never changes it): requested / approved / processed shown as separate facts (amount, time, person). Root-cause tagging (`refund_root_causes`), like-for-like analytics inputs, summary-scope projection without money. |
| Student Success handover | Section-6 machine, configurable required-field checklist (default: learner name, contact, language EN/HI/MR, programme, amount paid, amount due, payment-verified flag, promises, goals, objections, special notes, consent), submit blocked with a field list (422), 24 h acknowledgement timer with OVERDUE -> manager -> Team Lead alerts, acknowledge / request info (creates a CRM task for the seller) / complete, auto-creation from `deal.closed` (WON) and `lead.won`, manual creation, Student Success inbox that never sees drafts and never gets lead/deal ids. |
| Collaboration | Cross-functional tasks (Founder / Sales / Marketing / Community / Operations / Student Success): owner must belong to the department, due date, dependencies (cycle-safe, block completion), comments, manual escalation, completion by assignee + confirmation by requester, system overdue/escalation ladder, department-scoped visibility, campaign/webinar/event/lead-gen plan links (planned vs actual lead intake as counts only; links to `events`, `lead_campaigns`, `lead_sources`, `programs`), insights sharing with PII rejection. |
| Founder reporting | Weekly/monthly report builder (performance, risks with proposed solutions, opportunities, proposed solutions, action-items review), `ReportDataProvider` seam with honest "data pending Phase 5" placeholders, IMMUTABLE published snapshots (canonical JSON + SHA-256, DB triggers block UPDATE/DELETE, corrections are new versions), review (1-5 + note) on the report row only, due-time + timeliness tracking, report shell + reminder job, action items (section-8 machine, evidence mandatory, on-time flag, overdue -> owner -> Founder), risk register ("raise issues early with proposed solutions"). |
| UI | See section 8. Mobile-first, five states everywhere, EN/HI/MR messages (`cx`, `collab` namespaces). |

## 2. Contracts for Phase 5 (analytics) and Phase 8 (notifications)

### 2.1 KPI inputs (tables and columns)

| KPI | Source | Columns / endpoint |
|---|---|---|
| KPI-CX-001 learner satisfaction | `satisfaction_responses` where `kind IN ('CSAT','NPS')` | `score` (CSAT 1-5, NPS 0-10), `responded_at`, `program_id`, `lead_id`, `owner_id`. Mean and % satisfied (4-5) use `kind='CSAT'`; NPS = %9-10 minus %0-6. Show a caution flag when n < 5. `GET /cx/satisfaction/stats` returns the same maths. |
| KPI-CX-004 enrolment experience | `satisfaction_responses` where `kind='ENROLMENT_EXPERIENCE'` (this is the data model's `enrolment_feedback`) | `score` 1-5; exclude `outside_window = true` (response later than 7 days after `leads.won_at`) and report the excluded count. |
| KPI-CX-003 complaint resolution | `complaints` | opened: `created_at` in period and `closed_as_invalid = false`; resolved: `resolved_at IS NOT NULL OR status='CLOSED'`; SLA adherence: `resolved_within_sla` (frozen at resolve time); time to resolve: `resolved_at - created_at`; breach facts: `first_response_breached_at`, `resolution_breached_at` (= the deadline instant), `breach_level`. Trend/root cause: `root_cause_category`, `category`, `priority`. `GET /cx/complaints/trends`. |
| KPI-CX-002 refund reduction | revenue `refunds` + `sales_records`; CX-owned `refund_root_causes` | `GET /cx/refunds/analytics` returns per programme x month `wonEnrolments` (sum of `sales_records.enrolments` closed in month), `refundsRequested` (excl. WITHDRAWN), `refundsApproved` (status APPROVED/PROCESSED/RECONCILED, by REQUEST date), `approvedValue`, `cohortApproved` (by SALE month), `rate = approved / won`, `cohortRate`. REJECTED, WITHDRAWN and request-only refunds never enter the approved counts. Reduction = (previous rate - current rate) / previous rate, computed by Phase 5 on these cells; null when the denominator is 0. |
| KPI-FND-001 action-item completion | `action_items` | numerator: `status='COMPLETED' AND completed_at <= due_at`; denominator: items with `due_at` in the period and `status <> 'CANCELLED'`. `completed_on_time` is frozen at completion. `GET /action-items/metrics` (overall + per owner). |
| KPI-FND-002 quality of reporting | `founder_reports` (version_number = 1) | `completeness_pct` (0/25/50/75/100: performance narrative, risks with solutions or "none" confirmed, opportunities or "none" confirmed, action items reviewed), `rating` (Founder 1-5), `review_note`. Proxy per DEC-028. |
| KPI-FND-003 timeliness | `founder_reports` (version_number = 1), `founder_report_snapshots` | due: `due_at` in period and `due_at <= now`; on time: `published_at <= due_at` (frozen in `on_time`); late; missing (due, still DRAFT). Corrections (version_number > 1) never count. A shell DRAFT is auto-created by the sweep so a report nobody started is still "due". Due rule (DEC-028): weekly = Monday 10:00 (org timezone) after the week ends, monthly = 3rd working day 10:00; configurable in `cx_settings`. `GET /founder-reports/metrics`. |

Pure maths (no DB): `reportTimeliness`, `actionItemCompletion`, `reportCompleteness`, `complaintDeadlines`, `detectBreaches`, `breachLevelAt` in `@salesos/cx-core`.

### 2.2 ReportDataProvider (Phase 5 plug-in)

`apps/api/src/modules/cx/founder/report-data.provider.ts`: DI token `REPORT_DATA_PROVIDER`, interface `ReportDataProvider.getSections({ user, organizationId, type, periodStart, periodEnd }) => ReportDataSection[]`, each section `{ key, label, status: 'AVAILABLE' | 'DATA_PENDING_PHASE_5', metrics: [{ kpiId, label, value, unit? }], note? }`. The default `PendingPhase5ReportDataProvider` returns four labelled placeholders and no numbers. Phase 5 overrides the provider in its own module (`{ provide: REPORT_DATA_PROVIDER, useClass: ... }`). The provider's output is frozen into the snapshot at publish time. The provider must apply the caller's scope.

### 2.3 Events

Published through the outbox (all idempotent keys; payloads carry `notifyUserIds` / `notifyRoles`): `complaint.{created,acknowledged,updated,escalated,resolved,closed,reopened,sla_breached}`, `escalation.{raised,updated}`, `handover.{created,submitted,info_requested,acknowledged,overdue,completed}`, `survey.requested` (complaint resolved, handover completed; Phase 8 delivers the survey), `xf_task.{created,updated,completed,confirmed,overdue,escalated}`, `action_item.{created,completed,overdue,escalated}`, `founder_report.{published,due,overdue}`, `insight.shared`. Constants and payload types: `packages/shared-types/src/events/cx.ts`.

Notifications: events the platform notifier already maps (`complaint.created|escalated|acknowledged|resolved`, `handover.submitted|overdue|acknowledged|completed|info_requested`) rely on that mapping. For every other CX event `emitCx` also publishes the generic `notification.requested` contract (docs/platform-report.md 1.1) so the alert is raised without the platform knowing CX (types used: `complaint.updated|escalated`, `handover.update`, `founder.action_item`, `follow_up.due|overdue|escalated`, `review.pending`). Handover submit/ack payloads use `salesOwnerId` (not `ownerId`) so the platform does not also notify the submitter of their own action.

Consumed: `lead.won` (CRM), `deal.closed` / `deal.won` (revenue, `DealClosedPayload`; only `outcome = 'WON'` triggers). `createHandoverFromTrigger` is idempotent by outbox event id, by deal id, and by a DB partial unique index (one open handover per learner), so `lead.won` + `deal.closed` for the same sale (consumed concurrently) produce exactly one handover and the deal id/programme/amounts are attached to it.

### 2.4 Jobs (worker)

Queue `cx-sweeps`, repeatable every 5 minutes (`apps/worker/src/jobs/cx/index.ts`, logic in `@salesos/cx-core/sweeps.ts`, also unit-tested through the API suite): complaint SLA breach + escalation chain (+ 7-day auto-close), handover pending-alert timer, action item / cross-functional task overdue + escalation, Founder report shells + due/overdue reminders. Every state change is a compare-and-set (`updateMany` with the expected previous value), every event has a deterministic idempotency key: concurrent workers and restarts never double-notify, and a late sweep emits every missed escalation level exactly once, in order.

## 3. Rules implemented (and deviations)

State machines are the single source of truth in `packages/cx-core/src/machines.ts`; API services and sweeps both go through `findRule`. Illegal transition = `409 ILLEGAL_TRANSITION`; wrong actor = 403; missing required field = 422 `FIELDS_REQUIRED`.

| Machine | Implemented exactly | Documented deviations |
|---|---|---|
| Complaint (section 7) | all rows, REOPENED -> IN_PROGRESS as drawn | Team Lead and Founder count as "Mgr" actors on every manager step; SLA breach does not change the status (it notifies owner -> Team Lead -> Founder for P1). |
| Handover (section 6) | all rows | Student Success cannot see DRAFT handovers. Operations holds `handover:view` at `summary` and gets a status-only projection. |
| Task / action item (section 8) | all rows | Added IN_PROGRESS -> OVERDUE (otherwise a started item never alerts). Requester may cancel their own cross-team task. Manual "escalate" on a cross-team task records `escalated_at` and notifies without changing status (ESCALATED stays system-only). |
| Relationship escalation | OPEN -> IN_REVIEW -> RESOLVED, OPEN/IN_REVIEW -> CANCELLED | new (no spec row). |
| Founder report | DRAFT -> PUBLISHED, immutable | corrections = new row (`version_number + 1`, `supersedes_id`). |

Defaults awaiting owner approval (all configurable via `GET/PATCH /cx/settings`, validated, audited): DEC-017 complaint table, breach escalation delays (Team Lead after 240 min, Founder after 480 min for P1), auto-close 7 days, handover acknowledgement timer 24 h and Team Lead after +24 h, required checklist fields, work-item escalation after 24 h, report cadence/timezone/due time and Founder alert delay (DEC-028), working hours (DEC-020, from crm-core).

Data minimisation (MS-CX-002): `relationships:view` summary scope -> minimum projection; handover record is itself the minimum dataset for Student Success; cross-team tasks to Marketing / Community / Operations reject phone numbers, e-mails and PII-named payload keys (422 `PII_NOT_ALLOWED`); insights never contain contact data; plan links return counts only; refunds at summary scope carry no money or reasons.

## 4. Permissions

One key added with the matrix row: `relationships:update` (add relationship notes, manage own watchlist; Founder/Team Lead org, Manager team, Executive own). Everything else reuses matrix keys: complaints:*, satisfaction:*, relationships:view, handover:*, xf-tasks:*, insights:share, founder-reports:*, action-items:*, plus `settings:view|update` (CX settings, survey templates) and `refunds:view` + `complaints:update` (refund root-cause tagging).

## 5. Reconcile list for the lead

1. Schema: `prisma/schema/cx.prisma` uses plain UUID columns for User / Lead / Deal / Refund / Program / Event references (no `@relation`), so no other domain's model was edited. FKs may be added in the consolidated migration if desired.
2. DB guards: `prisma/sql/cx-guards.sql` must be part of the consolidated migration (snapshot immutability triggers, published-report freeze trigger, partial unique index `handover_one_open_per_lead`). The API also applies it idempotently at boot (`ensureCxGuards`); a boot against data that already violates the unique index fails fast.
3. New workspace package `@salesos/cx-core` (added to `build:packages` in the root `package.json`; dependency in `apps/api` and `apps/worker`; alias in both vitest configs). It depends on `@salesos/crm-core` for working-hours maths.
4. Permission matrix: row `relationships:update` added to docs/permissions-matrix.md (table only, the per-role lists further down were not regenerated) and to `permissions/cx.ts`.
5. `test/negative-authz.spec.ts`: 65 P7 rows appended to CASES. The shared "every route has a case" assertion also needs the other domains' rows; fuller P7 coverage (every route x least-privileged role, cross-org) is in `test/cx/cx-negative-authz.spec.ts`.
6. Web: `messages/{en,hi,mr}.json` gained `cx` and `collab` namespaces and `nav.cx*|collab*` keys (Hindi/Marathi are first-pass translations; native review recommended). `apps/web/src/lib/api/index.ts` currently fails typecheck on a duplicate `Program`/`usePrograms` export between `hooks/crm` and `hooks/crm-admin` (not P7).
7. Survey templates, CX settings and report shells are per organisation and created lazily; nothing else needs seeding. Demo data: `seed/domains/cx.ts` (all `[DEMO]`, idempotent).

## 6. Known issues / follow-ups

See docs/known-issues.md (KI-H-*). Highlights: survey delivery is manual until Phase 8 channels exist; report numbers are placeholders until Phase 5; refund analytics are inputs, not the KPI; notification titles are English server-side.

## 7. Verification (real runs)

See section 9 (filled in from the final runs).

## 8. UI map

`/cx` hub; `/cx/complaints` (+ trends tab) and `/cx/complaints/:id` (SLA countdown, legal next steps only); `/cx/escalations` board; `/cx/relationships` (find + watchlist) and `/cx/relationships/:leadId` (timeline); `/cx/satisfaction` (results, capture, question sets); `/cx/refunds` (tracking, like-for-like analysis); `/cx/handovers` (inbox for Student Success, list for sales), `/cx/handovers/new`, `/cx/handovers/:id` (checklist form / read-only view with actions); `/cx/founder-reports` (history + timeliness), `/cx/founder-reports/:id` (builder, publish confirmation, locked snapshot view with fingerprint, versions, review); `/cx/action-items`; `/cx/risks`; `/collaboration` (task board + sheet), `/collaboration/plans`, `/collaboration/insights`.

## 9. Verification results

Real runs on this machine (own DBs `salesos_agenth`, `_test`, `_wtest`; API :4108, web :3108):

| Command | Result |
|---|---|
| `pnpm db:validate`, `pnpm db:push` (salesos_agenth) | valid, in sync |
| API lint (`eslint src test`) / typecheck (`tsc --noEmit`) | exit 0 / exit 0 |
| `@salesos/web` eslint (src, e2e) / `tsc --noEmit` | 0 errors (3 warnings in CRM files) / exit 0 |
| packages `validation`, `cx-core`, `shared-types` eslint; worker eslint + tsc | clean |
| Whole API suite (`vitest run`, real Postgres) | 53 files, 1458 tests passed (P7: test/cx, 8 files, 80 tests; negative-authz 725 rows incl. 65 P7) |
| Worker suite | 6 files, 57 passed (P7: test/cx.spec.ts, 4 tests) |
| Web unit (cx, collaboration, i18n, nav) | 5 files, 39 passed; whole web run: 306 passed, 2 timeouts under load (one mine, fixed with a 30 s test timeout; one in revenue tests) |
| `pnpm build:packages`, api build, worker build | OK |
| `next build` (isolated copy of apps/web, NEXT_PUBLIC_API_URL=:4108) | OK, all P7 routes built |
| Playwright `e2e/cx-journeys.spec.ts` (real API + worker + seeded DB) | 7 passed (UJ-10 handover, complaint + escalation journeys, UJ-12 report/action items, collaboration) |
| Playwright `e2e/cx-a11y.spec.ts` | 2 passed (axe WCAG A/AA on 15 pages at 1280 and 375 px, no horizontal overflow) |

Not P7 but seen: `test/people-isolation.spec.ts` failed once in an earlier full run (passed in the final run).
