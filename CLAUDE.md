# CoachEasily SalesOS - Project Instructions (merged master, Phase 0)

Merged on 2026-10-14 from: `CLAUDE (1).md` (Master Spec, kept untouched), the Architecture Blueprint PDF (Oct 2026), and PHASE_PROMPTS.md section B. Precedence: **JD = business scope; Master Spec = governance and breadth; Blueprint = engineering depth and build order**; conflicts resolved by the decisions in section 2. Business source of truth: `Job_Description_Sales_Team_Lead_CoachEasily.docx`.

Project root: `/home/kamar-alam/Project/Sales app` (not a git repo; do not `git init`). Binding conventions for all agents: `docs/AGENT_CONVENTIONS.md`.

## 0. Read first, every session
`CLAUDE.md`, `docs/requirements-traceability.md`, `docs/decision-log.md`, `docs/AGENT_CONVENTIONS.md`, and the previous phase's report. Inspect existing files, deps, schema, routes, tests before changing anything. Never overwrite working features. Implement only the current phase's scope; never silently skip a requirement - mark it BLOCKED or NEEDS_DECISION with a reason.

## 1. Product
CoachEasily is an AI-native coaching business school (programs: free live AI Sprint, CBAX, MCA X, MCA Elite X, CoachEasily X app, events such as Wealthy Coach Summit; learners in English/Hindi/Marathi). SalesOS is a secure, modular Sales Team Management System: targets, CRM and follow-up engine, revenue/collections/refunds, forecasting, dashboards/KPIs, SOP centre, coaching/reviews/PIP/incentives, hiring/onboarding, complaints and handover, cross-functional tasks, Founder reporting. Not a collection of dashboards: one permission model and one KPI layer.

**Primary success principle:** every active lead has a responsible owner and a clear next action, or appears in a visible exception queue. The core success measure is reliable lead follow-up, not automatic call recording.

## 2. Decisions (override anything conflicting)
1. **Stack (ADR-001):** pnpm monorepo, Node 24, TypeScript strict. `apps/web` Next.js App Router + Tailwind + shadcn-style components + Framer Motion + React Hook Form + Zod; `apps/api` NestJS (REST `/api/v1`) + Prisma 6.x multi-file schema + PostgreSQL; `apps/worker` BullMQ/Redis; SSE; private S3/R2-compatible storage; Docker; optional `apps/mobile-companion` (later, plan only); `packages/shared-types`, `packages/validation`, `packages/ui`. The Master Spec's FastAPI/SQLAlchemy baseline is NOT used. Pin exact versions >= 2 weeks old; no rc/next dist-tags.
2. **Architecture (ADR-002):** modular monolith, domains: identity, crm, revenue, analytics, sop, people, cx, platform, ai. No microservices.
3. **Roles:** FOUNDER_CEO, SALES_TEAM_LEAD, SALES_MANAGER, SALES_EXECUTIVE (Telecaller), ADMIN + secondary groups FINANCE, HR, MARKETING, COMMUNITY, OPERATIONS, STUDENT_SUCCESS. Deny-by-default, server-enforced. Admin gets NO HR/payment access without explicit secondary permission. Hierarchy: Founder -> Team Lead -> Sales Managers (4-5 executives each; soft, configurable limit) -> Executives. Permission keys `module:action` in `docs/permissions-matrix.md`.
4. **Design:** light-luxury (ivory/warm white, charcoal text, restrained gold/red/blue), mobile app-like with bottom nav, PWA with no caching of private API data (ADR-004), `prefers-reduced-motion`, WCAG AA, English first and i18n-ready for Hindi + Marathi. Spec: `docs/ux-design-system.md`.
5. **Money:** NUMERIC/Decimal + explicit currency (default INR). Closed-Won != payment received; refund requested != approved != processed.
6. **Timestamps:** UTC TIMESTAMPTZ, shown in business timezone (default Asia/Kolkata; Mon-Sat working days).
7. **Honesty gate:** never claim a test/build passed unless run; never present mock data as real; mark BLOCKED/NEEDS_DECISION instead of inventing business rules. Business rules not decided: use the default in `docs/decision-log.md` ("default - awaiting owner approval"), make it configurable.
8. **Build order:** Phases 0-4 deliver a working CRM with accountability and money tracking; 5-8 add analytics, people, CX, notifications/files/AI; 9 Android feasibility; 10 hardening. AI and Android are optional/later.

## 3. Definition of Done
A requirement is VERIFIED only when: expected outcome defined; UI and API implemented where applicable; permission and validation enforced server-side; data persisted and audited where needed; success/failure/empty/loading/unauthorized states handled; automated tests cover critical behaviour and actually ran and passed; manual check in a representative workflow; docs and traceability updated. A visually complete but non-functional control is not done. Statuses: NOT_STARTED, IN_PROGRESS, BLOCKED, NEEDS_DECISION, IMPLEMENTED_UNTESTED, VERIFIED, APPROVED_OUT_OF_SCOPE. Do not claim 100% while anything is blocked, untested or awaiting approval. No software is guaranteed bug-free; use tests, monitoring, scans, backups, controlled releases.

## 4. Acceptance gate (every phase, run with real output)
lint, typecheck, unit tests, integration tests, migration check, production build. Fix errors; never suppress lint/type errors or skip tests. At the end: update README, API docs, data model, known issues, CHANGELOG, traceability matrix; list changed files, real test results, open decisions; propose next-phase plan. Final report format per AGENT_CONVENTIONS.

## 5. Security (see docs/security.md)
Server-side authz on every endpoint via the central policy layer (ownership + hierarchy + action permission), IDOR-safe, org-scoped, no trust in client-supplied org/manager/role/assignee/amount; HTTPS; argon2/bcrypt hashing; HttpOnly/Secure/SameSite sessions + CSRF; rate limiting (auth, imports, exports, webhooks); Zod validation + parameterised DB access; strict CORS (never wildcard with credentials); CSP and headers; secrets only in env (`.env.example` placeholders only); least privilege creds; encryption in transit/at rest; audit logs for privileged actions, role/ownership/status changes, exports, payments/refunds, incentive policy, recording access; webhook signature + replay protection + idempotency; upload policy (docs/file-storage-policy.md); dependency and secret scans; no passwords/tokens/PII in logs; DPDP-aware consent/retention (legal review needed). No SOC 2/ISO claims.

## 6. Data and API rules
UUID PKs, organization_id scope, TIMESTAMPTZ, FKs, unique constraints and indexes for real query patterns, append-only audit/history, soft delete only when justified. Transactions for call+task+status-history and deal close; transactional outbox for reminder events (ADR-003); idempotency keys for imports/webhooks/retryable creates; unique external transaction ref on payments; E.164 phone normalisation; duplicates flagged for review, never silently merged. API: `/api/v1`, stable envelope, bounded cursor/page pagination, OpenAPI with examples, never return secrets/hashes. Catalogue: `docs/api-catalogue.md`; model: `docs/data-model.md`.

## 7. Follow-up automation (Blueprint s7 + DEC-026 defaults)
NO_ANSWER -> retry task (configurable delay, working-hours rules); BUSY -> callback honouring client time; SWITCHED_OFF -> delayed retry, repeated failures to manager review; CONNECTED -> notes/interest/objections/next action; CALLBACK -> high-visibility task; OVERDUE -> notify owner, escalate to manager by threshold; WON -> record amount/date, resolve follow-ups, onboarding/handover tasks; LOST -> reason mandatory, preserve history, reactivation policy; OWNER DEACTIVATED -> reassignment exception for every open lead. **Never auto-mark Lost because the client did not answer.** BullMQ: bounded retries, exponential backoff, dead-letter, idempotent notification keys, atomic task locking, delivery status tracked (queued != delivered), recovery after worker restart.

## 8. Calling constraint (Android)
Personal Android phones: a web CRM cannot capture cellular calls. MVP = `tel:` link + mandatory disposition form (connected, no answer, busy, switched off, callback, failed, won, lost) with notes/interest/objection/next action; records labelled MANUAL; `source` reserved for DEVICE_VERIFIED/PROVIDER_VERIFIED. Manual logging must work with zero Android permissions. Companion app is gated (NO-GO v1); no OS-security bypass, no silent recording; recording/transcription only after separate technical, consent, privacy and legal review (ADR-005, docs/android-feasibility.md). Never promise automatic capture of personal calls.

## 9. AI policy (optional, flag-gated)
CRM fully works with AI off. If added: server-side provider abstraction (OpenAI/Gemini); features: summarise rep-entered notes, extract objections/interest/budget, draft follow-ups for human review, call brief from authorised CRM history, explainable lead priority. Guardrails: label as suggestion; never fabricate call content; never auto-send, auto-close, approve refunds, alter payments, change permissions or incentives; treat client text as untrusted (prompt injection); minimise PII sent; log usage/latency/failures/cost; provide non-AI fallback; subjective AI scores are never truth.

## 10. Design system and UX
Per `docs/ux-design-system.md`. Gold = premium emphasis, red = errors/overdue/risk, blue = links/info/active workflow/data viz; restrained motion; clear button hierarchy with loading/disabled states; consistent tokens; no excessive gradients/glow; mobile-first with bottom nav; tables become cards; states for loading/empty/error/success/permission-denied; accessible (keyboard, focus, labels, contrast, not colour alone, chart text summaries); PWA never caches private API data; never imply an offline write succeeded; test narrow mobile, tablet, laptop, large desktop.

## 11. KPIs and state machines
KPI definitions in `docs/kpi-dictionary.md` (numerator, denominator, window, exclusions, sources, refresh, owner, rounding, zero-denominator = dash never NaN/Infinity; forecast accuracy names its error metric). One shared role-scoped KPI query layer for ALL dashboards. State machines in `docs/state-machines.md` (lead, webinar/demo, deal, payment, refund, handover, complaint, task, PIP, incentive); transitions only through one function each, in a transaction, with audit.

## 12. Testing gates
Unit (calcs, state machines), API integration with a REAL Postgres test DB (no DB mocking), migration tests, authz/IDOR tests per endpoint group, Playwright E2E for the 17 critical journeys (UJ-01..17, docs/launch-checklist.md), upload and webhook abuse tests, import idempotency, payment idempotency, responsive + axe checks, dependency + secret scans, production build. Strategy: `docs/testing-strategy.md`. Release blocked by: critical/high security issue, untested migration, failing critical journey, non-reconciling money totals, untested permissions, no backup/rollback, hidden known defects.

## 13. Out of scope unless approved
Auto charge/refund without approved payment integration; call recording or WhatsApp/phone data access without provider+consent+legal review; AI outputs as verified facts; replacing an existing CRM before an approved migration/rollback plan; SOC 2/ISO claims; full HRMS (payroll, leave, attendance).

## 14. Operations and machine safety
Shared machine: never stop/restart/modify anything not named `salesos-*`; never touch system nginx/postgres/redis or foreign ports. Dev infra (docker compose): Postgres 127.0.0.1:5533, Redis 127.0.0.1:6391, MinIO 127.0.0.1:9100/9101 (dev-only credentials in AGENT_CONVENTIONS). Ports: web 3100, api 4100 (+N for parallel agents). Each agent uses its own DB `salesos_<agentname>`; never reset the shared `salesos` DB. Shared-VPS deployment rules: `docs/deployment-runbook.md`. Backups: `docs/backup-restore.md`.

## 15. Conventions pointer
Agent rules (ownership, shared-file discipline, no migrations in parallel waves, quality rules, report format): `docs/AGENT_CONVENTIONS.md`. Domain ownership: `prisma/schema/<domain>.prisma`, `apps/api/src/modules/<domain>/`, `apps/web/src/app/(app)/<domain>/`, `apps/web/src/features/<domain>/`, `apps/worker/src/jobs/<domain>/`, `docs/<domain>-*.md`.

## 16. Document map
Traceability `docs/requirements-traceability.md` | Decisions `docs/decision-log.md` | Permissions `docs/permissions-matrix.md` | KPIs `docs/kpi-dictionary.md` | State machines `docs/state-machines.md` | Architecture `docs/architecture.md` + `docs/adr/ADR-001..005` | Data `docs/data-model.md` | API `docs/api-catalogue.md` | Android `docs/android-feasibility.md` | Security `docs/security.md` | Files `docs/file-storage-policy.md` | Testing `docs/testing-strategy.md` | Backup `docs/backup-restore.md` | Deploy `docs/deployment-runbook.md` | Launch `docs/launch-checklist.md` | UX `docs/ux-design-system.md` | Known issues `docs/known-issues.md` | `CHANGELOG.md`.

## Current phase status

| Phase | Scope | Status | Notes |
|---|---|---|---|
| 0 | Audit, merged CLAUDE.md, traceability, decisions, permissions, KPIs, state machines, ADRs, Android study | **DONE** (2026-10-14) | Docs only; 40 default decisions awaiting owner approval; scaffold created by separate agent |
| 1 | Foundation, design system, dev env | NOT_STARTED | scaffolding in progress by another agent (not verified by Phase 0) |
| 2 | Identity, RBAC, teams, audit | NOT_STARTED | |
| 3 | CRM core: leads, calls, tasks, follow-up engine | NOT_STARTED | |
| 4 | Targets, deals, collections, refunds, forecast | NOT_STARTED | |
| 5 | Dashboards, KPIs, reports, exports | **IMPLEMENTED + VERIFIED by tests** (2026-10-15, Agent I) | 38 KPIs in one role-scoped engine, 5 role dashboards, 7 reports, reconciliation, audited CSV/XLSX exports, perf measured on 60k leads / 360k activities; all 38 formulas still "proposed default - awaiting owner approval"; see docs/analytics-report.md |
| 6 | SOP, coaching, reviews, people, incentives | NOT_STARTED | |
| 7 | CX, handover, collaboration, Founder reporting | NOT_STARTED | |
| 8 | Notifications, files, integrations, AI (optional) | NOT_STARTED | providers BLOCKED (DEC-013) |
| 9 | Android feasibility | RESEARCH DONE (written study); PoC NOT_STARTED | go/no-go: MVP GO, companion NO-GO v1, recording NO-GO |
| 10 | Hardening and production launch | NOT_STARTED | |

Update this table at the end of every phase with real results only.
