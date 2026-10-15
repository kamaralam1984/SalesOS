'use client';
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, setUnauthorizedHandler } from '@/lib/api/client';
import { useLogout, useMeQuery } from '@/lib/api/hooks/auth';
import type { EffectivePermission, MeResponse, RoleKey, ScopeLevel } from '@/lib/api/types';
import { qk } from '@/lib/api/keys';

const SCOPE_RANK: Record<ScopeLevel, number> = { own: 1, team: 2, org: 3 };

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  me: MeResponse | null;
  user: MeResponse['user'] | null;
  permissions: EffectivePermission[];
  error: ApiError | Error | null;
  /** Any-of permission check. `null`/empty = signed-in only. UI hiding only; the server enforces. */
  can: (
    permission: string | readonly string[] | null | undefined,
    minScope?: ScopeLevel,
  ) => boolean;
  hasRole: (role: RoleKey) => boolean;
  refresh: () => Promise<unknown>;
  logout: (reason?: 'manual' | 'idle' | 'expired') => Promise<void>;
}

const AuthCtx = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const q = useMeQuery();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const logoutMutation = useLogout();
  const pathRef = React.useRef(pathname);
  const hadSession = React.useRef(false);
  const loggingOut = React.useRef(false);
  React.useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const { refetch, error } = q;
  const me = q.data ?? null;
  const permScopes = React.useMemo(
    () => new Map((me?.permissions ?? []).map((p) => [p.key, p.scope] as const)),
    [me],
  );

  const goLogin = React.useCallback(
    (reason?: string) => {
      const qs = new URLSearchParams();
      if (reason) qs.set('reason', reason);
      if (pathRef.current && pathRef.current !== '/') qs.set('next', pathRef.current);
      const q = qs.toString();
      router.replace(q ? `/login?${q}` : '/login');
    },
    [router],
  );

  // Global 401 handling: any API call that loses its session sends the user to sign-in with a notice.
  React.useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(qk.me, null);
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
      goLogin('expired');
    });
    return () => setUnauthorizedHandler(null);
  }, [qc, goLogin]);

  // Signed-out bootstrap (no session / expired): redirect.
  React.useEffect(() => {
    if (q.data) hadSession.current = true;
    // Signed out while the app was open (revoked, expired) gets a notice; a cold visit does not.
    if (loggingOut.current) return; // logout() navigates with its own reason
    if (q.isSuccess && q.data === null) goLogin(hadSession.current ? 'expired' : undefined);
  }, [q.isSuccess, q.data, goLogin]);

  const can = React.useCallback<AuthContextValue['can']>(
    (permission, minScope) => {
      if (!me) return false;
      if (permission === null || permission === undefined) return true;
      const list = typeof permission === 'string' ? [permission] : permission;
      if (list.length === 0) return true;
      return list.some((k) => {
        const scope = permScopes.get(k);
        return scope !== undefined && (!minScope || SCOPE_RANK[scope] >= SCOPE_RANK[minScope]);
      });
    },
    [me, permScopes],
  );

  const logout = React.useCallback<AuthContextValue['logout']>(
    async (reason = 'manual') => {
      loggingOut.current = true;
      try {
        await logoutMutation.mutateAsync();
      } catch {
        /* session may already be gone; continue */
      }
      qc.clear();
      router.replace(reason === 'manual' ? '/login?reason=signedout' : `/login?reason=${reason}`);
    },
    [logoutMutation, qc, router],
  );

  const status: AuthStatus = q.isPending
    ? 'loading'
    : q.isError
      ? 'error'
      : me
        ? 'authenticated'
        : 'unauthenticated';

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      user: me?.user ?? null,
      permissions: me?.permissions ?? [],
      error,
      can,
      hasRole: (r) => Boolean(me?.user.roles.includes(r)),
      refresh: () => refetch(),
      logout,
    }),
    [status, me, error, can, logout, refetch],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = React.useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be used within <AuthProvider>');
  return v;
}

/** `const canCreate = usePermission('users:create')` - hide controls only; the API is the authority. */
export function usePermission(
  permission: string | readonly string[] | null,
  minScope?: ScopeLevel,
): boolean {
  return useAuth().can(permission, minScope);
}

/** Render children only when permitted; optional fallback. */
export function Can({
  permission,
  minScope,
  children,
  fallback = null,
}: {
  permission: string | readonly string[] | null;
  minScope?: ScopeLevel;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return <>{usePermission(permission, minScope) ? children : fallback}</>;
}
