import { definePermissions } from './define';

/**
 * reporting permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the reporting agent: edit this file only.
 */
export const reportingPermissions = definePermissions('reporting', {
  'dashboard:ceo:view': { description: 'Founder dashboard', grants: { FOUNDER_CEO: 'org' } },
  'dashboard:team-lead:view': { description: 'Team Lead dashboard', grants: { SALES_TEAM_LEAD: 'org' } },
  'dashboard:manager:view': { description: 'Manager dashboard', grants: { SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'dashboard:salesperson:view': { description: 'Personal dashboard', grants: { FOUNDER_CEO: 'own', SALES_TEAM_LEAD: 'own', SALES_MANAGER: 'own', SALES_EXECUTIVE: 'own' } },
  'dashboard:system-health:view': { description: 'System health dashboard (no business data)', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
  'kpi:view': { description: 'View KPI values in scope', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', FINANCE: 'summary', HR: 'summary', MARKETING: 'summary', STUDENT_SUCCESS: 'summary' } },
  'kpi:definitions:view': { description: 'View KPI dictionary', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'org', SALES_EXECUTIVE: 'org', ADMIN: 'org', FINANCE: 'org', HR: 'org', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org', STUDENT_SUCCESS: 'org' } },
  'reports:view': { description: 'Run follow-up/conversion reports', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', MARKETING: 'summary' } },
  'reports:export': { description: 'Export reports (CSV/XLSX, audited)', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', FINANCE: 'org' } },
});
