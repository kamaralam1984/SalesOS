# KPI Dictionary (Phase 5, generated from the KPI registry)

> GENERATED FILE. Source of truth: `apps/api/src/modules/reporting/kpi/defs/*.ts` and `registry.ts`. Edit the registry, then run `pnpm --filter @salesos/api docs:kpi`.
> `apps/api/test/analytics/dictionary-doc.spec.ts` fails when this file is out of date.

Finalised 2026-10-15 (Phase 5). **Owner-approval status: every formula is a "proposed default - awaiting owner approval"** (decision log DEC-003/004/005/009/010/017/020/023/024/026/028/030/036/037/038/039). The engine implements each default exactly as written here and some thresholds are configurable per organisation through `platform_settings` key `kpi` (see Configuration). Nothing here has been signed off by the business owner; a changed decision means a changed registry entry, a regenerated document and a re-run of the fixture tests.

## Global rules

- **One engine.** Every dashboard tile, report, export and Founder-report number is produced by `KpiService` (role-scoped). Dashboards never compute their own figures.
- **Result contract.** Each result carries: `value`, `numerator`, `denominator`, `dateRange` (IST business dates), `period`, `currency`, `filters` (applied / ignored / scope level), `definition` (id, summary, formula, zero-denominator rule, approval status), `breakdown`, `caution`, `dataSource` (calls), `isEstimate`, `computedAt` and `freshness` (LIVE or CACHED, age, refresh cadence). Values are decimal strings already rounded per the definition.
- **Zero denominator:** the API returns `value: null` with a `nullReason` (`ZERO_DENOMINATOR`, `NO_TARGET`, `NO_SNAPSHOT`, `INSUFFICIENT_RESPONSES`, `NO_DATA`) and the UI renders an em dash with the reason. Never NaN, Infinity or a fake 0% / 100%. Plain counts of nothing are a real 0.
- **Scope.** Values are computed only over records the caller may see: `kpi:view` scope (own / team / org / summary) narrowed by the KPI's domain permission (`requires`). Filters (team, program, source, owner) are intersected with that scope and can only narrow it; an out-of-scope filter yields an empty scope, never wider data. `summary` scope (Finance, HR, Marketing, Student Success) gets organisation aggregates without per-person breakdowns. KPIs marked `minScope: org` (attrition, engagement, dashboard accuracy, reporting quality/timeliness) are not shown to team- or own-scope viewers.
- **Money:** `NUMERIC`/Decimal end to end, INR explicit; revenue maths is reused from `modules/revenue/calc` (credit splits, adjustments, refunds); percentages 1 decimal unless stated.
- **Time:** UTC storage, IST (Asia/Kolkata) day boundaries, Mon-Sat working days, `[from, to]` inclusive in IST. Target KPIs measure the target period containing `to` (month by default; quarter / fiscal year selectable) from period start to min(as-of, period end).
- **Call data caveat:** calls are MANUAL in the MVP; call KPIs report the `source` mix (MANUAL / PROVIDER / DEVICE) and never merge call attempts with unique clients.
- **Exclusions common to all:** merged-away duplicate leads, cancelled records, `[DEMO]` leads when `excludeDemo` is on (default on in production).
- **Forecast accuracy** names its error metric: Accuracy = max(0, 1 - |F-A|/A) x 100 against the period-start snapshot, WAPE and bias alongside.
- **Reconciliation:** `GET /reports/reconciliation` recomputes dashboard figures with independent SQL and compares them (KPI-PRO-002 evidence); a nightly scheduled run is stored in `kpi_reconciliation_runs`.

## Configuration (per organisation, optional)

`platform_settings` row with key `kpi`, JSON object; unknown keys are ignored, wrong types fall back to the default.

| key | default | meaning |
|---|---|---|
| `conversionWindowDays` | 60 | lead conversion window from creation (DEC-009) |
| `attributionWindowDays` | 30 | webinar / demo to sale attribution window (DEC-010) |
| `staleActivityDays` | 7 | idle days after which a lead is "stale" (ageing) |
| `complianceActivityDays` | 7 | activity recency required for CRM compliance (DEC-038) |
| `newLeadGraceMinutes` | 60 | leads younger than this are not yet "eligible" for compliance |
| `sopNewJoinerGraceDays` | 7 | users added this recently who have not acknowledged are not counted as required |
| `excludeDemo` | false (true in production) | drop `[DEMO]` leads from lead KPIs |
| `engagementFloor` | 5 | minimum responses per survey before an engagement score is shown |
| `csatMinSample` | 5 | below this many responses a caution is shown |

## Summary table

| ID | KPI | Unit | Source | Owner | Refresh | Extra permission | Min scope | Approval status |
|---|---|---|---|---|---|---|---|---|
| KPI-CX-001 | Learner satisfaction (CSAT) | SCORE | JD KPI Customer Experience | Student Success / Team Lead | On request | `satisfaction:view` | own | proposed default - awaiting owner approval |
| KPI-CX-002 | Refund reduction (like-for-like, %) | PERCENT | JD KPI Customer Experience | Team Lead | On request | `refunds:view` | own | proposed default - awaiting owner approval |
| KPI-CX-003 | Complaint resolution (%) | PERCENT | JD KPI Customer Experience | Student Success / Team Lead | On request | `complaints:view` | own | proposed default - awaiting owner approval |
| KPI-CX-004 | Enrolment experience score | SCORE | JD KPI Customer Experience | Student Success | On request | `satisfaction:view` | own | proposed default - awaiting owner approval |
| KPI-EXC-001 | Unassigned leads | COUNT | Blueprint s8 | Manager | Near real time | `leads:view` | own | proposed default - awaiting owner approval |
| KPI-EXC-002 | No-next-action leads | COUNT | Blueprint s8 | Manager | Near real time | `leads:view` | own | proposed default - awaiting owner approval |
| KPI-EXC-003 | Overdue tasks | COUNT | Blueprint s8 | Manager | Near real time | `tasks:view` | own | proposed default - awaiting owner approval |
| KPI-EXC-004 | New leads | COUNT | Blueprint s8 | Manager | Near real time | `leads:view` | own | proposed default - awaiting owner approval |
| KPI-EXC-005 | Follow-up compliance | PERCENT | Blueprint s8 | Manager | Near real time | `tasks:view` | own | proposed default - awaiting owner approval |
| KPI-FND-001 | Completion of action items (%) | PERCENT | JD KPI Founder Support | Team Lead | Near real time | `action-items:view` | own | proposed default - awaiting owner approval |
| KPI-FND-002 | Quality of reporting (completeness %) | PERCENT | JD KPI Founder Support; DEC-028 | Founder | On submit | `founder-reports:view` | org | proposed default - awaiting owner approval |
| KPI-FND-003 | Timeliness of reporting (%) | PERCENT | JD KPI Founder Support | Founder | On submit | `founder-reports:view` | org | proposed default - awaiting owner approval |
| KPI-PRD-001 | Calls completed | COUNT | JD KPI Productivity | Team Lead / Manager | Near real time (computed on request) | `calls:view` | own | proposed default - awaiting owner approval |
| KPI-PRD-002 | Follow-ups completed | COUNT | JD KPI Productivity | Manager | Near real time | `tasks:view` | own | proposed default - awaiting owner approval |
| KPI-PRD-003 | CRM compliance (%) | PERCENT | JD KPI Productivity; DEC-038 | Team Lead | On request; org snapshot daily | `leads:view` | own | proposed default - awaiting owner approval |
| KPI-PRD-004 | Response time (working minutes) | MINUTES | JD KPI Productivity; DEC-039 | Manager | On request | `leads:view` | own | proposed default - awaiting owner approval |
| KPI-PRD-005 | Lead ageing (stale leads) | COUNT | JD KPI Productivity | Manager | Near real time | `leads:view` | own | proposed default - awaiting owner approval |
| KPI-PRD-006 | Call attempts | COUNT | Blueprint s8 (call attempts) | Team Lead / Manager | Near real time (computed on request) | `calls:view` | own | proposed default - awaiting owner approval |
| KPI-PRD-007 | Connected calls | COUNT | Blueprint s8 (connected calls) | Team Lead / Manager | Near real time (computed on request) | `calls:view` | own | proposed default - awaiting owner approval |
| KPI-PRD-008 | Unique clients called | COUNT | JD KPI Productivity (unique clients vs attempts) | Team Lead / Manager | Near real time (computed on request) | `calls:view` | own | proposed default - awaiting owner approval |
| KPI-PRO-001 | SOP adoption rate (%) | PERCENT | JD KPI Process | Team Lead | On request; org snapshot daily | `sop:adoption:view` | own | proposed default - awaiting owner approval |
| KPI-PRO-002 | Dashboard accuracy and timeliness | PERCENT | JD KPI Process | Founder / Tech | Daily 03:00 IST (scheduler) and on demand via POST /reports/reconciliation/run | - | org | proposed default - awaiting owner approval |
| KPI-REV-001 | Monthly revenue achievement (%) | PERCENT | JD KPI Revenue | Founder (owner); Team Lead | On request (live); org snapshot daily | `targets:view` | own | proposed default - awaiting owner approval |
| KPI-REV-002 | Collection target achievement (%) | PERCENT | JD KPI Revenue (collection targets) | Finance (data) / Team Lead | On request (live); org snapshot daily | `collections:view` | own | proposed default - awaiting owner approval |
| KPI-REV-003 | Team sales achievement (%) | PERCENT | JD KPI Revenue (team sales achievement) | Team Lead | On request | `targets:view` | own | proposed default - awaiting owner approval |
| KPI-REV-004 | Enrolment target achievement (%) | PERCENT | Blueprint s8 (enrolment target) | Team Lead | On request | `targets:view` | own | proposed default - awaiting owner approval |
| KPI-SAL-001 | Lead conversion (%) | PERCENT | JD KPI Sales | Team Lead | On request (cohorts need maturity); org snapshot daily | `leads:view` | own | proposed default - awaiting owner approval |
| KPI-SAL-002 | Webinar-to-sale conversion (%) | PERCENT | JD KPI Sales | Team Lead / Marketing (consumer) | On request; org snapshot daily | `events:view` | own | proposed default - awaiting owner approval |
| KPI-SAL-003 | Demo-to-sale conversion (%) | PERCENT | JD KPI Sales | Team Lead | On request; org snapshot daily | `events:view` | own | proposed default - awaiting owner approval |
| KPI-SAL-004 | Average deal value | CURRENCY | JD KPI Sales | Team Lead | On request | `deals:view` | own | proposed default - awaiting owner approval |
| KPI-SAL-005 | Forecast accuracy | PERCENT | JD KPI Sales; DEC-030 | Team Lead / Founder | After period close | `forecasts:view` | own | proposed default - awaiting owner approval |
| KPI-SAL-006 | Weekly forecast | CURRENCY | Blueprint s8 (weekly forecast) | Team Lead | Per snapshot | `forecasts:view` | own | proposed default - awaiting owner approval |
| KPI-TEA-001 | Sales Manager target achievement (%) | PERCENT | JD KPI Team | Team Lead | On request | `targets:view` | own | proposed default - awaiting owner approval |
| KPI-TEA-002 | Individual target achievement (%) | PERCENT | JD KPI Team | Manager | On request | `targets:view` | own | proposed default - awaiting owner approval |
| KPI-TEA-003 | Team productivity (calls per executive per working day) | RATIO | JD KPI Team | Team Lead | On request | `calls:view` | own | proposed default - awaiting owner approval |
| KPI-TEA-004 | Attrition (%) | PERCENT | JD KPI Team; DEC-037 | HR / Team Lead | Monthly | - | org | proposed default - awaiting owner approval |
| KPI-TEA-005 | Team engagement score | SCORE | JD KPI Team; DEC-024 | HR / Team Lead | Monthly | `engagement:view` | org | proposed default - awaiting owner approval |
| KPI-TEA-006 | Coaching hours conducted | HOURS | JD KPI Team | Team Lead | On request | `coaching:view` | own | proposed default - awaiting owner approval |

38 KPIs: the 33 dictionary KPIs (28 JD + 5 Blueprint exception metrics) plus KPI-REV-004 (enrolment achievement), KPI-SAL-006 (weekly forecast) and KPI-PRD-006/007/008 (call attempts, connected calls, unique clients called) so the Blueprint call metrics are individually addressable.

## Definitions

### Revenue and targets

#### KPI-REV-001 - Monthly revenue achievement (%)

- **Definition:** Booked sales (net of approved adjustments and approved refunds), credited per DEC-005, as a percentage of the revenue target in force on the as-of date.
- **Source:** JD KPI Revenue
- **Numerator:** Sum of booked sale value (net of approved adjustments) with close date in the period, minus approved refunds approved in the period; each sale once at organisation level, credit split at team/individual level
- **Denominator:** Revenue target for the scope and period (as-of-date revision, DEC-002)
- **Time window:** Target period of the `to` date (month by default; quarter / fiscal year selectable); actuals run from period start to min(as-of, period end).
- **Exclusions:** Deals not WON; cancelled sales; refunds in REQUESTED/REVIEWED/REJECTED; non-INR without conversion (excluded and flagged)
- **Source tables:** sales_records, sales_credits, sale_adjustments, refunds, targets, target_revisions
- **Exact implementation:** revenueFacts() loads sales_records (+credits, adjustments) closed in the window and refunds approved in it; revenue/calc revenueActual(); target = sum of scope-top targets (targets.metric=REVENUE) via targetAsOf(); achievementPct()
- **Formula:** actual / target x 100
- **Unit / rounding:** PERCENT; 1 decimal place, shown as %; values above 100 are allowed
- **Zero-denominator behaviour:** No target set -> null (dash) with the note "No target set"; never 0% or infinity
- **Refresh cadence:** On request (live); org snapshot daily
- **Owner:** Founder (owner); Team Lead
- **Access:** needs `kpi:view` and `targets:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-001, DEC-002, DEC-003, DEC-005
- **Approval status:** proposed default - awaiting owner approval

#### KPI-REV-002 - Collection target achievement (%)

- **Definition:** Verified payments (net of processed refunds) credited per DEC-004 as a percentage of the collection target.
- **Source:** JD KPI Revenue (collection targets)
- **Numerator:** Sum of VERIFIED/RECONCILED payments with verified date in the period minus PROCESSED/RECONCILED refunds processed in the period
- **Denominator:** Collection target for the scope and period
- **Time window:** Target period of the `to` date (month by default; quarter / fiscal year selectable); actuals run from period start to min(as-of, period end).
- **Exclusions:** Unverified/pending payments; duplicate external references; failed/rejected/reversed payments
- **Source tables:** sales_records, sales_credits, sale_adjustments, refunds, targets, target_revisions
- **Exact implementation:** collectionFacts(); revenue/calc collectionActual(); targets.metric=COLLECTION via targetAsOf(); achievementPct()
- **Formula:** net collections / collection target x 100
- **Unit / rounding:** PERCENT; 1 decimal place, shown as %; values above 100 are allowed
- **Zero-denominator behaviour:** No target set -> null (dash) with the note "No target set"; never 0% or infinity
- **Refresh cadence:** On request (live); org snapshot daily
- **Owner:** Finance (data) / Team Lead
- **Access:** needs `kpi:view` and `collections:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-003, DEC-004
- **Approval status:** proposed default - awaiting owner approval

#### KPI-REV-003 - Team sales achievement (%)

- **Definition:** Revenue credited to the managers' teams (manager plus everyone reporting to them) as a percentage of the sum of the managers' allocated targets.
- **Source:** JD KPI Revenue (team sales achievement)
- **Numerator:** Net booked revenue credited to the union of the managers' subtrees (each sale once, DEC-005)
- **Denominator:** Sum of MANAGER-level revenue targets in scope
- **Time window:** Target period of the `to` date (month by default; quarter / fiscal year selectable); actuals run from period start to min(as-of, period end).
- **Exclusions:** As KPI-REV-001; managers without a target are listed but excluded from the denominator
- **Source tables:** sales_records, sales_credits, sale_adjustments, refunds, targets, target_revisions
- **Exact implementation:** loadTargets(level=MANAGER); subtrees() recursive CTE on users.manager_id; revenueActual() once over the union of subtree users
- **Formula:** sum credited revenue of team subtrees / sum manager targets x 100
- **Unit / rounding:** PERCENT; 1 decimal place, shown as %; values above 100 are allowed
- **Zero-denominator behaviour:** No target set -> null (dash) with the note "No target set"; never 0% or infinity
- **Refresh cadence:** On request
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `targets:view`; minimum scope `own`; filters honoured: teamId, programId, sourceId
- **Decisions:** DEC-005
- **Approval status:** proposed default - awaiting owner approval

#### KPI-REV-004 - Enrolment target achievement (%)

- **Definition:** Won enrolments credited to the scope as a percentage of the enrolment (count) target.
- **Source:** Blueprint s8 (enrolment target)
- **Numerator:** Sum of sales_records.enrolments closed in the period (credited owners in scope)
- **Denominator:** Enrolment target (count) for the scope and period
- **Time window:** Target period of the `to` date (month by default; quarter / fiscal year selectable); actuals run from period start to min(as-of, period end).
- **Exclusions:** As KPI-REV-001
- **Source tables:** sales_records, sales_credits, sale_adjustments, refunds, targets, target_revisions
- **Exact implementation:** revenueFacts(); revenueActual().enrolments; targets.metric=ENROLMENT
- **Formula:** enrolments / enrolment target x 100
- **Unit / rounding:** PERCENT; 1 decimal place, shown as %; values above 100 are allowed
- **Zero-denominator behaviour:** No target set -> null (dash) with the note "No target set"; never 0% or infinity
- **Refresh cadence:** On request
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `targets:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-001, DEC-005
- **Approval status:** proposed default - awaiting owner approval

#### KPI-TEA-001 - Sales Manager target achievement (%)

- **Definition:** Average of each manager's own team achievement (credited team revenue / the manager's allocated target); every manager counts equally.
- **Source:** JD KPI Team
- **Numerator:** Sum of per-manager achievement percentages
- **Denominator:** Number of managers with a target
- **Time window:** Target period of the `to` date (month by default; quarter / fiscal year selectable); actuals run from period start to min(as-of, period end).
- **Exclusions:** As KPI-REV-001; managers with no allocation are not averaged (listed)
- **Source tables:** sales_records, sales_credits, sale_adjustments, refunds, targets, target_revisions
- **Exact implementation:** managerRows(MANAGER): per-manager revenueActual() over the manager subtree vs targets.level=MANAGER
- **Formula:** mean over managers of (team credited revenue / manager target x 100)
- **Unit / rounding:** PERCENT; 1 decimal place, shown as %; values above 100 are allowed
- **Zero-denominator behaviour:** No target set -> null (dash) with the note "No target set"; never 0% or infinity
- **Refresh cadence:** On request
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `targets:view`; minimum scope `own`; filters honoured: teamId, programId, sourceId
- **Decisions:** DEC-002, DEC-005
- **Approval status:** proposed default - awaiting owner approval

#### KPI-TEA-002 - Individual target achievement (%)

- **Definition:** Average of each executive's credited revenue as a percentage of the executive's allocated revenue target; every executive counts equally. For a single executive this is their own achievement.
- **Source:** JD KPI Team
- **Numerator:** Sum of per-executive achievement percentages
- **Denominator:** Number of executives with a target
- **Time window:** Target period of the `to` date (month by default; quarter / fiscal year selectable); actuals run from period start to min(as-of, period end).
- **Exclusions:** As KPI-REV-001; executives without a target are listed but not averaged
- **Source tables:** sales_records, sales_credits, sale_adjustments, refunds, targets, target_revisions
- **Exact implementation:** managerRows(EXECUTIVE): revenueActual() for the single executive vs targets.level=EXECUTIVE
- **Formula:** mean over executives of (credited revenue / own target x 100)
- **Unit / rounding:** PERCENT; 1 decimal place, shown as %; values above 100 are allowed
- **Zero-denominator behaviour:** No target set -> null (dash) with the note "No target set"; never 0% or infinity
- **Refresh cadence:** On request
- **Owner:** Manager
- **Access:** needs `kpi:view` and `targets:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-002, DEC-005
- **Approval status:** proposed default - awaiting owner approval

### Sales and conversion

#### KPI-SAL-001 - Lead conversion (%)

- **Definition:** Of the eligible leads created in the date range (cohort), the share that reached WON within the conversion window (default 60 days from creation, DEC-009).
- **Source:** JD KPI Sales
- **Numerator:** Distinct leads in the cohort with stage WON and won_at <= created_at + conversion window
- **Denominator:** Eligible leads created in the date range
- **Time window:** Lead-created cohort; a separate "won in range" count is shown, labelled, as a secondary view
- **Exclusions:** Leads merged away; lost reasons DUPLICATE_OR_INVALID / NOT_ELIGIBLE; [DEMO] leads when excluded by configuration
- **Source tables:** leads
- **Exact implementation:** SQL on leads: count(*) FILTER (stage_category='WON' AND won_at <= created_at + window) / count(*) with created_at in range, merged_into_id IS NULL, lost_reason NOT IN (...); lead scope = scopedWhere(leads)
- **Formula:** distinct won within window / eligible x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** Empty cohort -> null (dash)
- **Refresh cadence:** On request (cohorts need maturity); org snapshot daily
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `leads:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-009, DEC-006
- **Approval status:** proposed default - awaiting owner approval

#### KPI-SAL-002 - Webinar-to-sale conversion (%)

- **Definition:** Distinct webinar attendees who bought within the attribution window (DEC-010: 30 days after the most recent attended webinar) as a share of distinct attendees of webinars held in the range.
- **Source:** JD KPI Sales
- **Numerator:** Distinct attended leads with a sales_record closed within the attribution window after their most recent attended webinar
- **Denominator:** Distinct leads who attended webinars starting in the range
- **Time window:** Webinars starting in the date range
- **Exclusions:** No-shows (reported separately as registration-to-attendance); cancelled webinars; sales not linked to an attendance; merged duplicates
- **Source tables:** events, event_attendance, sales_records, leads
- **Exact implementation:** SQL: CTE att (event_attendance JOIN events type=WEBINAR, status IN ATTENDED/FOLLOWED_UP/CONVERTED/NOT_CONVERTED, anchor=max(coalesce(joined_at, starts_at))) + EXISTS(sales_records.closed_at in [anchor, anchor+window))
- **Formula:** attributed sales / attendees x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** No attendees -> null (dash)
- **Refresh cadence:** On request; org snapshot daily
- **Owner:** Team Lead / Marketing (consumer)
- **Access:** needs `kpi:view` and `events:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-010
- **Approval status:** proposed default - awaiting owner approval

#### KPI-SAL-003 - Demo-to-sale conversion (%)

- **Definition:** Distinct demo attendees who bought within the attribution window (DEC-010) as a share of distinct leads who attended a demo held in the range.
- **Source:** JD KPI Sales
- **Numerator:** Distinct demo attendees with a sales_record closed within the attribution window after their most recent attended demo
- **Denominator:** Distinct leads who attended demos starting in the range
- **Time window:** Demos starting in the date range
- **Exclusions:** No-shows, rescheduled-not-held, cancelled demos, merged duplicates
- **Source tables:** events, event_attendance, sales_records, leads
- **Exact implementation:** As KPI-SAL-002 with events.type=DEMO
- **Formula:** attributed sales / demo attendees x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** No demos held -> null (dash)
- **Refresh cadence:** On request; org snapshot daily
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `events:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-010
- **Approval status:** proposed default - awaiting owner approval

#### KPI-SAL-004 - Average deal value

- **Definition:** Net booked sale value of the won deals in the period divided by their number.
- **Source:** JD KPI Sales
- **Numerator:** Sum of net booked sale value (net of approved adjustments) of won deals closed in the window
- **Denominator:** Count of won deals in the window
- **Time window:** Date range (default: current month)
- **Exclusions:** Zero-value (complimentary) deals; cancelled sales; non-INR; refunds are not netted (see KPI-REV-001)
- **Source tables:** sales_records, sales_credits, sale_adjustments
- **Exact implementation:** revenueFacts(); zero-value sales dropped; revenueActual().booked / wonCount via calc averageDealValue()
- **Formula:** sum / count
- **Unit / rounding:** CURRENCY; whole rupees, INR
- **Zero-denominator behaviour:** No won deals -> null (dash)
- **Refresh cadence:** On request
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `deals:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-005
- **Approval status:** proposed default - awaiting owner approval

#### KPI-SAL-005 - Forecast accuracy

- **Definition:** Accuracy = max(0, 1 - |F - A| / A) x 100 of the period-start forecast snapshot (F) against the actual net revenue of the period (A); WAPE over the trailing six closed periods and bias are reported alongside.
- **Source:** JD KPI Sales; DEC-030
- **Numerator:** Absolute forecast error |F - A| of the latest closed period
- **Denominator:** Actual net revenue A of that period
- **Time window:** Latest CLOSED week or month (the open period is shown as forecast vs actual-so-far, without an accuracy figure)
- **Exclusions:** Periods without a stored snapshot; A <= 0 (never reported as 100%)
- **Source tables:** forecasts, forecast_snapshots, sales_records, refunds
- **Exact implementation:** prisma.forecast + forecast_snapshots (PERIOD_START snapshot, else earliest); actual via revenueActual().net; calc forecastAccuracy()/forecastBias()/wape()
- **Formula:** max(0, 1 - |F - A| / A) x 100; WAPE = sum|F_i - A_i| / sum A_i x 100; bias = (F - A) / A x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** A = 0 -> accuracy null (dash); WAPE null when the sum of actuals is 0
- **Refresh cadence:** After period close
- **Owner:** Team Lead / Founder
- **Access:** needs `kpi:view` and `forecasts:view`; minimum scope `own`; filters honoured: ownerId, teamId
- **Estimate:** yes. Shown with an "Estimate" label; never presented as a fact.
- **Decisions:** DEC-030
- **Approval status:** proposed default - awaiting owner approval

#### KPI-SAL-006 - Weekly forecast

- **Definition:** Latest stored forecast (an ESTIMATE, never a fact) for the current week: booked-to-date plus stage-weighted open pipeline.
- **Source:** Blueprint s8 (weekly forecast)
- **Numerator:** Total of the most recent forecast snapshot of the current week (booked to date + weighted pipeline)
- **Denominator:** n/a
- **Time window:** Current week (Monday to Sunday, IST)
- **Exclusions:** Weeks with no snapshot
- **Source tables:** forecasts, forecast_snapshots
- **Exact implementation:** prisma.forecast(periodType=WEEK) + latest forecast_snapshots row
- **Formula:** forecast_snapshots.total
- **Unit / rounding:** CURRENCY; 2 decimals, INR
- **Zero-denominator behaviour:** No snapshot -> null (dash)
- **Refresh cadence:** Per snapshot
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `forecasts:view`; minimum scope `own`; filters honoured: ownerId, teamId
- **Estimate:** yes. Shown with an "Estimate" label; never presented as a fact.
- **Decisions:** DEC-030
- **Approval status:** proposed default - awaiting owner approval

### Productivity

#### KPI-PRD-001 - Calls completed

- **Definition:** Call records by the owner in the range whose outcome is not FAILED. Call attempts, connected calls and unique clients called are reported separately and never merged. Data source (MANUAL / PROVIDER / DEVICE) is shown.
- **Source:** JD KPI Productivity
- **Numerator:** Count of call_logs with outcome <> FAILED in the range
- **Denominator:** n/a (count); per-day target comes from KRA assignments
- **Time window:** Date range in IST (default: current month); call time = call_logs.started_at
- **Exclusions:** FAILED outcomes are attempts but not completed calls
- **Source tables:** call_logs, leads
- **Exact implementation:** SQL on call_logs: count(*) FILTER (outcome <> FAILED); attempts = count(*); connected = outcome IN (CONNECTED, WON, LOST, CALLBACK); unique clients = count(DISTINCT lead_id)
- **Formula:** count
- **Unit / rounding:** COUNT; integer
- **Zero-denominator behaviour:** n/a (count): zero calls shows 0
- **Refresh cadence:** Near real time (computed on request)
- **Owner:** Team Lead / Manager
- **Access:** needs `kpi:view` and `calls:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-036
- **Approval status:** proposed default - awaiting owner approval

#### KPI-PRD-002 - Follow-ups completed

- **Definition:** Follow-up, callback, demo and email tasks completed in the range; the on-time share (completed on or before due / tasks due and judgeable) is reported with it.
- **Source:** JD KPI Productivity
- **Numerator:** Count of tasks (types FOLLOW_UP, CALLBACK, DEMO, EMAIL) with status DONE and completed_at in the range
- **Denominator:** Tasks due in the range (excluding cancelled and not-yet-due open tasks) for the on-time share
- **Time window:** Date range in IST (default: current month)
- **Exclusions:** Cancelled tasks; CALL-type retry tasks and other task types
- **Source tables:** tasks, leads
- **Exact implementation:** SQL on tasks: FILTER(status='DONE' AND completed_at in range); due cohort = due_at in range AND status<>'CANCELLED' AND (DONE OR due_at < now)
- **Formula:** count; on time / (completed + overdue due in range)
- **Unit / rounding:** COUNT; integer; on-time share 1 decimal
- **Zero-denominator behaviour:** On-time share is null (dash) when no task was due
- **Refresh cadence:** Near real time
- **Owner:** Manager
- **Access:** needs `kpi:view` and `tasks:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-026
- **Approval status:** proposed default - awaiting owner approval

#### KPI-PRD-003 - CRM compliance (%)

- **Definition:** Share of active leads that have an owner, a scheduled next action (next_action_at or an open task), required fields (name plus a valid phone or e-mail) and activity within the threshold (default 7 days).
- **Source:** JD KPI Productivity; DEC-038
- **Numerator:** Eligible leads meeting all four conditions
- **Denominator:** Active (stage OPEN) leads in scope, created more than 60 minutes ago
- **Time window:** Point in time (now)
- **Exclusions:** WON, LOST and NURTURE leads; leads created under an hour ago; merged duplicates
- **Source tables:** leads, tasks
- **Exact implementation:** SQL on leads: stage_category='OPEN', created_at < now-60m, owner NOT NULL, (next_action_at NOT NULL OR EXISTS open task), name & (phone_valid E.164 or email), coalesce(last_activity_at, created_at) >= now-7d
- **Formula:** compliant / eligible x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** No eligible lead -> null (dash)
- **Refresh cadence:** On request; org snapshot daily
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `leads:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-038
- **Approval status:** proposed default - awaiting owner approval

#### KPI-PRD-004 - Response time (working minutes)

- **Definition:** Median (P90 alongside) working-hours minutes from lead creation or assignment, whichever is later, to the first call attempt.
- **Source:** JD KPI Productivity; DEC-039
- **Numerator:** Median of working minutes to first attempt over leads that have been attempted
- **Denominator:** Leads created in the range that have at least one attempt (not-yet-responded count is shown)
- **Time window:** Leads created in the date range
- **Exclusions:** Imported leads, reactivated leads, time outside working hours (Mon-Sat 09:00-19:00 IST by default)
- **Source tables:** leads, call_logs
- **Exact implementation:** SQL selects leads (created/assigned/first_contact_at); crm-core workingMinutesBetween() with the org WORKING_HOURS rule; percentile in code
- **Formula:** median(workingMinutesBetween(max(created, assigned), first_contact_at))
- **Unit / rounding:** MINUTES; whole minutes
- **Zero-denominator behaviour:** No attempted lead -> null (dash)
- **Refresh cadence:** On request
- **Owner:** Manager
- **Access:** needs `kpi:view` and `leads:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-039, DEC-020
- **Approval status:** proposed default - awaiting owner approval

#### KPI-PRD-005 - Lead ageing (stale leads)

- **Definition:** Active leads with no meaningful activity for more than the threshold (default 7 days). Age since creation and days since last activity are both reported, in buckets 0-1, 2-3, 4-7, 8-14 and 15+ days.
- **Source:** JD KPI Productivity
- **Numerator:** Active leads whose days since last activity (or creation if none) exceed the threshold
- **Denominator:** Active (stage OPEN) leads in scope
- **Time window:** Point in time (now)
- **Exclusions:** WON, LOST, NURTURE leads; merged duplicates
- **Source tables:** leads
- **Exact implementation:** SQL on leads with floor(epoch/86400) buckets and percentile_cont
- **Formula:** now - created_at; now - coalesce(last_activity_at, created_at)
- **Unit / rounding:** COUNT; whole days
- **Zero-denominator behaviour:** n/a: empty buckets show 0
- **Refresh cadence:** Near real time
- **Owner:** Manager
- **Access:** needs `kpi:view` and `leads:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

#### KPI-PRD-006 - Call attempts

- **Definition:** Every call record in the range, whatever the outcome (including no answer and failed). Not the same as unique clients.
- **Source:** Blueprint s8 (call attempts)
- **Numerator:** Count of call_logs in the range
- **Denominator:** n/a (count)
- **Time window:** Date range in IST (default: current month); call time = call_logs.started_at
- **Exclusions:** None (attempts include FAILED)
- **Source tables:** call_logs, leads
- **Exact implementation:** SQL on call_logs: count(*)
- **Formula:** count
- **Unit / rounding:** COUNT; integer
- **Zero-denominator behaviour:** n/a (count): zero calls shows 0
- **Refresh cadence:** Near real time (computed on request)
- **Owner:** Team Lead / Manager
- **Access:** needs `kpi:view` and `calls:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-036
- **Approval status:** proposed default - awaiting owner approval

#### KPI-PRD-007 - Connected calls

- **Definition:** Calls in the range where the client was reached: outcome CONNECTED, WON, LOST or CALLBACK.
- **Source:** Blueprint s8 (connected calls)
- **Numerator:** Count of call_logs with outcome IN (CONNECTED, WON, LOST, CALLBACK)
- **Denominator:** Call attempts in the range (connect rate shown in the breakdown)
- **Time window:** Date range in IST (default: current month); call time = call_logs.started_at
- **Exclusions:** NO_ANSWER, BUSY, SWITCHED_OFF and FAILED outcomes
- **Source tables:** call_logs, leads
- **Exact implementation:** SQL on call_logs with outcome filter
- **Formula:** count
- **Unit / rounding:** COUNT; integer
- **Zero-denominator behaviour:** n/a (count): zero calls shows 0
- **Refresh cadence:** Near real time (computed on request)
- **Owner:** Team Lead / Manager
- **Access:** needs `kpi:view` and `calls:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-036
- **Approval status:** proposed default - awaiting owner approval

#### KPI-PRD-008 - Unique clients called

- **Definition:** Distinct leads called at least once in the range; separate from the number of attempts.
- **Source:** JD KPI Productivity (unique clients vs attempts)
- **Numerator:** Count of distinct lead_id in call_logs in the range
- **Denominator:** Call attempts in the range (attempts per client shown in the breakdown)
- **Time window:** Date range in IST (default: current month); call time = call_logs.started_at
- **Exclusions:** None
- **Source tables:** call_logs, leads
- **Exact implementation:** SQL on call_logs: count(DISTINCT lead_id)
- **Formula:** count distinct
- **Unit / rounding:** COUNT; integer
- **Zero-denominator behaviour:** n/a (count): zero calls shows 0
- **Refresh cadence:** Near real time (computed on request)
- **Owner:** Team Lead / Manager
- **Access:** needs `kpi:view` and `calls:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-036
- **Approval status:** proposed default - awaiting owner approval

### Team

#### KPI-TEA-003 - Team productivity (calls per executive per working day)

- **Definition:** Shown as its components, never one hidden number: calls, follow-ups, conversions and revenue per executive (and calls per executive per working day as the headline).
- **Source:** JD KPI Team
- **Numerator:** Calls completed by the executives in scope in the range
- **Denominator:** Active executives (joined at least 7 days before the range ended) x working days (Mon-Sat) elapsed in the range
- **Time window:** Date range in IST (default: current month, working days up to today)
- **Exclusions:** New joiners under 7 days; leave days are not tracked (HRMS out of scope, DEC-023); FAILED calls
- **Source tables:** call_logs, tasks, leads, sales_records, sales_credits, users, user_role_assignments
- **Exact implementation:** users JOIN user_role_assignments (SALES_EXECUTIVE, active); callStats() and followUpStats() restricted to those users; revenueActual() over them; workingDays()
- **Formula:** calls / (executives x working days); components: follow-ups / executive, won leads / executive, revenue / executive
- **Unit / rounding:** RATIO; 1 decimal place
- **Zero-denominator behaviour:** No active executive or no working day -> null (dash)
- **Refresh cadence:** On request
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `calls:view`; minimum scope `own`; filters honoured: teamId, ownerId
- **Decisions:** DEC-023
- **Approval status:** proposed default - awaiting owner approval

#### KPI-TEA-004 - Attrition (%)

- **Definition:** Sales-team exits in the range (voluntary and involuntary shown separately) as a percentage of average headcount ((start + end) / 2). Aggregate only; individual HR records are never exposed.
- **Source:** JD KPI Team; DEC-037
- **Numerator:** Sales-team members (Team Lead, Managers, Executives) whose exit date falls in the range, excluding internal transfers
- **Denominator:** Average headcount = (headcount at range start + at range end) / 2
- **Time window:** Date range (month or rolling 12 months)
- **Exclusions:** Internal transfers (exit type TRANSFER); contractors; viewers below organisation scope cannot see it
- **Source tables:** employee_profiles, users, user_role_assignments, roles
- **Exact implementation:** SQL on users LEFT JOIN employee_profiles (join = coalesce(join_date, created_at), exit = coalesce(exit_date, deactivated_at)); headcount at date d = join <= d AND (exit IS NULL OR exit > d)
- **Formula:** exits / average headcount x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** Average headcount 0 -> null (dash)
- **Refresh cadence:** Monthly
- **Owner:** HR / Team Lead
- **Access:** needs `kpi:view`; minimum scope `org`; filters honoured: teamId
- **Decisions:** DEC-037
- **Approval status:** proposed default - awaiting owner approval

#### KPI-TEA-005 - Team engagement score

- **Definition:** Mean of pulse-survey scale answers (1-5) scaled to 100. Responses are anonymous (no user reference is stored), so the score is organisation-wide and is suppressed below the anonymity floor (5 responses per survey).
- **Source:** JD KPI Team; DEC-024
- **Numerator:** Sum of all SCALE_5 answers of surveys that meet the floor, responded in the range
- **Denominator:** Number of those answers
- **Time window:** Responses given in the date range (monthly by default)
- **Exclusions:** Surveys with fewer responses than the floor; text answers; viewers below organisation scope
- **Source tables:** engagement_surveys, engagement_responses
- **Exact implementation:** engagement_responses in the range grouped by survey; people aggregateResponses() enforces the anonymity floor; pooled mean
- **Formula:** mean(answers) / 5 x 100
- **Unit / rounding:** SCORE; integer (0-100)
- **Zero-denominator behaviour:** Below the floor -> null (dash) with "insufficient responses"
- **Refresh cadence:** Monthly
- **Owner:** HR / Team Lead
- **Access:** needs `kpi:view` and `engagement:view`; minimum scope `org`; filters honoured: none (organisation-wide by design)
- **Decisions:** DEC-024
- **Approval status:** proposed default - awaiting owner approval

#### KPI-TEA-006 - Coaching hours conducted

- **Definition:** Hours of recorded coaching sessions and held 1:1s in the range (date, coach and duration recorded).
- **Source:** JD KPI Team
- **Numerator:** Sum of coaching_sessions.duration_min plus one_on_ones.duration_min (HELD) in the range, divided by 60
- **Denominator:** n/a
- **Time window:** Date range in IST (default: current month)
- **Exclusions:** Sessions without duration; cancelled and scheduled-but-not-held 1:1s; future-dated sessions
- **Source tables:** coaching_sessions, one_on_ones
- **Exact implementation:** SQL: coaching_sessions (coach_id in scope) + one_on_ones HELD (manager_id in scope)
- **Formula:** sum(minutes) / 60
- **Unit / rounding:** HOURS; 1 decimal place (hours)
- **Zero-denominator behaviour:** n/a: zero shows 0.0
- **Refresh cadence:** On request
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `coaching:view`; minimum scope `own`; filters honoured: teamId, ownerId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

### Process

#### KPI-PRO-001 - SOP adoption rate (%)

- **Definition:** Of the (user, mandatory SOP) pairs that are required today, the share where the user has acknowledged the CURRENT effective version. Acknowledgements of older versions never count.
- **Source:** JD KPI Process
- **Numerator:** Required pairs with an acknowledgement of the effective version
- **Denominator:** Active in-audience users x mandatory ACTIVE SOPs with an effective approved version
- **Time window:** As at today (effective version = highest APPROVED with effective_date <= today)
- **Exclusions:** Optional SOPs; users added in the last 7 days who have not yet acknowledged (grace); inactive users
- **Source tables:** sop_documents, sop_versions, sop_acknowledgements, users, user_role_assignments
- **Exact implementation:** SQL CTE eff (DISTINCT ON document, highest approved effective version) x in-audience active users LEFT JOIN sop_acknowledgements (same maths as GET /sop/adoption, plus the new-joiner grace)
- **Formula:** acknowledged / required x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** No mandatory SOP or no required user -> null (dash)
- **Refresh cadence:** On request; org snapshot daily
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `sop:adoption:view`; minimum scope `own`; filters honoured: teamId, ownerId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

#### KPI-PRO-002 - Dashboard accuracy and timeliness

- **Definition:** Accuracy: share of reconciliation checks (dashboard KPI vs an independent SQL recompute from the base tables) that matched within tolerance (0 for counts, 0.01 for money). Timeliness: minutes since the last completed run and whether it is within the 26 hour SLA.
- **Source:** JD KPI Process
- **Numerator:** Checks that passed in the runs of the range
- **Denominator:** Checks executed in the runs of the range (skipped checks are listed, not counted)
- **Time window:** Reconciliation runs completed in the date range
- **Exclusions:** Skipped checks
- **Source tables:** kpi_reconciliation_runs
- **Exact implementation:** ReconciliationService.run() persists kpi_reconciliation_runs; this KPI aggregates passed/total over runs in the range
- **Formula:** passed / executed x 100
- **Unit / rounding:** PERCENT; 1 decimal place; minutes
- **Zero-denominator behaviour:** No run in the range -> null (dash) with "no reconciliation run yet"
- **Refresh cadence:** Daily 03:00 IST (scheduler) and on demand via POST /reports/reconciliation/run
- **Owner:** Founder / Tech
- **Access:** needs `kpi:view`; minimum scope `org`; filters honoured: none (organisation-wide by design)
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

### Customer experience

#### KPI-CX-001 - Learner satisfaction (CSAT)

- **Definition:** Mean CSAT (1-5) of learner responses in the range; the share satisfied (4-5) and NPS are reported alongside. Fewer than 5 responses are flagged with a caution.
- **Source:** JD KPI Customer Experience
- **Numerator:** Sum of CSAT scores in the range
- **Denominator:** Number of CSAT responses
- **Time window:** Responses given in the date range
- **Exclusions:** Enrolment-experience and NPS responses (reported separately)
- **Source tables:** satisfaction_responses
- **Exact implementation:** SQL on satisfaction_responses WHERE kind='CSAT'; NPS = %9-10 minus %0-6 over kind='NPS'
- **Formula:** mean(score)
- **Unit / rounding:** SCORE; 1 decimal place
- **Zero-denominator behaviour:** No responses -> null (dash)
- **Refresh cadence:** On request
- **Owner:** Student Success / Team Lead
- **Access:** needs `kpi:view` and `satisfaction:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

#### KPI-CX-002 - Refund reduction (like-for-like, %)

- **Definition:** Relative fall in the refund rate (approved refunds requested in the period / won enrolments in the same period) against the immediately preceding period of the same length, counting only programs that sold in both periods. Raw counts are secondary.
- **Source:** JD KPI Customer Experience
- **Numerator:** Previous like-for-like refund rate minus current rate (percentage points)
- **Denominator:** Previous like-for-like refund rate
- **Time window:** The date range vs the preceding range of equal length
- **Exclusions:** REQUESTED/REVIEWED/REJECTED/WITHDRAWN refunds; programs with no enrolments in either period; chargebacks (not modelled)
- **Source tables:** refunds, deals, sales_records, sales_credits
- **Exact implementation:** SQL: refunds JOIN deals (status APPROVED/PROCESSED/RECONCILED, by requested_at) and sales_records.enrolments per program for both windows; Σ over programs present in both
- **Formula:** (previous rate - current rate) / previous rate x 100, rate = approved refunds / won enrolments
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** Previous rate 0 or no enrolments -> null (dash)
- **Refresh cadence:** On request
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `refunds:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

#### KPI-CX-003 - Complaint resolution (%)

- **Definition:** Of the complaints opened in the range, the share resolved or closed by the end of the range; SLA adherence (resolved within SLA, DEC-017) and time to resolve are reported with it.
- **Source:** JD KPI Customer Experience
- **Numerator:** Complaints opened in the range that are RESOLVED or CLOSED with a resolution date before the range end
- **Denominator:** Complaints opened in the range
- **Time window:** Complaints created in the date range
- **Exclusions:** Complaints closed as invalid/duplicate/spam
- **Source tables:** complaints
- **Exact implementation:** SQL on complaints: created_at in range AND NOT closed_as_invalid; resolved = status IN ('RESOLVED','CLOSED') AND coalesce(resolved_at, closed_at) < range end; SLA = resolved_within_sla
- **Formula:** resolved / opened x 100
- **Unit / rounding:** PERCENT; 1 decimal place; hours
- **Zero-denominator behaviour:** No complaint opened -> null (dash)
- **Refresh cadence:** On request
- **Owner:** Student Success / Team Lead
- **Access:** needs `kpi:view` and `complaints:view`; minimum scope `own`; filters honoured: teamId, ownerId
- **Decisions:** DEC-017
- **Approval status:** proposed default - awaiting owner approval

#### KPI-CX-004 - Enrolment experience score

- **Definition:** Mean enrolment-experience rating (1-5) collected within 7 days of enrolment; late responses are excluded and counted.
- **Source:** JD KPI Customer Experience
- **Numerator:** Sum of in-window ENROLMENT_EXPERIENCE scores in the range
- **Denominator:** Number of in-window responses
- **Time window:** Responses given in the date range
- **Exclusions:** Responses later than 7 days after enrolment (outside_window, counted separately)
- **Source tables:** satisfaction_responses
- **Exact implementation:** SQL on satisfaction_responses WHERE kind='ENROLMENT_EXPERIENCE' AND NOT outside_window
- **Formula:** mean(score)
- **Unit / rounding:** SCORE; 1 decimal place
- **Zero-denominator behaviour:** No in-window response -> null (dash)
- **Refresh cadence:** On request
- **Owner:** Student Success
- **Access:** needs `kpi:view` and `satisfaction:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

### Founder support

#### KPI-FND-001 - Completion of action items (%)

- **Definition:** Founder action items completed on or before their due date, as a share of the items due in the range (cancelled items excluded).
- **Source:** JD KPI Founder Support
- **Numerator:** Action items with status COMPLETED and completed_at <= due_at among those due in the range
- **Denominator:** Action items with due_at in the range, excluding CANCELLED
- **Time window:** Items due in the date range
- **Exclusions:** Cancelled items
- **Source tables:** action_items
- **Exact implementation:** SQL on action_items: due_at in range AND status <> 'CANCELLED'; numerator status='COMPLETED' AND completed_at <= due_at
- **Formula:** on-time completed / due x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** No item due -> null (dash)
- **Refresh cadence:** Near real time
- **Owner:** Team Lead
- **Access:** needs `kpi:view` and `action-items:view`; minimum scope `own`; filters honoured: teamId, ownerId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

#### KPI-FND-002 - Quality of reporting (completeness %)

- **Definition:** Mean completeness of the required sections (performance narrative, risks with solutions, opportunities, action-item review) of published Founder reports, with the Founder's own 1-5 rating shown alongside. Completeness is a proxy; the rating is the judgement.
- **Source:** JD KPI Founder Support; DEC-028
- **Numerator:** Sum of completeness_pct of published first-version reports with a period in the range
- **Denominator:** Number of those reports
- **Time window:** Reports whose period starts in the date range (trailing 3 months suggested)
- **Exclusions:** Drafts; correction versions (version > 1)
- **Source tables:** founder_reports
- **Exact implementation:** SQL on founder_reports WHERE version_number=1 AND status='PUBLISHED'
- **Formula:** mean(completeness_pct)
- **Unit / rounding:** PERCENT; integer %
- **Zero-denominator behaviour:** No published report -> null (dash)
- **Refresh cadence:** On submit
- **Owner:** Founder
- **Access:** needs `kpi:view` and `founder-reports:view`; minimum scope `org`; filters honoured: none (organisation-wide by design)
- **Decisions:** DEC-028
- **Approval status:** proposed default - awaiting owner approval

#### KPI-FND-003 - Timeliness of reporting (%)

- **Definition:** Founder reports published on or before their due time (weekly: Monday 10:00 after the week; monthly: 3rd working day 10:00, DEC-028) as a share of the reports due in the range.
- **Source:** JD KPI Founder Support
- **Numerator:** First-version reports with due_at in the range, already due, published on or before due_at
- **Denominator:** First-version reports with due_at in the range and due_at <= now
- **Time window:** Reports due in the date range
- **Exclusions:** Correction versions; reports with approved deferral (not modelled)
- **Source tables:** founder_reports
- **Exact implementation:** SQL on founder_reports WHERE version_number=1 AND due_at in range AND due_at <= now; on time = status='PUBLISHED' AND published_at <= due_at
- **Formula:** on-time / due x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** No report due -> null (dash)
- **Refresh cadence:** On submit
- **Owner:** Founder
- **Access:** needs `kpi:view` and `founder-reports:view`; minimum scope `org`; filters honoured: none (organisation-wide by design)
- **Decisions:** DEC-028
- **Approval status:** proposed default - awaiting owner approval

### Blueprint exception metrics

#### KPI-EXC-001 - Unassigned leads

- **Definition:** Active leads that have no current owner (an exception that must be visible).
- **Source:** Blueprint s8
- **Numerator:** Active (stage OPEN) leads with assigned_to_id IS NULL
- **Denominator:** n/a
- **Time window:** Point in time (now)
- **Exclusions:** Terminal and nurture leads; merged duplicates
- **Source tables:** leads
- **Exact implementation:** SQL on leads: stage_category='OPEN' AND assigned_to_id IS NULL
- **Formula:** count
- **Unit / rounding:** COUNT; integer
- **Zero-denominator behaviour:** n/a: zero shows 0
- **Refresh cadence:** Near real time
- **Owner:** Manager
- **Access:** needs `kpi:view` and `leads:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

#### KPI-EXC-002 - No-next-action leads

- **Definition:** Active leads without a scheduled next action (neither next_action_at nor an open task).
- **Source:** Blueprint s8
- **Numerator:** Active leads with next_action_at IS NULL and no OPEN task
- **Denominator:** n/a
- **Time window:** Point in time (now)
- **Exclusions:** Terminal and nurture leads; merged duplicates
- **Source tables:** leads, tasks
- **Exact implementation:** SQL on leads with NOT EXISTS (tasks.status='OPEN')
- **Formula:** count
- **Unit / rounding:** COUNT; integer
- **Zero-denominator behaviour:** n/a: zero shows 0
- **Refresh cadence:** Near real time
- **Owner:** Manager
- **Access:** needs `kpi:view` and `leads:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

#### KPI-EXC-003 - Overdue tasks

- **Definition:** Open tasks whose due time has passed.
- **Source:** Blueprint s8
- **Numerator:** Tasks with status OPEN and due_at < now
- **Denominator:** n/a
- **Time window:** Point in time (now)
- **Exclusions:** Completed and cancelled tasks
- **Source tables:** tasks, leads
- **Exact implementation:** SQL on tasks: status='OPEN' AND due_at < now; owner scope on assigned_to_id
- **Formula:** count
- **Unit / rounding:** COUNT; integer
- **Zero-denominator behaviour:** n/a: zero shows 0
- **Refresh cadence:** Near real time
- **Owner:** Manager
- **Access:** needs `kpi:view` and `tasks:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

#### KPI-EXC-004 - New leads

- **Definition:** Leads created in the date range.
- **Source:** Blueprint s8
- **Numerator:** Count of leads with created_at in the range
- **Denominator:** n/a
- **Time window:** Date range in IST
- **Exclusions:** Merged duplicates; [DEMO] leads when excluded by configuration
- **Source tables:** leads
- **Exact implementation:** SQL on leads: created_at in range
- **Formula:** count
- **Unit / rounding:** COUNT; integer
- **Zero-denominator behaviour:** n/a: zero shows 0
- **Refresh cadence:** Near real time
- **Owner:** Manager
- **Access:** needs `kpi:view` and `leads:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** none beyond the defaults above
- **Approval status:** proposed default - awaiting owner approval

#### KPI-EXC-005 - Follow-up compliance

- **Definition:** Share of follow-up tasks due in the range that were completed on or before their due time.
- **Source:** Blueprint s8
- **Numerator:** Tasks completed on or before due among those due in the range
- **Denominator:** Eligible tasks due in the range (not cancelled; open tasks count once their due time has passed)
- **Time window:** Date range in IST
- **Exclusions:** Cancelled tasks; open tasks not yet due
- **Source tables:** tasks
- **Exact implementation:** followUpStats()
- **Formula:** on-time completed / eligible due x 100
- **Unit / rounding:** PERCENT; 1 decimal place
- **Zero-denominator behaviour:** No task due -> null (dash)
- **Refresh cadence:** Near real time
- **Owner:** Manager
- **Access:** needs `kpi:view` and `tasks:view`; minimum scope `own`; filters honoured: teamId, ownerId, programId, sourceId
- **Decisions:** DEC-026
- **Approval status:** proposed default - awaiting owner approval
