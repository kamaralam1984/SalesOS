import { Injectable } from '@nestjs/common';
import type { RoleKey, ScopeLevel } from '@salesos/shared-types';
import { SCOPE_RANK } from '@salesos/shared-types';
import { PrismaService } from '../prisma';
import { grantsForRole } from './permissions.catalogue';

export interface OverrideRow {
  subjectType: string;
  subjectKey: string;
  permissionKey: string;
  effect: string;
  scope: string | null;
}

const SCOPES = ['summary', 'own', 'team', 'org'] as const;
const asScope = (s: string | null): ScopeLevel => ((SCOPES as readonly string[]).includes(s ?? '') ? (s as ScopeLevel) : 'own');

/** Developer Panel permissions and the DEVELOPER role are never changed by feature overrides (they are managed by role assignment only). */
export const isProtectedKey = (key: string) => key.startsWith('devpanel:');

const widen = (m: Map<string, ScopeLevel>, key: string, scope: ScopeLevel) => {
  const cur = m.get(key);
  if (!cur || SCOPE_RANK[scope] > SCOPE_RANK[cur]) m.set(key, scope);
};

/**
 * Pure: effective permissions for one user = per role (catalogue default, then that role's overrides), merged keeping the broadest
 * scope; then the user's own overrides. DENY always wins over a grant from the same layer or a lower one.
 */
export function applyOverrides(roles: RoleKey[], rows: readonly OverrideRow[], userId?: string): Map<string, ScopeLevel> {
  const out = new Map<string, ScopeLevel>();
  for (const role of roles) {
    const mine = new Map<string, ScopeLevel>(Object.entries(grantsForRole(role)) as Array<[string, ScopeLevel]>);
    if (role !== 'DEVELOPER') {
      for (const r of rows) {
        if (r.subjectType !== 'ROLE' || r.subjectKey !== role || isProtectedKey(r.permissionKey)) continue;
        if (r.effect === 'DENY') mine.delete(r.permissionKey);
        else if (r.effect === 'GRANT') mine.set(r.permissionKey, asScope(r.scope));
      }
    }
    for (const [k, s] of mine) widen(out, k, s);
  }
  if (userId) {
    const denied = new Set<string>();
    for (const r of rows) {
      if (r.subjectType !== 'USER' || r.subjectKey !== userId || isProtectedKey(r.permissionKey)) continue;
      if (r.effect === 'DENY') denied.add(r.permissionKey);
      else if (r.effect === 'GRANT') widen(out, r.permissionKey, asScope(r.scope));
    }
    for (const k of denied) out.delete(k);
  }
  return out;
}

@Injectable()
export class PermissionResolver {
  private readonly cache = new Map<string, { at: number; rows: OverrideRow[] }>();
  /** Overrides are re-read at most this often per organisation (and immediately after a Developer Panel change on this instance). */
  private static readonly TTL_MS = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  /** Catalogue defaults only (no overrides): merge grants over all held roles, keeping the broadest scope per permission. */
  effective(roles: RoleKey[]): Map<string, ScopeLevel> {
    return applyOverrides(roles, []);
  }

  async overrides(organizationId: string): Promise<OverrideRow[]> {
    const hit = this.cache.get(organizationId);
    if (hit && Date.now() - hit.at < PermissionResolver.TTL_MS) return hit.rows;
    const rows = await this.prisma.featureOverride.findMany({
      where: { organizationId },
      select: { subjectType: true, subjectKey: true, permissionKey: true, effect: true, scope: true },
    });
    this.cache.set(organizationId, { at: Date.now(), rows });
    return rows;
  }

  invalidate(organizationId: string) {
    this.cache.delete(organizationId);
  }

  /** What this user can really do: catalogue defaults plus the Developer Panel's role and user overrides. */
  async effectiveFor(organizationId: string, userId: string, roles: RoleKey[]): Promise<Map<string, ScopeLevel>> {
    return applyOverrides(roles, await this.overrides(organizationId), userId);
  }
}
