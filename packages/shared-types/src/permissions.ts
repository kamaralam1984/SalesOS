import type { ScopeLevel } from './roles';

/** Permission keys look like `resource:action`, e.g. `leads:read`. */
export type PermissionString = string;

export interface EffectivePermission {
  key: PermissionString;
  scope: ScopeLevel;
}

export interface CatalogueEntry {
  key: PermissionString;
  domain: string;
  description: string;
  sensitive: boolean;
  grants: Record<string, ScopeLevel>;
}

/** Identity permission keys (canonical names from docs/permissions-matrix.md). */
export const IDENTITY_PERMISSIONS = {
  AUTH_ME_VIEW: 'auth:me:view',
  AUTH_SESSION_REVOKE_OWN: 'auth:session:revoke-own',
  USERS_VIEW: 'users:view',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DEACTIVATE: 'users:deactivate',
  USERS_ROLE_ASSIGN: 'users:role:assign',
  USERS_ROLE_ASSIGN_SENSITIVE: 'users:role:assign-sensitive',
  USERS_DELEGATION_MANAGE: 'users:delegation:manage',
  TEAMS_VIEW: 'teams:view',
  TEAMS_CREATE: 'teams:create',
  TEAMS_UPDATE: 'teams:update',
  TEAMS_DELETE: 'teams:delete',
  AUDIT_VIEW: 'audit:view',
  AUDIT_EXPORT: 'audit:export',
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_UPDATE: 'settings:update',
  HR_RECORDS_VIEW: 'hr:records:view',
  COLLECTIONS_VERIFY: 'collections:verify',
} as const;
