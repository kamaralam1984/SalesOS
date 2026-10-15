import { definePermissions } from './define';

/**
 * sop permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the sop agent: edit this file only.
 */
export const sopPermissions = definePermissions('sop', {
  'sop:view': { description: 'View effective SOPs', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'org', SALES_EXECUTIVE: 'org', ADMIN: 'org', FINANCE: 'org', HR: 'org', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org', STUDENT_SUCCESS: 'org' } },
  'sop:create': { description: 'Create/edit SOP draft', grants: { SALES_TEAM_LEAD: 'org' } },
  'sop:approve': { description: 'Approve/publish SOP version', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org' } },
  'sop:acknowledge': { description: 'Acknowledge SOP version', grants: { FOUNDER_CEO: 'own', SALES_TEAM_LEAD: 'own', SALES_MANAGER: 'own', SALES_EXECUTIVE: 'own', ADMIN: 'own', FINANCE: 'own', HR: 'own', MARKETING: 'own', COMMUNITY: 'own', OPERATIONS: 'own', STUDENT_SUCCESS: 'own' } },
  'sop:adoption:view': { description: 'View acknowledgement/adoption tracking', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'sop:gaps:view': { description: 'View process-gap backlog', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'sop:gaps:manage': { description: 'Manage process-gap backlog', grants: { SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
});
