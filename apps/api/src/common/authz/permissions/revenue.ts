import { definePermissions } from './define';

/**
 * revenue permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the revenue agent: edit this file only.
 */
export const revenuePermissions = definePermissions('revenue', {
  'targets:view': { description: 'View targets', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', FINANCE: 'summary' } },
  'targets:create': { description: 'Create/allocate targets', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'targets:update': { description: 'Revise targets (reason required)', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org' } },
  'targets:approve': { description: 'Approve target revision', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org' } },
  'deals:view': { description: 'View deals', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', FINANCE: 'org', STUDENT_SUCCESS: 'summary' } },
  'deals:create': { description: 'Create deal', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'deals:update': { description: 'Update deal', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'deals:close': { description: 'Close won/lost', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'deals:escalate': { description: 'Escalate high-value deal', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'deals:export': { description: 'Export deals', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', FINANCE: 'org' } },
  'sales-adjustments:create': { description: 'Create sale adjustment record', sensitive: true, grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', FINANCE: 'org' } },
  'collections:view': { description: 'View payments/collections', sensitive: true, grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', FINANCE: 'org' } },
  'collections:create': { description: 'Record payment', sensitive: true, grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', FINANCE: 'org' } },
  'collections:verify': { description: 'Verify payment (Finance permission)', sensitive: true, grants: { FINANCE: 'org' } },
  'collections:reconcile': { description: 'Run/approve reconciliation', sensitive: true, grants: { FOUNDER_CEO: 'org', FINANCE: 'org' } },
  'collections:export': { description: 'Export collections', sensitive: true, grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', FINANCE: 'org' } },
  'refunds:view': { description: 'View refunds', sensitive: true, grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', FINANCE: 'org', STUDENT_SUCCESS: 'summary' } },
  'refunds:request': { description: 'Request refund', sensitive: true, grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', STUDENT_SUCCESS: 'org' } },
  'refunds:review': { description: 'Review refund request', sensitive: true, grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', FINANCE: 'org' } },
  'refunds:approve': { description: 'Approve/reject refund', sensitive: true, grants: { FOUNDER_CEO: 'org', FINANCE: 'org' } },
  'refunds:process': { description: 'Mark refund processed', sensitive: true, grants: { FINANCE: 'org' } },
  'refunds:reconcile': { description: 'Reconcile refund', sensitive: true, grants: { FINANCE: 'org' } },
  'forecasts:view': { description: 'View forecasts', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', FINANCE: 'summary' } },
  'forecasts:create': { description: 'Create forecast snapshot', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'proposals:view': { description: 'View pricing/offer proposals', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', FINANCE: 'org' } },
  'proposals:create': { description: 'Create proposal', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org' } },
  'proposals:approve': { description: 'Approve/reject proposal', grants: { FOUNDER_CEO: 'org' } },
  'market-intel:view': { description: 'View market/competitor/learner feedback log', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', MARKETING: 'org', COMMUNITY: 'org', STUDENT_SUCCESS: 'org' } },
  'market-intel:create': { description: 'Add feedback/opportunity entries', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', MARKETING: 'org', COMMUNITY: 'org', STUDENT_SUCCESS: 'org' } },
});
