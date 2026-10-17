'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { RoleKey } from '../types';

/** Account approvals and password-reset links (HR, Founder, Developer). Links come back ONCE and are never stored. */
export interface PendingUser {
  id: string; name: string; email: string; department: string | null; roles: RoleKey[]; createdAt: string;
  createdById: string | null; createdByName: string | null; canApprove: boolean;
}
export interface ResetRequest { id: string; userId: string; name: string; email: string; roles: RoleKey[]; requestedAt: string; canIssue: boolean }
export interface IssuedLink { link: string; expiresAt: string }
export interface ApprovedAccount { id: string; approvalStatus: 'APPROVED'; invite: IssuedLink }
export interface ResetLink extends IssuedLink { userId: string; name: string; email: string }

const key = ['approvals'] as const;

export const usePendingUsers = () =>
  useQuery({ queryKey: [...key, 'pending'], queryFn: async () => (await api.get<PendingUser[]>('/users/pending')).data });

export const useResetRequests = () =>
  useQuery({ queryKey: [...key, 'resets'], queryFn: async () => (await api.get<ResetRequest[]>('/users/password-resets')).data });

function useApprovalMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['users'] })]) });
}

export const useApproveUser = () => useApprovalMutation(async (id: string) => (await api.post<ApprovedAccount>(`/users/${id}/approve`, {})).data);
export const useRejectUser = () => useApprovalMutation(async (v: { id: string; reason?: string }) => (await api.post(`/users/${v.id}/reject`, v.reason ? { reason: v.reason } : {})).data);
export const useIssueReset = () => useApprovalMutation(async (requestId: string) => (await api.post<ResetLink>(`/users/password-resets/${requestId}/issue`, {})).data);
export const useDismissReset = () => useApprovalMutation(async (requestId: string) => (await api.post(`/users/password-resets/${requestId}/dismiss`, {})).data);
export const useResetDirect = () => useApprovalMutation(async (email: string) => (await api.post<ResetLink>('/users/password-resets/direct', { email })).data);
