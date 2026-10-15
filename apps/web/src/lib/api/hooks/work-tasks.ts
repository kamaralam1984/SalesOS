'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

/** Workforce work tasks. Query keys: ['work', 'tasks', ...]; every mutation invalidates the ['work', 'tasks'] and ['work', 'goals'] trees (linked tasks). */
export type TaskStatus = 'ASSIGNED' | 'ACCEPTED' | 'IN_PROGRESS' | 'REVIEW' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export const TASK_STATUSES: readonly TaskStatus[] = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED'];
export const TASK_PRIORITIES: readonly TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export interface WorkTask {
  id: string; title: string; description: string | null; priority: TaskPriority; status: TaskStatus; project: string | null; evidence: string | null; reviewNote: string | null;
  assignerId: string; assignerName: string | null; assigneeId: string; assigneeName: string | null;
  dueAt: string | null; completedAt: string | null; overdue: boolean; goalId: string | null; goalTitle: string | null;
  version: number; createdAt: string; updatedAt: string;
  can: { transitions: Partial<Record<TaskStatus, boolean>>; edit: boolean; comment: boolean };
}
export interface TaskEvent { id: string; kind: 'CREATED' | 'STATUS' | 'COMMENT' | 'EVIDENCE' | 'REASSIGNED' | 'UPDATED'; actorId: string | null; actorName: string | null; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string }
export interface WorkTaskDetail extends WorkTask { events: TaskEvent[] }
export interface TaskSummary { total: number; byStatus: Partial<Record<TaskStatus, number>>; overdue: number; dueSoon: number; mine: { open: number; overdue: number }; awaitingMyReview: number }

export interface TaskListQuery { view: 'mine' | 'assigned' | 'team' | 'all'; status?: string; overdue?: boolean; goalId?: string; page: number; limit: number }
export interface CreateTaskInput { title: string; description?: string; priority: TaskPriority; assigneeId?: string; dueAt?: string; goalId?: string; project?: string }

export const taskKeys = {
  all: ['work', 'tasks'] as const,
  list: (q: object) => ['work', 'tasks', 'list', q] as const,
  summary: ['work', 'tasks', 'summary'] as const,
  detail: (id: string) => ['work', 'tasks', 'detail', id] as const,
};

export function useWorkTasks(q: TaskListQuery) {
  return useQuery({
    queryKey: taskKeys.list(q),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<WorkTask[]>('/workforce/tasks', { view: q.view, status: q.status || undefined, overdue: q.overdue === undefined ? undefined : String(q.overdue), goalId: q.goalId, page: q.page, limit: q.limit });
      return { items: r.data, hasMore: Boolean((r.meta.pagination as { hasMore?: boolean } | undefined)?.hasMore) };
    },
  });
}
export const useTaskSummary = () => useQuery({ queryKey: taskKeys.summary, queryFn: async () => (await api.get<TaskSummary>('/workforce/tasks/summary')).data });
export const useWorkTask = (id: string) => useQuery({ queryKey: taskKeys.detail(id), queryFn: async () => (await api.get<WorkTaskDetail>(`/workforce/tasks/${id}`)).data });

function useTaskMutation<V>(fn: (v: V) => Promise<WorkTaskDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: taskKeys.all }), qc.invalidateQueries({ queryKey: ['work', 'goals'] })]),
  });
}
export const useCreateTask = () => useTaskMutation((b: CreateTaskInput) => api.post<WorkTaskDetail>('/workforce/tasks', b).then((r) => r.data));
export const useUpdateTask = (id: string) => useTaskMutation((b: Record<string, unknown>) => api.patch<WorkTaskDetail>(`/workforce/tasks/${id}`, b).then((r) => r.data));
export const useTransitionTask = (id: string) =>
  useTaskMutation((b: { to: TaskStatus; note?: string; evidence?: string; version?: number }) => api.post<WorkTaskDetail>(`/workforce/tasks/${id}/transition`, b).then((r) => r.data));
export const useCommentTask = (id: string) => useTaskMutation((b: { note: string }) => api.post<WorkTaskDetail>(`/workforce/tasks/${id}/comment`, b).then((r) => r.data));
