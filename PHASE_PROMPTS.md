# CoachEasily SalesOS — Phase-by-Phase Claude Code Prompts

**Sources merged:**
1. `CoachEasily_SalesOS_Architecture_Blueprint-4.pdf` (Blueprint) — concrete stack, schema, REST catalogue, reminder reliability, Android calling feasibility, AI guardrails.
2. `CLAUDE (1).md` (Master Spec) — requirement traceability, design system, KPI dictionary, state machines, finance, SOP/coaching/HR/CX modules, security, testing, deployment.
3. `Job_Description_Sales_Team_Lead_CoachEasily.docx` (JD) — **business source of truth** (8 responsibility groups, KPIs, people management, skills, competencies).

**Rule of precedence:** JD = business scope. Master Spec = governance + breadth. Blueprint = engineering depth + build order. Where they conflict, the decisions in section B below apply.

---

## A. Gap analysis (what each document is missing)

### Blueprint is missing (covered by Master Spec/JD — now added)
| Gap | Added in phase |
|---|---|
| **Sales Team Lead role** (JD's central role) — Blueprint only has CEO / Manager / Salesperson; no Admin role | 2 |
| Revenue/collection/enrolment **targets**, target breakdown, daily tracking | 4 |
| **Payments/collections/refunds**, sale value vs collected vs net, reconciliation | 4 |
| Programs (AI Sprint, CBAX, MCA X, MCA Elite X, CoachEasily X, events) + attribution | 3/4 |
| Webinar / demo entities, attendance, webinar-to-sale & demo-to-sale | 3/5 |
| Forecasting (weekly/monthly) + forecast accuracy | 5 |
| SOP / playbook centre with versions + acknowledgements + adoption | 7 |
| Coaching, 1:1s, scorecards, reviews, PIPs, incentives, recognition | 7 |
| Hiring, onboarding, probation, succession | 7 |
| Complaints, satisfaction, refunds, Student Success handover | 8 |
| Cross-functional tasks (Marketing, Community, Ops) | 8 |
| Founder reports with immutable snapshots + action items | 8 |
| KPI dictionary (numerator/denominator/window), state machines | 0/5 |
| Multi-language (EN/HI/MR), PWA/mobile-first design system, accessibility | 1 |
| File upload policy (MIME check, malware scan, private storage) | 9 |
| Shared-VPS safety, staging, rollback, requirement traceability | 0/10 |

### Master Spec is missing (covered by Blueprint — now added)
| Gap | Added in phase |
|---|---|
| **Personal Android calling reality**: `tel:` dialer + mandatory disposition form; companion app only after feasibility gate; no silent recording | 3/6 |
| Outcome→automation table (NO_ANSWER, BUSY, SWITCHED_OFF, CALLBACK, OVERDUE, WON, LOST, OWNER DEACTIVATED) | 3 |
| Primary principle: *every active lead has an owner + next action, or sits in a visible exception queue* | 3 |
| Deactivated employee → open leads go to **reassignment queue** (never orphaned) | 2/3 |
| E.164 phone normalisation, import idempotency keys, flag-don't-silently-merge duplicates | 3 |
| **Transactional outbox** (no lost reminder between DB commit and queue) | 3 |
| BullMQ: bounded retries, exponential backoff, dead-letter, task locking, delivery status ≠ queued | 3/9 |
| Concrete schema tables/indexes and REST catalogue (`/api/v1`) | 1–4 |
| SSE live updates; OpenAPI with examples; response envelope; cursor pagination | 1/5 |
| Opinionated stack (single language, monorepo, Prisma) instead of "pick one" | B |
| Explicit build order: Phases 0–3 first = useful CRM, then analytics, AI, Android | B |

### Both documents are weak on (new, added by this plan)
- Conflicting stacks (Blueprint: NestJS/Prisma; Master Spec: FastAPI/SQLAlchemy) → **resolved in B**.
- Hierarchy: CEO → Sales Team Lead → Sales Manager → Executive; Admin is separate with **no automatic HR/payment access**.
- Multi-tenancy: one company today, but keep `organization_id` everywhere (Blueprint) — cheap to keep, costly to retrofit.
- Demo/seed data, anonymised load-test data, and a clear "mock data is never shown as real" rule.
- AI Copilot must be *optional* and deterministic CRM must work without it (both agree; made a hard gate).
- Indian privacy (DPDP Act) consent + retention for call/learner data; consent flag on leads.
- Observability: request IDs, structured logs, error monitoring, health/readiness.
- Data import from existing CRM (LeadSquared/Zoho/HubSpot per JD) with rollback plan.

---

## B. Decisions applied in every prompt (override anything conflicting)

1. **Stack (greenfield default):** TypeScript monorepo — Next.js (App Router) + Tailwind + shadcn/ui + Framer Motion + React Hook Form + Zod; NestJS API; PostgreSQL + Prisma; Redis + BullMQ worker; SSE; private S3/R2-compatible storage; Docker. *Reason: one language, shared types/validation, matches Blueprint. If the repo already contains a different stack, reuse it and record an ADR.*
2. **Architecture:** modular monolith — `apps/web`, `apps/api`, `apps/worker`, optional `apps/mobile-companion` (later), `packages/shared-types`, `packages/validation`, `packages/ui`.
3. **Roles:** `FOUNDER_CEO`, `SALES_TEAM_LEAD`, `SALES_MANAGER`, `SALES_EXECUTIVE`, `ADMIN`, plus secondary permission groups (Finance, HR, Marketing, Community, Operations, Student Success). Deny-by-default, server-enforced.
4. **Design:** light-luxury (ivory/warm white, charcoal text, restrained gold/red/blue accents), mobile app-like with bottom nav, PWA with **no caching of private API data**, `prefers-reduced-motion`, WCAG AA. Languages: English first, i18n-ready for Hindi + Marathi.
5. **Money:** `NUMERIC` decimals + explicit currency (default INR); Closed-Won ≠ payment received; refund *requested ≠ approved ≠ processed*.
6. **Timestamps:** UTC (`TIMESTAMPTZ`), shown in business timezone (default `Asia/Kolkata`, confirm).
7. **Honesty gate:** never claim a test/build passed unless it was run; mark requirements `BLOCKED` / `NEEDS_DECISION` instead of inventing business rules; never show mock data as real.
8. **Build order:** Phases 0–4 deliver a working CRM with accountability and money tracking; 5–8 add analytics, people and CX; AI and Android are later and optional.

---

## C. Reusable header — paste at the top of EVERY phase prompt

```
You are building CoachEasily SalesOS in /home/kamar-alam/Project/Sales app.
Read first, every time: CLAUDE.md, docs/requirements-traceability.md,
docs/decision-log.md, and the previous phase's report.

Before changing anything: inspect existing files, dependencies, schema,
migrations, routes, tests. Never overwrite working features.
Implement ONLY this phase's scope; do not silently skip requirements —
mark them BLOCKED or NEEDS_DECISION with a reason.
Server-side authorization on every endpoint (deny-by-default, IDOR-safe).
No secrets in code; .env.example with placeholders only.
Never present mock data as real business data.

Acceptance gate (all must be run, with real output reported):
lint, typecheck, unit tests, integration tests, migration check,
production build. Fix errors; do not suppress them.

At the end: update docs (README, API/OpenAPI, data model, known issues,
CHANGELOG), update the traceability matrix, list changed files, list real
test results, list open decisions, and propose the next-phase plan.
Do not claim a test passed that was not run.
```

---

# PHASE 0 — Audit, merged master instructions, traceability

**Goal:** One authoritative CLAUDE.md, a complete requirement register, and decisions logged — before any feature code.

```
[Paste Section C header]

PHASE 0 — Repository + requirement audit.

Inputs: CLAUDE (1).md, CoachEasily_SalesOS_Architecture_Blueprint-4.pdf,
Job_Description_Sales_Team_Lead_CoachEasily.docx, and PHASE_PROMPTS.md
(sections A and B are binding).

Tasks:
1. Inspect the repository and report what exists vs. missing. Do not rewrite anything.
2. Create ONE merged CLAUDE.md (replace "CLAUDE (1).md") that combines the
   Master Spec and Blueprint using PHASE_PROMPTS.md section B for conflicts
   (stack, roles, build order). Keep: DoD, security, testing gates, design
   system, AI policy, Android calling constraint, honesty rules. Add a
   "Current phase status" section.
3. Create docs/requirements-traceability.md: one row PER BULLET of the JD
   (8 responsibility groups, every KPI, every people-management bullet,
   skills, qualifications, experience, each competency) plus Blueprint-only
   requirements (call dispositions, reminder engine, outbox, Android
   feasibility). Columns: ID | Source | Exact requirement | Type | Module |
   Roles | Acceptance criteria | API/model | Test | Status | Notes.
   Statuses: NOT_STARTED, IN_PROGRESS, BLOCKED, NEEDS_DECISION,
   IMPLEMENTED_UNTESTED, VERIFIED, APPROVED_OUT_OF_SCOPE.
   Non-product JD items (qualification, years of experience, competencies)
   map to hiring/people-module criteria or APPROVED_OUT_OF_SCOPE with reason.
4. Create docs/decision-log.md with owner/options/chosen/date/rationale for:
   target periods & proration, revenue recognition, collection attribution,
   credit sharing, lead stages & lost reasons, duplicate merge policy,
   conversion cohort windows, incentive formulas/clawback, program pricing,
   complaint SLA, refund approval authority, existing CRM migration,
   telephony/WhatsApp/SMS/email providers, business timezone & working days,
   retention/privacy (DPDP), UI languages, HRMS scope, AI in v1 or later.
   Propose a default for each and mark as "awaiting owner approval".
5. Create docs/permissions-matrix.md (draft) for the 5 roles + secondary groups.
6. Create docs/kpi-dictionary.md (draft): every JD KPI with numerator,
   denominator, window, exclusions, source tables, refresh, owner, rounding,
   zero-denominator behaviour.
7. Create docs/architecture.md + ADR-001 (stack choice) and
   docs/state-machines.md draft: lead, webinar/demo, opportunity,
   payment, refund, handover, complaint, task, PIP, incentive — each with
   allowed from/to states, required fields, roles, side effects, audit.
8. Create the repo skeleton per Blueprint structure (apps/, packages/,
   prisma/, docs/, docker-compose.yml, README.md) — empty scaffolding only.

Exit gate: no JD bullet is untracked; ambiguities are listed; nothing built yet.
Report: file list, count of requirement rows, open decisions needing the owner.
```

---

# PHASE 1 — Foundation, design system, dev environment

```
[Paste Section C header]

PHASE 1 — Foundation and design system.

Tasks:
1. Monorepo (pnpm workspaces): apps/web (Next.js App Router, TS strict,
   Tailwind, shadcn/ui, Framer Motion, RHF+Zod), apps/api (NestJS),
   apps/worker (BullMQ), packages/shared-types, packages/validation, packages/ui.
2. docker-compose for PostgreSQL + Redis (+ optional MinIO). Validated env
   config (fail fast on missing vars), .env.example placeholders only.
3. Prisma setup, first migration (organizations, users baseline), seed script
   with CLEARLY LABELLED demo data only.
4. API foundations: /api/v1 prefix, response envelope, central exception
   filter, request IDs, structured logging (no secrets/PII), health + readiness
   endpoints, OpenAPI generation, cursor/page pagination helper with bounded
   page size, rate-limit module, CORS (no wildcard with credentials), security headers.
5. Design tokens (spacing, type scale, radii, shadows, gold/red/blue accents,
   focus ring, motion) + light-luxury theme; dark mode optional.
   Components: Button (hierarchy, loading, disabled), Card/Panel, Input,
   Select, Table (mobile → cards), Dialog, Toast, Tabs, EmptyState,
   ErrorState, Skeleton, StatusBadge (never colour alone), Chart wrapper with
   accessible table/summary.
6. App shell: responsive sidebar (desktop) + bottom nav (mobile),
   permission-aware nav (UI hiding is NOT security), i18n scaffolding
   (EN now; HI/MR keys ready), `prefers-reduced-motion` honoured.
7. PWA manifest + icons + service worker that NEVER caches private API data;
   clear offline notice; forms never imply a write succeeded when offline.
8. CI: lint, typecheck, unit, build, dependency + secret scan.
9. Dev docs: README setup, docs/architecture.md update.

Exit gate: lint/type/build pass; component states (loading/empty/error/
success/permission-denied) demonstrated on a style-guide page; checked at
mobile, tablet, laptop, large desktop; axe accessibility check run.
```

---

# PHASE 2 — Identity, RBAC, teams, audit

```
[Paste Section C header]

PHASE 2 — Authentication, RBAC, hierarchy, audit.

Roles: FOUNDER_CEO, SALES_TEAM_LEAD, SALES_MANAGER, SALES_EXECUTIVE, ADMIN
+ secondary permission groups (Finance, HR, Marketing, Community, Operations,
Student Success). Admin does NOT automatically see HR/payment data.

Tasks:
1. Schema: organizations, users (manager_id, is_active), roles, permissions,
   user_role_assignments, teams, team_memberships, manager hierarchy,
   sessions, audit_logs (append-only). UUID PKs, organization_id scope,
   TIMESTAMPTZ.
2. Auth: login/logout/me, secure server-managed sessions (HttpOnly, Secure,
   SameSite cookies), CSRF protection, strong password hashing (argon2/bcrypt),
   session revocation, login rate limiting/lockout, password reset flow
   (token expiry, single use), optional invite/provisioning.
3. Authorization: central policy layer — check record ownership + team
   hierarchy + action permission on EVERY endpoint; deny-by-default;
   no trust in client-supplied org/manager/role/assignee IDs; IDOR-safe.
4. Team model: Manager typically leads 4–5 executives but make the limit
   CONFIGURABLE (warn, don't hard-block). Manager sees only own team unless
   explicit delegation exists.
5. Deactivating a user: revoke sessions and create a reassignment-queue entry
   for each open lead/task (never orphan).
6. Audit: role changes, ownership changes, exports, policy changes, login
   failures, privileged actions (including CEO and Admin actions).
7. Endpoints: /auth/*, /users, /users/:id, /teams, /teams/:id/members,
   /audit-logs. Admin UI for users/roles/teams, with permission-denied states.
8. Finalize docs/permissions-matrix.md and docs/security.md.

Tests (mandatory): cross-team and cross-organization access denied; manager
cannot read sibling team; executive cannot read another executive's leads;
Admin cannot read HR/payment without the secondary permission; deactivated
user session rejected; negative authorization test per endpoint.

Exit gate: authorization test suite proves isolation; all auth flows work end-to-end.
```

---

# PHASE 3 — CRM core: leads, calls, tasks, follow-up engine

*(This is the heart of the Blueprint. Manual call logging MUST work with zero Android permissions.)*

```
[Paste Section C header]

PHASE 3 — Lead management, calls, tasks, reminders, escalation.

Principle: every active lead has a responsible owner AND a next action,
or it appears in a visible Exception Queue.

Schema: lead_sources/campaigns, programs (configurable: AI Sprint, CBAX,
MCA X, MCA Elite X, CoachEasily X, events), leads (full_name, phone_e164,
email, source_id, program_id, assigned_to, status, interest_level,
next_action_at/type, estimated_value, lost_reason, consent fields),
lead_assignments, lead_status_history, lead_notes, call_logs, call_notes,
tasks, webinars/events/demos + attendance, notification_deliveries,
import_jobs, import_errors, outbox_events.

Tasks:
1. Lead CRUD, search/filter/pagination, E.164 normalisation, duplicate
   DETECTION and review queue (flag, never silently merge; merge keeps audit).
   Configurable stages and lost reasons. Lead ageing (since creation AND since
   last meaningful activity). Unattended-lead alerts.
2. CSV import: validation, row-level error report, idempotency keys so retries
   don't duplicate, async via worker with progress + retry.
3. Assignment: manual + configurable round-robin; reassignment with reason
   and history; bulk reassignment queue (deactivated owner, manager action).
4. Calling (MVP): `tel:` link on lead detail → mandatory disposition form:
   connected, no answer, busy, switched off, callback, failed, won, lost.
   Capture notes, interest, objection category, next action. Label records as
   MANUAL; reserve a `source` field for future device/provider-verified events.
   Call + task + status-history writes in ONE transaction.
5. Automation rules per outcome (configurable by organization/team/working hours):
   NO_ANSWER → retry task with delay; BUSY → callback scheduling honoring
   client time; SWITCHED_OFF → delayed retry, repeated failures → manager
   review; CALLBACK → high-visibility task; OVERDUE → notify owner then
   escalate to manager by threshold; WON → record value/date, create
   follow-up/onboarding tasks; LOST → require reason, preserve history;
   NEVER auto-mark Lost because of no answer.
6. Worker: transactional outbox → BullMQ; bounded retries, exponential
   backoff, dead-letter queue, idempotent notification keys, atomic task
   locking, delivery status tracked (queued ≠ delivered), job recovery after
   worker restart.
7. Lost-lead reactivation queue with rules; follow-up calendar; overdue queue.
8. SSE for live task/notification updates (fallback to polling).
9. UI: Executive workspace (priority leads, next follow-up, last contact,
   objections, webinar/demo status), lead detail + timeline, task calendar,
   manager exception queue. Mobile-first, one-hand usable follow-up flow.
10. Endpoints per Blueprint: /leads, /leads/:id, /leads/import,
    /leads/:id/assign, /leads/:id/status, /leads/:id/timeline,
    /leads/:id/calls, /leads/:id/tasks, /tasks, /tasks/:id/complete.

Tests: duplicate/import idempotency, transaction atomicity (call+task+history),
reminder survives worker restart, no duplicate reminders, deactivated owner →
reassignment queue, cross-team lead isolation, Lost never auto-set.

Exit gate: critical lead workflows pass E2E; launch-checklist rows
"Lead workflow", "Call records", "Follow-ups" demonstrated.
```

---

# PHASE 4 — Targets, deals, collections, refunds, forecast

```
[Paste Section C header]

PHASE 4 — Revenue management.

Schema: target_periods, targets (revenue, collection, enrolment) with
breakdown Founder → Team Lead → Manager → Executive, opportunities/deals,
sales_records, products/programs pricing (versioned), payments/collections
(external_transaction_ref UNIQUE), refunds, pricing/offer proposals with
approval history, forecasts, forecast snapshots.

Tasks:
1. Targets: monthly/quarterly/annual; breakdown by manager/team; revision
   history (no silent edits); daily achievement tracking.
2. Deals: pipeline stages, owner, amount, currency, high-value deal flag +
   escalation to Team Lead/Founder with blocker notes. Closed-Won ≠ paid:
   track sale value, amount due, collected, refunded, net collections.
3. Collections: verified-by Finance permission; idempotency/unique transaction
   refs prevent duplicate credit; reconciliation view.
4. Refund state machine: requested → reviewed → approved/rejected → processed
   → reconciled, each with actor, role, timestamp, reason. No automatic
   charge/refund (out of scope without approved payment integration).
5. Historical sale amounts immutable; corrections via adjustment records.
6. Upsell/cross-sell tracking, average deal value, program attribution.
7. Weekly/monthly revenue forecast: documented method (e.g. stage-weighted),
   stored snapshots so forecast accuracy can be measured later. Label as
   estimate, not fact.
8. Market/competitor/learner feedback log + pricing/offer proposal workflow
   for Founder review; new channel/segment/opportunity tracker.
9. Deal close in a single transaction (deal + status history + tasks).
10. Endpoints: /targets, /deals, /leads/:id/deals, /deals/:id/close,
    /collections, /refunds, /forecasts.

Tests: decimal precision, idempotent payment ingestion, duplicate credit
blocked, refund state transitions + authority, totals reconcile with fixtures,
role-scoped revenue visibility.

Exit gate: finance calculations and idempotency tests pass; totals reconcile.
```

---

# PHASE 5 — Dashboards, KPIs, reports, exports

```
[Paste Section C header]

PHASE 5 — Analytics (Blueprint: "add analytics next, after Phases 0–3").

Tasks:
1. Finalize docs/kpi-dictionary.md with owner-approved formulas (propose
   defaults, mark approval status). Implement EVERY JD KPI: revenue %,
   collection %, team sales achievement, lead conversion, webinar-to-sale,
   demo-to-sale, average deal value, forecast accuracy (named error metric),
   calls completed, follow-ups completed, CRM compliance, response time,
   lead ageing, manager/individual target achievement, team productivity,
   attrition, engagement, coaching hours, SOP adoption, dashboard
   accuracy/timeliness, learner satisfaction, refund reduction, complaint
   resolution, enrolment experience, Founder action-item completion,
   report timeliness.
2. KPI engine: one shared, role-scoped query layer used by ALL dashboards;
   zero-denominator → "—" (never NaN/∞); show date range, currency, filters,
   definition tooltip, data freshness. Separate call attempts vs unique clients.
3. Dashboards: Founder, Sales Team Lead, Sales Manager, Executive (and Admin
   system-health only). Filters (date/team/program/source) cannot bypass
   server-side scope. Exception metrics: unassigned leads, no-next-action,
   overdue, ageing.
4. Reports: /reports/follow-ups, /reports/conversions, weekly + monthly
   Founder views, CSV/XLSX export with server-side permission check + export
   audit log. Heavy reports via worker.
5. Accessible charts (text summary/table), responsive, loading/empty/error.
6. Caching only with authorization-aware keys and clear invalidation.

Tests: every KPI reconciles to seeded fixtures; manager sees only own scope;
exports logged; performance budget + query plan check on dashboard queries.

Exit gate: all KPIs reconcile with fixtures and respect role scope.
```

---

# PHASE 6 — SOP centre, coaching, reviews, people management, incentives

```
[Paste Section C header]

PHASE 6 — Process excellence and people management (JD sections 2, 4, People Mgmt).

Tasks:
1. SOP/playbook centre: versioned docs (lead handling, follow-up cadence,
   webinar/demo, objection handling, closing/negotiation, payment, handover,
   call scripts, WhatsApp templates, CRM usage, reporting formats); owner,
   version, effective date, approval, acknowledgements, adoption/compliance
   tracking, change history, process-gap/automation backlog with status.
2. Coaching: weekly 1:1s, scorecard reviews, coaching sessions (date, coach,
   participants, duration → coaching hours KPI), action items, call-quality /
   objection-handling / closing coaching records. Subjective AI scores are
   never treated as truth.
3. Weekly KPI/KRA assignment per manager and executive; monthly performance
   reviews; improvement plans (PIP state machine); recognition programs.
4. Incentives: policy (versioned, Founder-approved), calculation as a
   RECOMMENDATION → approval → paid-status workflow; clawback hooks tied to
   refunds; formula from decision log only (do not invent).
5. People: recruitment coordination with HR, hiring pipeline for managers/
   executives, onboarding + training checklists, probation reviews,
   succession plan (ready-now/ready-later bench). Sensitive HR data behind
   HR permission. NOT a full HRMS (no payroll/leave) unless approved.
6. Skills & coaching resource library (consultative selling, negotiation,
   forecasting, CRM, Google Workspace, Excel, etc.).

Tests: SOP version/acknowledgement history, HR data isolation, incentive
workflow permissions + audit, PIP transitions.

Exit gate: workflow permissions and audit history pass.
```

---

# PHASE 7 — Customer experience, handover, collaboration, Founder reporting

```
[Paste Section C header]

PHASE 7 — JD sections 6, 7, 8.

Tasks:
1. Learner/prospect relationship history; high-value / complex conversation
   escalation.
2. Complaints: owner, priority, SLA (from decision log), status, timestamps,
   resolution, root-cause categories + trends. Enrolment-experience and
   learner-satisfaction capture; refund-reduction analytics (like-for-like rates).
3. Student Success handover: checklist with required fields, state machine,
   pending-handover alerts, acknowledgement by receiving team.
4. Cross-functional tasks with Founder/Marketing/Community/Operations/Student
   Success: owner, due date, status, dependencies, comments, escalation,
   completion confirmation. Share only minimum data with other departments.
5. Campaign/webinar/event alignment linkage (lead-gen ↔ sales plans).
6. Founder reporting: weekly/monthly report builder (performance, risks,
   opportunities, proposed solutions), IMMUTABLE historical snapshots,
   action items with owner/due/evidence/overdue alerts.

Tests: handover journey, escalation journey, snapshot immutability,
data-minimisation for cross-functional roles.

Exit gate: handover and escalation journeys pass E2E.
```

---

# PHASE 8 — Notifications, files, integrations, AI Copilot (optional)

```
[Paste Section C header]

PHASE 8 — Notifications, files, integrations, AI.

Tasks:
1. In-app notification centre (configurable, deduplicated, actionable):
   due/overdue follow-ups, unassigned/no-next-action leads, target risk,
   pending reviews, complaints, collections, handovers, Founder action items,
   import/file failures, security events. Quiet hours / working-hours rules.
2. Email/WhatsApp/SMS/calendar adapters behind a provider interface ONLY
   for approved providers; consent + opt-out, delivery status from provider
   callbacks, retries, dead-letters. Never say "delivered" before provider
   confirms. Webhook signature verification + replay protection
   (/integrations/telephony/webhook).
3. File storage per policy: authenticated upload, extension allowlist +
   real MIME check, size/quota limits, safe generated keys, private bucket,
   malware scan hook, image metadata strip + WebP, safe PDF optimisation only
   if tool available, async processing with progress/retry, short-lived
   signed URLs, checksum + uploader + retention metadata, no path traversal /
   executables / decompression bombs. Recording assets only after a separate
   consent + legal review (BLOCKED until approved).
4. AI Sales Copilot (OPTIONAL, behind feature flag): provider abstraction
   (OpenAI/Gemini) server-side only; summarize rep-entered notes, extract
   objections/interest/budget, draft follow-ups for human review, call brief
   from authorised CRM history, explainable lead-priority suggestion.
   Guardrails: labelled as suggestion, never fabricate call content, never
   auto-send/close/approve/change payments/permissions/incentives, treat
   client text as untrusted (prompt-injection), minimise PII, log usage/
   latency/failures/cost, CRM fully works with AI off.
5. Import from existing CRM (LeadSquared/Zoho/HubSpot) with dry-run,
   mapping, rollback plan — only if the decision log says so.

Tests: failed job recovers; provider status not misrepresented; upload
abuse suite; webhook forgery/replay; AI failure doesn't break CRM.

Exit gate: failed jobs recover safely; unsupported guarantees not claimed.
```

---

# PHASE 9 — Android calling feasibility (separate, gated)

```
[Paste Section C header]

PHASE 9 — Personal Android calling feasibility. This is a RESEARCH + PoC
phase; manual logging remains the guaranteed fallback.

Tasks:
1. Written feasibility study: Android versions/devices in use, call-log and
   telephony APIs, permissions, background restrictions, Google Play policy
   limits, OEM behaviour, alternatives (provider-based cloud telephony / SIM
   / VoIP) with cost and consent implications.
2. Device-level proof of concept for call METADATA only (number, direction,
   start, duration) with explicit disclosure and user-controlled permissions.
   No bypassing OS security, no silent recording.
3. POST /devices/register; separate manual vs device/provider-verified call
   sources in data and UI; KPI calculations declare which source they use.
4. Recording/transcription: only after a separate technical, consent,
   privacy and legal review — otherwise mark APPROVED_OUT_OF_SCOPE.
5. Deliver go/no-go report + documented limitations. Do not promise
   automatic capture of all personal cellular calls.

Exit gate: compatibility and policy limits documented; no unsupported guarantees.
```

---

# PHASE 10 — Hardening and production launch

```
[Paste Section C header]

PHASE 10 — Release readiness.

Tasks:
1. Security review (OWASP): authz sweep of every endpoint, IDOR, XSS, CSRF,
   SSRF, upload abuse, webhook forgery, rate limits, CSP/headers, dependency
   audit, secret scan, least-privilege DB/storage credentials.
2. Accessibility audit + responsive pass (mobile/tablet/laptop/desktop);
   PWA caching review (no private data cached).
3. Performance: budgets, load test with anonymised realistic data, index/
   query-plan review, N+1 check, unbounded response check.
4. Reliability: backup + TESTED restore (docs/backup-restore.md), job recovery
   after worker restart, graceful shutdown, health/readiness, structured logs,
   error monitoring, alerts, defined RPO/RTO agreed with owner.
5. Deployment: dev/staging/prod configs; if shared VPS — inventory existing
   sites/ports/Nginx/PM2/systemd FIRST, back up configs, use isolated service
   names/ports, never restart unrelated apps; staging deploy, smoke tests,
   role-based E2E journeys, reversible release + rollback rehearsal.
6. Run all 17 critical user journeys from CLAUDE.md; run launch checklist
   (identity, lead workflow, calls, follow-ups survive restarts, analytics
   reconcile, AI optional, Android limits documented, production runbook).
7. Docs: deployment-runbook, security, testing-strategy, known-issues,
   CHANGELOG, release notes (include known defects).
8. Update traceability: every requirement VERIFIED or approved out-of-scope/
   blocked with reason. Do NOT claim 100% if anything is unverified.

Release is blocked if: critical/high security issue open, untested migration,
failing critical journey, non-reconciling money totals, untested permissions,
no backup/rollback, or hidden known defects.
```

---

## D. Quick usage guide

1. Run **Phase 0** first → review `docs/decision-log.md` and answer the blocking decisions.
2. Run phases **in order**; one phase per session, `/clear` between phases (the header re-reads CLAUDE.md + traceability).
3. After each phase, verify the reported test output yourself (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`).
4. Minimum useful product = **Phases 0–4**. Phases 5–8 = full JD coverage. Phase 9 (Android) and AI are optional.
