'use client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

const B = '/dev-panel/security';
const key = {
  all: ['devpanel', 'security'] as const,
  sessions: (userId: string) => ['devpanel', 'security', 'sessions', userId] as const,
  history: (f: HistoryFilters) => ['devpanel', 'security', 'history', f] as const,
  locked: ['devpanel', 'security', 'locked'] as const,
  audit: (f: AuditFilters) => ['devpanel', 'security', 'audit', f] as const,
};

export interface SecuritySession {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  isCurrent: boolean;
}
export interface LoginEvent {
  id: string;
  action: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  ip: string | null;
  createdAt: string;
  reason: string | null;
}
export interface LockedAccount {
  id: string;
  name: string;
  email: string;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  isLocked: boolean;
}
export interface DevAuditRow {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}
export interface HistoryFilters { action?: string; userId?: string; from?: string; to?: string }
export interface AuditFilters { action?: string; actorId?: string; from?: string; to?: string }
export interface ResetLink { link: string; expiresAt: string }

/** `to` date inputs are whole days: make them inclusive of the end of that day. */
const toIso = (d: string | undefined, end = false) => (d ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00.000'}`).toISOString() : undefined);

function usePaged<T>(queryKey: readonly unknown[], path: string, params: Record<string, string | number | undefined>) {
  return useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const r = await api.get<T[]>(`${B}/${path}`, { ...params, limit: 25, cursor: pageParam });
      const meta = r.meta as { note?: string } | undefined;
      return { items: r.data ?? [], next: r.meta?.pagination?.nextCursor ?? null, note: meta?.note ?? null };
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

export const useSecuritySessions = (userId: string) =>
  usePaged<SecuritySession>(key.sessions(userId), 'sessions', { userId: userId || undefined });

export const useLoginHistory = (f: HistoryFilters) =>
  usePaged<LoginEvent>(key.history(f), 'login-history', { action: f.action || undefined, userId: f.userId || undefined, from: toIso(f.from), to: toIso(f.to, true) });

export const useDevAudit = (f: AuditFilters) =>
  usePaged<DevAuditRow>(key.audit(f), 'audit', { action: f.action || undefined, actorId: f.actorId || undefined, from: toIso(f.from), to: toIso(f.to, true) });

export const useLockedAccounts = () =>
  useQuery({ queryKey: key.locked, queryFn: async () => (await api.get<LockedAccount[]>(`${B}/locked-accounts`)).data ?? [] });

export function useRevokeSecuritySession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ id: string; revoked: number }>(`${B}/sessions/${id}/revoke`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: key.all }),
  });
}

export function useUnlockAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ id: string; unlocked: boolean }>(`${B}/users/${id}/unlock`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: key.all }),
  });
}

export function useIssueResetLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<ResetLink>(`${B}/users/${id}/reset-link`)).data as ResetLink,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['devpanel', 'security', 'audit'] }),
  });
}
