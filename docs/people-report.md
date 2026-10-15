# Phase 6 report: SOP centre, coaching, reviews, people management, incentives, skills (Agent E)

Date 2026-10-15. Scope: `prisma/schema/people.prisma`, `apps/api/src/modules/{sop,people}`, `apps/worker/src/jobs/people`, `apps/api/src/seed/domains/people.ts`, `packages/{validation/src/{sop,people}.ts, shared-types/src/events/people.ts}`, `apps/web` (`(app)/sop`, `(app)/people`, `features/{sop,people}`, `nav/{sop,people}.ts`).
Verification results are in section 9 (real runs). Business rules not decided by the owner use the defaults in `docs/decision-log.md` and are configurable. NOT an HRMS: no payroll, leave or attendance (DEC-023).

## 1. Layout

```
apps/api/src/modules/sop/      sop.controller|service, adoption.ts (pure adoption maths), sop-guards.ts (DB immutability trigger)
apps/api/src/modules/people/
  common/helpers.ts            scope helpers (scopeUserIds, assertTargetInScope), asPage, date helpers
  coaching/ performance/ (competencies, KPI/KRA, scorecards, reviews) pip/ (pip-machine.ts pure table) recognition/
  incentives/ (engine.ts pure calculation, incentive-machine.ts pure table, input-provider.ts)  hiring/ (profile-match.ts)
  onboarding/ (templates, plans, probation, expectations)  succession/  engagement/  resources/
apps/worker/src/jobs/people/   clawback.ts (refund.processed subscriber), sop-reminders.ts, probation-due.ts, index.ts
prisma/schema/people.prisma    38 models (tenant-scoped via organization_id except the anonymity-preserving `engagement_participation`; user/org references are plain UUID columns, see section 10)
```

## 2. Visibility and permission rules (server-enforced; the UI only mirrors them)

| Data | Who | Rule |
|---|---|---|
| SOP drafts / pending versions | `sop:create`, `sop:approve` holders | everyone else gets 404; readers see only the effective approved version and history of approved versions |
| SOP approval | `sop:approve` (Founder, Team Lead) | author cannot approve own version unless Founder; approved versions are immutable (API 409 + DB trigger) |
| Coaching sessions | `coaching:view` | scope = coach or participant in caller scope; notes: COACH_ONLY -> coach; PARTICIPANTS -> coach + participants; MANAGEMENT -> also team/org coaching viewers. 1:1 private notes: only the conducting manager |
| Reviews | `reviews:*` | employee sees own review only once APPROVED; reviewer cannot approve; no self-review |
| PIP | `pip:*` (HR data) | team scope for managers, own for the employee (never the DRAFT), none for Admin/Finance; audit metadata never contains narrative text |
| Incentives | `incentives:*` | employee (and anyone reading their own row) gets a status-only projection; recommender cannot decide; approve = Founder only; mark-paid = Finance only; policy approve = Founder only |
| Hiring | `hiring:*` | managers see requisitions where they are the hiring manager; interview notes only for HR (`hr:records:view`), the interviewer and the hiring manager |
| Employee profile | `hr:records:*` | HR only (Admin, Founder, Team Lead, managers denied); each read is audited (`hr.record_viewed`) |
| Succession | `succession:*` | Founder, Team Lead, HR |
| Engagement pulse | `engagement:*` | responses have no user column; participation table has no link to the response; aggregates suppressed below 5 responses |
| Recognition | `recognition:*` | scoped records; org-wide wall shows only `isPublic` items with a minimum-data projection |

`ADMIN` holds none of the sensitive keys (asserted in `catalogue-matrix.spec.ts` and `people-negative-authz.spec.ts`).

## 3. State machines (implemented as pure tables + service guards)

- **PIP** (`pip/pip-machine.ts`, state-machines.md s9): DRAFT -> PENDING_APPROVAL (TL/HR; needs goals, measures, >=1 checkpoint, else 422) -> ACTIVE (`POST /approve` by pip:approve; needs the employee acknowledgement else 409 `PIP_ACK_REQUIRED` and a reminder outbox event) ; PENDING_APPROVAL -> DRAFT (return); ACTIVE -> EXTENDED (TL/HR request with new end date) -> ACTIVE (approver decision; extension count max 1, second request 422 `PIP_EXTENSION_LIMIT`); ACTIVE -> COMPLETED_SUCCESS / COMPLETED_NOT_IMPROVED (final review required); ACTIVE|DRAFT -> CANCELLED (Founder/HR). Activation creates one coaching action per checkpoint for the employee. Every transition: optimistic `version` check, `people_state_log` row, audit entry, outbox event.
- **Incentive recommendation** (`incentives/incentive-machine.ts`, s10): CALCULATED -> SUBMITTED -> APPROVED | REJECTED | CALCULATED(recalc, snapshot_version+1); APPROVED <-> ON_HOLD; APPROVED -> PAID (Finance); PAID -> CLAWBACK_PROPOSED (system only, via the worker) -> ADJUSTED | WAIVED. No approved policy: `409 POLICY_NOT_CONFIGURED`. Approved amount above computed requires an override reason (422). A recommendation is never a payment; payout happens outside SalesOS.
- **SOP version**: DRAFT -> PENDING_APPROVAL -> APPROVED -> SUPERSEDED | RETIRED; PENDING_APPROVAL -> REJECTED (editing a rejected version returns it to DRAFT). Effective version = highest APPROVED with `effective_date <= today`.
- **Review**: DRAFT -> SUBMITTED -> APPROVED -> ACKNOWLEDGED.
- **Incentive policy**: DRAFT -> APPROVED (Founder; slabs must be complete and non-overlapping, else 422) -> SUPERSEDED when a newer version is approved; approved versions are immutable.

## 4. Incentives: structure only, no invented numbers (DEC-015)

`incentiveStructureSchema` defaults contain no rates, slabs or caps. The seeded `[DEMO]` policy is a DRAFT with 0% placeholder rates and is not approved, so the product starts in `POLICY_NOT_CONFIGURED`. The calculation engine (`incentives/engine.ts`) is pure (Prisma Decimal arithmetic, half-up rounding): basis REVENUE|COLLECTION, optional net-of-refunds, FLAT_ON_TOTAL or MARGINAL slabs (rate % or fixed amount), eligibility gates (any metric or `achievementPct`), cap. Inputs come from the caller or from an `IncentiveInputProvider` (token `INCENTIVE_INPUT_PROVIDER`, `incentives/input-provider.ts`): the revenue/analytics phases register an implementation; the default `ManualInputProvider` returns nothing, so the API requires explicit inputs (stored as the immutable snapshot with `input_source`). Phase 6 never queries revenue tables.

**Clawback contract for the revenue phase** (`packages/shared-types/src/events/people.ts`): when a refund is PROCESSED publish `refund.processed` through the outbox with `RefundProcessedPayload { refundId, organizationId, dealId, paymentId, attributedUserId, amount, currency, processedAt, paymentCollectedAt? }`. The worker (`jobs/people/clawback.ts`) finds PAID (or already CLAWBACK_PROPOSED) recommendations of `attributedUserId`, picks the one whose period contains the collection date (else the latest payout), checks the policy's `clawbackWindowDays`, and creates an `incentive_adjustments` PROPOSAL = refund x (approved / basis), capped at the approved amount. Idempotent per (recommendation, refund). Never auto-applied; Founder or Finance decides (ADJUSTED / WAIVED).

## 5. Data contracts for Phase 5 analytics (tables and columns that feed KPIs)

| KPI (docs/kpi-dictionary.md) | Source | Definition |
|---|---|---|
| SOP adoption rate (KPI-PRO-001) | `sop_documents` (is_mandatory, status=ACTIVE, audience_roles), `sop_versions` (status=APPROVED, effective_date<=today, highest version_number), `sop_acknowledgements` (version_id, user_id), `users.is_active`, `user_role_assignments` | adoption % = acknowledged (effective mandatory version, in-audience active user) / required pairs x 100. Acknowledgements of older versions never count. `GET /sop/adoption` returns the same maths (per org/team/own scope). SQL: `WITH eff AS (SELECT DISTINCT ON (d.id) d.id doc_id, d.audience_roles, v.id version_id FROM sop_documents d JOIN sop_versions v ON v.document_id=d.id AND v.status='APPROVED' AND (v.effective_date IS NULL OR v.effective_date<=CURRENT_DATE) WHERE d.organization_id=$1 AND d.status='ACTIVE' AND d.is_mandatory ORDER BY d.id, v.version_number DESC), req AS (SELECT e.version_id, u.id user_id FROM eff e JOIN users u ON u.organization_id=$1 AND u.is_active AND (cardinality(e.audience_roles)=0 OR EXISTS (SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.user_id=u.id AND r.key=ANY(e.audience_roles)))) SELECT count(*) required, count(a.id) acknowledged FROM req LEFT JOIN sop_acknowledgements a ON a.version_id=req.version_id AND a.user_id=req.user_id` (verified against the seed: 27.27%) |
| Coaching hours conducted (KPI-TEA-006) | `coaching_sessions.duration_min` (+ `coach_id`, `session_date`, `topics`), `one_on_ones.duration_min` where `status='HELD'` (`manager_id`, `scheduled_for`) | hours = (sum session minutes + sum HELD 1:1 minutes) / 60 per coach per period. `GET /coaching/hours?from&to` returns per coach and per topic (facts only, no AI score) |
| Attrition (KPI-TEA-004) | `employee_profiles` (`exit_date`, `exit_type` VOLUNTARY / INVOLUNTARY / PROBATION_FAILURE / TRANSFER, `join_date`) | exits in period excluding TRANSFER / average headcount; headcount from `users.is_active` + join/exit dates (DEC attrition default). HR-restricted: expose to Phase 5 only as aggregates |
| Team engagement (KPI-TEA-005) | `engagement_responses.answers` (SCALE_5 answers, `survey_id`, `responded_on`), `engagement_surveys.questions` | average of scale answers per survey/question; suppress when responses < 5 (`aggregateResponses`, anonymity floor). No user identifiers are stored with responses |
| Review / PIP / recognition volumes | `performance_reviews.status/rating`, `improvement_plans.status`, `recognitions` | counts by period/status; PIP and review rows are HR data (aggregate only) |
| Onboarding / probation completion | `onboarding_plans/items.status`, `probation_reviews.status/outcome/due_date` | progress % ignores SKIPPED items |
| Incentive recommendation status counts | `incentive_recommendations.status`, `incentive_adjustments.status` | for Founder reporting only; amounts are sensitive |

Scorecards (`scorecards.inputs`) and KPI assignments (`kpi_assignments.items`) store targets and manual inputs and reference `kpi_definitions.dictionary_key`; computed KPI values are NOT stored here, Phase 5 supplies them.

## 6. Events

Published (outbox, idempotent): `sop.version_submitted|approved|rejected`, `sop.acknowledgement_reminder` (per user; on approval, manual remind, and the daily worker job after a 3-day grace), `pip.*`, `pip.acknowledgement_reminder`, `incentive.*` (calculated, submitted, approved, rejected, recalculated, held, released, paid, clawback_proposed, adjusted, waived), `review.approved`, `resource.assigned`, `recognition.granted`, `probation.review_due`. Consumed: `refund.processed` (contract in section 4). Delivery to people is the notifications phase's job (it subscribes to these types).

## 7. Seed (`pnpm db:seed`, idempotent, all `[DEMO]`)

Competency framework (10 JD competencies), KPI/KRA definitions, 7 approved SOPs with sample acknowledgements, 2 process gaps, recognition programs, a DRAFT incentive policy with zero rates, the Sales Team Lead hiring profile (taken from the JD: Bachelor's in Business/Marketing/Commerce/Management or related, MBA preferred, 8-10 years, 3 years managing a team, industries Coaching/Education/EdTech/Training), onboarding templates (30/60/90 probation checkpoints), role expectations, 15 skills-library entries (JD skills), one pulse survey, one coaching session and one 1:1.

## 8. Decisions and deviations (details in section 10 for reconcile items)

1. Manager-proposed PIPs for executives (state-machines.md s9 "Mgr proposes") are not implemented as a separate step (KI-J-02, NEEDS_DECISION): managers hold `pip:update` (checkpoint updates, draft edits) but not `pip:create` per the permission matrix. Employee acknowledgement of the ownership/accountability expectations (JD-HR-009) was added by the integration pass.
2. Extension approval follows the diagram (ACTIVE -> EXTENDED -> ACTIVE): the Team Lead/HR requests, Founder/HR decides; the end date changes only on approval.
3. Policy `effectiveFrom` defaults to the approval date, so a newly approved policy does not apply to earlier periods.
4. Recognition for executives follows the matrix (`own`); an org-wide wall is provided only for items marked public, with a minimum-data projection.
5. `approver == recommender -> 403` (state machine) is enforced, although the permission matrix already prevents any role from holding both `recommendation:create` and `recommendation:approve`.
6. Admin gets 403 on all HR data (also when the data belongs to Admin users); there is no break-glass path.

## 9. Verification (real runs, 2026-10-15, DB `salesos_agente`, test DBs `salesos_agente_test` / `salesos_agente_wtest`)

| Command | Result |
|---|---|
| `pnpm db:validate` | valid |
| `pnpm db:push` (DB `salesos_agente`) + `pnpm db:generate` | in sync |
| `pnpm db:seed` (twice) | complete, idempotent (7 SOPs, 15 resources, 10 competencies, 1 incentive policy DRAFT, ...) |
| `pnpm --filter @salesos/api test` (whole suite) | 53 files, 1458 tests passed (people/SOP files: `people-pure` 19, `sop` 16, `pip` 12, `incentives` 11, `people-isolation` 22, `people-negative-authz` 5, and 100 people/SOP rows inside `negative-authz.spec.ts` (725 tests in that file)) |
| `pnpm --filter @salesos/worker test` | 5 files / 56 tests passed in my files; `people.spec.ts` 9/9 passed. One failure in another agent's `revenue.spec.ts` (Monday snapshot reminder), not in people code |
| `pnpm --filter @salesos/web test` (whole suite) | 41 files, 308 tests passed (people/SOP: 20 files, 135 tests) |
| lint: api, worker, shared-types, web files of this domain | 0 errors, 0 warnings in files of this domain. Other agents' files: `packages/validation/src/cx.ts` 1 error (unused `fileIds`), `apps/web/e2e/crm-journeys.spec.ts` 3 errors (`any`), `features/crm` warnings |
| typecheck | api, worker, validation, shared-types, ui, web: no errors in this domain's files. At the time of the run `features/cx` had 2 type errors (other agent) |
| `pnpm --filter @salesos/api build` | OK |
| web production build | `next build` with `NEXT_PUBLIC_API_URL=http://localhost:4105/api/v1` compiled all routes including the 22 SOP/people routes. It had to be built in a temporary copy of `apps/web` (type check disabled there) because another agent's `next dev` was writing the shared `apps/web/.next/dev` types and `features/cx` had type errors at that moment; the copy was deleted afterwards. Re-run `pnpm build` once the other domains are clean |
| Playwright `e2e/people.spec.ts` against API :4105 + web :3105 (DB `salesos_agente`) | 9/9 passed: journey 11 (manager records a coaching session with an action item, executive completes it, manager drafts/submits a review, Team Lead approves, employee acknowledges, executive denied HR pages) and SOP (author, Team Lead cannot self-approve, Founder approves, executive acknowledges, adoption dashboard). Foundation specs `auth`/`admin`/`a11y`/`security` (same run): 19 passed, 1 failed: `auth.spec.ts` "session revoked" hard-codes origin `localhost:3103`, so it fails when run on ports 3105/4105 (environment-specific, not a regression) |

Not verified: Lighthouse/mobile device testing; Hindi/Marathi copy review; a real notification delivery of the published events (notifications phase).

## 10. Items the lead must reconcile

- `people.prisma` references users/organizations by plain UUID columns without `@relation`, so the identity models are untouched. Add FKs in the consolidated migration if wanted (all columns are `uuid`, NOT NULL where the domain requires it).
- `prisma/sql` guard for `sop_versions` immutability is created idempotently at API boot (`sop-guards.ts`) and by the seed; include `salesos_sop_version_immutable()` + trigger `sop_versions_immutable` in the consolidated migration.
- Negative-authz rows for 100 routes were appended to `apps/api/test/negative-authz.spec.ts` (central table); exhaustive denied-role coverage lives in `apps/api/test/people-negative-authz.spec.ts`.
- Dependencies added: none.
- Revenue phase: publish `refund.processed` and provide `INCENTIVE_INPUT_PROVIDER` (see section 4).
- Notifications phase: subscribe to the people/SOP event types in section 6.
