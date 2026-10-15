# Phase 4 report: revenue management (Agent G)

Date 2026-10-15. Scope: `prisma/schema/revenue.prisma`, `apps/api/src/modules/revenue/**`, `apps/worker/src/jobs/revenue/**`, `apps/api/src/seed/domains/revenue.ts`, `apps/web/src/features/revenue/**`, `apps/web/src/app/(app)/revenue/**`, `apps/web/src/nav/revenue.ts`, `apps/web/src/lib/api/hooks/revenue.ts`, `packages/validation/src/revenue.ts`, `packages/shared-types/src/events/revenue.ts`.

## 1. What exists

| Area | Implementation |
|---|---|
| Targets | `target_periods` (month / quarter / fiscal year, DEC-001), `targets` for REVENUE / COLLECTION / ENROLMENT with a self-referencing breakdown Founder -> Team Lead -> Manager -> Executive. A child can never push the sum above its parent (row-locked check, concurrent-safe); consistency (CONSISTENT / UNDER_ALLOCATED) is reported. Mid-period joiners are prorated by Mon-Sat working days and the basis is stored. `PATCH /targets/:id` only PROPOSES a revision (reason >= 10 chars); the value changes on approval (DEC-002 approver rules), `original_amount` is DB-immutable, revisions are append-only. Daily achievement series + pacing + target-as-of-date. |
| Deals | `deals` (stages OPEN, NEGOTIATION, PAYMENT_PENDING, WON, LOST, CANCELLED), types NEW / UPSELL / CROSS_SELL, program attribution, INR explicit, high-value flag (DEC-027) with blocker rows, escalation and resolution. |
| Deal close | `POST /deals/:id/close` is ONE transaction: row lock, lead status history through `@salesos/crm-core` `transitionLeadTx`, deal, immutable `sales_records` + `sales_credits`, expected `payments`, ONBOARDING + FOLLOW_UP tasks (`createTaskTx`), audit, outbox. Idempotent (double / concurrent close = one sale). Atomic rollback tested at four injected failure points. |
| Sales records | `sales_records`, `sales_credits`, `sale_adjustments`: DB triggers refuse UPDATE/DELETE. Adjustments are separate rows (PENDING -> APPROVED/REJECTED once). Cancelling a sale is an adjustment (Founder/Finance only). |
| Money split | `calc/deal-money.ts`: sale value (net of approved adjustments), amount due, collected (VERIFIED + RECONCILED only), refunded (PROCESSED + RECONCILED only), net collections. Pending-verification and approved-not-paid are shown separately. |
| Collections | `payments` with `UNIQUE (organization_id, provider, external_transaction_ref)` and `UNIQUE (organization_id, idempotency_key)`. Record -> Finance verify (separation of duties, overpayment guard, tolerance) -> reconcile against statement lines; reject / reverse paths; append-only `payment_events`; reconciliation view (unreconciled, deal mismatch, suspected duplicates). |
| Refunds | `refunds` + append-only `refund_events`: REQUESTED -> REVIEWED -> APPROVED/REJECTED -> PROCESSED -> RECONCILED (+ WITHDRAWN, CANCELLED). Every step stores actor, role, time, reason. Requester can never review/approve their own. Optional Founder-only threshold. No automatic payout: PROCESSED is Finance recording an external payout (unique reference). |
| Forecasts | `forecasts` + immutable `forecast_snapshots`, method STAGE_WEIGHTED_V1 (DEC-030), always labelled ESTIMATE; accuracy = max(0, 1 - abs(F-A)/A), bias and WAPE from the period-start snapshot. |
| Pricing | `program_prices` (append-only versions), `pricing_proposals` + `pricing_proposal_events` (DRAFT -> SUBMITTED -> APPROVED/REJECTED, Founder decides; approved PRICE_CHANGE appends a price version). |
| Market intel | `feedback_entries` (MARKET / COMPETITOR / LEARNER, one table), `growth_opportunities` (CHANNEL / SEGMENT / OTHER), `strategy_plans` + `strategy_initiatives`. |
| Settings | `revenue_settings` (fiscal year start, stage probabilities, default high-value threshold, refund Founder threshold, payment tolerance, default due days), `program_revenue_config` (per-program threshold). Founder-only, audited. |
| Worker | `apps/worker/src/jobs/revenue`: overdue expected installments (owner), payments waiting >24h for verification (Finance), "take the period-start forecast snapshot" reminder (Mondays / 1st). All via de-duplicated `notification.requested` outbox events; no money is changed. |
| UI | `/revenue` hub, `/revenue/targets`, `/revenue/deals` (+ `[id]`), `/revenue/collections`, `/revenue/refunds`, `/revenue/forecasts`, `/revenue/pricing`, `/revenue/intel`; en / hi / mr strings (`revenue.*`). |

Deviation (same as `crm.prisma`): `organization_id`, user ids and team ids are plain indexed UUID columns without `@relation` to identity models; services validate every org/user pair. Real FKs exist to `leads`, `programs` and inside the domain. Back-relations were appended to `Lead` (`deals`) and `Program` (`deals`, `dealsFrom`, `prices`, `revenueConfig`) in `crm.prisma`.
Other deviations: `target_allocations` is folded into `targets.parent_id`; market/competitor/learner feedback are one `feedback_entries` table with `kind`; the catalogue's `/market-intel` is implemented as `/feedback`; payments recorded against a deal require the deal to be WON (an advance before close is not modelled).

## 2. Decision defaults implemented (all "awaiting owner approval", configurable)

DEC-001 month / quarter / Apr-Mar fiscal year, proration by working days, explicit stored basis. DEC-002 revisions with reason, approver Founder for Founder/Team-Lead level, Team Lead or Founder for Manager/Executive; original kept; as-of-date lookup. DEC-003 two separate measures: revenue = booked sales net of approved adjustments and approved refunds; collections = verified payments net of processed refunds. DEC-004/005 collections follow the sale's credit split (largest-remainder, sums exactly); a split needs Team Lead authority (`targets:approve`). DEC-019 TL/Manager review, Founder or Finance approve/reject (never the requester), Finance process + reconcile, no automatic payout, Founder-only above `refund_founder_threshold` when set. DEC-027 program threshold, else org default, else top 10% of open deals in 90 days (needs 10 deals; otherwise nothing is flagged), Team Lead notified, Founder above 2x. DEC-030 stage probabilities NEW 5 / QUALIFIED 15 / DEMO_ATTENDED 35 / NEGOTIATION 60 / PAYMENT_PENDING 85 (plus OPEN 15) %.

Forecast method (STAGE_WEIGHTED_V1): `total = booked-to-date + sum(open deal amount x stage probability)` over open deals whose expected close date is in `[max(period start, as-of), period end]`. While a deal is OPEN the lead stage (NEW / QUALIFIED / DEMO_ATTENDED) refines the probability. Deals with no expected close date, or one in the past, are NOT in the number and are reported as `unscheduled` / `overdue`.

## 3. Calculation contract for Phase 5 (`apps/api/src/modules/revenue/calc`, pure, Decimal in / Decimal-or-string out)

Import from `modules/revenue/calc` (index). Money inputs are `Prisma.Decimal | string | bigint`; never JS numbers.

| Function | Purpose |
|---|---|
| `D, round2, sum, money, pct1, allocate(total, shares)` | Decimal helpers; half-up 2 dp; `pct1` returns a 1-dp string or `null` when the denominator is not positive; `allocate` splits to the paisa, parts sum exactly. |
| `dealMoney(input)` / `serializeDealMoney` | sale / due / collected / pending / refunded / net / refundable per deal. |
| `achievementPct(actual, target)`, `pacing(...)`, `targetAsOf(revisions, asOf)`, `prorate`, `prorationBasis`, `dailySeries` | KPI-REV-001/002/003 maths. |
| `revenueActual(sales, refunds, window, userIds|null)` | KPI-REV-001 numerator (booked net of approved adjustments and approved refunds, credit split aware; `null` = organisation, each sale once). |
| `collectionActual(sales, payments, refunds, window, userIds|null)` | KPI-REV-002 numerator (VERIFIED/RECONCILED in window net of PROCESSED/RECONCILED refunds). |
| `averageDealValue(netBooked, wonCount)` | KPI-SAL-004. |
| `stageWeightedForecast`, `forecastAccuracy`, `forecastBias`, `wape` | KPI-SAL-005 / DEC-030. |
| `resolveThreshold`, `evaluateHighValue`, `percentile90` | DEC-027. |
| `periodBounds`, `forecastBounds`, `istDate`, `istRange`, `workingDays` | period and IST helpers. |
| `canDealTransition`, `canPaymentTransition`, `canRefundTransition`, `canProposalTransition`, `childLevel`, `revisionApproverRoles` | state machines. |

`MetricsService` (exported by `RevenueModule`) loads the facts and calls these; `DealMoneyService.forDeals(orgId, dealIds)` gives per-deal money. Phase 5 should reuse both.

Tables / columns Phase 5 reads: `sales_records(deal_id, sale_value, currency, closed_at, deal_type, enrolments, program_id)`, `sales_credits(user_id, share_pct, amount)`, `sale_adjustments(status, delta, credit_allocations)` (only `APPROVED` counts), `payments(status, amount, verified_at, deal_id, owner_id, team_id)` (VERIFIED/RECONCILED = collected), `refunds(status, approved_at, processed_at, approved_amount, processed_amount)`, `deals(stage, amount, expected_close_on, is_high_value, deal_type, owner_id, team_id, program_id, closed_at)`, `targets(...)` + `target_revisions(status, new_amount, effective_from)`, `forecasts` / `forecast_snapshots(kind, total, taken_at)`. Day boundaries are IST: use `istRange`.

## 4. Events (outbox) and the Agent E contract

`packages/shared-types/src/events/revenue.ts` (`REVENUE_EVENTS`). All money in payloads is a 2-dp string. `refund.processed` (`RevenueRefundProcessedPayload`) is a SUPERSET of people's `RefundProcessedPayload` (refundId, organizationId, dealId, paymentId, attributedUserId, amount, currency, processedAt, paymentCollectedAt) so the existing clawback handler works unchanged (tested in `apps/worker/test/revenue.spec.ts` and `apps/api/test/revenue/isolation.spec.ts`). `refund.approved` carries `creditedOwners`. Notifications are `notification.requested` events (types `collection.status_changed`, `refund.status_changed`, `founder.action_item`).

## 5. Authorization

Every route has `@RequirePermission`. Lists use `access.scopedWhere` (owner = deal owner; denormalised `owner_id`/`team_id` on payments and refunds); single records answer 404 when out of scope or cross-org. Summary-only roles (Finance on targets/forecasts, Student Success on deals/refunds) get minimum-data projections. Admin and HR hold no revenue permission (DEC-032). Negative cases for all 69 routes are in `apps/api/test/negative-authz.spec.ts`.

## 6. Endpoints

See `docs/api-catalogue.md` section "Revenue (P4)" (status per route). Extras added: `/targets/periods`, `/targets/:id/{revisions,achievement}`, `/deals/pipeline`, `/deals/:id/{reopen,blockers/:id/resolve,adjustments/:id/decision}`, `GET /leads/:id/deals`, `/collections/{daily,:id,:id/reject,:id/reverse}`, `/refunds/{:id,:id/withdraw,:id/cancel}`, `/forecasts/{preview,accuracy}`, `/proposals/{:id,:id/submit,:id/withdraw}`, `/pricing/{prices,programs/:id/prices}`, `/revenue/{programs,settings,programs/:id/threshold}`, `/feedback`, `/growth-opportunities`, `/strategy-plans`, `/strategy-initiatives/:id`.

## 7. Seed

`pnpm db:seed` (idempotent) adds [DEMO] programs prices, a month of targets with the full breakdown, 9 booked deals (verified / recorded / expected / reconciled payments, one processed and one requested refund, one upsell), 6 open deals (one high-value), a period-start forecast snapshot, a submitted proposal, feedback, growth opportunities and a strategy plan. All numbers are invented and labelled.

## 8. Verification (real runs, 2026-10-15; DB `salesos_agentg*`)

| Command | Result |
|---|---|
| `pnpm db:validate`; `prisma db push` on `salesos_agentg` | valid; in sync |
| `pnpm --filter @salesos/api test` (DB `salesos_agentg_test`, whole suite incl. other agents' specs) | 53 files, 1458 tests passed |
| of which revenue: `calc` 38, `money-no-floats` 11, `deals` 22, `collections` 17, `refunds` 20, `targets` 13, `forecasts` 4, `pricing-intel` 9, `isolation` 7; `negative-authz` 725 (all routes incl. 69 revenue) | passed |
| `pnpm --filter @salesos/worker test` (DB `salesos_agentg_wtest`, fresh) | 6 files, 57 tests passed (revenue: 5) |
| `pnpm --filter @salesos/web test` | 41 files, 308 tests passed (revenue: lib 9, components 15, i18n coverage 4) |
| `pnpm --filter @salesos/api lint` / `worker lint` / `typecheck` (api, worker, web) | 0 errors (api: 3 pre-existing warnings in test/cx) |
| `pnpm --filter @salesos/web lint` | revenue files clean; 2 pre-existing react-hooks warnings in `features/crm` (not changed) |
| `pnpm --filter @salesos/api build`, `worker build`, `web build` (NEXT_PUBLIC_API_URL=:4107) | passed |
| Playwright `e2e/revenue-journeys.spec.ts` (built API :4107 + built web :3107, DB `salesos_agentg`, seeded demo users) | 3 passed: UJ-07, UJ-08, UJ-09 |
| Playwright `e2e/revenue-a11y.spec.ts` (axe WCAG A/AA on 8 revenue pages + 375px width check) | 2 passed (an earlier run found a real `aria-controls` defect on tab-less Tabs and a dl/div markup defect; both fixed) |

To rerun E2E: seed `salesos_agentg`, run the built API with `PORT=4107 CORS_ORIGINS=http://localhost:3107`, build web with `NEXT_PUBLIC_API_URL=http://localhost:4107/api/v1`, `PORT=3107 pnpm --filter @salesos/web start`, then `E2E_WEB_PORT=3107 E2E_API_PORT=4107 pnpm --filter @salesos/web exec playwright test e2e/revenue-journeys.spec.ts`.

## 9. Known issues and follow-ups

- Forecast period-start snapshots are taken by a person (button / `POST /forecasts`); the worker only reminds. Automating them needs the calc package moved out of `apps/api` (the worker cannot import `apps/api` source): lead decision.
- `ChartCard` (UI package) takes JS numbers; the achievement chart passes whole-rupee integers for display only. All arithmetic uses strings / Decimal.
- Payments cannot be recorded before the deal is closed won (advance / token payments are not modelled).
- (closed by the integration pass) the close dialog has a multi-owner credit split editor (exactly 100%, unique active users, Team Lead / Founder only) and `/revenue/strategy` shows strategy plans and initiatives.
- (closed) `packages/validation/src/cx.ts` lint error fixed.
- Hindi / Marathi strings are first-pass translations needing native review.
- No real payment gateway: `provider` is `MANUAL` unless supplied; PROCESSED / VERIFIED are manual confirmations by design (DEC-019).
