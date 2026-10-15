/** Test helper: a stand-in for '@/features/auth/auth-provider' driven by a mutable state object. */
import * as React from 'react';

export interface AuthState { userId: string; perms: Record<string, 'own' | 'team' | 'org'> }
const RANK = { own: 1, team: 2, org: 3 } as const;

export function makeAuthModule(state: AuthState) {
  const can = (p: string | readonly string[] | null | undefined, min?: 'own' | 'team' | 'org') => {
    if (p === null || p === undefined) return true;
    const list = typeof p === 'string' ? [p] : p;
    return list.length === 0 || list.some((k) => state.perms[k] !== undefined && (!min || RANK[state.perms[k]!] >= RANK[min]));
  };
  return {
    useAuth: () => ({ user: { id: state.userId }, can, status: 'authenticated' }),
    usePermission: (p: string | readonly string[], min?: 'own' | 'team' | 'org') => can(p, min),
    Can: ({ permission, minScope, children, fallback = null }: { permission: string | readonly string[]; minScope?: 'own' | 'team' | 'org'; children: React.ReactNode; fallback?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, can(permission, minScope) ? children : fallback),
  };
}
