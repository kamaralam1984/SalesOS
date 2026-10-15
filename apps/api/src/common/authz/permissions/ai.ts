import { definePermissions } from './define';

/**
 * ai permissions. Seeded from docs/permissions-matrix.md (canonical). Owned by the ai agent: edit this file only.
 */
export const aiPermissions = definePermissions('ai', {
  'ai:use': { description: 'Use AI Copilot (flag on)', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', SALES_MANAGER: 'team', SALES_EXECUTIVE: 'own' } },
  'ai:config': { description: 'Configure AI provider/flag', grants: { FOUNDER_CEO: 'org', ADMIN: 'org' } },
  'ai:usage:view': { description: 'View AI usage and cost', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'org', ADMIN: 'org' } },
});
