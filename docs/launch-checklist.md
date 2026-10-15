# Launch Checklist

Date: 2026-10-14. Sources: Blueprint s13, Master Spec s23, Master Spec s17 (17 critical journeys). Nothing is ticked: status is NOT_STARTED. Tick only with real evidence (command output / test path / date). Do not claim 100% if any item is unverified.

## A. Blueprint launch checklist (LC)
| ID | Area | Acceptance criteria | Evidence | Done |
|---|---|---|---|---|
| LC-01 | Identity & permissions | Role tests pass; cross-team and cross-organization access denied | | [ ] |
| LC-02 | Lead workflow | Imports, duplicate review, assignment and complete history work | | [ ] |
| LC-03 | Call records | Manual disposition, notes and lead timeline work reliably | | [ ] |
| LC-04 | Follow-ups | Tasks, reminders, retries and escalation survive worker restarts | | [ ] |
| LC-05 | Analytics | KPIs reconcile with database records and obey role scope | | [ ] |
| LC-06 | AI | Suggestions reviewable; provider failures do not break CRM; CRM works with AI off | | [ ] |
| LC-07 | Android | Compatibility and policy limitations documented; no unsupported guarantees (docs/android-feasibility.md) | | [ ] |
| LC-08 | Production | Security review, monitoring, backup restore and runbook complete | | [ ] |

## B. Master Spec final acceptance (FA)
| ID | Item | Done |
|---|---|---|
| FA-01 | Every individual source requirement has a traceability row | [ ] |
| FA-02 | All eight responsibility groups mapped | [ ] |
| FA-03 | Every KPI has an approved formula and a passing test | [ ] |
| FA-04 | Founder, Team Lead, Manager, Executive/Telecaller, Admin permissions enforced server-side | [ ] |
| FA-05 | Documented team structure supported (4-5 per manager, configurable) | [ ] |
| FA-06 | CRM, lead ageing, follow-ups, reactivation, pipeline, collections, reporting work end to end | [ ] |
| FA-07 | SOPs, coaching, reviews, improvement plans, incentives, recognition work | [ ] |
| FA-08 | Complaints, learner satisfaction, refunds, Student Success handover work | [ ] |
| FA-09 | Recruitment, onboarding, probation, succession covered or explicitly scoped | [ ] |
| FA-10 | Program names/terminology supported without invented rules | [ ] |
| FA-11 | Mobile layouts and core mobile workflows tested | [ ] |
| FA-12 | Gold/red/blue accents and motion restrained, accessible, consistent | [ ] |
| FA-13 | File upload authorisation, validation, optimisation, private storage tested | [ ] |
| FA-14 | Security, audit logging, monitoring, backups, restore verified | [ ] |
| FA-15 | Critical E2E, regression and permission tests pass | [ ] |
| FA-16 | No unresolved critical/high defect hidden | [ ] |
| FA-17 | Staging UAT and release rollback completed | [ ] |
| FA-18 | Known limitations and blocked requirements disclosed | [ ] |
| FA-19 | Owner signs off traceability register | [ ] |

## C. Release gates (any = block)
Critical/high security issue open; untested migration; failing critical journey; non-reconciling money totals; untested permissions; no backup/rollback; hidden known defects; decisions DEC-* still unapproved where they change behaviour (list in release notes).

## D. 17 critical user journeys (UJ)
| ID | Journey | Roles | Key assertions | Phase available | Result |
|---|---|---|---|---|---|
| UJ-01 | Founder logs in and views company-level performance | Founder | dashboard loads, scoped org data, definitions/freshness shown | P5 | passed 2026-10-15 (apps/web/e2e/analytics-journeys.spec.ts; docs/uat-report.md) |
| UJ-02 | Team Lead assigns/reviews targets and manager scorecards | Team Lead | cascade targets, revision history, scorecard totals | P4/P6 | passed 2026-10-15 (analytics-journeys.spec.ts; docs/uat-report.md) |
| UJ-03 | Manager assigns a lead to a team member | Manager | assignment history, notification, cannot assign outside team | P3 | passed 2026-10-15 (crm-journeys.spec.ts; docs/uat-report.md) |
| UJ-04 | Executive records activity and schedules a follow-up | Executive | disposition + task + history atomic; timeline updated | P3 | passed 2026-10-15 (crm-journeys.spec.ts; docs/uat-report.md) |
| UJ-05 | System flags an overdue/unattended lead | System/Manager | exception queue, owner notified then escalated | P3 | passed 2026-10-15 (crm-journeys.spec.ts; docs/uat-report.md) |
| UJ-06 | Lead progresses through webinar/demo and sales stages | Executive | attendance recorded, stages valid transitions, attribution anchor | P3/P4 | passed 2026-10-15 (crm-journeys.spec.ts; docs/uat-report.md) |
| UJ-07 | Closed-won sale and verified collection remain distinct | Exec/Finance | sale value vs collected vs net | P4 | passed 2026-10-15 (apps/web/e2e/revenue-journeys.spec.ts) |
| UJ-08 | Payment reconciliation avoids duplicate credit | Finance | duplicate external ref blocked, totals reconcile | P4 | passed 2026-10-15 (apps/web/e2e/revenue-journeys.spec.ts) |
| UJ-09 | Refund follows authorised approval and processing states | Exec/TL/Founder/Finance | separate actors, no auto refund | P4 | passed 2026-10-15 (apps/web/e2e/revenue-journeys.spec.ts) |
| UJ-10 | Sale handed over to Student Success with required info | Exec/Student Success | checklist required, ack, pending alert | P7 | passed 2026-10-15 (cx-journeys.spec.ts; docs/uat-report.md) |
| UJ-11 | Manager records coaching session and review action | Manager | session hours counted, action item tracked | P6 | passed 2026-10-15 (people.spec.ts; docs/uat-report.md) |
| UJ-12 | Founder report and action items generated and tracked | TL/Founder | immutable snapshot, overdue alerts | P7 | passed 2026-10-15 (cx-journeys.spec.ts; docs/uat-report.md) |
| UJ-13 | Unauthorised users cannot access another team's records | all | negative authz suite | P2 | passed 2026-10-15 (uat-journeys.spec.ts; docs/uat-report.md) |
| UJ-14 | Upload validated, optimised if supported, downloaded securely | any | MIME check, signed URL expiry | P8 | passed 2026-10-15 (platform-journeys.spec.ts; docs/uat-report.md) |
| UJ-15 | Failed notification/import visible and recoverable | Admin/Manager | DLQ view, retry works | P8 | passed 2026-10-15 (platform-journeys.spec.ts; docs/uat-report.md) |
| UJ-16 | Mobile user completes core lead and follow-up workflows | Executive | 360px viewport, one-hand flow | P3/P10 | passed 2026-10-15 (crm-journeys.spec.ts 390px + uat-journeys.spec.ts 360px; docs/uat-report.md) |
| UJ-17 | Backup restore and release rollback rehearsed in safe environment | Ops | measured RPO/RTO recorded | P10 | PARTIAL 2026-10-15: backup+restore passed (uat-journeys.spec.ts); rollback rehearsal evidence pending L1 (docs/uat-report.md) |

## E. Sign-off
Owner: ______ Date: ______ Residual risks accepted: ______
