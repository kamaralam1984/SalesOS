import { definePermissions } from './define';

/**
 * files permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the files agent: edit this file only.
 */
export const filesPermissions = definePermissions('files', {
  'files:upload': { description: 'Upload file', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', ADMIN: 'org', FINANCE: 'org', HR: 'org', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org', STUDENT_SUCCESS: 'org' } },
  'files:view': { description: 'View/download file in scope', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', FINANCE: 'summary', HR: 'summary', MARKETING: 'summary', COMMUNITY: 'summary', OPERATIONS: 'summary', STUDENT_SUCCESS: 'summary' } },
  'files:delete': { description: 'Delete file (audited)', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', ADMIN: 'org' } },
  'imports:view': { description: 'View import jobs/errors', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', ADMIN: 'org' } },
  'imports:manage': { description: 'Retry/cancel import jobs', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
});
