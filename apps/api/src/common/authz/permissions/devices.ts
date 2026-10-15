import { definePermissions } from './define';

/**
 * devices permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the devices agent: edit this file only.
 */
export const devicesPermissions = definePermissions('devices', {
  'devices:register': { description: 'Register companion device', grants: { FOUNDER_CEO: 'own', SALES_TEAM_LEAD: 'own', SALES_MANAGER: 'own', SALES_EXECUTIVE: 'own' } },
});
