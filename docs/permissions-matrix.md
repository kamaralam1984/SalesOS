# Permissions Matrix (draft, Phase 0; finalised in Phase 2)

Date: 2026-10-14. Binding for the api agent: permission keys below (`module:action`) are the canonical catalogue. Deny-by-default; every endpoint declares exactly one permission key plus a scope check. UI hiding is not security.

## Conventions

- **Scope**: `org` = whole organisation; `team` = the user's own team tree (manager: own team; Team Lead: all managers' teams i.e. org for sales data); `own` = records the user owns/is assigned/created; `summary` = minimum-data projection (no PII beyond name/id/status); `-` = denied.
- Scope is evaluated server-side from the authenticated user: record ownership + team hierarchy + explicit delegation. Client-supplied org/team/role/assignee IDs are never trusted. Cross-organization access is always denied.
- **Primary role** = exactly one of FOUNDER_CEO, SALES_TEAM_LEAD, SALES_MANAGER, SALES_EXECUTIVE, ADMIN. **Secondary groups** (FINANCE, HR, MARKETING, COMMUNITY, OPERATIONS, STUDENT_SUCCESS) are additive grants on top of a primary role (a user may hold several). Effective permission = union of all grants; the widest scope wins per key.
- ADMIN has no HR (`hr:*`, reviews, pip, incentives detail) or payment/finance data by default (DEC-032). Granting needs an explicit secondary group and is audited.
- Sales Manager sees sibling teams only via `users:delegation:manage` time-bound delegation.
- The 'approve' column: Founder is the final approver for target revisions, incentives, pricing proposals, high-value policy; Finance approves refunds with Founder; Student Success acknowledges handovers.
- Sensitive-action audit events are mandatory for: users:role:assign, users:deactivate, leads:assign, leads:export, calls:export, reports:export, collections:*, refunds:*, incentives:*, settings:update, files:delete, audit:export, ai:config, hr:records:*.
- Secondary-group columns show what the group grants *in addition*; a '-' there means the group adds nothing for that key.

Columns: F=FOUNDER_CEO, TL=SALES_TEAM_LEAD, MG=SALES_MANAGER, EX=SALES_EXECUTIVE, AD=ADMIN, FIN=FINANCE, HR=HR, MKT=MARKETING, COM=COMMUNITY, OPS=OPERATIONS, SS=STUDENT_SUCCESS.

## auth - Authentication and session

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `auth:login` | Log in / out | org | org | org | org | org | org | org | org | org | org | org |
| `auth:me:view` | View own profile and effective permissions | own | own | own | own | own | own | own | own | own | own | own |
| `auth:session:revoke-own` | Revoke own sessions | own | own | own | own | own | own | own | own | own | own | own |

## users - Users, roles, teams

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `users:view` | List/view users | org | org | team | own | org | - | summary | - | - | - | - |
| `users:create` | Create/invite users | org | - | - | - | org | - | - | - | - | - | - |
| `users:update` | Update user fields (non-role) | org | - | - | - | org | - | - | - | - | - | - |
| `users:deactivate` | Deactivate user (triggers reassignment queue) | org | - | - | - | org | - | - | - | - | - | - |
| `users:role:assign` | Assign/revoke roles and secondary groups | org | - | - | - | org | - | - | - | - | - | - |
| `users:role:assign-sensitive` | Assign FOUNDER_CEO / HR / FINANCE roles (Founder only; tightening of `users:role:assign`, DEC-032, owner may relax) | org | - | - | - | - | - | - | - | - | - | - |
| `users:delegation:manage` | Grant time-bound team delegation | org | org | - | - | - | - | - | - | - | - | - |
| `teams:view` | View teams | org | org | team | own | org | - | summary | - | - | - | - |
| `teams:create` | Create team | org | - | - | - | org | - | - | - | - | - | - |
| `teams:update` | Update team and membership | org | org | - | - | org | - | - | - | - | - | - |
| `teams:delete` | Delete team (empty only) | - | - | - | - | org | - | - | - | - | - | - |
| `audit:view` | View audit logs | org | team | team | - | org | - | - | - | - | - | - |
| `audit:export` | Export audit logs | org | - | - | - | org | - | - | - | - | - | - |
| `settings:view` | View org settings | org | org | - | - | org | - | - | - | - | - | - |
| `settings:update` | Update org settings (stages, rules, thresholds) | org | org | - | - | org | - | - | - | - | - | - |
| `settings:policy:approve` | Approve sensitive policy change | org | - | - | - | - | - | - | - | - | - | - |

## leads - CRM

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `leads:view` | View leads | org | org | team | own | - | - | - | summary | - | - | summary |
| `leads:create` | Create lead | org | org | team | own | - | - | - | - | - | - | - |
| `leads:update` | Update lead fields | org | org | team | own | - | - | - | - | - | - | - |
| `leads:delete` | Delete/anonymise lead | org | - | - | - | - | - | - | - | - | - | - |
| `leads:assign` | Assign/reassign lead | org | org | team | - | - | - | - | - | - | - | - |
| `leads:status:change` | Change stage/status | org | org | team | own | - | - | - | - | - | - | - |
| `leads:import` | CSV import leads | org | org | team | - | org | - | - | - | - | - | - |
| `leads:export` | Export leads | org | org | team | - | - | - | - | - | - | - | - |
| `leads:duplicates:review` | Review/merge duplicates | org | org | team | - | - | - | - | - | - | - | - |
| `leads:exceptions:view` | View exception and reassignment queue | org | org | team | own | - | - | - | - | - | - | - |
| `leads:reassignment-queue:resolve` | Resolve reassignment queue entries | org | org | team | - | - | - | - | - | - | - | - |
| `leads:reactivation:view` | View lost-lead reactivation queue | org | org | team | own | - | - | - | - | - | - | - |
| `leads:timeline:view` | View lead timeline | org | org | team | own | - | - | - | - | - | - | - |
| `leads:notes:create` | Add notes | org | org | team | own | - | - | - | - | - | - | - |
| `leads:notes:view-private` | View private notes of others | org | org | team | - | - | - | - | - | - | - | - |
| `calls:view` | View call logs | org | org | team | own | - | - | - | - | - | - | - |
| `calls:create` | Log call disposition | org | org | team | own | - | - | - | - | - | - | - |
| `calls:update` | Edit call log within edit window (audited) | org | org | team | own | - | - | - | - | - | - | - |
| `calls:export` | Export call logs | org | org | team | - | - | - | - | - | - | - | - |
| `tasks:view` | View tasks | org | org | team | own | - | - | - | - | - | - | - |
| `tasks:create` | Create/schedule task | org | org | team | own | - | - | - | - | - | - | - |
| `tasks:update` | Update/complete task | org | org | team | own | - | - | - | - | - | - | - |
| `tasks:reassign` | Reassign tasks | org | org | team | - | - | - | - | - | - | - | - |
| `sources:view` | View lead sources/campaigns | org | org | team | own | - | - | - | org | - | - | - |
| `sources:manage` | Manage sources/campaigns/programs | org | org | - | - | org | - | - | org | - | - | - |
| `programs:view` | View programs | org | org | org | org | org | org | org | org | org | org | org |
| `programs:manage` | Manage programs and pricing versions | org | org | - | - | org | org | - | - | - | - | - |
| `events:view` | View webinars/events/demos | org | org | team | own | - | - | - | org | org | org | - |
| `events:manage` | Create/update events, record attendance | org | org | team | - | - | - | - | org | org | org | - |
| `integrations:manage` | Manage integrations, webhooks, devices | org | - | - | - | org | - | - | - | - | - | - |
| `devices:register` | Register companion device | own | own | own | own | - | - | - | - | - | - | - |

## revenue - Targets, deals, collections

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `targets:view` | View targets | org | org | team | own | - | summary | - | - | - | - | - |
| `targets:create` | Create/allocate targets | org | org | team | - | - | - | - | - | - | - | - |
| `targets:update` | Revise targets (reason required) | org | org | - | - | - | - | - | - | - | - | - |
| `targets:approve` | Approve target revision | org | org | - | - | - | - | - | - | - | - | - |
| `deals:view` | View deals | org | org | team | own | - | org | - | - | - | - | summary |
| `deals:create` | Create deal | org | org | team | own | - | - | - | - | - | - | - |
| `deals:update` | Update deal | org | org | team | own | - | - | - | - | - | - | - |
| `deals:close` | Close won/lost | org | org | team | own | - | - | - | - | - | - | - |
| `deals:escalate` | Escalate high-value deal | org | org | team | own | - | - | - | - | - | - | - |
| `deals:export` | Export deals | org | org | team | - | - | org | - | - | - | - | - |
| `sales-adjustments:create` | Create sale adjustment record | org | org | - | - | - | org | - | - | - | - | - |
| `collections:view` | View payments/collections | org | org | team | own | - | org | - | - | - | - | - |
| `collections:create` | Record payment | org | org | team | - | - | org | - | - | - | - | - |
| `collections:verify` | Verify payment (Finance permission) | - | - | - | - | - | org | - | - | - | - | - |
| `collections:reconcile` | Run/approve reconciliation | org | - | - | - | - | org | - | - | - | - | - |
| `collections:export` | Export collections | org | org | - | - | - | org | - | - | - | - | - |
| `refunds:view` | View refunds | org | org | team | own | - | org | - | - | - | - | summary |
| `refunds:request` | Request refund | org | org | team | own | - | - | - | - | - | - | org |
| `refunds:review` | Review refund request | org | org | team | - | - | org | - | - | - | - | - |
| `refunds:approve` | Approve/reject refund | org | - | - | - | - | org | - | - | - | - | - |
| `refunds:process` | Mark refund processed | - | - | - | - | - | org | - | - | - | - | - |
| `refunds:reconcile` | Reconcile refund | - | - | - | - | - | org | - | - | - | - | - |
| `forecasts:view` | View forecasts | org | org | team | - | - | summary | - | - | - | - | - |
| `forecasts:create` | Create forecast snapshot | org | org | team | - | - | - | - | - | - | - | - |
| `proposals:view` | View pricing/offer proposals | org | org | - | - | - | org | - | - | - | - | - |
| `proposals:create` | Create proposal | org | org | - | - | - | - | - | - | - | - | - |
| `proposals:approve` | Approve/reject proposal | org | - | - | - | - | - | - | - | - | - | - |
| `market-intel:view` | View market/competitor/learner feedback log | org | org | team | own | - | - | - | org | org | - | org |
| `market-intel:create` | Add feedback/opportunity entries | org | org | team | own | - | - | - | org | org | - | org |

## analytics - Dashboards and reports

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `dashboard:ceo:view` | Founder dashboard | org | - | - | - | - | - | - | - | - | - | - |
| `dashboard:team-lead:view` | Team Lead dashboard | - | org | - | - | - | - | - | - | - | - | - |
| `dashboard:manager:view` | Manager dashboard | - | org | team | - | - | - | - | - | - | - | - |
| `dashboard:salesperson:view` | Personal dashboard | own | own | own | own | - | - | - | - | - | - | - |
| `dashboard:system-health:view` | System health dashboard (no business data) | org | - | - | - | org | - | - | - | - | - | - |
| `kpi:view` | View KPI values in scope | org | org | team | own | - | summary | summary | summary | - | - | summary |
| `kpi:definitions:view` | View KPI dictionary | org | org | org | org | org | org | org | org | org | org | org |
| `reports:view` | Run follow-up/conversion reports | org | org | team | own | - | - | - | summary | - | - | - |
| `reports:export` | Export reports (CSV/XLSX, audited) | org | org | team | - | - | org | - | - | - | - | - |

## sop - SOP centre

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `sop:view` | View effective SOPs | org | org | org | org | org | org | org | org | org | org | org |
| `sop:create` | Create/edit SOP draft | - | org | - | - | - | - | - | - | - | - | - |
| `sop:approve` | Approve/publish SOP version | org | org | - | - | - | - | - | - | - | - | - |
| `sop:acknowledge` | Acknowledge SOP version | own | own | own | own | own | own | own | own | own | own | own |
| `sop:adoption:view` | View acknowledgement/adoption tracking | org | org | team | own | - | - | - | - | - | - | - |
| `sop:gaps:view` | View process-gap backlog | org | org | team | - | - | - | - | - | - | - | - |
| `sop:gaps:manage` | Manage process-gap backlog | - | org | team | - | - | - | - | - | - | - | - |

## people - Coaching, reviews, HR

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `coaching:view` | View coaching sessions/1:1s | org | org | team | own | - | - | org | - | - | - | - |
| `coaching:create` | Record coaching session/1:1 | - | org | team | - | - | - | - | - | - | - | - |
| `coaching:update` | Update coaching records and actions | - | org | team | - | - | - | - | - | - | - | - |
| `kpi-assignments:view` | View KPI/KRA assignments | org | org | team | own | - | - | org | - | - | - | - |
| `kpi-assignments:manage` | Assign weekly KPI/KRA | - | org | team | - | - | - | - | - | - | - | - |
| `scorecards:view` | View scorecards | org | org | team | own | - | - | org | - | - | - | - |
| `reviews:view` | View performance reviews | org | org | team | own | - | - | org | - | - | - | - |
| `reviews:create` | Conduct review | - | org | team | - | - | - | org | - | - | - | - |
| `reviews:approve` | Finalise/approve review | org | org | - | - | - | - | org | - | - | - | - |
| `pip:view` | View improvement plans | org | org | team | own | - | - | org | - | - | - | - |
| `pip:create` | Create PIP | - | org | - | - | - | - | org | - | - | - | - |
| `pip:propose` | Propose a PIP for an employee in own team (DRAFT for Team Lead / HR to take forward; Phase 10 gap closure, KI-J-02 default) | - | - | team | - | - | - | - | - | - | - | - |
| `pip:update` | Update PIP progress | - | org | team | - | - | - | org | - | - | - | - |
| `pip:approve` | Approve PIP start/close | org | - | - | - | - | - | org | - | - | - | - |
| `recognition:view` | View recognitions | org | org | team | own | - | - | org | - | - | - | - |
| `recognition:create` | Grant recognition | org | org | team | - | - | - | - | - | - | - | - |
| `incentives:policy:view` | View incentive policy | org | org | team | own | - | org | org | - | - | - | - |
| `incentives:policy:manage` | Create/version incentive policy (draft) | org | org | - | - | - | - | - | - | - | - | - |
| `incentives:policy:approve` | Approve incentive policy | org | - | - | - | - | - | - | - | - | - | - |
| `incentives:recommendation:view` | View recommendations | org | org | team | own | - | org | org | - | - | - | - |
| `incentives:recommendation:create` | Create/submit recommendation | - | org | team | - | - | - | - | - | - | - | - |
| `incentives:recommendation:approve` | Approve recommendation | org | - | - | - | - | - | - | - | - | - | - |
| `incentives:recommendation:mark-paid` | Mark paid | - | - | - | - | - | org | - | - | - | - | - |
| `hiring:view` | View hiring pipeline | org | org | team | - | - | - | org | - | - | - | - |
| `hiring:manage` | Manage requisitions/candidates | - | org | team | - | - | - | org | - | - | - | - |
| `onboarding:view` | View onboarding/training/probation | org | org | team | own | - | - | org | - | - | - | - |
| `onboarding:manage` | Manage onboarding/probation | - | org | team | - | - | - | org | - | - | - | - |
| `succession:view` | View succession bench | org | org | - | - | - | - | org | - | - | - | - |
| `succession:manage` | Manage succession bench | org | org | - | - | - | - | org | - | - | - | - |
| `hr:records:view` | View sensitive HR records (employee profiles) | - | - | - | - | - | - | org | - | - | - | - |
| `hr:records:manage` | Edit sensitive HR records | - | - | - | - | - | - | org | - | - | - | - |
| `resources:view` | View coaching resource library | org | org | org | org | org | org | org | org | org | org | org |
| `resources:manage` | Manage resource library | - | org | - | - | - | - | org | - | - | - | - |
| `engagement:respond` | Submit pulse survey response | own | own | own | own | own | own | own | own | own | own | own |
| `engagement:view` | View aggregated engagement results | org | org | team | - | - | - | org | - | - | - | - |

## cx - Complaints, handover, collaboration, founder

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `complaints:view` | View complaints | org | org | team | own | - | - | - | - | - | - | org |
| `complaints:create` | Log complaint/escalation | org | org | team | own | - | - | - | - | - | - | org |
| `complaints:update` | Update/resolve complaint | org | org | team | own | - | - | - | - | - | - | org |
| `complaints:export` | Export complaints | org | org | - | - | - | - | - | - | - | - | - |
| `satisfaction:view` | View satisfaction/enrolment-experience scores | org | org | team | own | - | - | - | - | - | - | org |
| `satisfaction:create` | Record satisfaction/enrolment feedback | org | org | team | own | - | - | - | - | - | - | org |
| `relationships:view` | View learner/prospect relationship history | org | org | team | own | - | - | - | - | - | - | summary |
| `relationships:update` | Add relationship notes; manage own key-prospect watchlist (Phase 7 addition) | org | org | team | own | - | - | - | - | - | - | - |
| `handover:view` | View handovers | org | org | team | own | - | - | - | - | - | summary | org |
| `handover:create` | Create/submit handover | org | org | team | own | - | - | - | - | - | - | - |
| `handover:acknowledge` | Acknowledge/accept/reject handover | - | - | - | - | - | - | - | - | - | - | org |
| `xf-tasks:view` | View cross-functional tasks | org | org | team | own | - | - | - | org | org | org | org |
| `xf-tasks:create` | Create cross-functional task | org | org | team | - | - | - | - | org | org | org | org |
| `xf-tasks:update` | Update/complete cross-functional task | org | org | team | - | - | - | - | org | org | org | org |
| `founder-reports:view` | View founder reports/snapshots | org | org | - | - | - | - | - | - | - | - | - |
| `founder-reports:create` | Build/submit founder report | org | org | - | - | - | - | - | - | - | - | - |
| `founder-reports:review` | Review/rate founder report | org | - | - | - | - | - | - | - | - | - | - |
| `action-items:view` | View action items | org | org | team | own | - | - | - | - | - | - | - |
| `action-items:create` | Create action item | org | org | team | - | - | - | - | - | - | - | - |
| `action-items:update` | Update/complete action item (own or scoped) | org | org | team | own | - | - | - | - | - | - | - |
| `insights:share` | Share learner/market insights | org | org | team | own | - | - | - | org | org | org | org |

## platform - Notifications, files, imports, AI

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `notifications:view` | View own notifications | own | own | own | own | own | own | own | own | own | own | own |
| `notifications:manage-prefs` | Manage own preferences | own | own | own | own | own | own | own | own | own | own | own |
| `notifications:config` | Configure notification rules/quiet hours | org | org | - | - | org | - | - | - | - | - | - |
| `files:upload` | Upload file | org | org | team | own | org | org | org | org | org | org | org |
| `files:view` | View/download file in scope | org | org | team | own | - | summary | summary | summary | summary | summary | summary |
| `files:delete` | Delete file (audited) | org | org | team | own | org | - | - | - | - | - | - |
| `imports:view` | View import jobs/errors | org | org | team | - | org | - | - | - | - | - | - |
| `imports:manage` | Retry/cancel import jobs | org | - | - | - | org | - | - | - | - | - | - |
| `jobs:dlq:view` | View dead-letter jobs | - | - | - | - | org | - | - | - | - | - | - |
| `jobs:dlq:retry` | Retry dead-letter jobs | - | - | - | - | org | - | - | - | - | - | - |
| `ai:use` | Use AI Copilot (flag on) | org | org | team | own | - | - | - | - | - | - | - |
| `ai:config` | Configure AI provider/flag | org | - | - | - | org | - | - | - | - | - | - |
| `ai:usage:view` | View AI usage and cost | org | org | - | - | org | - | - | - | - | - | - |

## workforce - Attendance, leave, goals, work tasks, payroll, directory (DEC-048)

| Permission key | Action | F | TL | MG | EX | AD | FIN | HR | MKT | COM | OPS | SS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `attendance:self` | Check in/out and view own attendance | own | own | own | own | own | own | own | own | own | own | own |
| `attendance:view` | View attendance (own / team / organisation) | org | team | team | own | own | own | org | own | own | own | own |
| `attendance:correct` | Correct an attendance record with a reason (audited with old/new value) | org | team | team | - | - | - | org | - | - | - | - |
| `holidays:view` | View the holiday calendar | org | org | org | org | org | org | org | org | org | org | org |
| `holidays:manage` | Create/approve/edit holidays and generate suggestions | org | - | - | - | - | - | org | - | - | - | - |
| `leave:apply` | Apply for / cancel own leave | own | own | own | own | own | own | own | own | own | own | own |
| `leave:view` | View leave requests and balances (own / team / organisation) | org | team | team | own | own | own | org | own | own | own | own |
| `leave:approve` | Approve/reject leave at the manager step | org | team | team | - | - | - | - | - | - | - | - |
| `leave:approve-hr` | Approve/reject leave at the HR step | org | - | - | - | - | - | org | - | - | - | - |
| `leave:balance:adjust` | Adjust a leave balance (opening balance, correction); always audited | org | - | - | - | - | - | org | - | - | - | - |
| `workforce:settings:view` | View workforce policy (leave types, Earned Leave, attendance, goals, payroll) | org | - | - | - | - | - | org | - | - | - | - |
| `workforce:settings:manage` | Change workforce policy; every change is logged with user and time | org | - | - | - | - | - | org | - | - | - | - |
| `goals:view` | View goals (own / team / organisation) | org | team | team | own | own | own | org | own | own | own | own |
| `goals:create` | Create a goal (own scope = for yourself; team/org = assign to others) | org | team | team | own | own | own | own | own | own | own | own |
| `goals:update` | Update goal progress, milestones and submit for verification | org | team | team | own | own | own | own | own | own | own | own |
| `goals:review` | Comment on, verify or return a goal | org | team | team | - | - | - | - | - | - | - | - |
| `work-tasks:view` | View work tasks (own / team / organisation) | org | team | team | own | own | own | org | own | own | own | own |
| `work-tasks:create` | Create a work task (own = for yourself; team = assign to team members; org = assign to anyone) | org | team | team | own | own | own | org | own | own | own | own |
| `work-tasks:update` | Update/accept/progress/review a work task you are part of (assignee or assigner), or in scope | org | team | team | own | own | own | org | own | own | own | own |
| `directory:view` | Employee directory, global search and organisation chart (name, designation, department, manager, status) | org | org | org | org | org | org | org | org | org | org | org |
| `birthdays:view` | View upcoming birthdays of all employees (date of birth is HR data) | org | - | - | - | - | - | org | - | - | - | - |
| `workforce:dashboard:view` | Workforce dashboards: employee (own), manager (team), HR / Boss (organisation) | org | team | team | own | own | own | org | own | own | own | own |
| `workforce:reports:view` | Attendance, leave, Earned Leave, task, goal, holiday, probation and birthday reports | org | team | team | - | - | - | org | - | - | - | - |
| `workforce:reports:export` | Export workforce reports (CSV/XLSX, audited) | org | - | - | - | - | - | org | - | - | - | - |
| `announcements:view` | View company announcements | org | org | org | org | org | org | org | org | org | org | org |
| `announcements:manage` | Publish company announcements | org | - | - | - | - | - | org | - | - | - | - |
| `payroll:structure:view` | View salary structures | org | - | - | - | - | org | org | - | - | - | - |
| `payroll:structure:manage` | Create salary structure versions for employees | - | - | - | - | - | org | org | - | - | - | - |
| `payroll:run:view` | View payroll runs and all payslips | org | - | - | - | - | org | org | - | - | - | - |
| `payroll:run:manage` | Create a payroll run, calculate it from attendance/leave, add adjustment lines before approval | - | - | - | - | - | org | org | - | - | - | - |
| `payroll:run:approve` | Approve or send back a calculated payroll run | org | - | - | - | - | - | - | - | - | - | - |
| `payroll:run:mark-paid` | Record that an approved run was paid externally (payout reference); SalesOS never moves money | - | - | - | - | - | org | - | - | - | - | - |
| `payroll:payslip:view` | View own payslips | own | own | own | own | own | own | own | own | own | own | own |

## Action coverage (view/create/update/delete/export/approve)

| Module | view | create | update | delete | export | approve |
|---|---|---|---|---|---|---|
| leads | leads:view | leads:create | leads:update, leads:assign, leads:status:change | leads:delete (anonymise) | leads:export | - |
| calls | calls:view | calls:create | calls:update | not allowed (immutable log; edits audited) | calls:export | - |
| tasks | tasks:view | tasks:create | tasks:update, tasks:reassign | not allowed (cancel instead) | reports:export | - |
| targets | targets:view | targets:create | targets:update | not allowed (revision history) | reports:export | targets:approve |
| deals/sales | deals:view | deals:create | deals:update, deals:close | not allowed (adjustment records) | deals:export | proposals:approve |
| collections | collections:view | collections:create | collections:verify | not allowed | collections:export | collections:reconcile |
| refunds | refunds:view | refunds:request | refunds:review, refunds:process | not allowed | collections:export | refunds:approve |
| sop | sop:view | sop:create | sop:create (new version) | not allowed (retire) | - | sop:approve |
| coaching/reviews | coaching:view, reviews:view | coaching:create, reviews:create | coaching:update | not allowed | - | reviews:approve |
| pip | pip:view | pip:create | pip:update | not allowed | - | pip:approve |
| incentives | incentives:*:view | incentives:recommendation:create | incentives:policy:manage | not allowed | - | incentives:recommendation:approve, incentives:policy:approve |
| hiring/HR | hiring:view, hr:records:view | hiring:manage | hr:records:manage | not allowed | - | - |
| complaints | complaints:view | complaints:create | complaints:update | not allowed | complaints:export | - |
| handover | handover:view | handover:create | handover:acknowledge | not allowed | - | handover:acknowledge |
| founder reports | founder-reports:view | founder-reports:create | action-items:update | not allowed (snapshots immutable) | - | founder-reports:review |
| users/teams | users:view, teams:view | users:create, teams:create | users:update, teams:update | users:deactivate, teams:delete | - | - |
| files | files:view | files:upload | - | files:delete | - | - |
| audit | audit:view | system only | not allowed | not allowed | audit:export | - |

## Authorization test requirements (Phase 2 onward)

1. Every key has at least one allow test and one deny test per role that lacks it.
2. Cross-team, cross-organization, sibling-manager, executive-to-executive, Admin-without-HR/Finance and deactivated-user session are explicit negative tests.
3. Scope tests per resource: own vs team vs org must return identical 404/403 behaviour (IDOR-safe: prefer 404 for out-of-scope records).
4. Secondary groups: Finance sees collections/refunds but not coaching/HR; HR sees HR/reviews/PIP but not collections; Marketing/Community/Operations/Student Success see only `summary` projections of leads/deals plus their own cross-functional tasks.

## Machine-readable appendix

Generated from the code catalogue (the source of truth) by `pnpm --filter @salesos/api permissions:matrix`; `apps/api/test/catalogue-matrix.spec.ts` fails when it drifts. Do not edit the JSON by hand.

Format: `role -> ["permission@scope", ...]`. Scope values: `org`, `team`, `own`, `summary`. The api agent loads this as the seed for roles/permissions; secondary groups are additive.

```json
{
 "version": 1,
 "date": "2026-10-14",
 "roles": {
  "FOUNDER_CEO": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "users:view@org",
   "users:create@org",
   "users:update@org",
   "users:deactivate@org",
   "users:role:assign@org",
   "users:delegation:manage@org",
   "teams:view@org",
   "teams:create@org",
   "teams:update@org",
   "audit:view@org",
   "audit:export@org",
   "settings:view@org",
   "settings:update@org",
   "settings:policy:approve@org",
   "users:role:assign-sensitive@org",
   "leads:view@org",
   "leads:create@org",
   "leads:update@org",
   "leads:delete@org",
   "leads:assign@org",
   "leads:status:change@org",
   "leads:import@org",
   "leads:export@org",
   "leads:duplicates:review@org",
   "leads:exceptions:view@org",
   "leads:reassignment-queue:resolve@org",
   "leads:reactivation:view@org",
   "leads:timeline:view@org",
   "leads:notes:create@org",
   "leads:notes:view-private@org",
   "calls:view@org",
   "calls:create@org",
   "calls:update@org",
   "calls:export@org",
   "tasks:view@org",
   "tasks:create@org",
   "tasks:update@org",
   "tasks:reassign@org",
   "sources:view@org",
   "sources:manage@org",
   "programs:view@org",
   "programs:manage@org",
   "events:view@org",
   "events:manage@org",
   "targets:view@org",
   "targets:create@org",
   "targets:update@org",
   "targets:approve@org",
   "deals:view@org",
   "deals:create@org",
   "deals:update@org",
   "deals:close@org",
   "deals:escalate@org",
   "deals:export@org",
   "sales-adjustments:create@org",
   "collections:view@org",
   "collections:create@org",
   "collections:reconcile@org",
   "collections:export@org",
   "refunds:view@org",
   "refunds:request@org",
   "refunds:review@org",
   "refunds:approve@org",
   "forecasts:view@org",
   "forecasts:create@org",
   "proposals:view@org",
   "proposals:create@org",
   "proposals:approve@org",
   "market-intel:view@org",
   "market-intel:create@org",
   "coaching:view@org",
   "kpi-assignments:view@org",
   "scorecards:view@org",
   "reviews:view@org",
   "reviews:approve@org",
   "pip:view@org",
   "pip:approve@org",
   "recognition:view@org",
   "recognition:create@org",
   "incentives:policy:view@org",
   "incentives:policy:manage@org",
   "incentives:policy:approve@org",
   "incentives:recommendation:view@org",
   "incentives:recommendation:approve@org",
   "hiring:view@org",
   "onboarding:view@org",
   "succession:view@org",
   "succession:manage@org",
   "resources:view@org",
   "engagement:respond@own",
   "engagement:view@org",
   "complaints:view@org",
   "complaints:create@org",
   "complaints:update@org",
   "complaints:export@org",
   "satisfaction:view@org",
   "satisfaction:create@org",
   "relationships:view@org",
   "relationships:update@org",
   "handover:view@org",
   "handover:create@org",
   "founder-reports:view@org",
   "founder-reports:create@org",
   "founder-reports:review@org",
   "action-items:view@org",
   "action-items:create@org",
   "action-items:update@org",
   "insights:share@org",
   "sop:view@org",
   "sop:approve@org",
   "sop:acknowledge@own",
   "sop:adoption:view@org",
   "sop:gaps:view@org",
   "xf-tasks:view@org",
   "xf-tasks:create@org",
   "xf-tasks:update@org",
   "dashboard:ceo:view@org",
   "dashboard:salesperson:view@own",
   "dashboard:system-health:view@org",
   "kpi:view@org",
   "kpi:definitions:view@org",
   "reports:view@org",
   "reports:export@org",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "notifications:config@org",
   "files:upload@org",
   "files:view@org",
   "files:delete@org",
   "imports:view@org",
   "imports:manage@org",
   "integrations:manage@org",
   "ai:use@org",
   "ai:config@org",
   "ai:usage:view@org",
   "devices:register@own",
   "attendance:self@own",
   "attendance:view@org",
   "attendance:correct@org",
   "holidays:view@org",
   "holidays:manage@org",
   "leave:apply@own",
   "leave:view@org",
   "leave:approve@org",
   "leave:approve-hr@org",
   "leave:balance:adjust@org",
   "workforce:settings:view@org",
   "workforce:settings:manage@org",
   "goals:view@org",
   "goals:create@org",
   "goals:update@org",
   "goals:review@org",
   "work-tasks:view@org",
   "work-tasks:create@org",
   "work-tasks:update@org",
   "directory:view@org",
   "birthdays:view@org",
   "workforce:dashboard:view@org",
   "workforce:reports:view@org",
   "workforce:reports:export@org",
   "announcements:view@org",
   "announcements:manage@org",
   "payroll:structure:view@org",
   "payroll:run:view@org",
   "payroll:run:approve@org",
   "payroll:payslip:view@own"
  ],
  "SALES_TEAM_LEAD": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "users:view@org",
   "users:delegation:manage@org",
   "teams:view@org",
   "teams:update@org",
   "audit:view@team",
   "settings:view@org",
   "settings:update@org",
   "leads:view@org",
   "leads:create@org",
   "leads:update@org",
   "leads:assign@org",
   "leads:status:change@org",
   "leads:import@org",
   "leads:export@org",
   "leads:duplicates:review@org",
   "leads:exceptions:view@org",
   "leads:reassignment-queue:resolve@org",
   "leads:reactivation:view@org",
   "leads:timeline:view@org",
   "leads:notes:create@org",
   "leads:notes:view-private@org",
   "calls:view@org",
   "calls:create@org",
   "calls:update@org",
   "calls:export@org",
   "tasks:view@org",
   "tasks:create@org",
   "tasks:update@org",
   "tasks:reassign@org",
   "sources:view@org",
   "sources:manage@org",
   "programs:view@org",
   "programs:manage@org",
   "events:view@org",
   "events:manage@org",
   "targets:view@org",
   "targets:create@org",
   "targets:update@org",
   "targets:approve@org",
   "deals:view@org",
   "deals:create@org",
   "deals:update@org",
   "deals:close@org",
   "deals:escalate@org",
   "deals:export@org",
   "sales-adjustments:create@org",
   "collections:view@org",
   "collections:create@org",
   "collections:export@org",
   "refunds:view@org",
   "refunds:request@org",
   "refunds:review@org",
   "forecasts:view@org",
   "forecasts:create@org",
   "proposals:view@org",
   "proposals:create@org",
   "market-intel:view@org",
   "market-intel:create@org",
   "coaching:view@org",
   "coaching:create@org",
   "coaching:update@org",
   "kpi-assignments:view@org",
   "kpi-assignments:manage@org",
   "scorecards:view@org",
   "reviews:view@org",
   "reviews:create@org",
   "reviews:approve@org",
   "pip:view@org",
   "pip:create@org",
   "pip:update@org",
   "recognition:view@org",
   "recognition:create@org",
   "incentives:policy:view@org",
   "incentives:policy:manage@org",
   "incentives:recommendation:view@org",
   "incentives:recommendation:create@org",
   "hiring:view@org",
   "hiring:manage@org",
   "onboarding:view@org",
   "onboarding:manage@org",
   "succession:view@org",
   "succession:manage@org",
   "resources:view@org",
   "resources:manage@org",
   "engagement:respond@own",
   "engagement:view@org",
   "complaints:view@org",
   "complaints:create@org",
   "complaints:update@org",
   "complaints:export@org",
   "satisfaction:view@org",
   "satisfaction:create@org",
   "relationships:view@org",
   "relationships:update@org",
   "handover:view@org",
   "handover:create@org",
   "founder-reports:view@org",
   "founder-reports:create@org",
   "action-items:view@org",
   "action-items:create@org",
   "action-items:update@org",
   "insights:share@org",
   "sop:view@org",
   "sop:create@org",
   "sop:approve@org",
   "sop:acknowledge@own",
   "sop:adoption:view@org",
   "sop:gaps:view@org",
   "sop:gaps:manage@org",
   "xf-tasks:view@org",
   "xf-tasks:create@org",
   "xf-tasks:update@org",
   "dashboard:team-lead:view@org",
   "dashboard:manager:view@org",
   "dashboard:salesperson:view@own",
   "kpi:view@org",
   "kpi:definitions:view@org",
   "reports:view@org",
   "reports:export@org",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "notifications:config@org",
   "files:upload@org",
   "files:view@org",
   "files:delete@org",
   "imports:view@org",
   "ai:use@org",
   "ai:usage:view@org",
   "devices:register@own",
   "attendance:self@own",
   "attendance:view@team",
   "attendance:correct@team",
   "holidays:view@org",
   "leave:apply@own",
   "leave:view@team",
   "leave:approve@team",
   "goals:view@team",
   "goals:create@team",
   "goals:update@team",
   "goals:review@team",
   "work-tasks:view@team",
   "work-tasks:create@team",
   "work-tasks:update@team",
   "directory:view@org",
   "workforce:dashboard:view@team",
   "workforce:reports:view@team",
   "announcements:view@org",
   "payroll:payslip:view@own"
  ],
  "SALES_MANAGER": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "users:view@team",
   "teams:view@team",
   "audit:view@team",
   "leads:view@team",
   "leads:create@team",
   "leads:update@team",
   "leads:assign@team",
   "leads:status:change@team",
   "leads:import@team",
   "leads:export@team",
   "leads:duplicates:review@team",
   "leads:exceptions:view@team",
   "leads:reassignment-queue:resolve@team",
   "leads:reactivation:view@team",
   "leads:timeline:view@team",
   "leads:notes:create@team",
   "leads:notes:view-private@team",
   "calls:view@team",
   "calls:create@team",
   "calls:update@team",
   "calls:export@team",
   "tasks:view@team",
   "tasks:create@team",
   "tasks:update@team",
   "tasks:reassign@team",
   "sources:view@team",
   "programs:view@org",
   "events:view@team",
   "events:manage@team",
   "targets:view@team",
   "targets:create@team",
   "deals:view@team",
   "deals:create@team",
   "deals:update@team",
   "deals:close@team",
   "deals:escalate@team",
   "deals:export@team",
   "collections:view@team",
   "collections:create@team",
   "refunds:view@team",
   "refunds:request@team",
   "refunds:review@team",
   "forecasts:view@team",
   "forecasts:create@team",
   "market-intel:view@team",
   "market-intel:create@team",
   "coaching:view@team",
   "coaching:create@team",
   "coaching:update@team",
   "kpi-assignments:view@team",
   "kpi-assignments:manage@team",
   "scorecards:view@team",
   "reviews:view@team",
   "reviews:create@team",
   "pip:view@team",
   "pip:propose@team",
   "pip:update@team",
   "recognition:view@team",
   "recognition:create@team",
   "incentives:policy:view@team",
   "incentives:recommendation:view@team",
   "incentives:recommendation:create@team",
   "hiring:view@team",
   "hiring:manage@team",
   "onboarding:view@team",
   "onboarding:manage@team",
   "resources:view@org",
   "engagement:respond@own",
   "engagement:view@team",
   "complaints:view@team",
   "complaints:create@team",
   "complaints:update@team",
   "satisfaction:view@team",
   "satisfaction:create@team",
   "relationships:view@team",
   "relationships:update@team",
   "handover:view@team",
   "handover:create@team",
   "action-items:view@team",
   "action-items:create@team",
   "action-items:update@team",
   "insights:share@team",
   "sop:view@org",
   "sop:acknowledge@own",
   "sop:adoption:view@team",
   "sop:gaps:view@team",
   "sop:gaps:manage@team",
   "xf-tasks:view@team",
   "xf-tasks:create@team",
   "xf-tasks:update@team",
   "dashboard:manager:view@team",
   "dashboard:salesperson:view@own",
   "kpi:view@team",
   "kpi:definitions:view@org",
   "reports:view@team",
   "reports:export@team",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "files:upload@team",
   "files:view@team",
   "files:delete@team",
   "imports:view@team",
   "ai:use@team",
   "devices:register@own",
   "attendance:self@own",
   "attendance:view@team",
   "attendance:correct@team",
   "holidays:view@org",
   "leave:apply@own",
   "leave:view@team",
   "leave:approve@team",
   "goals:view@team",
   "goals:create@team",
   "goals:update@team",
   "goals:review@team",
   "work-tasks:view@team",
   "work-tasks:create@team",
   "work-tasks:update@team",
   "directory:view@org",
   "workforce:dashboard:view@team",
   "workforce:reports:view@team",
   "announcements:view@org",
   "payroll:payslip:view@own"
  ],
  "SALES_EXECUTIVE": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "users:view@own",
   "teams:view@own",
   "leads:view@own",
   "leads:create@own",
   "leads:update@own",
   "leads:status:change@own",
   "leads:exceptions:view@own",
   "leads:reactivation:view@own",
   "leads:timeline:view@own",
   "leads:notes:create@own",
   "calls:view@own",
   "calls:create@own",
   "calls:update@own",
   "tasks:view@own",
   "tasks:create@own",
   "tasks:update@own",
   "sources:view@own",
   "programs:view@org",
   "events:view@own",
   "targets:view@own",
   "deals:view@own",
   "deals:create@own",
   "deals:update@own",
   "deals:close@own",
   "deals:escalate@own",
   "collections:view@own",
   "refunds:view@own",
   "refunds:request@own",
   "market-intel:view@own",
   "market-intel:create@own",
   "coaching:view@own",
   "kpi-assignments:view@own",
   "scorecards:view@own",
   "reviews:view@own",
   "pip:view@own",
   "recognition:view@own",
   "incentives:policy:view@own",
   "incentives:recommendation:view@own",
   "onboarding:view@own",
   "resources:view@org",
   "engagement:respond@own",
   "complaints:view@own",
   "complaints:create@own",
   "complaints:update@own",
   "satisfaction:view@own",
   "satisfaction:create@own",
   "relationships:view@own",
   "relationships:update@own",
   "handover:view@own",
   "handover:create@own",
   "action-items:view@own",
   "action-items:update@own",
   "insights:share@own",
   "sop:view@org",
   "sop:acknowledge@own",
   "sop:adoption:view@own",
   "xf-tasks:view@own",
   "dashboard:salesperson:view@own",
   "kpi:view@own",
   "kpi:definitions:view@org",
   "reports:view@own",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "files:upload@own",
   "files:view@own",
   "files:delete@own",
   "ai:use@own",
   "devices:register@own",
   "attendance:self@own",
   "attendance:view@own",
   "holidays:view@org",
   "leave:apply@own",
   "leave:view@own",
   "goals:view@own",
   "goals:create@own",
   "goals:update@own",
   "work-tasks:view@own",
   "work-tasks:create@own",
   "work-tasks:update@own",
   "directory:view@org",
   "workforce:dashboard:view@own",
   "announcements:view@org",
   "payroll:payslip:view@own"
  ],
  "ADMIN": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "users:view@org",
   "users:create@org",
   "users:update@org",
   "users:deactivate@org",
   "users:role:assign@org",
   "teams:view@org",
   "teams:create@org",
   "teams:update@org",
   "teams:delete@org",
   "audit:view@org",
   "audit:export@org",
   "settings:view@org",
   "settings:update@org",
   "leads:import@org",
   "sources:manage@org",
   "programs:view@org",
   "programs:manage@org",
   "resources:view@org",
   "engagement:respond@own",
   "sop:view@org",
   "sop:acknowledge@own",
   "dashboard:system-health:view@org",
   "kpi:definitions:view@org",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "notifications:config@org",
   "files:upload@org",
   "files:delete@org",
   "imports:view@org",
   "imports:manage@org",
   "integrations:manage@org",
   "ai:config@org",
   "ai:usage:view@org",
   "jobs:dlq:view@org",
   "jobs:dlq:retry@org",
   "attendance:self@own",
   "attendance:view@own",
   "holidays:view@org",
   "leave:apply@own",
   "leave:view@own",
   "goals:view@own",
   "goals:create@own",
   "goals:update@own",
   "work-tasks:view@own",
   "work-tasks:create@own",
   "work-tasks:update@own",
   "directory:view@org",
   "workforce:dashboard:view@own",
   "announcements:view@org",
   "payroll:payslip:view@own"
  ],
  "FINANCE": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "programs:view@org",
   "programs:manage@org",
   "targets:view@summary",
   "deals:view@org",
   "deals:export@org",
   "sales-adjustments:create@org",
   "collections:view@org",
   "collections:create@org",
   "collections:verify@org",
   "collections:reconcile@org",
   "collections:export@org",
   "refunds:view@org",
   "refunds:review@org",
   "refunds:approve@org",
   "refunds:process@org",
   "refunds:reconcile@org",
   "forecasts:view@summary",
   "proposals:view@org",
   "incentives:policy:view@org",
   "incentives:recommendation:view@org",
   "incentives:recommendation:mark-paid@org",
   "resources:view@org",
   "engagement:respond@own",
   "sop:view@org",
   "sop:acknowledge@own",
   "kpi:view@summary",
   "kpi:definitions:view@org",
   "reports:export@org",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "files:upload@org",
   "files:view@summary",
   "attendance:self@own",
   "attendance:view@own",
   "holidays:view@org",
   "leave:apply@own",
   "leave:view@own",
   "goals:view@own",
   "goals:create@own",
   "goals:update@own",
   "work-tasks:view@own",
   "work-tasks:create@own",
   "work-tasks:update@own",
   "directory:view@org",
   "workforce:dashboard:view@own",
   "announcements:view@org",
   "payroll:structure:view@org",
   "payroll:structure:manage@org",
   "payroll:run:view@org",
   "payroll:run:manage@org",
   "payroll:run:mark-paid@org",
   "payroll:payslip:view@own"
  ],
  "HR": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "users:view@summary",
   "teams:view@summary",
   "programs:view@org",
   "coaching:view@org",
   "kpi-assignments:view@org",
   "scorecards:view@org",
   "reviews:view@org",
   "reviews:create@org",
   "reviews:approve@org",
   "pip:view@org",
   "pip:create@org",
   "pip:update@org",
   "pip:approve@org",
   "recognition:view@org",
   "incentives:policy:view@org",
   "incentives:recommendation:view@org",
   "hiring:view@org",
   "hiring:manage@org",
   "onboarding:view@org",
   "onboarding:manage@org",
   "succession:view@org",
   "succession:manage@org",
   "hr:records:view@org",
   "hr:records:manage@org",
   "resources:view@org",
   "resources:manage@org",
   "engagement:respond@own",
   "engagement:view@org",
   "sop:view@org",
   "sop:acknowledge@own",
   "kpi:view@summary",
   "kpi:definitions:view@org",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "files:upload@org",
   "files:view@summary",
   "attendance:self@own",
   "attendance:view@org",
   "attendance:correct@org",
   "holidays:view@org",
   "holidays:manage@org",
   "leave:apply@own",
   "leave:view@org",
   "leave:approve-hr@org",
   "leave:balance:adjust@org",
   "workforce:settings:view@org",
   "workforce:settings:manage@org",
   "goals:view@org",
   "goals:create@own",
   "goals:update@own",
   "work-tasks:view@org",
   "work-tasks:create@org",
   "work-tasks:update@org",
   "directory:view@org",
   "birthdays:view@org",
   "workforce:dashboard:view@org",
   "workforce:reports:view@org",
   "workforce:reports:export@org",
   "announcements:view@org",
   "announcements:manage@org",
   "payroll:structure:view@org",
   "payroll:structure:manage@org",
   "payroll:run:view@org",
   "payroll:run:manage@org",
   "payroll:payslip:view@own"
  ],
  "MARKETING": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "leads:view@summary",
   "sources:view@org",
   "sources:manage@org",
   "programs:view@org",
   "events:view@org",
   "events:manage@org",
   "market-intel:view@org",
   "market-intel:create@org",
   "resources:view@org",
   "engagement:respond@own",
   "insights:share@org",
   "sop:view@org",
   "sop:acknowledge@own",
   "xf-tasks:view@org",
   "xf-tasks:create@org",
   "xf-tasks:update@org",
   "kpi:view@summary",
   "kpi:definitions:view@org",
   "reports:view@summary",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "files:upload@org",
   "files:view@summary",
   "attendance:self@own",
   "attendance:view@own",
   "holidays:view@org",
   "leave:apply@own",
   "leave:view@own",
   "goals:view@own",
   "goals:create@own",
   "goals:update@own",
   "work-tasks:view@own",
   "work-tasks:create@own",
   "work-tasks:update@own",
   "directory:view@org",
   "workforce:dashboard:view@own",
   "announcements:view@org",
   "payroll:payslip:view@own"
  ],
  "COMMUNITY": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "programs:view@org",
   "events:view@org",
   "events:manage@org",
   "market-intel:view@org",
   "market-intel:create@org",
   "resources:view@org",
   "engagement:respond@own",
   "insights:share@org",
   "sop:view@org",
   "sop:acknowledge@own",
   "xf-tasks:view@org",
   "xf-tasks:create@org",
   "xf-tasks:update@org",
   "kpi:definitions:view@org",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "files:upload@org",
   "files:view@summary",
   "attendance:self@own",
   "attendance:view@own",
   "holidays:view@org",
   "leave:apply@own",
   "leave:view@own",
   "goals:view@own",
   "goals:create@own",
   "goals:update@own",
   "work-tasks:view@own",
   "work-tasks:create@own",
   "work-tasks:update@own",
   "directory:view@org",
   "workforce:dashboard:view@own",
   "announcements:view@org",
   "payroll:payslip:view@own"
  ],
  "OPERATIONS": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "programs:view@org",
   "events:view@org",
   "events:manage@org",
   "resources:view@org",
   "engagement:respond@own",
   "handover:view@summary",
   "insights:share@org",
   "sop:view@org",
   "sop:acknowledge@own",
   "xf-tasks:view@org",
   "xf-tasks:create@org",
   "xf-tasks:update@org",
   "kpi:definitions:view@org",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "files:upload@org",
   "files:view@summary",
   "attendance:self@own",
   "attendance:view@own",
   "holidays:view@org",
   "leave:apply@own",
   "leave:view@own",
   "goals:view@own",
   "goals:create@own",
   "goals:update@own",
   "work-tasks:view@own",
   "work-tasks:create@own",
   "work-tasks:update@own",
   "directory:view@org",
   "workforce:dashboard:view@own",
   "announcements:view@org",
   "payroll:payslip:view@own"
  ],
  "STUDENT_SUCCESS": [
   "auth:login@org",
   "auth:me:view@own",
   "auth:session:revoke-own@own",
   "leads:view@summary",
   "programs:view@org",
   "deals:view@summary",
   "refunds:view@summary",
   "refunds:request@org",
   "market-intel:view@org",
   "market-intel:create@org",
   "resources:view@org",
   "engagement:respond@own",
   "complaints:view@org",
   "complaints:create@org",
   "complaints:update@org",
   "satisfaction:view@org",
   "satisfaction:create@org",
   "relationships:view@summary",
   "handover:view@org",
   "handover:acknowledge@org",
   "insights:share@org",
   "sop:view@org",
   "sop:acknowledge@own",
   "xf-tasks:view@org",
   "xf-tasks:create@org",
   "xf-tasks:update@org",
   "kpi:view@summary",
   "kpi:definitions:view@org",
   "notifications:view@own",
   "notifications:manage-prefs@own",
   "files:upload@org",
   "files:view@summary",
   "attendance:self@own",
   "attendance:view@own",
   "holidays:view@org",
   "leave:apply@own",
   "leave:view@own",
   "goals:view@own",
   "goals:create@own",
   "goals:update@own",
   "work-tasks:view@own",
   "work-tasks:create@own",
   "work-tasks:update@own",
   "directory:view@org",
   "workforce:dashboard:view@own",
   "announcements:view@org",
   "payroll:payslip:view@own"
  ]
 },
 "allKeys": [
  "auth:login",
  "auth:me:view",
  "auth:session:revoke-own",
  "users:view",
  "users:create",
  "users:update",
  "users:deactivate",
  "users:role:assign",
  "users:delegation:manage",
  "teams:view",
  "teams:create",
  "teams:update",
  "teams:delete",
  "audit:view",
  "audit:export",
  "settings:view",
  "settings:update",
  "settings:policy:approve",
  "users:role:assign-sensitive",
  "leads:view",
  "leads:create",
  "leads:update",
  "leads:delete",
  "leads:assign",
  "leads:status:change",
  "leads:import",
  "leads:export",
  "leads:duplicates:review",
  "leads:exceptions:view",
  "leads:reassignment-queue:resolve",
  "leads:reactivation:view",
  "leads:timeline:view",
  "leads:notes:create",
  "leads:notes:view-private",
  "calls:view",
  "calls:create",
  "calls:update",
  "calls:export",
  "tasks:view",
  "tasks:create",
  "tasks:update",
  "tasks:reassign",
  "sources:view",
  "sources:manage",
  "programs:view",
  "programs:manage",
  "events:view",
  "events:manage",
  "targets:view",
  "targets:create",
  "targets:update",
  "targets:approve",
  "deals:view",
  "deals:create",
  "deals:update",
  "deals:close",
  "deals:escalate",
  "deals:export",
  "sales-adjustments:create",
  "collections:view",
  "collections:create",
  "collections:verify",
  "collections:reconcile",
  "collections:export",
  "refunds:view",
  "refunds:request",
  "refunds:review",
  "refunds:approve",
  "refunds:process",
  "refunds:reconcile",
  "forecasts:view",
  "forecasts:create",
  "proposals:view",
  "proposals:create",
  "proposals:approve",
  "market-intel:view",
  "market-intel:create",
  "coaching:view",
  "coaching:create",
  "coaching:update",
  "kpi-assignments:view",
  "kpi-assignments:manage",
  "scorecards:view",
  "reviews:view",
  "reviews:create",
  "reviews:approve",
  "pip:view",
  "pip:create",
  "pip:propose",
  "pip:update",
  "pip:approve",
  "recognition:view",
  "recognition:create",
  "incentives:policy:view",
  "incentives:policy:manage",
  "incentives:policy:approve",
  "incentives:recommendation:view",
  "incentives:recommendation:create",
  "incentives:recommendation:approve",
  "incentives:recommendation:mark-paid",
  "hiring:view",
  "hiring:manage",
  "onboarding:view",
  "onboarding:manage",
  "succession:view",
  "succession:manage",
  "hr:records:view",
  "hr:records:manage",
  "resources:view",
  "resources:manage",
  "engagement:respond",
  "engagement:view",
  "complaints:view",
  "complaints:create",
  "complaints:update",
  "complaints:export",
  "satisfaction:view",
  "satisfaction:create",
  "relationships:view",
  "relationships:update",
  "handover:view",
  "handover:create",
  "handover:acknowledge",
  "founder-reports:view",
  "founder-reports:create",
  "founder-reports:review",
  "action-items:view",
  "action-items:create",
  "action-items:update",
  "insights:share",
  "sop:view",
  "sop:create",
  "sop:approve",
  "sop:acknowledge",
  "sop:adoption:view",
  "sop:gaps:view",
  "sop:gaps:manage",
  "xf-tasks:view",
  "xf-tasks:create",
  "xf-tasks:update",
  "dashboard:ceo:view",
  "dashboard:team-lead:view",
  "dashboard:manager:view",
  "dashboard:salesperson:view",
  "dashboard:system-health:view",
  "kpi:view",
  "kpi:definitions:view",
  "reports:view",
  "reports:export",
  "notifications:view",
  "notifications:manage-prefs",
  "notifications:config",
  "files:upload",
  "files:view",
  "files:delete",
  "imports:view",
  "imports:manage",
  "integrations:manage",
  "ai:use",
  "ai:config",
  "ai:usage:view",
  "devices:register",
  "jobs:dlq:view",
  "jobs:dlq:retry",
  "attendance:self",
  "attendance:view",
  "attendance:correct",
  "holidays:view",
  "holidays:manage",
  "leave:apply",
  "leave:view",
  "leave:approve",
  "leave:approve-hr",
  "leave:balance:adjust",
  "workforce:settings:view",
  "workforce:settings:manage",
  "goals:view",
  "goals:create",
  "goals:update",
  "goals:review",
  "work-tasks:view",
  "work-tasks:create",
  "work-tasks:update",
  "directory:view",
  "birthdays:view",
  "workforce:dashboard:view",
  "workforce:reports:view",
  "workforce:reports:export",
  "announcements:view",
  "announcements:manage",
  "payroll:structure:view",
  "payroll:structure:manage",
  "payroll:run:view",
  "payroll:run:manage",
  "payroll:run:approve",
  "payroll:run:mark-paid",
  "payroll:payslip:view"
 ]
}
```
