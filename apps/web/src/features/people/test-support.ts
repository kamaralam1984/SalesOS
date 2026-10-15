import type { RoleKey } from '@/lib/api/types';

const RANK: Record<string, number> = { own: 1, team: 2, org: 3 };

/** Value for a mocked `useAuth()`: grants is { permissionKey: scope }. */
export function makeAuth(grants: Record<string, 'own' | 'team' | 'org'>, roles: RoleKey[] = [], id = 'me') {
  return {
    status: 'authenticated' as const,
    user: { id, name: 'Me', email: 'me@x.co', roles },
    can: (p: string | readonly string[] | null | undefined, min?: 'own' | 'team' | 'org') => {
      if (!p) return true;
      const list = typeof p === 'string' ? [p] : p;
      return list.some((k) => grants[k] !== undefined && (!min || RANK[grants[k]!]! >= RANK[min]!));
    },
    hasRole: (r: RoleKey) => roles.includes(r),
  };
}

export const page = <T,>(items: T[], hasMore = false) => ({ data: items, meta: { pagination: { mode: 'page', page: 1, limit: 10, hasMore } } });
export const one = <T,>(data: T) => ({ data, meta: {} });
