# Decision Log

Date of all entries: 2026-10-14. Status for every entry: **default - awaiting owner approval** (owner may override; build agents must use the default, make it configurable, and not silently invent other values). Referenced from docs/requirements-traceability.md as DEC-nnn.

Rule: if an affected requirement needs a value not in this log, mark it NEEDS_DECISION and add an entry here.

## Index

| ID | Decision | Owner | Status |
|---|---|---|---|
| DEC-001 | Target periods and proration | Founder | default - awaiting owner approval |
| DEC-002 | Target revision policy | Founder | default - awaiting owner approval |
| DEC-003 | Revenue recognition | Founder + Finance | default - awaiting owner approval |
| DEC-004 | Collection attribution | Founder + Finance | default - awaiting owner approval |
| DEC-005 | Sales ownership and credit sharing | Founder | default - awaiting owner approval |
| DEC-006 | Lead stages and lost reasons | Team Lead | default - awaiting owner approval |
| DEC-007 | Sales Manager team size limit | Founder | default - awaiting owner approval |
| DEC-008 | Lead assignment and round-robin rules | Team Lead | default - awaiting owner approval |
| DEC-009 | Conversion cohort and attribution windows | Founder + Team Lead | default - awaiting owner approval |
| DEC-010 | Webinar/demo attribution rule | Founder | default - awaiting owner approval |
| DEC-011 | Duplicate detection and merge policy | Team Lead | default - awaiting owner approval |
| DEC-012 | Existing CRM source and migration | Founder | default - awaiting owner approval |
| DEC-013 | Telephony, WhatsApp, SMS, email providers | Founder + Operations | default - awaiting owner approval |
| DEC-014 | Call recording and transcription | Founder + Legal | default - awaiting owner approval |
| DEC-015 | Incentive formula, approval, clawback | Founder | default - awaiting owner approval |
| DEC-016 | Program pricing and product-specific funnels | Founder | default - awaiting owner approval |
| DEC-017 | Complaint priority and SLA | Founder + Student Success | default - awaiting owner approval |
| DEC-018 | Data retention, deletion, DPDP privacy | Founder + Legal | default - awaiting owner approval |
| DEC-019 | Refund approval authority and payment provider | Founder + Finance | default - awaiting owner approval |
| DEC-020 | Business timezone and working days | Founder | default - awaiting owner approval |
| DEC-021 | UI languages | Founder | default - awaiting owner approval |
| DEC-022 | AI features in v1 or later | Founder | default - awaiting owner approval |
| DEC-023 | HRMS scope (payroll, leave, attendance) | Founder + HR | default - awaiting owner approval |
| DEC-024 | Team engagement measurement | Team Lead + HR | default - awaiting owner approval |
| DEC-025 | Learner ranks terminology (Warrior..Chhatrapati) | Founder | default - awaiting owner approval |
| DEC-026 | Reminder, retry and escalation thresholds | Team Lead | default - awaiting owner approval |
| DEC-027 | High-value deal threshold | Founder | default - awaiting owner approval |
| DEC-028 | Founder report quality metric | Founder | default - awaiting owner approval |
| DEC-029 | RPO/RTO and backup policy | Founder + Ops | default - awaiting owner approval |
| DEC-030 | Forecast method and accuracy metric | Team Lead + Founder | default - awaiting owner approval |
| DEC-031 | Lost-lead reactivation rules | Team Lead | default - awaiting owner approval |
| DEC-032 | Admin and secondary-permission access | Founder | default - awaiting owner approval |
| DEC-033 | Currency | Founder | default - awaiting owner approval |
| DEC-034 | Incentive payout handling | Founder + Finance | default - awaiting owner approval |
| DEC-035 | File limits and retention | Ops | default - awaiting owner approval |
| DEC-036 | Android companion go/no-go | Founder + Tech | default - awaiting owner approval |
| DEC-037 | Attrition definition | HR | default - awaiting owner approval |
| DEC-038 | CRM compliance definition | Team Lead | default - awaiting owner approval |
| DEC-039 | Response time definition | Team Lead | default - awaiting owner approval |
| DEC-040 | Hosting target | Founder + Ops | default - awaiting owner approval |
| DEC-041 | Phase 5: exports stored privately in the database with authorised streaming download | Founder + Tech | default - awaiting owner approval |
| DEC-042 | Phase 5: KPI engine, export generation, snapshots and nightly reconciliation run in the API process; worker invalidates cache and maintains | Tech | default - awaiting owner approval |
| DEC-043 | Phase 5: KPI scope = narrower(kpi:view, KPI domain permission); HR-grade aggregates need organisation scope | Founder + HR | default - awaiting owner approval |
| DEC-044 | Phase 5: SOP adoption excludes new joiners (7 days) only while they have not acknowledged | Team Lead | default - awaiting owner approval |
| DEC-045 | Phase 5: forecast accuracy uses the latest CLOSED week/month, net revenue as actual, WAPE over six periods | Team Lead + Founder | default - awaiting owner approval |
| DEC-046 | Phase 5: manager / individual achievement = unweighted mean of per-person achievement; team achievement = pooled | Team Lead | default - awaiting owner approval |
| DEC-048 | Workforce platform: attendance, leave, Earned Leave, 45-day goals, work tasks, payroll register (supersedes DEC-023) | Founder + HR | default - awaiting owner approval |

## Decisions

### DEC-001 - Target periods and proration
- **Owner:** Founder
- **Options considered:** (a) calendar month/quarter/year; (b) fiscal Apr-Mar quarters/year; (c) custom
- **Chosen default:** Calendar month; quarter = calendar quarter; year = Indian fiscal year Apr-Mar (configurable per org). Mid-period joiners/leavers: target prorated by working days in period (Mon-Sat), stored as explicit allocation, never recomputed silently.
- **Date:** 2026-10-14
- **Rationale:** Indian businesses report on Apr-Mar fiscal year while monthly sales cadence is calendar-based; explicit allocation avoids silent edits.
- **Affected requirement IDs:** JD-SALES-001, JD-SALES-002, MS-FIN-012, JD-KPI-REV-001
- **Status:** default - awaiting owner approval

### DEC-002 - Target revision policy
- **Owner:** Founder
- **Options considered:** (a) free edit; (b) revisions with reason+approver; (c) lock after period start
- **Chosen default:** Revisions allowed with mandatory reason, appended to target_revisions, approver = Founder for org/team-lead level, Team Lead for manager/executive level; original retained; KPIs show target-as-of-date and original.
- **Date:** 2026-10-14
- **Rationale:** Prevents silent goalpost moving while permitting legitimate change.
- **Affected requirement IDs:** JD-SALES-001, MS-FIN-012
- **Status:** default - awaiting owner approval

### DEC-003 - Revenue recognition
- **Owner:** Founder + Finance
- **Options considered:** (a) on Closed-Won (booked); (b) on first verified collection; (c) on full collection
- **Chosen default:** Two separate measures: Sales value (booked) recognised on Closed-Won close date; Collections recognised on verified payment date. 'Revenue achievement %' (JD) uses booked sales value net of approved refunds in period; collection % uses verified collections. Both shown, never merged.
- **Date:** 2026-10-14
- **Rationale:** Closed-Won != paid (Master Spec s9); JD lists revenue and collection targets separately.
- **Affected requirement IDs:** JD-KPI-REV-001, JD-KPI-REV-002, MS-FIN-003
- **Status:** default - awaiting owner approval

### DEC-004 - Collection attribution
- **Owner:** Founder + Finance
- **Options considered:** (a) to closing executive; (b) to collection date owner; (c) split
- **Chosen default:** Collection credited to the sale's credited owner(s) (per DEC-005) regardless of who verified; attribution date = verified payment date; installments follow the sale's credit split.
- **Date:** 2026-10-14
- **Rationale:** Keeps collection and revenue credit consistent per sale.
- **Affected requirement IDs:** JD-KPI-REV-002, MS-FIN-003
- **Status:** default - awaiting owner approval

### DEC-005 - Sales ownership and credit sharing
- **Owner:** Founder
- **Options considered:** (a) single owner; (b) split by percentage; (c) manager override
- **Chosen default:** Single credited owner (lead owner at close) by default; optional split (sum must be 100%) requiring Team Lead approval; manager and team-lead totals roll up from members; no double counting at org level.
- **Date:** 2026-10-14
- **Rationale:** Simple, auditable; splits are the exception.
- **Affected requirement IDs:** JD-KPI-REV-003, JD-KPI-TEAM-001
- **Status:** default - awaiting owner approval

### DEC-006 - Lead stages and lost reasons
- **Owner:** Team Lead
- **Options considered:** (a) fixed; (b) configurable per org
- **Chosen default:** Configurable; defaults. Stages: NEW, CONTACT_ATTEMPTED, CONNECTED, QUALIFIED, WEBINAR_REGISTERED, WEBINAR_ATTENDED, DEMO_SCHEDULED, DEMO_ATTENDED, PROPOSAL_NEGOTIATION, PAYMENT_PENDING, WON, LOST, NURTURE (terminal-ish with reactivation). Lost reasons: PRICE, NOT_INTERESTED, NO_RESPONSE_EXHAUSTED, COMPETITOR, BAD_TIMING, NOT_ELIGIBLE, DUPLICATE_OR_INVALID, LANGUAGE_MISMATCH, OTHER (needs note).
- **Date:** 2026-10-14
- **Rationale:** Matches JD funnel (webinar, demo, closure, payment) and Blueprint lifecycle.
- **Affected requirement IDs:** BP-LIFE-*, MS-CRM-008
- **Status:** default - awaiting owner approval

### DEC-007 - Sales Manager team size limit
- **Owner:** Founder
- **Options considered:** (a) hard cap 5; (b) soft limit configurable
- **Chosen default:** Soft limit default 5 (JD says 4-5), configurable per org/team; exceeding shows warning and is audited, never blocks.
- **Date:** 2026-10-14
- **Rationale:** Master Spec: configurable exceptions rather than inflexible limit.
- **Affected requirement IDs:** JD-ROLE-003, MS-ROLE-011
- **Status:** default - awaiting owner approval

### DEC-008 - Lead assignment and round-robin rules
- **Owner:** Team Lead
- **Options considered:** (a) manual only; (b) round-robin; (c) weighted/capacity
- **Chosen default:** Manual always available. Round-robin optional per team over active, available executives in the team; skips deactivated/on-leave; configurable weight and daily cap (default cap off); source/program filters optional. Rotation pointer persisted for fairness; every assignment writes lead_assignments with reason.
- **Date:** 2026-10-14
- **Rationale:** Blueprint requires configurable round-robin.
- **Affected requirement IDs:** BP-LIFE-002, MS-CRM-006
- **Status:** default - awaiting owner approval

### DEC-009 - Conversion cohort and attribution windows
- **Owner:** Founder + Team Lead
- **Options considered:** (a) period-of-close; (b) lead-created cohort; (c) both
- **Chosen default:** Lead conversion % uses lead-created cohort: leads created in period that reach WON within 60 days of creation (configurable window); period-of-close view available as secondary 'conversions in period'. Both labelled; window shown on KPI.
- **Date:** 2026-10-14
- **Rationale:** Cohort avoids inflating by old leads; Blueprint says disclose range and denominator.
- **Affected requirement IDs:** JD-KPI-SALES-001, BP-KPI-006
- **Status:** default - awaiting owner approval

### DEC-010 - Webinar/demo attribution rule
- **Owner:** Founder
- **Options considered:** (a) last-touch; (b) first-touch; (c) participation window
- **Chosen default:** Sale attributed to a webinar/demo if the lead ATTENDED (attendance flag, not just registered) and the deal WON within 30 days (configurable) after the session; if multiple sessions, the most recent attended before WON is credited. Denominator = attendees (qualified participants optional toggle).
- **Date:** 2026-10-14
- **Rationale:** Master Spec: attendees or qualified participants under agreed rule.
- **Affected requirement IDs:** JD-KPI-SALES-002, JD-KPI-SALES-003
- **Status:** default - awaiting owner approval

### DEC-011 - Duplicate detection and merge policy
- **Owner:** Team Lead
- **Options considered:** (a) auto-merge; (b) flag for review; (c) block
- **Chosen default:** Flag only (never silent merge). Match on E.164 phone (exact) and email (case-insensitive exact); fuzzy name+phone-suffix as 'possible'. Review by owner's manager; merge keeps winner record, moves history/calls/tasks, writes audit with before/after; unmerge not supported in v1 (merge log retained).
- **Date:** 2026-10-14
- **Rationale:** Blueprint rule.
- **Affected requirement IDs:** BP-DATA-002, JD-DASH-011
- **Status:** default - awaiting owner approval

### DEC-012 - Existing CRM source and migration
- **Owner:** Founder
- **Options considered:** (a) none, greenfield; (b) import from LeadSquared; (c) Zoho; (d) HubSpot
- **Chosen default:** None for v1 (greenfield) with CSV import only; connector import deferred until owner names source CRM; rollback plan required before any migration. SalesOS does not replace an existing CRM until approved.
- **Date:** 2026-10-14
- **Rationale:** Master Spec out-of-scope item; JD names three CRMs as skills only.
- **Affected requirement IDs:** MS-NOT-008, MS-GOV-011
- **Status:** default - awaiting owner approval

### DEC-013 - Telephony, WhatsApp, SMS, email providers
- **Owner:** Founder + Operations
- **Options considered:** (a) none (in-app only); (b) provider per channel
- **Chosen default:** v1 ships in-app notifications only; provider interface defined but no provider enabled; WhatsApp/SMS/email adapters BLOCKED until provider, credentials, consent and DLT/template approvals exist. Calling = tel: dialer + manual disposition (ADR-005).
- **Date:** 2026-10-14
- **Rationale:** No provider named in any source document.
- **Affected requirement IDs:** MS-NOT-003, BP-API-005
- **Status:** default - awaiting owner approval

### DEC-014 - Call recording and transcription
- **Owner:** Founder + Legal
- **Options considered:** (a) never; (b) provider-recorded with consent; (c) device recording
- **Chosen default:** Out of scope for v1. Reconsider only after separate technical, consent, privacy and legal review; recording_assets table reserved but unused.
- **Date:** 2026-10-14
- **Rationale:** Blueprint and Google Play policy (see android-feasibility.md).
- **Affected requirement IDs:** BP-AND-008
- **Status:** default - awaiting owner approval

### DEC-015 - Incentive formula, approval, clawback
- **Owner:** Founder
- **Options considered:** (a) flat; (b) slab on achievement; (c) % of collections
- **Chosen default:** NO amounts invented. Structure only: versioned incentive_policy with configurable fields (basis: REVENUE
- **Date:** 2026-10-14
- **Rationale:** COLLECTION, slabs JSON [{min%,max%,rate or fixed}], eligibility gates, cap, period). Calculation yields a RECOMMENDATION (DRAFT) -> Team Lead submits -> Founder approves -> Finance marks PAID. Clawback hook: refund approved within configurable window (default 30 days placeholder) creates a clawback ADJUSTMENT proposal, never automatic. Policy values blank until Founder supplies them; feature runs with policy NOT_CONFIGURED state.
- **Affected requirement IDs:** Master Spec s22: do not invent commission formulas.
- **Status:** default - awaiting owner approval

### DEC-016 - Program pricing and product-specific funnels
- **Owner:** Founder
- **Options considered:** (a) global price; (b) per-program versioned price
- **Chosen default:** Per-program versioned price list (effective-from, currency INR, tax-inclusive flag); funnel stage subsets per program optional; no prices seeded except [DEMO] labelled.
- **Date:** 2026-10-14
- **Rationale:** Master Spec: never assume shared pricing/funnel.
- **Affected requirement IDs:** JD-ROLE-011, MS-I18N-002
- **Status:** default - awaiting owner approval

### DEC-017 - Complaint priority and SLA
- **Owner:** Founder + Student Success
- **Options considered:** (a) none; (b) tiered SLA
- **Chosen default:** Priorities P1 Critical (first response 4 business hours, resolve 2 business days), P2 High (8h / 3 days), P3 Medium (1 business day / 5 days), P4 Low (2 days / 10 days). Business hours per DEC-020. Breach -> notify owner then Team Lead then Founder (P1). All values configurable.
- **Date:** 2026-10-14
- **Rationale:** Reasonable placeholder for a consumer education business; owner to adjust.
- **Affected requirement IDs:** JD-CX-006, JD-KPI-CX-003
- **Status:** default - awaiting owner approval

### DEC-018 - Data retention, deletion, DPDP privacy
- **Owner:** Founder + Legal
- **Options considered:** (a) indefinite; (b) tiered retention
- **Chosen default:** Defaults (pending legal review): lead/learner records retained while active + 3 years after last activity then anonymised; lost/no-consent leads 12 months; call logs 3 years; audit logs 7 years; notifications 90 days; import files 30 days; file assets per policy table; consent captured with timestamp/source; data-subject erasure/export request workflow manual with audit. Not legal advice; DPDP Act 2023 review required.
- **Date:** 2026-10-14
- **Rationale:** Minimise personal data; align with DPDP principles.
- **Affected requirement IDs:** BP-SEC-007, MS-SEC-022
- **Status:** default - awaiting owner approval

### DEC-019 - Refund approval authority and payment provider
- **Owner:** Founder + Finance
- **Options considered:** (a) Team Lead approves; (b) Founder/Finance approve
- **Chosen default:** Sales Team Lead (or Manager) recommends/reviews; Founder or FINANCE approves/rejects (amount threshold configurable; default all refunds need Founder or Finance); FINANCE marks PROCESSED and RECONCILED. No automatic refund/charge; external payment provider NOT integrated (manual reference id entry).
- **Date:** 2026-10-14
- **Rationale:** Master Spec: refund requested != approved; separation of duties.
- **Affected requirement IDs:** MS-FIN-006, JD-CX-009
- **Status:** default - awaiting owner approval

### DEC-020 - Business timezone and working days
- **Owner:** Founder
- **Options considered:** Asia/Kolkata vs per-user
- **Chosen default:** Business timezone Asia/Kolkata (IST, UTC+05:30, no DST); stored UTC; per-user display override allowed. Working days Mon-Sat, hours 09:00-19:00 IST (configurable); Sunday and org holidays calendar excluded from retry delays and SLA clocks.
- **Date:** 2026-10-14
- **Rationale:** Stated default in PHASE_PROMPTS B.6; remote India-based team.
- **Affected requirement IDs:** BP-CALL-002, JD-CX-006
- **Status:** default - awaiting owner approval

### DEC-021 - UI languages
- **Owner:** Founder
- **Options considered:** (a) EN only; (b) EN+HI+MR
- **Chosen default:** UI English first; i18n catalogues scaffolded for Hindi (hi) and Marathi (mr) with key parity checks; translated strings added later; lead preferred_language stored; user-entered content not auto-translated.
- **Date:** 2026-10-14
- **Rationale:** JD says learners served in EN/HI/MR; staff UI language not specified.
- **Affected requirement IDs:** MS-I18N-001
- **Status:** default - awaiting owner approval

### DEC-022 - AI features in v1 or later
- **Owner:** Founder
- **Options considered:** (a) v1; (b) later optional
- **Chosen default:** Later and OPTIONAL: Phase 8 behind feature flag AI_COPILOT_ENABLED=false by default; no external provider call until provider approved and PII controls signed off.
- **Date:** 2026-10-14
- **Rationale:** Both source docs make AI optional.
- **Affected requirement IDs:** BP-AI-*
- **Status:** default - awaiting owner approval

### DEC-023 - HRMS scope (payroll, leave, attendance)
- **Owner:** Founder + HR
- **Options considered:** (a) full HRMS; (b) hiring/onboarding/probation/reviews/succession only
- **Chosen default:** Option (b): no payroll, leave, attendance. Employee profile holds only JD-required people data. Integration with an external HRMS deferred.
- **Date:** 2026-10-14
- **Rationale:** JD names recruitment, onboarding, probation, reviews, succession only.
- **Affected requirement IDs:** MS-PPL-002, JD-HR-*
- **Status:** default - awaiting owner approval

### DEC-024 - Team engagement measurement
- **Owner:** Team Lead + HR
- **Options considered:** (a) pulse survey; (b) proxy metrics
- **Chosen default:** Monthly 5-question anonymous-by-default pulse (1-5 Likert), aggregated only when >=3 responses per team; engagement score = mean/5*100. Questions configurable.
- **Date:** 2026-10-14
- **Rationale:** JD lists engagement KPI without definition.
- **Affected requirement IDs:** JD-KPI-TEAM-005
- **Status:** default - awaiting owner approval

### DEC-025 - Learner ranks terminology (Warrior..Chhatrapati)
- **Owner:** Founder
- **Options considered:** (a) ignore; (b) display-only config; (c) auto-map to earnings
- **Chosen default:** Display-only configurable terminology list; NO automatic mapping to sales records or earnings.
- **Date:** 2026-10-14
- **Rationale:** Master Spec s2 explicit warning.
- **Affected requirement IDs:** JD-ROLE-015
- **Status:** default - awaiting owner approval

### DEC-026 - Reminder, retry and escalation thresholds
- **Owner:** Team Lead
- **Options considered:** n/a (technical defaults)
- **Chosen default:** NO_ANSWER retry +3 working hours (max 3 attempts/day, 5 total before manager review); BUSY callback at requested time else +1 working hour; SWITCHED_OFF +1 working day, 3 consecutive -> manager review; CALLBACK reminder 15 min before due; OVERDUE: notify owner at due+0, again +4h, escalate to Manager at due+1 working day, to Team Lead at +3 working days; unattended lead alert when no activity > 3 working days (NEW lead no first contact > 1 hour during working hours). Configurable org > team.
- **Date:** 2026-10-14
- **Rationale:** Reasonable sales-follow-up cadence; configurable per Blueprint.
- **Affected requirement IDs:** BP-CALL-*, BP-REL-005, JD-DASH-011
- **Status:** default - awaiting owner approval

### DEC-027 - High-value deal threshold
- **Owner:** Founder
- **Options considered:** (a) fixed amount; (b) percentile; (c) per program
- **Chosen default:** Configurable amount threshold per program; default NOT_CONFIGURED -> falls back to top 10% of open deal value in last 90 days; breach flags deal and notifies Team Lead; Founder notified above 2x threshold.
- **Date:** 2026-10-14
- **Rationale:** JD gives no figure; no amount invented.
- **Affected requirement IDs:** JD-SALES-009, MS-FIN-010
- **Status:** default - awaiting owner approval

### DEC-028 - Founder report quality metric
- **Owner:** Founder
- **Options considered:** (a) subjective; (b) checklist
- **Chosen default:** Quality = required-section completeness (performance, risks with proposed solutions, opportunities, action items) as %; optional Founder 1-5 rating. Timeliness = submitted on/before due time (weekly Monday 10:00 IST for previous week; monthly by 3rd working day; configurable).
- **Date:** 2026-10-14
- **Rationale:** JD gives no definition.
- **Affected requirement IDs:** JD-KPI-FND-002, JD-KPI-FND-003
- **Status:** default - awaiting owner approval

### DEC-029 - RPO/RTO and backup policy
- **Owner:** Founder + Ops
- **Options considered:** (a) daily; (b) PITR
- **Chosen default:** Proposed targets: RPO <= 24h (daily dump) improving to <= 15 min with WAL/PITR when managed DB chosen; RTO <= 4h. Marked proposed, not guaranteed; restore drill quarterly.
- **Date:** 2026-10-14
- **Rationale:** Master Spec: do not invent guarantees; owner to confirm.
- **Affected requirement IDs:** MS-SEC-025, BP-SEC-008
- **Status:** default - awaiting owner approval

### DEC-030 - Forecast method and accuracy metric
- **Owner:** Team Lead + Founder
- **Options considered:** (a) rep estimates; (b) stage-weighted; (c) statistical
- **Chosen default:** Stage-weighted pipeline: sum(open deal amount x stage probability) for deals expected to close in the period + booked-to-date; probabilities configurable (defaults NEW 5%, QUALIFIED 15%, DEMO_ATTENDED 35%, NEGOTIATION 60%, PAYMENT_PENDING 85%). Accuracy: Forecast Accuracy = max(0, 1 - 
- **Date:** 2026-10-14
- **Rationale:** forecast - actual
- **Affected requirement IDs:** /actual) at period end from the snapshot taken at period start/week start; also report WAPE across periods = sum
- **Status:** default - awaiting owner approval

### DEC-031 - Lost-lead reactivation rules
- **Owner:** Team Lead
- **Options considered:** (a) none; (b) time-based queue
- **Chosen default:** Lost leads with reasons BAD_TIMING, NO_RESPONSE_EXHAUSTED, PRICE enter reactivation queue after 30/45/60 days (configurable); excluded: DUPLICATE_OR_INVALID, NOT_ELIGIBLE, consent withdrawn/DND. Max 2 reactivation attempts, then archived. Assigned round-robin to eligible executives.
- **Date:** 2026-10-14
- **Rationale:** JD requires reactivation; no rule given.
- **Affected requirement IDs:** JD-DASH-013
- **Status:** default - awaiting owner approval

### DEC-032 - Admin and secondary-permission access
- **Owner:** Founder
- **Options considered:** (a) admin superuser; (b) least privilege
- **Chosen default:** Admin has no HR/finance/payment/revenue-detail data by default; needs explicit secondary grants (hr:*, finance:*). Founder grant/revoke is audited. Managers see sibling teams only through explicit time-bound delegation.
- **Date:** 2026-10-14
- **Rationale:** Blueprint + Master Spec.
- **Affected requirement IDs:** MS-ROLE-006
- **Status:** default - awaiting owner approval

### DEC-033 - Currency
- **Owner:** Founder
- **Options considered:** INR only vs multi
- **Chosen default:** INR default; currency column on every money record; no FX conversion in v1.
- **Date:** 2026-10-14
- **Rationale:** Master Spec: explicit currency.
- **Affected requirement IDs:** MS-FIN-005
- **Status:** default - awaiting owner approval

### DEC-034 - Incentive payout handling
- **Owner:** Founder + Finance
- **Options considered:** (a) in-app pay; (b) mark paid only
- **Chosen default:** Mark-paid status only; payroll/payout outside SalesOS.
- **Date:** 2026-10-14
- **Rationale:** HRMS out of scope.
- **Affected requirement IDs:** JD-DASH-015
- **Status:** default - awaiting owner approval

### DEC-035 - File limits and retention
- **Owner:** Ops
- **Options considered:** n/a
- **Chosen default:** Max 10 MB images/PDF per file (configurable), 100 MB per user quota, allowed: jpg, png, webp, pdf, csv, xlsx; retention default per file category; originals kept. See file-storage-policy.md.
- **Date:** 2026-10-14
- **Rationale:** Technical default.
- **Affected requirement IDs:** MS-SEC-001
- **Status:** default - awaiting owner approval

### DEC-036 - Android companion go/no-go
- **Owner:** Founder + Tech
- **Options considered:** (a) build; (b) defer
- **Chosen default:** NO-GO for v1; revisit after owner chooses provider-based telephony or accepts Play-policy limits (ADR-005).
- **Date:** 2026-10-14
- **Rationale:** See android-feasibility.md.
- **Affected requirement IDs:** BP-AND-*
- **Status:** default - awaiting owner approval

### DEC-037 - Attrition definition
- **Owner:** HR
- **Options considered:** (a) all exits; (b) split
- **Chosen default:** Attrition % = exits (voluntary+involuntary reported separately) in period / average headcount in period x 100; probation failures counted; internal transfers excluded. Reported monthly with rolling 12-month view.
- **Date:** 2026-10-14
- **Rationale:** JD names attrition KPI only.
- **Affected requirement IDs:** JD-KPI-TEAM-004
- **Status:** default - awaiting owner approval

### DEC-038 - CRM compliance definition
- **Owner:** Team Lead
- **Options considered:** (a) activity-based; (b) field-based
- **Chosen default:** Compliant lead-day = active lead owned by executive that has owner, next action, required fields (stage, interest, contact status), and activity updated within threshold; compliance % = compliant eligible leads / eligible active leads.
- **Date:** 2026-10-14
- **Rationale:** Master Spec suggested definition.
- **Affected requirement IDs:** JD-KPI-PROD-003
- **Status:** default - awaiting owner approval

### DEC-039 - Response time definition
- **Owner:** Team Lead
- **Options considered:** n/a
- **Chosen default:** First-response time = minutes (working hours only) from lead creation/assignment to first call attempt logged; median and 90th percentile reported; leads created outside working hours start at next opening.
- **Date:** 2026-10-14
- **Rationale:** JD lists response time without definition.
- **Affected requirement IDs:** JD-KPI-PROD-004
- **Status:** default - awaiting owner approval

### DEC-040 - Hosting target
- **Owner:** Founder + Ops
- **Options considered:** (a) shared VPS; (b) managed cloud
- **Chosen default:** Local docker compose for dev; staging/prod deployment target undecided - runbook written for shared-VPS safety (isolated salesos-* services/ports) and portable to managed cloud.
- **Date:** 2026-10-14
- **Rationale:** Master Spec s18.
- **Affected requirement IDs:** MS-GOV-004
- **Status:** default - awaiting owner approval

### DEC-041 - Export storage and download (Phase 5)
- **Owner:** Founder + Tech
- **Options considered:** (a) FileService/object storage with signed URLs; (b) private bytea column streamed after an authorisation check
- **Chosen default:** (b). Exports are short-lived (72 h), single-owner derived files bounded by row caps (CSV 100k, XLSX 50k rows); they never enter the upload scanner/MIME pipeline and are reachable only through `GET /reports/exports/:id/download` for the requester who still holds `reports:export`. Every create, completion, download and failure is audited. Switch to object storage if exports grow beyond tens of MB.
- **Date:** 2026-10-15
- **Rationale:** simplest design that keeps the file private and authorisation-checked on every read.
- **Affected requirement IDs:** MS-REP-002
- **Status:** default - awaiting owner approval

### DEC-042 - Where analytics jobs run (Phase 5)
- **Owner:** Tech
- **Options considered:** (a) move the KPI engine into a framework-free package so the worker runs exports/snapshots; (b) run them inside the API (DB-claimed, lease-based, idempotent), worker keeps cache invalidation and housekeeping
- **Chosen default:** (b) for Phase 5 because the revenue calc package lives in apps/api (same constraint as KI-G-01). Large exports use a DB queue (`FOR UPDATE SKIP LOCKED`, lease, 3 attempts); snapshots and the nightly reconciliation run from an API scheduler guarded by "once per day" checks. Tracked as KI-I-02.
- **Date:** 2026-10-15
- **Affected requirement IDs:** MS-REP-002, JD-KPI-PROC-002
- **Status:** default - awaiting owner approval

### DEC-043 - KPI visibility (Phase 5)
- **Owner:** Founder + HR
- **Options considered:** (a) every KPI behind `kpi:view` only; (b) additionally the KPI's domain permission; (c) HR-grade aggregates restricted by minimum scope
- **Chosen default:** (b)+(c). A KPI value is computed over `narrower(scope(kpi:view), scope(domain permission))`. Attrition, engagement, dashboard accuracy and Founder-reporting quality/timeliness are shown only at organisation (or summary) scope and only as aggregates; per-person breakdowns are never returned at `summary` scope. Admin holds neither `kpi:view` nor business permissions: it sees the dictionary and system health only (DEC-032).
- **Date:** 2026-10-15
- **Affected requirement IDs:** BP-KPI-010, MS-REP-007
- **Status:** default - awaiting owner approval

### DEC-044 - SOP adoption new-joiner rule (Phase 5)
- **Owner:** Team Lead
- **Chosen default:** users created within the last 7 days are excluded from the required set unless they have already acknowledged (dictionary text "users added < 7 days ago" made precise); configurable `sopNewJoinerGraceDays`.
- **Date:** 2026-10-15
- **Affected requirement IDs:** JD-KPI-PROC-001
- **Status:** default - awaiting owner approval

### DEC-045 - Forecast accuracy window and actual (Phase 5)
- **Owner:** Team Lead + Founder
- **Chosen default:** accuracy is reported for the latest CLOSED week or month (an open period shows forecast vs actual-so-far without an accuracy figure); F = PERIOD_START snapshot (else earliest), A = net revenue of the period (booked net of adjustments minus approved refunds, same as the revenue forecasts API); WAPE over the trailing six periods that have a snapshot; bias alongside; A <= 0 gives a dash, never 100%.
- **Date:** 2026-10-15
- **Affected requirement IDs:** JD-KPI-SALES-005
- **Status:** default - awaiting owner approval

### DEC-046 - Manager / individual / team achievement (Phase 5)
- **Owner:** Team Lead
- **Chosen default:** KPI-TEA-001 and KPI-TEA-002 are the unweighted mean of per-manager / per-executive achievement % (people without a target are listed, not averaged); KPI-REV-003 is pooled (revenue of the managers' subtrees / sum of manager targets). Targets are counted once through the target tree (top-most node in scope).
- **Date:** 2026-10-15
- **Affected requirement IDs:** JD-KPI-REV-003, JD-KPI-TEAM-001, JD-KPI-TEAM-002
- **Status:** default - awaiting owner approval

### DEC-047 - Luxury-premium visual refresh: gold + blue + green accents (owner override)
- **Owner:** Founder / CEO (explicit user request, 2026-10-15)
- **Chosen default:** Overrides the earlier "gold / red / blue only" accent rule. Gold = premium emphasis and primary CTA; blue = info, links, active workflow; green = success, growth, money-in; red remains errors / overdue / risk only. Animated accent lines, sheen on primary buttons and staggered page entry are allowed; all motion respects `prefers-reduced-motion`, nothing flashes above 3 Hz, no glow spam, WCAG AA text variants (gold-700, blue-700, green-700) retained. Existing token names are unchanged (additions only).
- **Date:** 2026-10-15
- **Affected requirement IDs:** UX design system (docs/ux-design-system.md), CLAUDE.md section 10
- **Status:** approved by owner request

## Ambiguities in source documents (Phase 0 exit gate)

1. **Stack conflict:** Blueprint = NestJS/Prisma; Master Spec = FastAPI/SQLAlchemy. Resolved by PHASE_PROMPTS B.1 (TypeScript/NestJS/Prisma). See ADR-001.
2. **Phase numbering differs** between Blueprint (0-7), Master Spec (0-9) and PHASE_PROMPTS (0-10). PHASE_PROMPTS numbering is authoritative here.
3. **Role set:** Blueprint has CEO/Manager/Salesperson only; JD centres on Sales Team Lead; Admin absent from Blueprint. Resolved by B.3 (five roles + secondary groups).
4. **'Revenue achievement' vs 'collection'** - JD lists both without defining recognition. See DEC-003/004.
5. **'Team sales achievement' vs 'Sales Manager and individual target achievement'** overlap; defined separately in kpi-dictionary.md (team = sum of team credited sales vs team target; manager = same attributed to the manager's team).
6. **'Forecast accuracy'** has no error metric in JD. DEC-030.
7. **'Learner satisfaction', 'enrolment experience score', 'team engagement', 'quality of reporting'** have no instrument defined; defaults proposed (DEC-024, DEC-028; CSAT 1-5 and enrolment 1-5 survey defined in kpi-dictionary.md).
8. **'Attrition', 'response time', 'CRM compliance', 'team productivity'** undefined. DEC-037/039/038 and kpi-dictionary.md.
9. **'Telecallers' vs 'Sales Executives'** - treated as the same role SALES_EXECUTIVE with an optional job-title label.
10. **Accountability Coach team** appears in JD context but not in the responsibilities; modelled via STUDENT_SUCCESS group; no separate module.
11. **'8-10 years' experience vs 'Minimum 3 years managing'** - hiring criteria only; no runtime meaning.
12. **Rank names (Warrior...Chhatrapati)** are learner progress ranks, not sales ranks. DEC-025.
13. **'Reduce refunds'** target magnitude not given - KPI shows trend like-for-like with no target unless set.
14. **'Calculate and recommend incentives'** with no policy given. DEC-015 (structure only).
15. **'Recruit sales talent with HR'** - whether an applicant tracking system is needed vs lightweight pipeline; assumed lightweight (DEC-023).
16. **'Work arrangement: Remote'** - no VPN/IP restrictions assumed; session security relies on app controls.
17. **Blueprint 'optional recording references' (core modules) vs 'recording out of scope'** - reference table reserved, unused (DEC-014).
18. **Call 'duration'/'connected'** are manual in MVP; KPIs declare source (manual vs verified).
19. **Blueprint API lists PATCH /users/:id but no DELETE** - users are deactivated, never hard-deleted.
20. **Multi-tenancy:** single company today; organization_id kept on every table (cheap now, costly later).

### Platform defaults used in Phase 8 (Agent F) - not new decisions
- DEC-012: no CRM connector built (greenfield + CSV import only) -> MS-NOT-008 stays NEEDS_DECISION.
- DEC-013: real providers BLOCKED; sandbox adapters + provider interface + consent/opt-out shipped.
- DEC-014: recording BLOCKED; `recording_assets` schema reserved, endpoints answer 403 `RECORDINGS_DISABLED`.
- DEC-035: file limits/quotas/retention shipped as configurable defaults (10 MB per category, 100 MB per user, 5 GB per org, CSV 30 days, payment proofs 7 years, signed URL 300 s).
- DEC-036: Android companion NO-GO; `devices.enabled` flag defaults OFF.

### Integration pass (Agent J) - defaults used, not new business decisions
- INT-01 Notifications: one in-app inbox. The CRM worker sends through the platform notifier (`createCrmNotificationPort`); `crm_notification_deliveries` stays as the CRM's idempotency/retry ledger (status mirrors the platform result) and `GET /crm-notifications` is a thin view of the platform `notifications` rows of CRM types. `PLATFORM_AUTO_NOTIFY_CRM_EVENTS` defaults to `false` (opt-in only when the CRM handlers are disabled).
- INT-02 Notification catalogue additions (alerts that producers already published had no type): `lead.assigned`, `reassignment.needed`, `pip.update`, `incentive.update`, `recognition.received`, `resource.assigned`, `sop.approval_pending`, `sop.update`, `sop.ack_due`, `probation.review_due`. Titles are generic on purpose: HR content never travels in an alert.
- INT-03 Files inherit the scope of the entity they are attached to (`recordFileResolver`): read needs the entity's view permission at more than `summary` scope and the record inside the caller's scope; attaching needs a write permission on the same record; unregistered types are not attachable; unpublished SOP versions need `sop:create|approve`. Registered types: lead, deal, payment, refund, complaint, founder_report, sop_version, review, candidate, onboarding, pip (+ user, handover, action_item, xf_task from their owners).
- INT-04 AI context (`CrmAiContextProvider`): the caller is re-loaded from the database for every call (active user, current roles); summary-only holders get nothing; lead names, e-mails and phone numbers are masked at the source; PRIVATE notes need `leads:notes:view-private`. Provider call events (`CallEventPort`) write `call_logs` rows with `source = PROVIDER` as evidence only (no lead movement, no tasks), matched by E.164 number inside the organisation.
- INT-05 Minimum projections: summary-scope roles get `null` for every money/high-value field; the `highValue` filter is refused for them (no oracle). Audit-log metadata of money, HR and CX entity types is redacted unless the caller holds that domain's permission above `summary` (Admin holds none, DEC-032).
- INT-06 FK policy: every `organization_id` and user/team column of the crm/revenue/people/cx/platform schemas is a real FK with `onDelete: Restrict` (users are never hard-deleted; a team referenced by records answers `409 TEAM_IN_USE` instead of a 500). Analytics tables are covered once their schema is final.
- INT-07 Migrations: one consolidated initial migration (`prisma/schema/migrations/20261015000000_init`; with a multi-file schema Prisma keeps the folder inside the schema folder) = Prisma DDL + `prisma/sql/*.sql` guards (all idempotent). Guards written in TypeScript are exported to SQL by `pnpm db:guards:export`; both generated artefacts are verified by `pnpm migration-check` and CI. Later changes are incremental migrations (`prisma migrate dev --create-only`).
- INT-08 Permission keys for teams are `teams:view|create|update|delete` only (legacy `teams:read|manage` spellings removed). `users:role:assign-sensitive` (Founder only) has a row in the matrix; the per-role JSON appendix of `docs/permissions-matrix.md` is generated from the code catalogue (`pnpm --filter @salesos/api permissions:matrix`).
- INT-09 Manager-proposed PIPs are NOT built (KI-J-02): the matrix gives managers `pip:update` but not `pip:create`; owner to decide whether to add a `pip:propose` permission.
- INT-10 Ownership/accountability expectations (JD-HR-009): acknowledgement is bound to a SHA-256 of kind+title+body; editing the text requires a new acknowledgement; HR/Team Lead/Manager see adoption within scope.
- INT-11 Target risk notification (`target.at_risk`) - default awaiting owner approval, configurable by env: a REVENUE target is at risk when >= 25% of its period has elapsed (`TARGET_RISK_MIN_ELAPSED_PCT`) and credited sales are < 70% of the straight-line pace (`TARGET_RISK_PACE_PCT`); owner and manager are told once per ISO week. `target.milestone_missed` has no producer: "milestone" is not defined anywhere in the spec (NEEDS_DECISION).

### DEC-048 - Workforce platform in scope: attendance, leave, Earned Leave, 45-day goal cycle, work tasks, payroll register (supersedes DEC-023)
- **Owner:** Founder (requested 2026-10-15) + HR
- **Source:** `Employee_Management_Platform_Feature_Document (1).pdf` + owner request for the Team App Goal Cycle (45-day goals, task updates, leave approvals), payroll, leave and attendance.
- **Decision (owner answers 2026-10-15):** Payroll = register without statutory calculation (PF/ESI/PT/TDS are NOT computed; HR/Finance may add them as manual deduction components; legal/CA review needed). Attendance = web check-in/out + HR/manager correction with reason (no biometric/GPS). Leave = Casual, Sick, Earned, Unpaid; approval chain Manager then HR, configurable.
- **Defaults implemented (all "default - awaiting owner approval", configurable in `workforce_settings`):** Earned Leave: 1 day after 20 eligible working days (counter follows the working calendar; weekly off/holidays skipped; half day = 0.5; WFH/late count; approved/unpaid leave and absent skipped; no duplicate credit for a period); weekly off Sunday (Mon-Sat working, DEC-020); goal cycle 45 days, AT_RISK when progress is 20 points behind elapsed time, manager verification required; probation 3 months with 7-day reminder; birthday reminders 7/3/1 days; payroll pays working days minus loss-of-pay (unpaid leave, absent, half day x 0.5), approval by Founder, "paid" is recorded by Finance after an EXTERNAL payout (SalesOS never moves money).
- **Not decided / needs owner:** CASUAL and SICK annual quotas (no quota is invented: HR sets opening balances); holiday list (moveable festivals are entered by HR; only fixed-date national holidays are suggested); statutory payroll rules; whether payroll data may be shown to Admin (default: no, DEC-032).
- Code: `prisma/schema/workforce.prisma`, `apps/api/src/modules/workforce`, `packages/workforce-core`, `apps/worker/src/jobs/workforce`, web `/work/*`. Contract and ownership: `docs/workforce-report.md`.
