import type { CatalogueEntry } from '@salesos/shared-types';
import type { RoleKey, ScopeLevel } from '@salesos/shared-types';
import { PERMISSION_SETS, type PermissionDef } from './permissions';

type KeysOf<T> = T extends { defs: infer D } ? keyof D : never;
/** Union of every declared permission key (grows automatically as domains add keys). */
export type PermissionKey = Extract<KeysOf<(typeof PERMISSION_SETS)[number]>, string>;

interface Flat extends PermissionDef {
  key: PermissionKey;
  domain: string;
}

const flat: Flat[] = [];
for (const set of PERMISSION_SETS) {
  for (const [key, def] of Object.entries(set.defs as Record<string, PermissionDef>)) {
    if (flat.some((f) => f.key === key)) throw new Error(`Duplicate permission key in catalogue: ${key}`);
    flat.push({ key: key as PermissionKey, domain: set.domain, ...def });
  }
}

export const PERMISSION_CATALOGUE: readonly Flat[] = flat;
export const PERMISSION_KEYS: readonly PermissionKey[] = flat.map((f) => f.key);
const byKey = new Map(flat.map((f) => [f.key as string, f]));

export const isKnownPermission = (key: string): key is PermissionKey => byKey.has(key);

/** Role -> (permission -> scope). Derived from the catalogue; this is the authoritative mapping. */
export function grantsForRole(role: RoleKey): Record<string, ScopeLevel> {
  const out: Record<string, ScopeLevel> = {};
  for (const f of flat) {
    const s = f.grants[role];
    if (s) out[f.key] = s;
  }
  return out;
}

export function catalogueEntries(): CatalogueEntry[] {
  return flat.map((f) => ({
    key: f.key,
    domain: f.domain,
    description: f.description,
    sensitive: f.sensitive ?? false,
    grants: { ...f.grants } as Record<string, ScopeLevel>,
  }));
}
