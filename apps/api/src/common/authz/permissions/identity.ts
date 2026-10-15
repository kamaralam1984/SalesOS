import { definePermissions } from './define';

/** Identity domain permissions (Agent B). Generated from docs/permissions-matrix.md; edit freely afterwards. */
export const identityPermissions = definePermissions('identity', {
  'auth:login': { description: 'Log in / out', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'org', SALES_EXECUTIVE: 'org', ADMIN: 'org', FINANCE: 'org', HR: 'org', MARKETING: 'org', COMMUNITY: 'org', OPERATIONS: 'org', STUDENT_SUCCESS: 'org' } },
  'auth:me:view': { description: 'View own profile and effective permissions', grants: { FOUNDER_CEO: 'own', SALES_TEAM_LEAD: 'own', SALES_MANAGER: 'own', SALES_EXECUTIVE: 'own', ADMIN: 'own', FINANCE: 'own', HR: 'own', MARKETING: 'own', COMMUNITY: 'own', OPERATIONS: 'own', STUDENT_SUCCESS: 'own' } },
  'auth:session:revoke-own': { description: 'Revoke own sessions', grants: { FOUNDER_CEO: 'own', SALES_TEAM_LEAD: 'own', SALES_MANAGER: 'own', SALES_EXECUTIVE: 'own', ADMIN: 'own', FINANCE: 'own', HR: 'own', MARKETING: 'own', COMMUNITY: 'own', OPERATIONS: 'own', STUDENT_SUCCESS: 'own' } },
  'users:view': { description: 'List/view users', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', ADMIN: 'org', HR: 'summary' } },
  'users:create': { description: 'Create/invite users', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
  'users:update': { description: 'Update user fields (non-role)', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
  'users:deactivate': { description: 'Deactivate user (triggers reassignment queue)', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
  'users:role:assign': { description: 'Assign/revoke roles and secondary groups', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
  'users:delegation:manage': { description: 'Grant time-bound team delegation', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org' } },
  'teams:view': { description: 'View teams', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own', ADMIN: 'org', HR: 'summary' } },
  'teams:create': { description: 'Create team', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
  'teams:update': { description: 'Update team and membership', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', ADMIN: 'org' } },
  'teams:delete': { description: 'Delete team (empty only)', grants: { ADMIN: 'org' } },
  'audit:view': { description: 'View audit logs', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', ADMIN: 'org' } },
  'audit:export': { description: 'Export audit logs', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
  'settings:view': { description: 'View org settings', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', ADMIN: 'org' } },
  'settings:update': { description: 'Update org settings (stages, rules, thresholds)', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', ADMIN: 'org' } },
  'settings:policy:approve': { description: 'Approve sensitive policy change', grants: { FOUNDER_CEO: 'org' } },
  'users:role:assign-sensitive': { description: 'Assign FOUNDER_CEO / HR / FINANCE roles (tightening beyond the matrix; NEEDS_DECISION)', sensitive: true, grants: { FOUNDER_CEO: 'org' } },
});
