import type { RoleKey, ScopeLevel } from '@salesos/shared-types';

export interface PermissionDef {
  description: string;
  /** Sensitive permissions (HR, payments, ...) are never implied by ADMIN. */
  sensitive?: boolean;
  /** Default role -> scope grants. Absent role = no access (deny-by-default). */
  grants: Partial<Record<RoleKey, ScopeLevel>>;
}

/**
 * Declare a domain's permissions. Keys are `resource:action`.
 * Use `as const`-style inference so PermissionKey stays a precise union.
 */
export function definePermissions<const T extends Record<`${string}:${string}`, PermissionDef>>(
  domain: string,
  defs: T,
): { domain: string; defs: T } {
  return { domain, defs };
}
