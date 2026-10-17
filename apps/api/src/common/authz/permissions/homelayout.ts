import { definePermissions } from './define';

/** Phone/desktop home layout: everyone reads their own; Founder (and the Developer super-admin) edit it for every role. */
export const homelayoutPermissions = definePermissions('homelayout', {
  'home-layout:view': {
    description: 'See the home layout set for your role',
    grants: { DEVELOPER: 'own', FOUNDER_CEO: 'own', SALES_TEAM_LEAD: 'own', SALES_MANAGER: 'own', SALES_EXECUTIVE: 'own', ADMIN: 'own', FINANCE: 'own', HR: 'own', MARKETING: 'own', COMMUNITY: 'own', OPERATIONS: 'own', STUDENT_SUCCESS: 'own' },
  },
  'home-layout:manage': {
    description: 'Set the home layout (widgets, order, size) for every role and preview each role\'s phone home',
    grants: { DEVELOPER: 'org', FOUNDER_CEO: 'org' },
  },
});
