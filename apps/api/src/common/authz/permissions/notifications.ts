import { definePermissions } from './define';

/**
 * notifications permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the notifications agent: edit this file only.
 */
export const notificationsPermissions = definePermissions('notifications', {
  'notifications:view': { description: 'View own notifications', grants: { FOUNDER_CEO: 'own', SALES_TEAM_LEAD: 'own', SALES_MANAGER: 'own', SALES_EXECUTIVE: 'own', ADMIN: 'own', FINANCE: 'own', HR: 'own', MARKETING: 'own', COMMUNITY: 'own', OPERATIONS: 'own', STUDENT_SUCCESS: 'own' } },
  'notifications:manage-prefs': { description: 'Manage own preferences', grants: { FOUNDER_CEO: 'own', SALES_TEAM_LEAD: 'own', SALES_MANAGER: 'own', SALES_EXECUTIVE: 'own', ADMIN: 'own', FINANCE: 'own', HR: 'own', MARKETING: 'own', COMMUNITY: 'own', OPERATIONS: 'own', STUDENT_SUCCESS: 'own' } },
  'notifications:config': { description: 'Configure notification rules/quiet hours', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', ADMIN: 'org' } },
});
