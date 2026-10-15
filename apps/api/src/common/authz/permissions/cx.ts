import { definePermissions } from './define';

/**
 * cx permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the cx agent: edit this file only.
 */
export const cxPermissions = definePermissions('cx', {
  'complaints:view': { description: 'View complaints', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', STUDENT_SUCCESS: 'org' } },
  'complaints:create': { description: 'Log complaint/escalation', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', STUDENT_SUCCESS: 'org' } },
  'complaints:update': { description: 'Update/resolve complaint', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', STUDENT_SUCCESS: 'org' } },
  'complaints:export': { description: 'Export complaints', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org' } },
  'satisfaction:view': { description: 'View satisfaction/enrolment-experience scores', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', STUDENT_SUCCESS: 'org' } },
  'satisfaction:create': { description: 'Record satisfaction/enrolment feedback', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', STUDENT_SUCCESS: 'org' } },
  'relationships:view': { description: 'View learner/prospect relationship history', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', STUDENT_SUCCESS: 'summary' } },
  'relationships:update': { description: 'Add relationship notes; manage own key-prospect watchlist (Phase 7 addition)', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'handover:view': { description: 'View handovers', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', OPERATIONS: 'summary', STUDENT_SUCCESS: 'org' } },
  'handover:create': { description: 'Create/submit handover', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'handover:acknowledge': { description: 'Acknowledge/accept/reject handover', grants: { STUDENT_SUCCESS: 'org' } },
  'founder-reports:view': { description: 'View founder reports/snapshots', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org' } },
  'founder-reports:create': { description: 'Build/submit founder report', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org' } },
  'founder-reports:review': { description: 'Review/rate founder report', grants: { FOUNDER_CEO: 'org' } },
  'action-items:view': { description: 'View action items', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'action-items:create': { description: 'Create action item', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'action-items:update': { description: 'Update/complete action item (own or scoped)', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'insights:share': { description: 'Share learner/market insights', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org', STUDENT_SUCCESS: 'org' } },
});
