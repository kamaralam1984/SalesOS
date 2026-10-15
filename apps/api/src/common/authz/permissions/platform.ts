import { definePermissions } from './define';

/**
 * platform permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the platform agent: edit this file only.
 */
export const platformPermissions = definePermissions('platform', {
  'jobs:dlq:view': { description: 'View dead-letter jobs', grants: { ADMIN: 'org' } },
  'jobs:dlq:retry': { description: 'Retry dead-letter jobs', grants: { ADMIN: 'org' } },
});
