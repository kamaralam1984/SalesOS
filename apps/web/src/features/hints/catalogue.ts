/**
 * Central hint catalogue.
 *
 * Structure only: ids, the routes they belong to and optional "learn more" links.
 * The words live in messages/{en,hi,mr}.json under `hints.page.<id>` (what / first / tip) and `hints.tip.<id>` (title / body),
 * so every hint is translated. A unit test checks that every id here has text in all three languages.
 */

export interface PageHintDef {
  /** Route pattern. `*` matches exactly one dynamic segment. Longest literal match wins. */
  route: string;
  /** Module, for grouping and tests. */
  module: string;
  /** True when messages contain an extra `tip` line for this page. */
  tip?: boolean;
  /** Internal link to a deeper page (rendered as "Learn more"). */
  learnMore?: string;
}

export const PAGE_HINTS = {
  // dashboards
  dashboardFounder: {
    route: '/dashboard/founder',
    module: 'dashboard',
    tip: true,
    learnMore: '/reporting/kpis',
  },
  dashboardTeamLead: {
    route: '/dashboard/team-lead',
    module: 'dashboard',
    tip: true,
    learnMore: '/reporting/kpis',
  },
  dashboardManager: { route: '/dashboard/manager', module: 'dashboard', tip: true },
  dashboardExecutive: { route: '/dashboard/executive', module: 'dashboard', tip: true },
  dashboardAdmin: { route: '/dashboard/admin', module: 'dashboard' },
  // crm
  crmWorkspace: { route: '/crm', module: 'crm', tip: true },
  crmLeads: { route: '/crm/leads', module: 'crm', tip: true },
  crmLeadDetail: { route: '/crm/leads/*', module: 'crm', tip: true },
  crmTasks: { route: '/crm/tasks', module: 'crm' },
  crmCalendar: { route: '/crm/calendar', module: 'crm' },
  crmOverdue: { route: '/crm/overdue', module: 'crm', tip: true },
  crmExceptions: { route: '/crm/exceptions', module: 'crm', tip: true },
  crmReassignment: { route: '/crm/reassignment', module: 'crm' },
  crmDuplicates: { route: '/crm/duplicates', module: 'crm' },
  crmReactivation: { route: '/crm/reactivation', module: 'crm' },
  crmImports: { route: '/crm/imports', module: 'crm', tip: true },
  crmEvents: { route: '/crm/events', module: 'crm' },
  crmEventDetail: { route: '/crm/events/*', module: 'crm' },
  crmSettings: { route: '/crm/settings', module: 'crm' },
  // revenue
  revenueHome: { route: '/revenue', module: 'revenue', tip: true },
  revenueDeals: { route: '/revenue/deals', module: 'revenue' },
  revenueDealDetail: { route: '/revenue/deals/*', module: 'revenue', tip: true },
  revenueTargets: { route: '/revenue/targets', module: 'revenue', tip: true },
  revenueCollections: { route: '/revenue/collections', module: 'revenue', tip: true },
  revenueRefunds: { route: '/revenue/refunds', module: 'revenue', tip: true },
  revenueForecasts: { route: '/revenue/forecasts', module: 'revenue', tip: true },
  revenuePricing: { route: '/revenue/pricing', module: 'revenue' },
  revenueIntel: { route: '/revenue/intel', module: 'revenue' },
  revenueStrategy: { route: '/revenue/strategy', module: 'revenue' },
  // people
  peopleHub: { route: '/people', module: 'people' },
  peopleCoaching: { route: '/people/coaching', module: 'people' },
  peopleOneOnOnes: { route: '/people/one-on-ones', module: 'people' },
  peopleKpis: { route: '/people/kpis', module: 'people' },
  peopleReviews: { route: '/people/reviews', module: 'people' },
  peopleReviewDetail: { route: '/people/reviews/*', module: 'people' },
  peoplePips: { route: '/people/pips', module: 'people' },
  peoplePipDetail: { route: '/people/pips/*', module: 'people' },
  peopleRecognition: { route: '/people/recognition', module: 'people' },
  peopleIncentives: { route: '/people/incentives', module: 'people', tip: true },
  peopleIncentiveDetail: { route: '/people/incentives/*', module: 'people' },
  peopleHiring: { route: '/people/hiring', module: 'people' },
  peopleOnboarding: { route: '/people/onboarding', module: 'people' },
  peopleSuccession: { route: '/people/succession', module: 'people' },
  peopleSkills: { route: '/people/skills', module: 'people' },
  peopleEngagement: { route: '/people/engagement', module: 'people' },
  peopleEmployees: { route: '/people/employees', module: 'people' },
  peopleEmployeeDetail: { route: '/people/employees/*', module: 'people' },
  // sop
  sopLibrary: { route: '/sop', module: 'sop' },
  sopReader: { route: '/sop/*', module: 'sop' },
  sopEditorNew: { route: '/sop/new', module: 'sop', tip: true },
  sopEditor: { route: '/sop/*/edit', module: 'sop', tip: true },
  sopDiff: { route: '/sop/*/diff', module: 'sop' },
  sopAdoption: { route: '/sop/adoption', module: 'sop' },
  sopGaps: { route: '/sop/gaps', module: 'sop' },
  sopApprovals: { route: '/sop/approvals', module: 'sop' },
  // customer care
  cxHub: { route: '/cx', module: 'cx' },
  cxComplaints: { route: '/cx/complaints', module: 'cx', tip: true },
  cxComplaintDetail: { route: '/cx/complaints/*', module: 'cx' },
  cxEscalations: { route: '/cx/escalations', module: 'cx' },
  cxRelationships: { route: '/cx/relationships', module: 'cx' },
  cxRelationshipDetail: { route: '/cx/relationships/*', module: 'cx' },
  cxSatisfaction: { route: '/cx/satisfaction', module: 'cx' },
  cxRefunds: { route: '/cx/refunds', module: 'cx' },
  cxHandovers: { route: '/cx/handovers', module: 'cx', tip: true },
  cxHandoverDetail: { route: '/cx/handovers/*', module: 'cx' },
  cxHandoverNew: { route: '/cx/handovers/new', module: 'cx' },
  cxFounderReports: { route: '/cx/founder-reports', module: 'cx' },
  cxFounderReportDetail: { route: '/cx/founder-reports/*', module: 'cx' },
  cxActionItems: { route: '/cx/action-items', module: 'cx' },
  cxRisks: { route: '/cx/risks', module: 'cx' },
  // collaboration
  collabTasks: { route: '/collaboration', module: 'collaboration' },
  collabPlans: { route: '/collaboration/plans', module: 'collaboration' },
  collabInsights: { route: '/collaboration/insights', module: 'collaboration' },
  // reporting
  reportingHome: { route: '/reporting', module: 'reporting' },
  reportingReport: { route: '/reporting/*', module: 'reporting', tip: true },
  reportingKpis: { route: '/reporting/kpis', module: 'reporting' },
  reportingReconciliation: { route: '/reporting/reconciliation', module: 'reporting' },
  reportingExports: { route: '/reporting/exports', module: 'reporting' },
  // admin and platform
  adminIndex: { route: '/admin', module: 'admin' },
  adminUsers: { route: '/admin/users', module: 'admin', tip: true },
  adminTeams: { route: '/admin/teams', module: 'admin' },
  adminTeamDetail: { route: '/admin/teams/*', module: 'admin' },
  adminSettings: { route: '/admin/settings', module: 'admin' },
  adminAudit: { route: '/admin/audit', module: 'admin' },
  adminRoles: { route: '/admin/roles', module: 'admin' },
  adminIntegrations: { route: '/admin/integrations', module: 'admin' },
  adminFiles: { route: '/admin/files', module: 'admin' },
  adminAi: { route: '/admin/ai', module: 'admin' },
  notifications: { route: '/notifications', module: 'platform' },
  files: { route: '/files', module: 'platform' },
} as const satisfies Record<string, PageHintDef>;

export type PageHintId = keyof typeof PAGE_HINTS;

/** Field / KPI / button level hints (the small "?" buttons). Text: messages `hints.tip.<id>.{title,body}`. */
export const TIP_HINTS = {
  leadOwnerNextAction: { learnMore: '/crm/exceptions' },
  callOutcome: {},
  callWon: {},
  callLost: {},
  callNoAnswer: {},
  leadStage: {},
  leadConsent: {},
  importConsent: {},
  importIdempotent: {},
  attemptsVsClients: {},
  dealClosedWon: {},
  dealFinalValue: {},
  paymentReference: {},
  paymentVerified: {},
  refundSteps: {},
  forecastAccuracy: { learnMore: '/reporting/kpis' },
  targetBreakdown: {},
  exceptionQueue: {},
  manualCallLabel: {},
  handoverChecklist: {},
  complaintClock: {},
  sopAcknowledge: {},
  userSecondaryRoles: {},
  hintsToggle: {},
} as const satisfies Record<string, { learnMore?: string }>;

export type TipHintId = keyof typeof TIP_HINTS;

/** Find the hint definition whose route pattern best matches the pathname (most literal segments wins). */
export function matchPageHint(pathname: string | null | undefined): PageHintId | null {
  if (!pathname) return null;
  const parts = pathname.split('?')[0]!.split('/').filter(Boolean);
  let best: { id: PageHintId; score: number } | null = null;
  for (const [id, def] of Object.entries(PAGE_HINTS) as [PageHintId, PageHintDef][]) {
    const pat = def.route.split('/').filter(Boolean);
    if (pat.length !== parts.length) continue;
    let score = 0;
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      if (pat[i] === '*') continue;
      if (pat[i] !== parts[i]) {
        ok = false;
        break;
      }
      score++;
    }
    if (ok && (!best || score > best.score)) best = { id, score };
  }
  return best ? best.id : null;
}
