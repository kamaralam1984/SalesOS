/**
 * Role guide content for the Developer Panel "Role guide" tab. English only: it is developer documentation, not learner/staff UI.
 * Which pages a role sees comes from `ROLE_NAV_SCOPE` (generated from the permission catalogue); this file explains what each page
 * is and how it works. Keep `how` short and factual. If a page changes, change it here too (src/nav/registry.test.ts guards the ids).
 */
export interface GuideModule {
  /** Nav item id (src/nav/*.ts). */
  id: string;
  group: string;
  name: string;
  path: string;
  how: string;
}

export const GROUP_LABEL: Record<string, string> = {
  dashboard: 'Dashboard',
  crm: 'Leads and CRM',
  revenue: 'Revenue',
  people: 'People',
  work: 'My Work (attendance, leave, goals)',
  sop: 'SOP centre',
  cx: 'Customer care',
  collaboration: 'Collaboration',
  reporting: 'Reporting',
  notifications: 'Notifications',
  admin: 'Administration',
  files: 'Files',
};

const m = (id: string, name: string, path: string, how: string): GuideModule => ({ id, group: id.split('.')[0] ?? id, name, path, how });

export const GUIDE_MODULES: GuideModule[] = [
  m('dashboard', 'Dashboard', '/dashboard', 'Landing page by role: Founder, Team Lead, Manager and Executive dashboards read the same role-scoped KPI layer (numbers match across screens). Executives also get today\'s attendance card. Roles without a sales dashboard see a workspace home with shortcuts to their pages.'),

  m('crm', 'Leads and CRM', '/crm', 'Home of the follow-up engine. Principle: every active lead has an owner and a next action, or it shows in an exception queue.'),
  m('crm.leads', 'Leads', '/crm/leads', 'Lead list and lead detail. Call from the lead with a tel: link, then fill the mandatory disposition form (connected, no answer, busy, switched off, callback, failed, won, lost). Records are labelled MANUAL. A lost lead needs a reason; no answer never marks a lead lost.'),
  m('crm.tasks', 'Tasks', '/crm/tasks', 'Follow-up tasks created by dispositions (retry, callback, next action). Complete or reschedule from here.'),
  m('crm.calendar', 'Follow-up calendar', '/crm/calendar', 'Calendar view of upcoming follow-ups and callbacks, in Asia/Kolkata time.'),
  m('crm.overdue', 'Overdue', '/crm/overdue', 'Follow-ups past due. The owner is notified first, then the manager once the escalation threshold passes.'),
  m('crm.exceptions', 'Exception queue', '/crm/exceptions', 'Active leads with no owner or no next action. Managers clear it by assigning an owner or creating a task.'),
  m('crm.reassignment', 'Reassignment queue', '/crm/reassignment', 'Open leads of a deactivated or moved executive. A manager must reassign each one.'),
  m('crm.duplicates', 'Duplicate review', '/crm/duplicates', 'Possible duplicates found by E.164 phone match. Never merged silently: a person reviews and merges or dismisses.'),
  m('crm.reactivation', 'Lost-lead reactivation', '/crm/reactivation', 'Lost leads that are due for another attempt under the reactivation policy. History is kept.'),
  m('crm.imports', 'Imports', '/crm/imports', 'CSV/XLSX lead import with validation and idempotency (re-uploading the same file does not duplicate leads).'),
  m('crm.events', 'Webinars and demos', '/crm/events', 'Webinar and demo records with registrations and attendance. Feeds the campaign plans.'),
  m('crm.settings', 'CRM settings', '/crm/settings', 'Lead sources, campaigns, programs, retry delays, working hours and escalation thresholds.'),

  m('revenue', 'Revenue', '/revenue', 'Targets, deals, collections, refunds and forecasts. Closed-Won is not payment received; refund requested, approved and processed are separate steps.'),
  m('revenue.deals', 'Deals', '/revenue/deals', 'Deals created from won leads, with amount, programme, instalments and payment status.'),
  m('revenue.targets', 'Targets', '/revenue/targets', 'Monthly/period targets set top-down (Founder, Team Lead, Manager, Executive) with achievement against them.'),
  m('revenue.collections', 'Collections', '/revenue/collections', 'Payments recorded against deals. A unique external transaction reference stops double entry.'),
  m('revenue.refunds', 'Refunds', '/revenue/refunds', 'Refund requests and their approval state. Requested, approved and processed are different statuses.'),
  m('revenue.forecasts', 'Forecasts', '/revenue/forecasts', 'Revenue forecast by period. Accuracy names its error metric.'),
  m('revenue.pricing', 'Pricing and offers', '/revenue/pricing', 'Price list, offers and proposals used when quoting.'),
  m('revenue.strategy', 'Strategy plans', '/revenue/strategy', 'Sales strategy plans with initiatives (create, edit, track). Visible from team scope upward.'),
  m('revenue.intel', 'Market intelligence', '/revenue/intel', 'Competitor and market notes shared with sales and other teams.'),

  m('people', 'People', '/people', 'Coaching, reviews, improvement plans, incentives, hiring and onboarding of the sales team.'),
  m('people.coaching', 'Coaching log', '/people/coaching', 'Manager coaching sessions and call reviews with actions.'),
  m('people.one-on-ones', 'One-on-ones', '/people/one-on-ones', 'Scheduled one-on-one meetings with notes and action items.'),
  m('people.kpis', 'KPIs and KRAs', '/people/kpis', 'KPI and KRA assignment per person; values come from the shared KPI layer.'),
  m('people.reviews', 'Performance reviews', '/people/reviews', 'Review cycles with ratings; acknowledgement by the employee.'),
  m('people.pips', 'Improvement plans', '/people/pips', 'Performance improvement plans with milestones and outcome. Sensitive: visible to the person, their line and HR.'),
  m('people.recognition', 'Recognition', '/people/recognition', 'Recognition and shout-outs.'),
  m('people.incentives', 'Incentives', '/people/incentives', 'Incentive policy and calculated payouts. Policy changes are audited; payouts follow an approval flow.'),
  m('people.hiring', 'Hiring', '/people/hiring', 'Open roles, candidates and interview stages.'),
  m('people.onboarding', 'Onboarding and probation', '/people/onboarding', 'Onboarding checklist plans from a template and scheduled probation reviews.'),
  m('people.succession', 'Succession', '/people/succession', 'Successor readiness for key roles.'),
  m('people.skills', 'Skills library', '/people/skills', 'Skills catalogue and learning material.'),
  m('people.engagement', 'Engagement pulse', '/people/engagement', 'Short engagement pulse surveys and results.'),
  m('people.employees', 'Employee records', '/people/employees', 'HR employee records and profile details. HR only.'),

  m('work', 'My Work', '/work', 'Hub for every employee: attendance, leave, goals, tasks, holidays, payslips. Managers and HR get team views; Founder gets the organisation view.'),
  m('work.attendance', 'Attendance', '/work/attendance', 'Check in (office or WFH) and check out. After the cutoff (11:00 IST) a person can still check in by giving a reason; HR and the Boss get a daily note about late joins (policy can switch this off). Before check-out the person fills the end-of-day report (how much of today\'s work is done, plus a note when not everything). The Day sheet (HR, managers) shows who came when, how late, who pressed the meeting button, overtime after 19:00, the late-join reason and each person\'s work report. Weekly offs and holidays follow the holiday calendar. A nightly day-close job marks working days with no record as absent. Corrections need a reason and keep old and new value in the audit log. Tabs: My month, My team, Corrections. A Zoom meeting link appears after check-in when HR configured one.'),
  m('work.leave', 'Leave', '/work/leave', 'Balances (including the Earned Leave ledger), apply, cancel, history. Requests go manager step, then HR step.'),
  m('work.goals', 'Goals', '/work/goals', '45-day goal cycle. Create a goal with an optional measurable target, post progress and milestones, then submit. The reviewer verifies or returns it. A goal without a measurable target follows its linked tasks automatically (finished tasks move it forward). Anyone who can open a goal can download it as an Excel sheet (details, progress history, tasks); at the end of the 45 days the page offers it prominently. Founder / Team Lead / Manager can set one goal for everyone in their team at once; start date fills the target date (+45 days). Risk (on track, at risk, overdue) is computed from progress against elapsed days. Managers can assign goals to their team.'),
  m('work.tasks', 'Tasks', '/work/tasks', 'Work tasks with owner, due date and comments. Finished tasks improve the linked goal.'),
  m('work.holidays', 'Holidays', '/work/holidays', 'Holiday calendar; HR and Founder can create, approve and edit.'),
  m('work.payslips', 'Payslips', '/work/payslips', 'Your own payslips only.'),
  m('work.approvals', 'Leave approvals', '/work/approvals', 'Leave requests waiting for you at the manager or HR step.'),
  m('work.goalsHub', '45-day goals', '/work/goals', 'Shortcut to the goal cycle.'),
  m('work.directory', 'Directory', '/work/directory', 'Search people. Others see minimum data only (no personal contact details).'),
  m('work.orgChart', 'Org chart', '/work/org-chart', 'Reporting lines from Founder to executives.'),
  m('work.hr', 'HR', '/work/hr', 'HR hub: policy (attendance cutoff, leave types, Earned Leave, goal cycle length), leave balances, birthdays, probation, announcements. Every policy change is logged.'),
  m('work.hr.policy', 'HR policy', '/work/hr/policy', 'Attendance cutoff and late time, leave types, Earned Leave rules, goal cycle length and payroll settings. Every change is logged with user and time.'),
  m('work.hr.balances', 'Leave balances', '/work/hr/balances', 'View and adjust opening balances and corrections. Always audited.'),
  m('work.hr.birthdays', 'Birthdays', '/work/hr/birthdays', 'Upcoming birthdays and work anniversaries.'),
  m('work.hr.joiners', 'New joiners', '/work/hr/joiners', 'Join a new employee in one step: account and invite link, HR record, a 90-day training plan with 30/60/90-day reviews, and first tasks. Shows each new joiner\'s progress through the first 90 days. HR and the Boss.'),
  m('work.hr.probation', 'Probation', '/work/hr/probation', 'Probation reviews due at each checkpoint; overdue ones are flagged.'),
  m('work.hr.announcements', 'Announcements', '/work/hr/announcements', 'Company announcements shown to staff.'),
  m('work.payroll', 'Payroll', '/work/payroll', 'Payroll runs calculated from attendance and leave, with adjustments before approval, plus salary structures. Finance and HR only; Admin has no access.'),
  m('work.payroll.structures', 'Salary structures', '/work/payroll/structures', 'Salary components per person or grade used by payroll runs. Sensitive: Finance and HR only.'),
  m('work.reports', 'Workforce reports', '/work/reports', 'Attendance, leave, task and goal reports with CSV / Excel export, plus the Weekly progress report (attendance, late joins, own work reports, tasks, goals per person) and the New joiner 90-day report.'),

  m('sop', 'SOP centre', '/sop', 'Versioned standard operating procedures. Staff read the current approved version and acknowledge it.'),
  m('sop.adoption', 'Adoption', '/sop/adoption', 'Who has read and acknowledged each SOP.'),
  m('sop.gaps', 'Process gaps', '/sop/gaps', 'Gaps reported where no SOP exists or an SOP is not followed.'),
  m('sop.approvals', 'Approvals', '/sop/approvals', 'SOP versions waiting for approval before they go live.'),

  m('cx', 'Customer care', '/cx', 'Complaints, escalations, handovers after a sale and Founder reporting.'),
  m('cx.complaints', 'Complaints', '/cx/complaints', 'Complaint log with SLA timers and a state machine.'),
  m('cx.escalations', 'Escalations', '/cx/escalations', 'Escalated complaints and issues with owner and deadline.'),
  m('cx.relationships', 'Relationships', '/cx/relationships', 'Learner relationship view across calls, deals, complaints and handover.'),
  m('cx.satisfaction', 'Satisfaction', '/cx/satisfaction', 'Satisfaction scores and feedback.'),
  m('cx.refunds', 'Refunds', '/cx/refunds', 'Refund cases from the customer-care side.'),
  m('cx.handovers', 'Handovers', '/cx/handovers', 'Sale to onboarding handover with checklist and alert timer.'),
  m('cx.reports', 'Founder reports', '/cx/founder-reports', 'Structured reports to the Founder with risks and proposed solutions.'),
  m('cx.actionItems', 'Action items', '/cx/action-items', 'Action items from complaints, reports and meetings.'),
  m('cx.risks', 'Risk register', '/cx/risks', 'Risks with severity and mitigation.'),

  m('collaboration', 'Collaboration', '/collaboration', 'Cross-functional tasks between Sales, Marketing, Community, Operations and Student Success.'),
  m('collaboration.plans', 'Campaign plans (sales plan)', '/collaboration/plans', 'Links a campaign, webinar, event or lead-gen push to the sales plan. Link a program, campaign or lead source so "Leads so far" is counted against planned leads (counts only, never learner details). Edit a plan or move it Planned, Active, then Completed or Cancelled; closed plans are final. Marketing, Community, Operations, Founder, Team Lead and Managers can edit; others read.'),
  m('collaboration.insights', 'Shared insights', '/collaboration/insights', 'Themes and counts heard from learners and the market, shared to chosen departments. Entries with names, phones or emails are rejected.'),

  m('reporting', 'Reporting', '/reporting', 'One KPI engine and reports on top of it.'),
  m('reporting.follow-ups', 'Follow-up discipline', '/reporting/follow-ups', 'On-time follow-up rate, overdue counts and exception queue size.'),
  m('reporting.conversions', 'Conversions', '/reporting/conversions', 'Conversion by stage, source and person.'),
  m('reporting.funnel', 'Funnel', '/reporting/funnel', 'Lead-to-won funnel.'),
  m('reporting.revenue', 'Revenue and collections', '/reporting/revenue', 'Booked versus collected revenue.'),
  m('reporting.team', 'Team performance', '/reporting/team-performance', 'Per-person and per-team performance within your scope.'),
  m('reporting.founder', 'Founder report data', '/reporting/monthly-founder', 'Monthly data pack for the Founder report.'),
  m('reporting.reconciliation', 'Data reconciliation', '/reporting/reconciliation', 'Checks that dashboards, reports and money totals agree.'),
  m('reporting.kpis', 'KPI dictionary', '/reporting/kpis', 'Definition of every KPI: numerator, denominator, window, exclusions. Formulas are proposed defaults until the owner approves them.'),
  m('reporting.exports', 'My exports', '/reporting/exports', 'Audited CSV/XLSX exports. Each export is logged.'),

  m('notifications', 'Notifications', '/notifications', 'In-app notifications. Queued is not delivered: delivery status is tracked.'),

  m('admin.users', 'Users', '/admin/users', 'Invite, deactivate and manage users in your scope. Deactivating an executive creates reassignment tasks for their open leads.'),
  m('admin.teams', 'Teams', '/admin/teams', 'Teams and their members under each manager (4-5 executives per manager by default, configurable).'),
  m('admin.settings', 'Organisation settings', '/admin/settings', 'Business timezone, working days and organisation-wide settings.'),
  m('admin.audit', 'Audit log', '/admin/audit', 'Append-only log of privileged actions: role changes, exports, payments, refunds, policy changes.'),
  m('admin.roles', 'Roles and permissions', '/admin/roles', 'Assign primary and secondary roles. Only Founder assigns Founder, HR or Finance.'),
  m('admin.developer', 'Developer Panel', '/admin/developer', 'This panel: super-admin tools, above every business role.'),
  m('admin.integrations', 'Integrations and delivery', '/admin/integrations', 'Webhooks and message delivery providers with signature checks.'),
  m('admin.files', 'File storage', '/admin/files', 'Private file storage settings and upload policy.'),
  m('admin.ai', 'AI Copilot', '/admin/ai', 'Optional, flag-gated AI helper. The CRM works fully with AI off; AI output is a suggestion only.'),
  m('files', 'My files', '/files', 'Your uploaded files in private storage.'),
];

export interface GuideRole {
  role: string;
  /** What this role is for, in one or two sentences. */
  summary: string;
  lands: string;
  /** Limits worth knowing (deny-by-default). */
  limits: string[];
}

export const GUIDE_ROLES: GuideRole[] = [
  { role: 'DEVELOPER', summary: 'Super admin for the platform. Not a business role: no CRM, revenue or HR data.', lands: '/admin/developer', limits: ['Sees only Dashboard, Audit log and the Developer Panel.', 'Has no attendance, goals or leave pages (not an employee).', 'Every action in the panel is audited.'] },
  { role: 'FOUNDER_CEO', summary: 'Owner of the business. Organisation-wide view of everything and final approver.', lands: '/dashboard/founder', limits: ['Only role that can assign Founder, HR and Finance roles.', 'Sees payroll, HR policy and leave balances.', 'Does not see the Developer Panel unless also given the Developer role.'] },
  { role: 'SALES_TEAM_LEAD', summary: 'Runs the whole sales team under the Founder: targets, exceptions, coaching, reports.', lands: '/dashboard/team-lead', limits: ['Attendance, goals and leave are team scope, not whole organisation.', 'No payroll, HR policy or leave-balance adjustment.'] },
  { role: 'SALES_MANAGER', summary: 'Leads 4-5 executives (soft, configurable limit). Owns their follow-up discipline and coaching.', lands: '/dashboard/manager', limits: ['Team scope only: own executives.', 'No CRM settings, SOP approvals, Founder reports or risk register.', 'No pricing page.'] },
  { role: 'SALES_EXECUTIVE', summary: 'Telecaller. Works own leads, calls, follow-ups and own goals.', lands: '/dashboard/executive', limits: ['Own scope: sees only own leads, tasks, deals and goals.', 'No imports, reassignment, duplicate review or CRM settings.', 'Cannot create or edit campaign plans (read only).', 'No leave approvals, reports exports or strategy plans.'] },
  { role: 'ADMIN', summary: 'Runs users, teams, settings and integrations. Not a sales or HR role.', lands: '/dashboard/admin', limits: ['No CRM, revenue, coaching, payroll or HR data unless given a secondary role.', 'Can assign roles except Founder, HR and Finance.'] },
  { role: 'FINANCE', summary: 'Secondary group: money. Collections, refunds, forecasts, incentives payout and payroll.', lands: '/dashboard (workspace home)', limits: ['No lead or call data.', 'Reporting is revenue, KPIs and exports only.'] },
  { role: 'HR', summary: 'Secondary group: people operations. Employee records, leave, attendance corrections, probation, policy, payroll.', lands: '/dashboard (workspace home)', limits: ['No lead data; revenue appears only in the revenue report.', 'Can correct attendance for the organisation, each correction audited.'] },
  { role: 'MARKETING', summary: 'Secondary group: lead generation. Sees leads and events at minimum data and plans campaigns with Sales.', lands: '/dashboard (workspace home)', limits: ['No deals, money or HR pages.', 'Can create and edit campaign plans; sees reporting but not payroll.'] },
  { role: 'COMMUNITY', summary: 'Secondary group: community and events. Plans with Sales and shares insights.', lands: '/dashboard (workspace home)', limits: ['No CRM, deals or HR pages.', 'Can edit campaign plans and share insights.'] },
  { role: 'OPERATIONS', summary: 'Secondary group: delivery and operations. Handovers after a sale and event logistics.', lands: '/dashboard (workspace home)', limits: ['Customer care limited to Handovers.', 'No CRM, deals or HR pages.'] },
  { role: 'STUDENT_SUCCESS', summary: 'Secondary group: learner support after joining. Complaints, relationships, satisfaction, handovers.', lands: '/dashboard (workspace home)', limits: ['Sees leads at minimum data only; no call dispositions.', 'No payroll or HR pages.'] },
];

export interface GuideFlow {
  title: string;
  steps: string[];
}

/** Features asked about in the 2026-10-16 audit, written as end-to-end flows. */
export const GUIDE_FLOWS: GuideFlow[] = [
  {
    title: 'Attendance',
    steps: [
      'Every employee role has attendance:self, so everyone checks in from the dashboard card or /work/attendance (office or WFH).',
      'Self check-in is open on working days until the cutoff (default 11:00 IST). After it, the button is replaced by a notice and HR or a manager records attendance.',
      'Late is decided by the "late after" policy time. A short day is stored as a half day and flagged for the manager.',
      'A nightly day-close job marks working days with no record as absent. Holidays and weekly offs are never marked absent.',
      'Team Lead and Manager see their team, HR and Founder see the organisation. Corrections need a reason and write old and new value to the audit log.',
      'After check-in, a Zoom meeting link is shown when HR has set one (https links only).',
    ],
  },
  {
    title: 'Goals (45-day cycle)',
    steps: [
      'Anyone can create a goal for themselves; managers can assign goals to their team, the Founder to anyone.',
      'The owner posts progress (and optional milestones). If a numeric target exists, progress % is calculated from the posted value.',
      'The owner submits it. The reviewer (manager) verifies it or returns it with a comment. Status: Active, Waiting for verification, Completed, Cancelled.',
      'Risk is On track, At risk or Overdue, computed from progress against the share of the cycle that has passed.',
      'Views: My goals, Team goals, To review, Everyone I can see, by scope.',
    ],
  },
  {
    title: 'Sales plan (campaign plans)',
    steps: [
      'Marketing, Community, Operations or Sales leadership create a plan for a campaign, webinar, event or lead-gen push, with a window, planned leads and a sales plan note (how Sales will follow up).',
      'Webinar and event plans must link a webinar/event record. Link a program, campaign or lead source as well, otherwise actual leads cannot be counted.',
      'The plan card shows planned versus actual leads created in the window (counts only) and event attendance counts.',
      'Edit a plan to change the window, planned leads, note or links, and move it Planned, Active, Completed or Cancelled. Completed and Cancelled plans are final. Every change is audited.',
      'Sales plans for revenue (initiatives and targets) are separate: Revenue, Strategy plans.',
    ],
  },
];
