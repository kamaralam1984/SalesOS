import { definePermissions } from './define';

/**
 * crm permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the crm agent: edit this file only.
 */
export const crmPermissions = definePermissions('crm', {
  'leads:view': { description: 'View leads', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', MARKETING: 'summary', STUDENT_SUCCESS: 'summary' } },
  'leads:create': { description: 'Create lead', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'leads:update': { description: 'Update lead fields', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'leads:delete': { description: 'Delete/anonymise lead', grants: { FOUNDER_CEO: 'org' } },
  'leads:assign': { description: 'Assign/reassign lead', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'leads:status:change': { description: 'Change stage/status', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'leads:import': { description: 'CSV import leads', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', ADMIN: 'org' } },
  'leads:export': { description: 'Export leads', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'leads:duplicates:review': { description: 'Review/merge duplicates', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'leads:exceptions:view': { description: 'View exception and reassignment queue', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'leads:reassignment-queue:resolve': { description: 'Resolve reassignment queue entries', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'leads:reactivation:view': { description: 'View lost-lead reactivation queue', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'leads:timeline:view': { description: 'View lead timeline', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'leads:notes:create': { description: 'Add notes', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'leads:notes:view-private': { description: 'View private notes of others', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'calls:view': { description: 'View call logs', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'calls:create': { description: 'Log call disposition', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'calls:update': { description: 'Edit call log within edit window (audited)', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'calls:export': { description: 'Export call logs', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'tasks:view': { description: 'View tasks', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'tasks:create': { description: 'Create/schedule task', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'tasks:update': { description: 'Update/complete task', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'tasks:reassign': { description: 'Reassign tasks', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team' } },
  'sources:view': { description: 'View lead sources/campaigns', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', MARKETING: 'org' } },
  'sources:manage': { description: 'Manage sources/campaigns/programs', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', ADMIN: 'org', MARKETING: 'org' } },
  'programs:view': { description: 'View programs', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'org', SALES_EXECUTIVE: 'org', ADMIN: 'org', FINANCE: 'org', HR: 'org', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org', STUDENT_SUCCESS: 'org' } },
  'programs:manage': { description: 'Manage programs and pricing versions', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', ADMIN: 'org', FINANCE: 'org' } },
  'events:view': { description: 'View webinars/events/demos', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org' } },
  'events:manage': { description: 'Create/update events, record attendance', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org' } },
});
