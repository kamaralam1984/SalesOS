'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

/** Workforce goals (45-day cycle). Query keys: ['work', 'goals', ...]; every mutation invalidates the whole ['work', 'goals'] tree. */
export type GoalStatus = 'ACTIVE' | 'PENDING_VERIFICATION' | 'COMPLETED' | 'CANCELLED';
export type GoalRisk = 'ON_TRACK' | 'AT_RISK' | 'COMPLETED' | 'OVERDUE';
export const GOAL_STATUSES: readonly GoalStatus[] = ['ACTIVE', 'PENDING_VERIFICATION', 'COMPLETED', 'CANCELLED'];
export const GOAL_RISKS: readonly GoalRisk[] = ['ON_TRACK', 'AT_RISK', 'OVERDUE', 'COMPLETED'];

export interface GoalMilestone { id: string; title: string; dueDate: string | null; done: boolean; doneAt: string | null }
export interface GoalCan {
  progress: boolean; edit: boolean; milestones: boolean; comment: boolean; submit: boolean; completeDirect: boolean; verify: boolean; return: boolean; cancel: boolean;
}
export interface Goal {
  id: string;
  ownerId: string; ownerName: string | null; reviewerId: string | null; reviewerName: string | null; createdById: string; createdByName: string | null;
  title: string; description: string | null;
  startDate: string; targetDate: string; cycleDays: number;
  targetValue: string | null; currentValue: string; unit: string | null; progressPct: number;
  status: GoalStatus; risk: GoalRisk; riskApplies: boolean; elapsedPct: number; daysToTarget: number;
  submittedAt: string | null; verifiedAt: string | null; verifiedByName: string | null;
  version: number; createdAt: string; updatedAt: string;
  milestones: GoalMilestone[];
  can: GoalCan;
}
export interface GoalUpdateRow { id: string; kind: 'PROGRESS' | 'COMMENT' | 'SUBMITTED' | 'VERIFIED' | 'RETURNED'; authorId: string; authorName: string | null; currentValue: string | null; progressPct: number | null; note: string | null; createdAt: string }
export interface GoalLinkedTask { id: string; title: string; status: string; priority: string; dueAt: string | null; assigneeId: string; assigneeName: string | null }
export interface GoalDetail extends Goal { updates: GoalUpdateRow[]; tasks: GoalLinkedTask[]; tasksAvailable: boolean }
export interface GoalSummary { total: number; byStatus: Partial<Record<GoalStatus, number>>; byRisk: Partial<Record<GoalRisk, number>>; awaitingMyVerification: number }

export interface GoalListQuery { view: 'mine' | 'team' | 'reviewing' | 'all'; status?: string; risk?: string; page: number; limit: number }
export interface CreateGoalInput {
  title: string; description?: string; ownerId?: string; startDate?: string; targetDate?: string; targetValue?: string; unit?: string; reviewerId?: string | null;
  milestones?: Array<{ title: string; dueDate?: string }>;
}

export const goalKeys = {
  all: ['work', 'goals'] as const,
  list: (q: object) => ['work', 'goals', 'list', q] as const,
  summary: ['work', 'goals', 'summary'] as const,
  detail: (id: string) => ['work', 'goals', 'detail', id] as const,
};

export function useGoals(q: GoalListQuery) {
  return useQuery({
    queryKey: goalKeys.list(q),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<Goal[]>('/workforce/goals', { view: q.view, status: q.status || undefined, risk: q.risk || undefined, page: q.page, limit: q.limit });
      return { items: r.data, hasMore: Boolean((r.meta.pagination as { hasMore?: boolean } | undefined)?.hasMore) };
    },
  });
}
export const useGoalSummary = () => useQuery({ queryKey: goalKeys.summary, queryFn: async () => (await api.get<GoalSummary>('/workforce/goals/summary')).data });
export const useGoal = (id: string) => useQuery({ queryKey: goalKeys.detail(id), queryFn: async () => (await api.get<GoalDetail>(`/workforce/goals/${id}`)).data });

function useGoalMutation<V>(fn: (v: V) => Promise<GoalDetail>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: goalKeys.all }) });
}
export const useCreateGoal = () => useGoalMutation((b: CreateGoalInput) => api.post<GoalDetail>('/workforce/goals', b).then((r) => r.data));
export const useUpdateGoal = (id: string) => useGoalMutation((b: Record<string, unknown>) => api.patch<GoalDetail>(`/workforce/goals/${id}`, b).then((r) => r.data));
export const usePostGoalProgress = (id: string) => useGoalMutation((b: { version?: number; currentValue?: string; progressPct?: number; note?: string }) => api.post<GoalDetail>(`/workforce/goals/${id}/progress`, b).then((r) => r.data));
export const useAddMilestone = (id: string) => useGoalMutation((b: { title: string; dueDate?: string }) => api.post<GoalDetail>(`/workforce/goals/${id}/milestones`, b).then((r) => r.data));
export const useUpdateMilestone = (id: string) => useGoalMutation((v: { milestoneId: string; done: boolean }) => api.patch<GoalDetail>(`/workforce/goals/${id}/milestones/${v.milestoneId}`, { done: v.done }).then((r) => r.data));
export const useCommentGoal = (id: string) => useGoalMutation((b: { note: string }) => api.post<GoalDetail>(`/workforce/goals/${id}/comment`, b).then((r) => r.data));
export type GoalActionBody = { version?: number; note?: string; reason?: string };
export const useGoalAction = (id: string, action: 'submit' | 'verify' | 'return' | 'cancel') =>
  useGoalMutation((b: GoalActionBody) => api.post<GoalDetail>(`/workforce/goals/${id}/${action}`, b).then((r) => r.data));
