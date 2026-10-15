# CoachEasily Sales Team Management System

## Master Build Specification for Claude Code

**Document purpose:** This is the authoritative project specification
for planning, implementing, testing, and releasing the CoachEasily Sales
Team Management System.

**Primary source:** `Job_Description_Sales_Team_Lead_CoachEasily.docx`
supplied by the project owner. The job description is the source of
truth for business responsibilities and KPIs. Technical choices in this
file are implementation recommendations, not claims made by the job
description.

**Non-negotiable goal:** Preserve and trace every applicable requirement
from the source document. Do not mark a requirement complete merely
because a screen exists. It must have working business logic,
permissions, persistence, validation, and a passing test.

> No software can honestly be guaranteed to be permanently bug-free. The
> project must instead use test gates, monitoring, security checks,
> backups, regression testing, and controlled releases to reduce defects
> and detect them quickly.

------------------------------------------------------------------------

# 1. Instructions to Claude Code

Before changing code:

1.  Inspect the entire repository, existing `CLAUDE.md`/`CLAUDE.md`
    files, package manifests, environment examples, database schema,
    migrations, routes, tests, deployment files, and current
    architecture.
2.  Report what already exists and what is missing. Do not overwrite
    working features or make assumptions about the existing codebase.
3.  Do not start a large rewrite before presenting a concise audit and
    implementation plan.
4.  Keep a requirements traceability matrix in
    `docs/requirements-traceability.md`. Give every requirement an ID,
    source reference, module, implementation path, test, and status.
5.  Treat the supplied Job Description as authoritative for business
    scope. Label any additional engineering safeguards as technical
    recommendations.
6.  Build in small, testable phases. At the end of each phase, run
    relevant tests, lint, type checks, migrations checks, and build.
    Report actual command results; never claim a test passed unless it
    was run and passed.
7.  Do not hardcode secrets, real credentials, customer data, or
    production URLs. Use validated environment variables and maintain
    `.env.example` with placeholders only.
8.  Use safe database migrations and backups. Never run destructive
    production changes without explicit approval and a verified backup.
9.  Preserve unrelated websites/services on any shared VPS. Inspect
    reverse proxy, process manager, ports, DNS, and existing deployments
    before changing infrastructure. Never restart or overwrite unrelated
    applications.
10. Keep code maintainable, accessible, documented, responsive, and
    secure. Avoid unnecessary dependencies and premature microservices.
11. If a requirement cannot be completed due to missing access, external
    integration, unclear policy, or unavailable credentials, mark it
    `BLOCKED` or `NEEDS DECISION`; do not silently omit it.
12. At the end of every phase, update the traceability matrix,
    changelog, known issues, and next steps.

## Definition of done

A requirement is `VERIFIED` only when: - its expected user outcome is
defined; - UI and API behavior are implemented where applicable; -
permission and validation rules are enforced server-side; - data is
persisted correctly and audited where needed; - success, failure, empty,
loading, and unauthorized states are handled; - automated tests cover
the critical behavior; - the feature is manually checked in a
representative workflow; - documentation and traceability records are
updated.

A visually complete but non-functional control is not done. A mock value
must never be presented as real business data.

------------------------------------------------------------------------

# 2. Business context from the source document

Company: CoachEasily\
Role described: Sales Team Lead\
Reports to: Founder & CEO\
Department: Sales\
Work arrangement: Remote, full-time\
Experience in the role description: 8--10 years\
Team structure: Sales Managers, each leading 4--5 Sales Executives /
Telecallers.

The source describes CoachEasily as an AI-native coaching business
school. Its programs and offerings include: - Free live AI Sprint; -
CBAX; - MCA X; - MCA Elite X; - CoachEasily X app; - Live events such as
Wealthy Coach Summit.

The source says CoachEasily serves learners in English, Hindi, and
Marathi. It describes learner progress ranks: - Warrior; - Mavala ---
first ₹1 lakh; - Sardar --- ₹10 lakh; - Senapati --- ₹50 lakh; -
Chhatrapati --- ₹1 crore.

These names and values may be shown as configurable business terminology
where useful. Do not assume they are sales-team ranks or automatically
map them to a learner's sales record without a confirmed business rule.

The source emphasizes a remote, execution-focused culture built on
ownership, accountability, and learner success. Sales, Student Success,
and Accountability Coach teams work together to enrol learners and guide
progress.

------------------------------------------------------------------------

# 3. Product objective and scope

Build a secure, high-performance, responsive Sales Team Management
System that enables leadership to manage: - monthly, quarterly, and
annual revenue, collection, and enrolment targets; - daily sales
activity and team performance; - lead pipeline, follow-ups, lead ageing,
lost-lead reactivation, and conversion; - revenue forecasting and
high-value deal escalation; - sales managers and their teams; - sales
scripts, SOPs, playbooks, webinars, demos, payments, and handover; -
incentives, recognition, coaching, performance reviews, and improvement
plans; - customer escalations, learner satisfaction, complaint
resolution, and refunds; - hiring, onboarding, probation, and succession
planning; - cross-functional collaboration and Founder reporting.

Build a modular application, not a collection of disconnected
dashboards. All dashboards must use the same permission rules and
trusted source data.

## Out of scope unless explicitly approved

-   Automatically charging or refunding a payment without an approved
    payment integration and reconciliation policy.
-   Recording calls or accessing WhatsApp/phone data without the
    required provider integration, consent, and applicable legal review.
-   Treating AI-generated forecasts, recommendations, or summaries as
    verified facts.
-   Replacing an existing CRM before an import/migration and rollback
    plan is approved.
-   Claiming certification such as SOC 2 or ISO 27001 without an actual
    audit/certification.

------------------------------------------------------------------------

# 4. Design system and user experience

## Visual direction

Create a premium, light-luxury, human-designed business interface. It
should feel deliberate, clear, and polished---not like a generic
AI-generated template.

-   Primary surfaces: warm white, ivory, and restrained neutral tones.
-   Text: high-contrast charcoal/near-black; muted grey for secondary
    information.
-   Accent lines: elegant gold, red, and blue used consistently and
    sparingly.
-   Gold: premium emphasis, selected highlights, milestones.
-   Red: errors, overdue tasks, risk, and negative variance; do not use
    red for every decorative element.
-   Blue: links, informational states, active workflows, and data
    visualization.
-   Use subtle animated accent lines, restrained transitions, purposeful
    motion, and polished hover/focus/pressed states.
-   Buttons must have clear hierarchy, accessible contrast, comfortable
    touch targets, loading/disabled states, and visible feedback.
-   Panels/cards should have consistent spacing, refined borders, subtle
    shadows, and meaningful information hierarchy.
-   Avoid excessive gradients, excessive glow, random animation,
    unnecessary glassmorphism, and distracting movement.
-   Respect `prefers-reduced-motion`; all critical information must
    remain available without animation.
-   Use consistent design tokens for spacing, typography, radii,
    shadows, colors, focus rings, and motion.

## Responsive/mobile behavior

-   Mobile must feel app-like, not like a desktop page squeezed into a
    small viewport.
-   Use responsive layouts, touch-friendly controls, compact cards,
    sensible mobile tables (cards or horizontal scrolling where
    appropriate), and a mobile bottom navigation for primary
    destinations when suitable.
-   Support installable PWA behavior if feasible, with manifest, icons,
    service-worker caching policy, and clear online/offline behavior.
-   Never cache sensitive API responses or private business data in a
    public/shared cache.
-   Handle slow networks, retries, offline notices, and form state
    carefully. Do not imply a write succeeded when it did not.
-   Test narrow mobile, tablet, laptop, and large desktop breakpoints.

## Accessibility

-   Semantic HTML, keyboard navigation, visible focus, accessible
    labels, proper headings, error associations, contrast, and
    screen-reader-friendly status announcements.
-   Do not communicate status by color alone.
-   Charts need text summaries or accessible tables.
-   Avoid motion that can trigger discomfort and respect reduced-motion
    settings.

------------------------------------------------------------------------

# 5. Recommended technical architecture

First inspect the existing repository. Reuse a suitable existing stack
when safe and consistent. Do not migrate technology merely for
preference.

If starting from scratch, recommended baseline:

## Frontend

-   Next.js App Router;
-   TypeScript with strict settings;
-   Tailwind CSS;
-   Framer Motion for restrained UI animation;
-   React Hook Form and schema validation (for example, Zod);
-   Accessible component primitives;
-   A maintained charting library for dashboards;
-   PWA support only with a reviewed caching strategy.

## Backend

-   Python 3.11+ FastAPI;
-   Pydantic request/response validation;
-   SQLAlchemy 2.x;
-   Alembic migrations;
-   Structured logging and centralized exception handling;
-   OpenAPI documentation generated from the API.

## Data and background jobs

-   PostgreSQL on Neon, if appropriate to existing infrastructure;
-   Redis for cache/queues/rate-limit support where justified;
-   A background worker for imports, report generation, notifications,
    and file optimization;
-   Private object storage for uploaded files. Do not store large files
    as database blobs unless there is a specific, justified need.

## Deployment

-   Separate development, staging, and production configurations;
-   HTTPS, reverse proxy, process supervision, health checks, logs,
    backup/restore procedures, and controlled releases;
-   Use least-privilege database and storage credentials;
-   If deployed on a shared VPS, inventory existing services and protect
    unrelated websites and processes.

Do not introduce microservices unless measured scale or organizational
needs justify them. A modular monolith is the default for the first
release.

------------------------------------------------------------------------

# 6. Roles, hierarchy, and access control

Implement server-enforced role-based access control (RBAC). Hiding a
button in the frontend is not authorization.

## Core roles

### Founder / CEO

-   Company-wide read access to approved sales, collection, enrolment,
    pipeline, forecast, risk, and performance reports.
-   Review sales performance, risks, opportunities, and action items.
-   Access all teams only within approved business and privacy policies.
-   Approve sensitive policy changes such as target/incentive rules
    where assigned.

### Sales Team Lead

-   Own company sales targets and performance reporting delegated to the
    role.
-   Manage Sales Managers and view subordinate teams.
-   Review pipeline, forecast, conversion, activity, coaching, SOP
    adoption, escalations, and performance.
-   Create improvement plans, recommend incentives, and report to
    Founder.
-   Handle high-value deals and blockers.

### Sales Manager

-   Manage only assigned team members and permitted team records.
-   Assign leads, set/review team goals, monitor
    calls/follow-ups/conversions, coach members, and complete reviews.
-   Cannot access another manager's team unless explicitly delegated.

### Sales Executive / Telecaller

-   Access assigned leads and own activity records.
-   Add call outcomes, notes, follow-up dates, and permitted status
    updates.
-   View own targets, activity, performance, and approved incentive
    status.
-   Cannot change payment verification, incentive policy, or other
    users' records without explicit permission.

### Admin / System Administrator

-   Manage user accounts, roles, configuration, imports, integrations,
    and system health as authorized.
-   Administrative access does not automatically grant unrestricted
    access to sensitive HR or payment information. Separate permissions
    are required.

## Additional permission groups

Use fine-grained permissions for Finance/Collections, HR, Operations,
Marketing, Community Manager, Student Success, and customer support as
needed. These can be assigned to a person as secondary roles. Do not
create unnecessary standalone dashboards if a role-specific module is
sufficient.

## Authorization requirements

-   Define a permissions matrix in `docs/permissions-matrix.md`.
-   Check record ownership, team hierarchy, and action permission on
    every relevant API.
-   Prevent insecure direct object reference (IDOR) attacks.
-   Audit role changes, exports, sensitive record access, policy
    changes, and privileged actions.
-   Use deny-by-default for unknown roles and actions.

------------------------------------------------------------------------

# 7. Dashboard and module requirements

## 7.1 Founder / CEO dashboard

Show: - revenue achievement versus monthly, quarterly, and annual
target; - collections and enrolments; - team and manager performance; -
pipeline value, stage distribution, forecast, and forecast accuracy; -
lead-to-enrolment, webinar-to-sale, and demo-to-sale conversion; - major
risks, overdue actions, escalations, and trend changes; - weekly/monthly
report views and action-item completion.

All numbers must be derived from defined data and calculation rules.
Show date range, currency, filters, data freshness, and definitions.

## 7.2 Sales Team Lead dashboard

Show: - team target breakdown and achievement; - daily calls,
follow-ups, pipeline changes, closures, collections, revenue, and funnel
health; - manager scorecards and individual performance; - leads without
a next action, overdue follow-ups, lead ageing, and lost-lead
reactivation; - weekly revenue forecast and risks; - coaching sessions,
one-on-ones, monthly performance reviews, improvement plans, and
succession pipeline; - SOP adoption, incentive recommendations,
recognition, escalations, and Founder reports.

## 7.3 Sales Manager dashboard

Show: - assigned team roster and role; - each team member's target,
calls, follow-ups, conversion, and closures; - lead assignment and
workload distribution; - overdue and ageing leads, upcoming callbacks,
and missed activities; - weekly KPIs/KRAs and scorecards; - one-on-one
notes, coaching actions, monthly review status, and improvement plans; -
team risks and items to escalate to the Sales Team Lead.

Enforce the documented team model: a Sales Manager typically leads 4--5
Sales Executives/Telecallers. Allow configuration for exceptions rather
than hardcoding an inflexible limit.

## 7.4 Sales Executive / Telecaller workspace

Show: - assigned leads and priority; - next follow-up, due date, last
contact, and contact history; - call outcome, notes, objection category,
and next step; - webinar/demo status; - stage and closure details; - own
daily/weekly/monthly target progress; - tasks, alerts, and approved
incentive status.

Every lead should have a clear owner and next action or a defined
terminal status with reason. Support reassignment with audit history.

## 7.5 CRM and lead pipeline

Support: - lead creation and import; - source/campaign, owner, team,
contact preferences, consent where applicable, and timestamps; -
duplicate detection and merge with audit history; - configurable stages
and lost reasons; - lead assignment and reassignment; - activity
timeline; - calls, follow-ups, meetings, webinar/demo attendance, notes,
and tasks; - lead ageing and unattended-lead alerts; - lost-lead
reactivation queues; - search, filters, pagination, exports, and import
error reports.

Never invent call data. If phone/telephony integration is unavailable,
record manually entered activity and label it accordingly.

## 7.6 Sales strategy and revenue management

Support: - monthly, quarterly, and annual targets; - target breakdown by
manager and team; - daily collection tracking; - upselling of premium
coaching programs; - cross-selling of suitable learning journeys; -
average deal value; - market, competitor, and learner feedback; -
pricing/offer proposals for Founder review; - new channel, segment, and
growth opportunity tracking.

Pricing changes and offers must have a controlled approval history. Do
not let a user silently rewrite historical sale amounts.

## 7.7 SOP and sales process centre

Maintain versioned SOPs/playbooks for: - lead handling; - follow-up
cadence; - webinar and demo process; - objection handling; - closing and
negotiation; - payment; - handover to Student Success; - call scripts; -
WhatsApp communication templates; - CRM usage; - reporting formats.

Support owner, version, effective date, approval, acknowledgement,
adoption tracking, and change history. Track automation/workflow gaps
and their resolution.

## 7.8 Reporting and analytics

Provide role-filtered dashboards/reports for: - calls completed; -
follow-ups completed; - pipeline and stage changes; - conversions; -
closures; - collections and revenue; - funnel health; - response time; -
lead ageing; - CRM compliance; - manager and individual target
achievement; - team productivity; - attrition; - team engagement; -
coaching hours; - SOP adoption; - dashboard accuracy and timeliness; -
learner satisfaction; - refunds and complaint resolution; - enrolment
experience; - Founder action-item completion and report timeliness.

Support weekly and monthly reports to Founder, date/team/program/source
filters, export, and reproducible calculations. Export permissions must
be checked server-side and exports logged.

## 7.9 Customer and relationship management

Support: - learner/prospect relationship history; - high-value and
complex conversation escalation; - complaints with owner, priority,
status, timestamps, and resolution; - enrolment experience feedback; -
learner satisfaction measurement; - refund request and outcome
tracking; - root-cause categories and trends.

A refund request is not the same as an approved refund. Track requested,
reviewed, approved/rejected, processed, and reconciled states
separately.

## 7.10 Cross-functional collaboration

Create controlled handoff/task workflows with Founder, Marketing,
Community Manager, Operations, and Student Success: - campaign and
lead-generation alignment; - webinar and event planning linkage; -
sales-to-delivery handover checklist; - learner and market insights; -
owner, due date, status, dependencies, and comments; - escalations and
completion confirmation.

Do not expose full sales/learner data to other departments by default.
Share only the information needed for their tasks.

## 7.11 Founder reporting and action tracking

Support: - sales performance, risks, and opportunities; - proposed
solutions; - action items from reviews; - owner, due date, status,
evidence/notes, and overdue alerts; - weekly/monthly reporting
cadence; - historical report snapshots so past reports do not silently
change when source data changes.

## 7.12 People management

Support: - recruitment coordination with HR; - hiring support for Sales
Managers and team members; - onboarding and training checklists; -
KRA/KPI assignment; - probation reviews; - monthly performance
reviews; - incentive recommendations; - succession planning; - ownership
and accountability expectations.

Keep sensitive HR records permission-restricted. The source document
specifies these responsibilities but does not define a full payroll or
leave-management system; do not silently expand scope into a complete
HRMS without approval.

## 7.13 Skills and coaching enablement

Support resources and coaching records related to: - consultative
selling; - closing techniques; - revenue planning; - negotiation and
objection handling; - pipeline management and forecasting; - sales
strategy; - team management, mentoring, and performance management; -
conflict resolution, decision-making, delegation, and influencing; -
written/verbal communication and presentation; - CRM, Google Workspace,
Excel, and dashboards.

Track sessions and actions, not subjective AI scores as unquestionable
truth.

## 7.14 Business program and learner context

Allow configuration of CoachEasily's programs and offerings: - AI
Sprint; - CBAX; - MCA X; - MCA Elite X; - CoachEasily X; - Wealthy Coach
Summit and other events.

Support program attribution on leads, enrolments, and sales when known.
Support English, Hindi, and Marathi UI/content where in scope. Program
names, ranks, and descriptions should be configurable. The system must
not assume all programs share the same pricing, funnel, eligibility, or
conversion rules.

------------------------------------------------------------------------

# 8. KPI dictionary and calculation rules

Create `docs/kpi-dictionary.md`. Each KPI must define numerator,
denominator, time window, exclusions, source tables, refresh cadence,
owner, and rounding.

Minimum KPIs from the source: - monthly revenue achievement
percentage; - collection target achievement; - team sales achievement; -
lead conversion percentage; - webinar-to-sale conversion; - demo-to-sale
conversion; - average deal value; - forecast accuracy; - calls
completed; - follow-ups completed; - CRM compliance; - response time; -
lead ageing; - manager and individual target achievement; - team
productivity; - attrition; - team engagement; - coaching hours; - SOP
adoption rate; - dashboard accuracy and timeliness; - learner
satisfaction; - refund reduction; - complaint resolution; - enrolment
experience score; - Founder action-item completion; - report quality and
timeliness.

Do not choose ambiguous KPI definitions silently. Proposed defaults must
be documented and approved by the business owner.

Suggested definitions requiring approval: - Revenue achieved % =
recognized/credited sales revenue in the selected period divided by
target × 100. - Collection achieved % = verified collections in the
selected period divided by collection target × 100. - Lead conversion %
= unique eligible leads converted within the defined cohort/window
divided by eligible leads in that cohort × 100. - Webinar/demo
conversion = attributed sales divided by attendees or qualified
participants under an agreed attribution rule. - Average deal value =
defined sales value divided by number of eligible closed-won deals. -
Forecast accuracy = use an agreed error metric; show the formula and do
not label a metric "accuracy" without defining it. - Lead ageing = time
since creation or last meaningful activity; show both if relevant. - CRM
compliance = eligible records with required fields/activities completed
divided by eligible records × 100. - Refund reduction = compare
like-for-like refund rates across agreed periods; do not compare raw
counts alone. - Attrition = define voluntary/involuntary exclusions and
the measurement period. - Coaching hours = recorded sessions with date,
coach, participants, and duration.

Handle zero denominators explicitly; do not show NaN or infinity.

------------------------------------------------------------------------

# 9. Sales workflow and state transitions

Design and document explicit state machines for: - lead lifecycle; -
webinar/demo participation; - opportunity/sale; - payment/collection; -
refund; - Student Success handover; - complaint/escalation; -
task/action item; - performance improvement plan; - incentive
recommendation/approval.

For every transition define: - allowed previous state; - allowed next
state; - required fields; - authorized roles; - side
effects/notifications; - audit entry; - failure handling.

Use database transactions for critical updates. Prevent duplicate
sale/payment events with idempotency keys or unique external transaction
references where appropriate.

A lead marked `Closed Won` must not automatically mean payment has been
received. Distinguish sale value, amount due, amount collected, refunds,
and net collections.

------------------------------------------------------------------------

# 10. Database design guidance

Inspect existing schema before creating models. Produce a documented ERD
and migrations. Likely entities include:

-   users;
-   roles;
-   permissions;
-   user-role assignments;
-   teams;
-   team memberships;
-   manager hierarchy;
-   leads;
-   lead sources/campaigns;
-   lead assignments and assignment history;
-   contacts;
-   activities/calls;
-   follow-ups/tasks;
-   opportunities/deals;
-   products/programs;
-   target periods and targets;
-   sales records;
-   payments/collections;
-   refunds;
-   webinars/events/demos and attendance;
-   SOPs/playbooks and versions;
-   coaching sessions;
-   scorecards/KPIs;
-   performance reviews;
-   improvement plans;
-   incentive policies and recommendations;
-   recognition records;
-   complaints/escalations;
-   handover records;
-   cross-functional tasks;
-   Founder reports/action items;
-   recruitment/onboarding/probation/succession records;
-   notifications;
-   file metadata;
-   audit logs;
-   import jobs and import errors;
-   integration configuration and webhook events.

This is a candidate model list, not a command to create every table
blindly. Normalize where appropriate, use foreign keys, unique
constraints, indexes, timestamps, soft deletion only when justified, and
immutable audit history for critical actions.

Use decimal/numeric types for currency, never binary floating point.
Store timestamps consistently and display in the configured business
timezone. India currency defaults to INR, but currency should be
explicit on records if multiple currencies may ever be supported.

------------------------------------------------------------------------

# 11. API design expectations

Use versioned, documented endpoints such as `/api/v1/...` if consistent
with the existing project. Exact endpoint names must follow the
repository's conventions.

Expected API domains: - authentication and sessions; - users, roles,
permissions, teams, and hierarchy; - leads, assignments, imports, and
duplicates; - activities, calls, follow-ups, and tasks; - opportunities,
sales, programs, and funnel stages; - targets and KPI scorecards; -
collections, payments, and refunds; - webinars, demos, and attendance; -
SOPs, scripts, and acknowledgements; - coaching, reviews, improvement
plans, and succession; - incentives and recognition; - complaints and
escalations; - cross-functional handovers; - reports, analytics, and
exports; - notifications; - file upload/processing/download; - audit
logs and system health.

For each endpoint document: - HTTP method and path; - role/permission; -
request and response schemas; - validation; - pagination/filtering; -
error codes; - audit requirements; - tests.

Never trust a user ID, team ID, amount, role, or permission supplied by
the client without server-side verification.

------------------------------------------------------------------------

# 12. File upload and storage policy

All uploads must be authenticated and authorized.

-   Allowlist file extensions and verify actual content/MIME type; do
    not trust the filename.
-   Set configurable size limits and quotas.
-   Generate safe server-side object names; never use raw user filenames
    as filesystem paths.
-   Store files outside the public web root or in private object
    storage.
-   Scan for malware where a scanning service is available.
-   Strip image metadata where appropriate; resize images and encode to
    WebP/AVIF where suitable.
-   Optimize PDFs only when a safe tool is available; preserve
    readability and never claim every file can be compressed.
-   Do not destructively replace originals unless a documented policy
    explicitly requires it.
-   Use short-lived authorized download URLs or an authenticated
    download API.
-   Record uploader, timestamp, size, checksum, storage key, content
    type, processing status, and retention policy.
-   Use asynchronous processing for large files; show progress and
    failure/retry states.
-   Reject path traversal, executable content, oversized decompression
    bombs, and unsupported formats.
-   Keep backups and deletion/retention behavior documented.

------------------------------------------------------------------------

# 13. Security requirements

Use a threat-model-driven approach and OWASP guidance appropriate to the
application.

-   HTTPS everywhere in production.
-   Secure password hashing using a maintained algorithm/library.
-   Secure, HttpOnly, SameSite cookies for browser sessions where
    applicable.
-   CSRF protection where cookie-based authentication requires it.
-   Short-lived tokens and safe refresh/session rotation if token-based
    auth is used.
-   Rate limiting and abuse protection for authentication, imports,
    exports, and expensive endpoints.
-   Server-side validation and parameterized database access.
-   Strict CORS policy; never use wildcard origins with credentials.
-   Content Security Policy and security headers, tested against actual
    app needs.
-   Secret management through environment/secret store; no secrets in
    source control or client bundles.
-   Least-privilege database, storage, and deployment credentials.
-   Encryption in transit and managed encryption at rest where
    supported.
-   Sensitive data minimization, retention rules, and access logging.
-   Audit logs for privileged operations, role changes, exports,
    payment/refund changes, and incentive-policy changes.
-   Protect against IDOR, SQL injection, XSS, CSRF, SSRF, file upload
    abuse, replay, and webhook forgery.
-   Verify webhook signatures and use idempotency.
-   Dependency vulnerability scans and patch process.
-   Backups plus periodically tested restore procedures.
-   Do not log passwords, tokens, payment secrets, or unnecessary
    personal data.
-   Follow applicable Indian privacy, employment, and consumer
    requirements with qualified review where needed.

------------------------------------------------------------------------

# 14. Performance and reliability

-   Establish performance budgets before optimizing.
-   Use server-side pagination for large datasets.
-   Index real query patterns; inspect query plans for slow queries.
-   Avoid N+1 queries and unbounded API responses.
-   Cache only appropriate data with clear invalidation and
    authorization boundaries.
-   Use background jobs for reports, large imports, notifications, and
    file processing.
-   Lazy-load noncritical frontend modules and optimize image/font
    assets.
-   Use loading skeletons only where helpful, plus empty/error states
    and retry options.
-   Provide health/readiness endpoints without exposing secrets.
-   Use structured logs, request IDs, error monitoring, and actionable
    alerts.
-   Set timeouts and retry policies; avoid retrying non-idempotent
    operations blindly.
-   Use graceful shutdown and safe worker restart behavior.
-   Test expected load with realistic, anonymized data before release.
-   Define recovery point and recovery time objectives with the owner;
    do not invent guarantees.

------------------------------------------------------------------------

# 15. Notifications and automation

Support configurable in-app notifications for: - due/overdue
follow-ups; - leads without an owner or next action; - target risk and
missed milestones; - pending reviews and coaching actions; -
complaint/escalation updates; - payment/collection status changes; -
pending Student Success handovers; - Founder action items; - import/file
processing completion or failure; - security-relevant events.

Email, WhatsApp, SMS, telephony, and calendar integrations require
approved providers, credentials, consent/policy review, delivery
tracking, retries, and opt-out handling where applicable. Keep
notifications actionable and avoid duplicate spam. Do not state that a
message was delivered until provider status confirms it.

------------------------------------------------------------------------

# 16. AI use policy

AI features are optional and must not replace core deterministic
business logic. If added later: - clearly label AI-generated
suggestions; - show the data/time period used when feasible; - allow
human review for forecasts, coaching suggestions, scripts, and
summaries; - never allow an AI model to grant permissions, approve
refunds, alter payment records, or change incentive policy
autonomously; - avoid sending sensitive learner/employee information to
external models without approved controls; - log important AI-assisted
actions and allow correction; - provide non-AI fallback behavior if the
model is unavailable.

The source describes CoachEasily as AI-native but does not require a
particular AI provider or autonomous agent design.

------------------------------------------------------------------------

# 17. Testing and quality gates

## Automated checks

-   linting and formatting;
-   frontend type checking;
-   backend static checks where configured;
-   unit tests for business calculations and state transitions;
-   API integration tests;
-   database migration tests;
-   permission/IDOR tests;
-   end-to-end tests for critical user journeys;
-   upload validation and security tests;
-   import duplicate/error handling tests;
-   payment/collection idempotency tests;
-   responsive UI and accessibility checks;
-   dependency and secret scanning;
-   production build test.

## Minimum critical user journeys

1.  Founder logs in and views company-level performance.
2.  Sales Team Lead assigns/reviews targets and manager scorecards.
3.  Manager assigns a lead to a team member.
4.  Executive records activity and schedules a follow-up.
5.  System flags an overdue/unattended lead.
6.  Lead progresses through webinar/demo and sales stages.
7.  A closed-won sale and a verified collection remain distinct.
8.  Payment reconciliation avoids duplicate credit.
9.  A refund request follows authorized approval and processing states.
10. A sale is handed over to Student Success with required information.
11. Manager records a coaching session and review action.
12. Founder report and action items are generated and tracked.
13. Unauthorized users cannot access another team's records.
14. An upload is validated, optimized if supported, and downloaded
    securely.
15. A failed notification/import is visible and recoverable.
16. Mobile user can complete core lead and follow-up workflows.
17. Backup restore and release rollback are rehearsed in a safe
    environment.

## Release gates

Do not release if: - a critical/high-severity security issue is
unresolved; - a migration has not been tested; - critical user journeys
fail; - payment/collection totals do not reconcile; - permissions are
not tested; - backups or rollback are not available; - known high-impact
defects are hidden from the release notes.

Track bugs with severity, reproduction steps, expected/actual behavior,
owner, fix version, regression test, and status. "Zero known critical
defects at release" is a target, not a promise of zero bugs forever.

------------------------------------------------------------------------

# 18. Deployment and operations

Before deployment: - inspect the existing server and every hosted
service; - record ports, domains, reverse proxy routes, process manager
entries, environment variable names, and database connections; - back up
configuration and data; - deploy to staging first; - run health checks,
smoke tests, and role-based user journeys; - use a reversible
release/rollback plan; - verify TLS, headers, logs, metrics, and
backups; - avoid restarting unrelated services.

For a shared VPS, do not change global Nginx/Apache/Cloudflare settings
or stop existing PM2/systemd processes without confirming impact. Prefer
isolated service names, ports, config files, and deploy directories.

------------------------------------------------------------------------

# 19. Phase-wise implementation plan

## Phase 0 --- Repository and requirement audit

-   Inspect codebase and the complete source Job Description.
-   Create `docs/requirements-traceability.md`,
    `docs/permissions-matrix.md`, `docs/kpi-dictionary.md`, and an
    architecture decision record.
-   Map every source requirement to a feature and test.
-   Identify existing integrations and unknowns.
-   **Exit gate:** no source bullet is untracked; ambiguities are
    listed.

## Phase 1 --- Foundation and design system

-   Establish app structure, design tokens, responsive shell, accessible
    components, theme rules, navigation, logging, configuration, and CI
    checks.
-   Build representative mobile and desktop layouts.
-   **Exit gate:** lint/type/build pass; visual states and responsive
    checks pass.

## Phase 2 --- Identity, permissions, teams

-   Authentication, session security, RBAC, team hierarchy,
    invitations/provisioning, audit logs.
-   **Exit gate:** authorization tests prove cross-team isolation.

## Phase 3 --- CRM and activity workflow

-   Leads, import, duplicate handling, ownership, activities,
    follow-ups, tasks, pipeline, ageing, lost lead reactivation.
-   **Exit gate:** critical lead workflows pass end-to-end tests.

## Phase 4 --- Targets, sales, collections

-   Target periods, goal breakdown, opportunities, sales, programs,
    payment/collection reconciliation, refunds, revenue calculations.
-   **Exit gate:** finance calculations and idempotency tests pass.

## Phase 5 --- Dashboards, KPIs, reporting

-   Founder, Sales Team Lead, Manager, Executive, and Admin views; KPI
    dictionary; weekly/monthly reports and exports.
-   **Exit gate:** all KPIs reconcile with test fixtures and access
    rules.

## Phase 6 --- SOP, coaching, people management

-   SOP library, scripts, acknowledgements, coaching sessions,
    scorecards, reviews, improvement plans,
    hiring/onboarding/probation/succession, incentives and recognition.
-   **Exit gate:** workflow permissions and audit history pass.

## Phase 7 --- Customer experience and collaboration

-   Complaints, escalations, satisfaction, refund tracking,
    cross-functional tasks, Student Success handover, Founder action
    items.
-   **Exit gate:** handover and escalation journeys pass.

## Phase 8 --- Notifications, files, integrations

-   File optimization pipeline, in-app notifications, approved
    email/SMS/WhatsApp/CRM/calendar integrations.
-   **Exit gate:** failed jobs recover safely and provider status is not
    misrepresented.

## Phase 9 --- Hardening and release

-   Security review, accessibility, performance/load checks, backup
    restore, staging UAT, smoke/regression tests, monitoring, rollback
    rehearsal.
-   **Exit gate:** signed acceptance checklist; all requirements
    `VERIFIED` or explicitly approved as out-of-scope/blocked with
    reason.

Do not claim 100% completion when a requirement remains blocked,
untested, or awaiting business approval.

------------------------------------------------------------------------

# 20. Required project documentation

Maintain: - `README.md` --- setup, commands, architecture overview; -
`CLAUDE.md` --- this master specification and current phase status; -
`docs/requirements-traceability.md`; - `docs/permissions-matrix.md`; -
`docs/kpi-dictionary.md`; - `docs/architecture.md`; -
`docs/data-model.md` / ERD; - `docs/api.md` or generated OpenAPI
documentation; - `docs/security.md`; - `docs/file-storage-policy.md`; -
`docs/deployment-runbook.md`; - `docs/backup-restore.md`; -
`docs/testing-strategy.md`; - `docs/known-issues.md`; -
`CHANGELOG.md`; - `.env.example` with placeholders only.

------------------------------------------------------------------------

# 21. Requirements traceability register

The source Job Description has eight key responsibility groups plus
KPIs, people management, required skills, qualifications, experience,
and competencies. Track each source bullet individually, not just the
headings.

Use IDs such as: - `JD-ROLE-001` --- role purpose and Founder
reporting; - `JD-SALES-001` --- revenue, collection, enrolment
targets; - `JD-LEAD-001` --- target breakdown and daily tracking; -
`JD-PIPE-001` --- daily pipeline review and weekly/monthly
forecasting; - `JD-CONV-001` --- lead/webinar/demo conversion; -
`JD-MGR-001` --- Sales Manager leadership and team structure; -
`JD-COACH-001` --- coaching, one-to-ones, scorecards, performance
reviews; - `JD-STRAT-001` --- sales strategy, upsell/cross-sell, market
feedback and growth channels; - `JD-SOP-001` --- full sales cycle SOPs
and playbooks; - `JD-DASH-001` --- dashboards, activity tracking, CRM
compliance, ageing, reactivation; - `JD-CX-001` --- relationships,
escalations, learner satisfaction, complaints and refunds; -
`JD-CROSS-001` --- Founder/Marketing/Community/Operations/Student
Success collaboration; - `JD-REPORT-001` --- Founder reporting and
action items; - `JD-KPI-001` --- every KPI in the source; - `JD-HR-001`
--- recruitment, onboarding, probation, reviews, succession; -
`JD-SKILL-001` --- required skills and tool familiarity; - `JD-QUAL-001`
--- education and experience criteria; - `JD-COMP-001` --- each listed
competency.

These IDs are examples. Expand them so every bullet and sub-bullet in
the original document has its own traceable row. Include source
page/section where available.

Recommended columns:
`Requirement ID | Source page/section | Exact source requirement | Requirement type | Module | Role(s) | Acceptance criteria | API/model | Test case | Status | Evidence/notes`

Allowed statuses: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`,
`NEEDS_DECISION`, `IMPLEMENTED_UNTESTED`, `VERIFIED`,
`APPROVED_OUT_OF_SCOPE`.

------------------------------------------------------------------------

# 22. Business decisions that must not be invented

Create a decision log and ask the owner only when the decision blocks
implementation. Candidates include: - target periods, prorating, and
target revision policy; - revenue recognition and collection
attribution; - sales ownership and credit-sharing rules; - lead stages,
lost reasons, reactivation rules, and duplicate merge policy; -
conversion cohort and attribution windows; - incentive/commission
formulas, approval, clawbacks, and refund handling; - program pricing
and product-specific funnels; - complaint priority and SLA; - refund
approval authority and external payment provider; - source CRM and
migration approach; - call/WhatsApp/SMS/email providers and consent; -
business timezone and working days; - data retention, deletion, and
privacy policy; - exact UI languages for the application; - whether
payroll, attendance, leave, or a full HRMS is required (not specified as
a full system by the source); - whether AI features are required in the
first release or later.

For every decision, record owner, options, chosen value, date,
rationale, and affected requirements.

------------------------------------------------------------------------

# 23. Final acceptance checklist

Before declaring the project complete, confirm:

-   [ ] Every individual source requirement has a traceability row.
-   [ ] All eight responsibility groups are mapped.
-   [ ] Every KPI has an approved formula and a passing test.
-   [ ] Founder, Sales Team Lead, Manager, Executive/Telecaller, and
    Admin permissions are enforced server-side.
-   [ ] The documented team structure is supported.
-   [ ] CRM, lead ageing, follow-ups, reactivation, sales pipeline,
    collections, and reporting work end to end.
-   [ ] SOPs, coaching, reviews, improvement plans, incentives, and
    recognition work.
-   [ ] Complaints, learner satisfaction, refunds, and Student Success
    handover work.
-   [ ] Recruitment, onboarding, probation, and succession requirements
    are covered or explicitly scoped.
-   [ ] Required program names and business terminology are supported
    without invented rules.
-   [ ] Mobile layouts and core mobile workflows are tested.
-   [ ] Gold/red/blue accents and motion are restrained, accessible, and
    consistent.
-   [ ] File upload authorization, validation, optimization, and private
    storage are tested.
-   [ ] Security, audit logging, monitoring, backups, and restore
    procedures are verified.
-   [ ] Critical end-to-end, regression, and permission tests pass.
-   [ ] No unresolved critical/high-severity defect is hidden.
-   [ ] Staging UAT and release rollback are completed.
-   [ ] Known limitations and blocked requirements are disclosed.
-   [ ] The owner signs off on the traceability register.

**Final rule:** The project can be called "100% requirement coverage
verified" only when every applicable source requirement is implemented
and tested, or is explicitly approved as out of scope. This is not a
guarantee that no future defect can ever occur.
