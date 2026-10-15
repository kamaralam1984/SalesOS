'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

/** Workforce leave + Earned Leave (area A). Query keys: ['work','leave',...]; every mutation invalidates the whole tree (balances, requests, ledger, progress). */
export type LeaveStatus = 'PENDING_MANAGER' | 'PENDING_HR' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export const LEAVE_STATUSES: readonly LeaveStatus[] = ['PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED', 'CANCELLED'];
export type HalfDay = 'NONE' | 'FIRST_HALF' | 'SECOND_HALF';
export type LeaveView = 'mine' | 'team' | 'pending-me' | 'all';

export interface LeaveType { key: string; name: string; isPaid: boolean; needsBalance: boolean; maxConsecutiveDays: number | null }
export interface LeaveBalance { typeKey: string; name: string; isPaid: boolean; needsBalance: boolean; active: boolean; balance: number; pending: number; available: number }
export interface LeaveStepView { step: 'MANAGER' | 'HR'; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED'; actorId: string | null; actorName: string | null; comment: string | null; decidedAt: string | null }
export interface LeaveRequest {
  id: string; userId: string; userName: string | null; typeKey: string; startDate: string; endDate: string; halfDay: HalfDay; days: string; unpaidDays: string; reason: string;
  status: LeaveStatus; cancelReason: string | null; createdAt: string; updatedAt: string; steps: LeaveStepView[]; can: { decide: boolean; cancel: boolean };
}
export interface LedgerRow {
  id: string; typeKey: string; kind: string; amount: string; balanceBefore: string; balanceAfter: string; leaveRequestId: string | null; periodStart: string | null; periodEnd: string | null;
  eligibleDays: string | null; note: string | null; createdById: string | null; createdByName: string | null; createdAt: string;
}
export interface ElDayOutcome { date: string; status: string; eligible: number; reason: string; source: string }
export interface EarnedLeaveProgress {
  userId: string; enabled: boolean; requiredEligibleDays: number; creditDays: number; leaveTypeKey: string; eligibleDays: number; daysToNextCredit: number; creditsGiven: number;
  processedThrough: string | null; periodStart: string | null; balance: number; dayLog: ElDayOutcome[];
}
export interface EarnedLeaveTxn {
  id: string; kind: 'CREDIT_EARNED' | 'EXPIRY'; typeKey: string; amount: string; balanceBefore: string; balanceAfter: string; periodStart: string | null; periodEnd: string | null; eligibleDays: string | null;
  calculation: { days?: ElDayOutcome[] } | null; policyVersion: number | null; note: string | null; createdAt: string;
}
export interface LeaveCalendarEntry { requestId: string; userId: string; userName: string | null; typeKey: string; startDate: string; endDate: string; halfDay: HalfDay; status: 'APPROVED' | 'PENDING' }

export const leaveKeys = {
  all: ['work', 'leave'] as const,
  types: ['work', 'leave', 'types'] as const,
  balances: (userId?: string) => ['work', 'leave', 'balances', userId ?? 'me'] as const,
  ledger: (q: object) => ['work', 'leave', 'ledger', q] as const,
  requests: (q: object) => ['work', 'leave', 'requests', q] as const,
  calendar: (from: string, to: string) => ['work', 'leave', 'calendar', from, to] as const,
  el: (userId?: string) => ['work', 'leave', 'el', userId ?? 'me'] as const,
  elTxns: (userId?: string) => ['work', 'leave', 'el-txns', userId ?? 'me'] as const,
};

export const useLeaveTypes = () => useQuery({ queryKey: leaveKeys.types, queryFn: async () => (await api.get<LeaveType[]>('/workforce/leave/types')).data, staleTime: 5 * 60_000 });
export const useLeaveBalances = (userId?: string, enabled = true) =>
  useQuery({ queryKey: leaveKeys.balances(userId), enabled, queryFn: async () => (await api.get<{ userId: string; balances: LeaveBalance[] }>('/workforce/leave/balances', { userId })).data.balances });
export function useLeaveLedger(q: { userId?: string; typeKey?: string; page: number; limit: number }, enabled = true) {
  return useQuery({
    queryKey: leaveKeys.ledger(q), enabled, placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<LedgerRow[]>('/workforce/leave/ledger', { userId: q.userId, typeKey: q.typeKey || undefined, page: q.page, limit: q.limit });
      return { items: r.data, hasMore: Boolean((r.meta.pagination as { hasMore?: boolean } | undefined)?.hasMore) };
    },
  });
}
export function useLeaveRequests(q: { view: LeaveView; status?: string; page: number; limit: number }, enabled = true) {
  return useQuery({
    queryKey: leaveKeys.requests(q), enabled, placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<LeaveRequest[]>('/workforce/leave/requests', { view: q.view, status: q.status || undefined, page: q.page, limit: q.limit });
      return { items: r.data, hasMore: Boolean((r.meta.pagination as { hasMore?: boolean } | undefined)?.hasMore) };
    },
  });
}
export const useLeaveCalendar = (from: string, to: string, enabled = true) =>
  useQuery({ queryKey: leaveKeys.calendar(from, to), enabled, queryFn: async () => (await api.get<{ entries: LeaveCalendarEntry[] }>('/workforce/leave/calendar', { from, to })).data.entries });
export const useEarnedLeaveProgress = (userId?: string, enabled = true) =>
  useQuery({ queryKey: leaveKeys.el(userId), enabled, queryFn: async () => (await api.get<EarnedLeaveProgress>('/workforce/earned-leave/progress', { userId })).data });
export const useEarnedLeaveTransactions = (userId?: string, enabled = true) =>
  useQuery({ queryKey: leaveKeys.elTxns(userId), enabled, queryFn: async () => (await api.get<EarnedLeaveTxn[]>('/workforce/earned-leave/transactions', { userId, limit: 50 })).data });

function useLeaveMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: leaveKeys.all }) });
}
export interface ApplyLeaveInput { typeKey: string; startDate: string; endDate: string; halfDay: HalfDay; reason: string; confirmUnpaid: boolean }
export const useApplyLeave = () => useLeaveMutation((b: ApplyLeaveInput) => api.post<LeaveRequest>('/workforce/leave/requests', b).then((r) => r.data));
export const useDecideLeave = () =>
  useLeaveMutation((v: { id: string; decision: 'APPROVE' | 'REJECT'; comment?: string }) => api.post<LeaveRequest>(`/workforce/leave/requests/${v.id}/decision`, { decision: v.decision, ...(v.comment ? { comment: v.comment } : {}) }).then((r) => r.data));
export const useCancelLeave = () => useLeaveMutation((v: { id: string; reason: string }) => api.post<LeaveRequest>(`/workforce/leave/requests/${v.id}/cancel`, { reason: v.reason }).then((r) => r.data));
export interface AdjustInput { userId: string; typeKey: string; amount: string; kind: 'ADJUSTMENT' | 'OPENING'; reason: string }
export const useAdjustBalance = () => useLeaveMutation((b: AdjustInput) => api.post<LedgerRow>('/workforce/leave/balances/adjust', b).then((r) => r.data));
export const useRunEarnedLeave = () =>
  useLeaveMutation((userId?: string) => api.post<{ users: number; credits: number }>('/workforce/earned-leave/run', userId ? { userId } : {}).then((r) => r.data));
