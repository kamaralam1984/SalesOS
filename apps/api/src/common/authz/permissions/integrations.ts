import { definePermissions } from './define';

/**
 * integrations permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the integrations agent: edit this file only.
 */
export const integrationsPermissions = definePermissions('integrations', {
  'integrations:manage': { description: 'Manage integrations, webhooks, devices', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
});
