'use client';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '../client';
import type { PaginationMeta } from '../types';

/* ------------------------------------------------------------------ wire types (mirror apps/api crm serializers) */
export type StageCategory = 'OPEN' | 'WON' | 'LOST' | 'NURTURE';
export type Interest = 'LOW' | 'MEDIUM' | 'HIGH';
export type CallOutcome =
  | 'CONNECTED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'SWITCHED_OFF'
  | 'CALLBACK'
  | 'FAILED'
  | 'WON'
  | 'LOST';
export type TaskType =
  | 'CALL'
  | 'CALLBACK'
  | 'FOLLOW_UP'
  | 'DEMO'
  | 'EMAIL'
  | 'WEBINAR_REMINDER'
  | 'ONBOARDING'
  | 'MANAGER_REVIEW'
  | 'OTHER';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface Lead {
  id: string;
  fullName: string;
  phone?: string | null;
  phoneE164?: string | null;
  phoneValid?: boolean;
  email?: string | null;
  status: string;
  stageCategory: StageCategory;
  interestLevel?: Interest | null;
  assignedTo?: { id: string; name: string | null } | null;
  teamId?: string | null;
  source: { id: string; name: string | null } | null;
  program: { id: string; name: string | null; code: string | null } | null;
  nextActionAt?: string | null;
  nextActionType?: TaskType | null;
  estimatedValue?: string | null;
  currency?: string;
  wonValue?: string | null;
  lostReason?: string | null;
  lostNote?: string | null;
  consent?: { status: string; at: string | null; source: string | null };
  lastActivityAt?: string | null;
  lastContactAt?: string | null;
  callAttemptCount?: number;
  duplicateFlag?: boolean;
  isKeyProspect?: boolean;
  createdAt: string;
  version?: number;
  preferredLanguage?: string | null;
  ageing?: { sinceCreationDays: number; sinceActivityDays: number; creationBucket: string; activityBucket: string };
  overdue?: boolean;
  lastCall?: { outcome: string; objectionCategory: string | null; interestLevel: string | null; at: string; source: string } | null;
  latestEvent?: { eventId: string; title: string; type: string; status: string; startsAt: string } | null;
  exceptions?: string[];
  /** summary-scope projection (Marketing / Student Success): no contact data */
  summary?: true;
}

export interface LeadDetail extends Lead {
  contacts: { id: string; kind: string; value: string; label: string | null }[];
  recentCalls: { id: string; outcome: CallOutcome; source: string; startedAt: string; interestLevel: string | null; objectionCategory: string | null; notes: string | null; userName: string | null }[];
  openTasks: { id: string; type: TaskType; title: string; dueAt: string; priority: TaskPriority; isPinned: boolean; version?: number; description?: string | null; assignedToId: string; assignedToName: string | null; overdue: boolean }[];
  attendances: { id: string; status: string; event: { id: string; title: string; type: string; startsAt: string; status: string } }[];
  assignments: { id: string; from: { name: string | null } | null; to: { name: string | null } | null; changedBy: { name: string | null } | null; method: string; reason: string | null; at: string }[];
  statusHistory: { id: string; from: string | null; to: string; reason: string | null; at: string }[];
  openDuplicateCount: number;
  stages: { key: string; label: string; category: StageCategory; sortOrder: number }[];
}

export interface LeadMeta {
  stages: { key: string; label: string; category: StageCategory; sortOrder: number }[];
  lostReasons: { key: string; label: string; requiresNote: boolean }[];
  sources: { id: string; name: string; type: string }[];
  programs: { id: string; code: string; name: string; kind: string }[];
  callOutcomes: { key: CallOutcome; label: string }[];
  objectionCategories: { key: string; label: string }[];
  taskTypes: { key: TaskType; label: string }[];
}

export interface CrmTask {
  id: string;
  leadId: string | null;
  lead: { id: string; fullName: string; phone: string | null; status: string } | null;
  assignedTo: { id: string; name: string | null };
  type: TaskType;
  title: string;
  description: string | null;
  dueAt: string;
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  priority: TaskPriority;
  isPinned: boolean;
  overdue: boolean;
  overdueLevel: number;
  completedAt: string | null;
  completionNote: string | null;
  ruleKey: string | null;
  version: number;
}

export interface Workspace {
  counts: { overdueLeads: number; tasksToday: number; overdueTasks: number; pinned: number; unattended: number; exceptions: number };
  tasksToday: WorkspaceTask[];
  pinnedTasks: WorkspaceTask[];
  priorityLeads: Lead[];
  upcomingEvents: { id: string; title: string; type: string; startsAt: string }[];
}
export interface WorkspaceTask {
  id: string;
  type: TaskType;
  title: string;
  dueAt: string;
  priority: TaskPriority;
  isPinned: boolean;
  overdue: boolean;
  leadId: string | null;
  lead: { id: string; fullName: string; phone: string | null } | null;
}

export interface TimelineEntry {
  type: string;
  at: string;
  actorName: string | null;
  title: string;
  detail?: string | null;
  data: Record<string, unknown>;
}

export interface LeadsQuery {
  q?: string;
  status?: string;
  category?: string;
  assignedToId?: string;
  sourceId?: string;
  programId?: string;
  interestLevel?: string;
  duplicate?: boolean;
  overdue?: boolean;
  mine?: boolean;
  noActivityDays?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/* ------------------------------------------------------------------ queries */
export const crmKey = (...parts: unknown[]) => ['crm', ...parts] as const;

export function useLeads(q: LeadsQuery) {
  return useQuery({
    queryKey: crmKey('leads', 'list', q),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<Lead[]>('/leads', q as Record<string, string | number | boolean>);
      return { items: r.data, pagination: r.meta.pagination as PaginationMeta | undefined };
    },
  });
}

export const useLead = (id: string) =>
  useQuery({ queryKey: crmKey('leads', 'detail', id), queryFn: async () => (await api.get<LeadDetail>(`/leads/${id}`)).data });

export const useLeadMeta = () =>
  useQuery({ queryKey: crmKey('meta'), staleTime: 60_000, queryFn: async () => (await api.get<LeadMeta>('/leads/meta')).data });

export const useWorkspace = () =>
  useQuery({ queryKey: crmKey('workspace'), queryFn: async () => (await api.get<Workspace>('/leads/workspace')).data });

export function useTimeline(id: string) {
  return useInfiniteQuery({
    queryKey: crmKey('leads', 'timeline', id),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const r = await api.get<TimelineEntry[]>(`/leads/${id}/timeline`, { limit: 20, before: pageParam });
      return { items: r.data, next: r.meta.pagination?.hasMore ? ((r.meta.pagination as { nextCursor?: string }).nextCursor ?? undefined) : undefined };
    },
    getNextPageParam: (last) => last.next,
  });
}

export interface TasksQuery {
  status?: 'OPEN' | 'DONE' | 'CANCELLED' | 'ALL';
  overdue?: boolean;
  mine?: boolean;
  pinned?: boolean;
  leadId?: string;
  assignedToId?: string;
  page?: number;
  limit?: number;
}
export function useTasks(q: TasksQuery) {
  return useQuery({
    queryKey: crmKey('tasks', 'list', q),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<CrmTask[]>('/tasks', q as Record<string, string | number | boolean>);
      return { items: r.data, pagination: r.meta.pagination as PaginationMeta | undefined };
    },
  });
}

export interface CalendarData {
  timezone: string;
  days: { date: string; count: number; tasks: CrmTask[] }[];
  overdue: CrmTask[];
}
export function useCalendar(from: string, to: string, mine?: boolean) {
  return useQuery({
    queryKey: crmKey('tasks', 'calendar', from, to, mine),
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<CalendarData>('/tasks/calendar', { from, to, mine })).data,
  });
}

export interface ExceptionRow {
  id: string;
  kind: 'NO_OWNER' | 'NO_NEXT_ACTION' | 'UNATTENDED' | 'MANAGER_REVIEW' | 'OWNER_DEACTIVATED';
  detail: string | null;
  detectedAt: string;
  lead: Lead;
}
export function useExceptions(kind?: string, page = 1) {
  return useQuery({
    queryKey: crmKey('exceptions', kind, page),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<ExceptionRow[]>('/leads/exceptions', { kind, page, limit: 25 });
      return { items: r.data, counts: (r.meta.counts ?? {}) as Record<string, number>, pagination: r.meta.pagination as PaginationMeta | undefined };
    },
  });
}

export interface QueueEntry {
  id: string;
  reason: string;
  status: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  resolvedBy?: { id: string; name: string | null } | null;
  previousOwner: { id: string; name: string | null } | null;
  newOwner: { id: string; name: string | null } | null;
  createdAt: string;
  lead: { id: string; fullName: string; status: string; nextActionAt: string | null } | null;
  task: { id: string; title: string; type: string; dueAt: string; leadId: string | null } | null;
}
export function useReassignmentQueue(status: 'OPEN' | 'RESOLVED' = 'OPEN') {
  return useQuery({
    queryKey: crmKey('reassignment', status),
    queryFn: async () => (await api.get<QueueEntry[]>('/reassignment-queue', { status, limit: 100 })).data,
  });
}

export interface DuplicateRow {
  id: string;
  matchType: string;
  status: string;
  leadA: Lead;
  leadB: Lead;
}
export const useDuplicates = () =>
  useQuery({ queryKey: crmKey('duplicates'), queryFn: async () => (await api.get<DuplicateRow[]>('/leads/duplicates', { limit: 50 })).data });

export interface ReactivationRow {
  id: string;
  status: string;
  eligible: boolean;
  eligibleFrom: string;
  attempts: number;
  lostReason: string | null;
  lead: Lead;
}
export const useReactivation = () =>
  useQuery({ queryKey: crmKey('reactivation'), queryFn: async () => (await api.get<ReactivationRow[]>('/leads/reactivation', { limit: 50 })).data });

export interface SalesUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
}
/** Active users that can own leads, within the caller's visible users (the API enforces scope on assignment). */
export function useAssignableUsers() {
  return useQuery({
    queryKey: crmKey('assignable-users'),
    staleTime: 60_000,
    queryFn: async () => {
      const r = await api.get<SalesUser[] | { items: SalesUser[] }>('/users', { limit: 100, isActive: 'true' });
      const items = Array.isArray(r.data) ? r.data : r.data.items;
      return items.filter((u) => u.roles.some((x) => x.startsWith('SALES_') || x === 'FOUNDER_CEO'));
    },
  });
}

export interface SavedView {
  id: string;
  name: string;
  filters: LeadsQuery;
}
export const useSavedViews = () =>
  useQuery({ queryKey: crmKey('views'), queryFn: async () => (await api.get<SavedView[]>('/leads/views')).data });

/* ------------------------------------------------------------------ mutations */
function useCrmMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }) });
}

export interface CreateLeadInput {
  fullName: string;
  phone?: string;
  email?: string;
  sourceId?: string | null;
  programId?: string | null;
  interestLevel?: Interest | null;
  consentStatus?: string;
  note?: string;
  assignedToId?: string | null;
  autoAssign?: 'round_robin' | 'none';
}
let createSeq = 0;
export const useCreateLead = () =>
  useCrmMutation(async (input: CreateLeadInput & { idempotencyKey?: string }) => {
    const { idempotencyKey, ...body } = input;
    const r = await api.post<{ lead: Lead; created: boolean; possibleDuplicates: { id: string; fullName: string }[] }>('/leads', body, {
      headers: { 'Idempotency-Key': idempotencyKey ?? `ui-${Date.now()}-${createSeq++}` },
    });
    return { ...r.data, warnings: r.meta.warnings ?? [] };
  });

export const useAssignLead = () =>
  useCrmMutation(async (i: { id: string; toUserId?: string; mode?: 'user' | 'round_robin'; reason: string }) =>
    (await api.post<Lead>(`/leads/${i.id}/assign`, { toUserId: i.toUserId, mode: i.mode ?? 'user', reason: i.reason })).data);

export interface UpdateLeadInput {
  id: string;
  version?: number;
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  sourceId?: string | null;
  programId?: string | null;
  interestLevel?: Interest | null;
  estimatedValue?: string | number | null;
  preferredLanguage?: string | null;
  consentStatus?: 'UNKNOWN' | 'GRANTED' | 'WITHDRAWN' | 'DND';
  consentSource?: string | null;
  isKeyProspect?: boolean;
}
/** Edit lead fields (PATCH /leads/:id). Sends only changed fields plus the version for optimistic concurrency. */
export const useUpdateLead = () =>
  useCrmMutation(async (i: UpdateLeadInput) => {
    const { id, ...body } = i;
    return (await api.patch<Lead>(`/leads/${id}`, body)).data;
  });

export const useChangeStatus = () =>
  useCrmMutation(async (i: { id: string; status: string; reason?: string; lostReason?: string; lostNote?: string; wonValue?: number }) => {
    const { id, ...body } = i;
    return (await api.post<Lead>(`/leads/${id}/status`, body)).data;
  });

export interface CallInput {
  outcome: CallOutcome;
  durationSeconds?: number;
  notes?: string;
  interestLevel?: Interest;
  objectionCategory?: string;
  nextActionAt?: string;
  nextActionType?: TaskType;
  callbackAt?: string;
  taskId?: string;
  lostReason?: string;
  lostNote?: string;
  wonValue?: number;
}
export interface CallResult {
  call: { id: string; source: string; outcome: CallOutcome };
  lead: { id: string; status: string; stageCategory: StageCategory; nextActionAt: string | null } | null;
  tasksCreated: { id: string; type: string; dueAt: string; title: string }[];
  statusChanges: { from: string; to: string }[];
  warnings: string[];
}
export const useLogCall = () =>
  useCrmMutation(async (i: { leadId: string; body: CallInput; key?: string }) => {
    const r = await api.post<Omit<CallResult, 'warnings'>>(`/leads/${i.leadId}/calls`, i.body, { headers: i.key ? { 'Idempotency-Key': i.key } : undefined });
    return { ...r.data, warnings: r.meta.warnings ?? [] } as CallResult;
  });

export const useAddNote = () =>
  useCrmMutation(async (i: { leadId: string; body: string; visibility?: 'SHARED' | 'PRIVATE' }) =>
    (await api.post(`/leads/${i.leadId}/notes`, { body: i.body, visibility: i.visibility ?? 'SHARED' })).data);

export interface CreateTaskInput {
  leadId?: string;
  type: TaskType;
  title: string;
  dueAt: string;
  priority?: TaskPriority;
  description?: string;
  assignedToId?: string;
}
export const useCreateTask = () =>
  useCrmMutation(async (i: CreateTaskInput) => {
    const { leadId, ...body } = i;
    const path = leadId ? `/leads/${leadId}/tasks` : '/tasks';
    return (await api.post<CrmTask>(path, body)).data;
  });

export const useCompleteTask = () =>
  useCrmMutation(async (i: { id: string; completionNote?: string }) => (await api.post<CrmTask>(`/tasks/${i.id}/complete`, { completionNote: i.completionNote })).data);

export const useUpdateTask = () =>
  useCrmMutation(async (i: { id: string; dueAt?: string; title?: string; priority?: TaskPriority }) => {
    const { id, ...body } = i;
    return (await api.patch<CrmTask>(`/tasks/${id}`, body)).data;
  });

export const useReassignTask = () =>
  useCrmMutation(async (i: { id: string; assignedToId: string; reason: string }) => {
    const { id, ...body } = i;
    return (await api.post<CrmTask>(`/tasks/${id}/reassign`, body)).data;
  });

export const useLinkEvent = () =>
  useCrmMutation(async (i: { leadId: string; eventId: string; status: string; reason?: string; newEventId?: string }) => {
    const { leadId, ...body } = i;
    const r = await api.post(`/leads/${leadId}/events`, body);
    return { data: r.data, warnings: r.meta.warnings ?? [] };
  });

export const useResolveException = () =>
  useCrmMutation(async (i: { id: string; note: string }) => (await api.post(`/leads/exceptions/${i.id}/resolve`, { note: i.note })).data);

export interface BulkResult {
  resolved: number;
  skipped: number;
  results: { entryId: string; status: 'RESOLVED' | 'SKIPPED'; error?: string }[];
}
export const useBulkAssign = () =>
  useCrmMutation(async (i: { entryIds: string[]; toUserId: string; reason: string }) => (await api.post<BulkResult>('/reassignment-queue/bulk-assign', i)).data);

export const useMergeDuplicate = () =>
  useCrmMutation(async (i: { id: string; winnerLeadId: string; takeFromLoser: string[]; reason: string }) => {
    const { id, ...body } = i;
    return (await api.post(`/leads/duplicates/${id}/merge`, body)).data;
  });
export const useDismissDuplicate = () =>
  useCrmMutation(async (i: { id: string; reason: string }) => (await api.post(`/leads/duplicates/${i.id}/dismiss`, { reason: i.reason })).data);

export const useReactivate = () =>
  useCrmMutation(async (i: { id: string; toUserId?: string; reason: string }) => {
    const { id, ...body } = i;
    return (await api.post(`/leads/reactivation/${id}/reactivate`, body)).data;
  });

export const useSaveView = () => useCrmMutation(async (i: { name: string; filters: LeadsQuery }) => (await api.post<SavedView>('/leads/views', i)).data);
export const useDeleteView = () => useCrmMutation(async (id: string) => (await api.delete(`/leads/views/${id}`)).data);

export { useQueryClient };
