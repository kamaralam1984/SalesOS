'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

/** Workforce directory, Employee 360, org chart, hub dashboard and announcements (area D1). All reads are server-scoped; sections the viewer may not see arrive as `{ available: false }`. */

export const wpk = {
  all: ['work', 'people'] as const,
  directory: (q: object) => ['work', 'people', 'directory', q] as const,
  departments: ['work', 'people', 'departments'] as const,
  employee: (id: string) => ['work', 'people', 'employee', id] as const,
  orgChart: (q: object) => ['work', 'people', 'org-chart', q] as const,
  dashboard: ['work', 'people', 'dashboard'] as const,
  announcements: (q: object) => ['work', 'people', 'announcements', q] as const,
};

type Q = Record<string, string | number | boolean | undefined | null>;
export type DirectoryStatus = 'ACTIVE' | 'PROBATION' | 'EXITED';
export interface PageInfo { hasMore: boolean; page?: number; limit: number; total?: number; totalPages?: number }

export interface DirectoryRow {
  id: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  manager: { id: string; name: string } | null;
  status: DirectoryStatus;
}
export function useDirectory(q: Q) {
  return useQuery({
    queryKey: wpk.directory(q),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<DirectoryRow[]>('/workforce/directory', q);
      return { items: r.data, pagination: r.meta.pagination as PageInfo | undefined };
    },
  });
}
export const useDirectoryDepartments = () =>
  useQuery({ queryKey: wpk.departments, queryFn: async () => (await api.get<string[]>('/workforce/directory/departments')).data });

type Na = { available: false };
type Sec<T> = ({ available: true } & T) | Na;
export interface Employee360 {
  id: string;
  generatedAt: string;
  profile: Sec<{ id: string; name: string; employeeCode: string | null; designation: string | null; department: string | null; manager: { id: string; name: string } | null; status: DirectoryStatus; joinDate: string | null; employmentType: string | null; workLocation: string | null; hrContact: { id: string; name: string } | null; email: string | null; isSelf: boolean }>;
  hr: Sec<{ employmentType: string | null; joinDate: string | null; exitDate: string | null; exitType: string | null; hasProfile: boolean }>;
  performance: Sec<{
    goals: Sec<{ hasData: boolean; byRisk: Record<string, number>; items: Array<{ id: string; title: string; status: string; risk: string; progressPct: number; startDate: string | null; targetDate: string | null }> }>;
    tasks: Sec<{ hasData: boolean; assigned: number; completed: number; inProgress: number; pending: number; overdue: number; completionRatePct: number | null }>;
  }>;
  attendance: Sec<{ hasData: boolean; month: string; counts: Record<string, number>; recent: Array<{ id: string; date: string | null; status: string; checkInAt: string | null; checkOutAt: string | null; workMinutes: number | null }> }>;
  leave: Sec<{ year: string; hasData: boolean; balances: Array<{ typeKey: string; name: string; remaining: number; used: number; pending: number }> }>;
  probation: Sec<{ hasData: boolean; startDate: string | null; durationMonths: number | null; endDate: string | null; status: 'UNKNOWN' | 'ON_PROBATION' | 'COMPLETED'; daysLeft: number | null; reviews: Array<{ id: string; checkpointDay: number; dueDate: string | null; status: string; outcome: string | null }> }>;
  activity: Sec<{ hasData: boolean; items: Array<{ id: string; source: 'goal' | 'task'; kind: string; at: string; entityId: string; title: string; note: string | null }> }>;
}
export const useEmployee360 = (id: string) =>
  useQuery({ queryKey: wpk.employee(id), enabled: Boolean(id), queryFn: async () => (await api.get<Employee360>(`/workforce/directory/${id}`)).data });

export interface OrgNode {
  id: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  status: DirectoryStatus;
  managerId: string | null;
  directReports: number;
  loop?: true;
  children: OrgNode[];
}
export interface OrgChart {
  view: 'organisation' | 'department' | 'team';
  department: string | null;
  team: { id: string; name: string } | null;
  roots: OrgNode[];
  total: number;
  truncated: boolean;
  limits: { maxNodes: number; maxDepth: number };
  departments: string[];
  teams: Array<{ id: string; name: string }>;
}
export const useOrgChart = (q: Q) =>
  useQuery({ queryKey: wpk.orgChart(q), placeholderData: keepPreviousData, queryFn: async () => (await api.get<OrgChart>('/workforce/org-chart', q)).data });

export interface WorkDashboard {
  generatedAt: string;
  today: string;
  timezone: string;
  scopeLevel: 'own' | 'team' | 'org';
  employee: {
    attendance: Sec<{ day: string; dayKind: string; holidayName: string | null; record: { status: string; checkInAt: string | null; checkOutAt: string | null; workMinutes: number | null } | null }>;
    tasks: Sec<{ hasData: boolean; open: number; overdue: number; dueToday: number; items: Array<{ id: string; title: string; status: string; priority: string; dueAt: string | null; overdue: boolean }> }>;
    goals: Sec<{ hasData: boolean; items: Array<{ id: string; title: string; status: string; risk: string; progressPct: number; targetDate: string | null; nextMilestone: { title: string; dueDate: string | null } | null }> }>;
    leave: Sec<{ year: string; hasData: boolean; balances: Array<{ typeKey: string; name: string; remaining: number; used: number; pending: number }>; earnedLeave: { required: number; eligibleDays: number; daysToNextCredit: number; creditsGiven: number; processedThrough: string | null; started: boolean } | null }>;
    upcomingHolidays: Sec<{ items: Array<{ date: string; name: string; kind: string }> }>;
    announcements: Sec<{ hasData: boolean; items: Array<{ id: string; title: string; body: string; publishedAt: string; expiresAt: string | null }> }>;
    birthdays: Sec<{ hasData: boolean; items: Array<{ userId: string; name: string; daysAway: number; date: string }> }>;
  };
  team: null | {
    members: number;
    attendance: Sec<{ hasData: boolean; members: number; counts: Record<string, number>; notMarked: number }>;
    tasks: Sec<{ hasData: boolean; assigned: number; inProgress: number; inReview: number; notStarted: number; completed: number; completedLast30Days: number; overdue: number }>;
    goals: Sec<{ hasData: boolean; open: number; byRisk: Record<string, number>; byEmployee: Array<{ userId: string; name: string | null; goals: number; avgProgressPct: number }> }>;
    leave: Sec<{ hasData: boolean; pending: number; items: Array<{ id: string; userId: string; name: string | null; typeKey: string; startDate: string | null; endDate: string | null; days: number; status: string }> }>;
    drilldown: Array<{ key: string; href: string }>;
  };
  organisation: null | {
    headcount: number;
    onProbation: number;
    newJoinersLast30Days: number;
    departments: Array<{ department: string; headcount: number; href: string }>;
    probationEndingSoon: { windowDays: number; items: Array<{ userId: string; name: string | null; endDate: string | null; daysLeft: number }> };
    birthdays: Sec<{ hasData: boolean; windowDays: number; items: Array<{ userId: string; name: string; date: string; daysAway: number }> }>;
    pendingLeave: Sec<{ hasData: boolean; pending: number }>;
    attendanceExceptions: Sec<{ hasData: boolean; today: Record<string, number>; missingCheckOutYesterday: number }>;
    earnedLeave: Sec<{ hasData: boolean; creditsLast30Days: number; items: Array<{ id: string; userId: string; name: string | null; amount: number; at: string }> }>;
  };
}
export const useWorkDashboard = () =>
  useQuery({ queryKey: wpk.dashboard, queryFn: async () => (await api.get<WorkDashboard>('/workforce/dashboard')).data });

export interface Announcement { id: string; title: string; body: string; audienceRoles: string[]; publishedAt: string; expiresAt: string | null; expired: boolean; createdByName: string | null }
export function useAnnouncements(q: Q, enabled = true) {
  return useQuery({
    queryKey: wpk.announcements(q),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<Announcement[]>('/workforce/announcements', q);
      return { items: r.data, pagination: r.meta.pagination as PageInfo | undefined };
    },
  });
}
export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: { title: string; body: string; audienceRoles: string[]; expiresAt?: string }) => (await api.post<Announcement>('/workforce/announcements', b)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['work', 'people'] }),
  });
}
export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete<{ id: string; deleted: true }>(`/workforce/announcements/${id}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['work', 'people'] }),
  });
}
