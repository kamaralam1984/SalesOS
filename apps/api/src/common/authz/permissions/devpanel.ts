import { definePermissions } from './define';

/**
 * Developer Panel (super-admin) permissions. Granted ONLY to DEVELOPER; deny-by-default for every other role,
 * including FOUNDER_CEO and ADMIN. All are sensitive: never implied by another role.
 */
export const devpanelPermissions = definePermissions('devpanel', {
  'devpanel:access': { description: 'Open the Developer Panel', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:roles:manage': { description: 'Grant/remove any role (except DEVELOPER) for any user', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:developer:assign': { description: 'Grant/remove the DEVELOPER role', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:sessions:revoke': { description: 'Revoke one user\'s sessions or force-logout everyone', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:server:view': { description: 'View server, database, Redis, worker and queue health', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:diagnostics:view': { description: 'View diagnostics: health latency, failed jobs, errors, migrations, build info', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:jobs:manage': { description: 'Retry or discard failed background jobs', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:security:view': { description: 'View live sessions, login history and locked accounts', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:security:manage': { description: 'Kill a session, unlock an account, issue a password-reset link', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:config:view': { description: 'View feature flags, integrations/backup status and the role matrix', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:features:view': { description: 'View which screens and features each role or user has, and the overrides', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:features:manage': { description: 'Switch screens and features on or off for a role or a user (Feature access)', sensitive: true, grants: { DEVELOPER: 'org' } },
  'devpanel:maintenance:manage': { description: 'Turn maintenance mode on or off', sensitive: true, grants: { DEVELOPER: 'org' } },
});
