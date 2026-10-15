import { definePermissions } from './define';

/**
 * collaboration permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the collaboration agent: edit this file only.
 */
export const collaborationPermissions = definePermissions('collaboration', {
  'xf-tasks:view': { description: 'View cross-functional tasks', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org', STUDENT_SUCCESS: 'org' } },
  'xf-tasks:create': { description: 'Create cross-functional task', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org', STUDENT_SUCCESS: 'org' } },
  'xf-tasks:update': { description: 'Update/complete cross-functional task', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org', STUDENT_SUCCESS: 'org' } },
});
