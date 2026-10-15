import { Injectable } from '@nestjs/common';
import type { RoleKey, ScopeLevel } from '@salesos/shared-types';
import { SCOPE_RANK } from '@salesos/shared-types';
import { grantsForRole } from './permissions.catalogue';

@Injectable()
export class PermissionResolver {
  /** Merge grants over all held roles, keeping the broadest scope per permission. */
  effective(roles: RoleKey[]): Map<string, ScopeLevel> {
    const out = new Map<string, ScopeLevel>();
    for (const role of roles) {
      for (const [key, scope] of Object.entries(grantsForRole(role))) {
        const cur = out.get(key);
        if (!cur || SCOPE_RANK[scope] > SCOPE_RANK[cur]) out.set(key, scope);
      }
    }
    return out;
  }
}
