'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

/** Workforce HR automation (area D2): HR profile fields, birthdays, probation decisions, policy. */
type Q = Record<string, string | number | boolean | undefined | null>;
const key = (...p: Array<string | number | object>) => ['work', 'hr', ...p] as const;

export interface HrProfile {
  id?: string;
  userId?: string;
  joinDate?: string | null;
  probationMonths?: number | null;
  probationEndDate?: string | null;
  dateOfBirth?: string | null;
  shareBirthday?: boolean;
  employeeCode?: string | null;
  workLocation?: string | null;
  hrContactId?: string | null;
  positionTitle?: string | null;
  employmentType?: string | null;
  probation: ProbationRow | null;
}
export const useHrProfile = (userId: string, enabled = true) =>
  useQuery({ queryKey: key('profile', userId), enabled: enabled && Boolean(userId), queryFn: async () => (await api.get<HrProfile>(`/workforce/hr/profiles/${userId}`)).data });
export interface HrProfilePatch { joinDate?: string; probationMonths?: number | null; dateOfBirth?: string | null; shareBirthday?: boolean; employeeCode?: string | null; workLocation?: string | null; hrContactId?: string | null }
export function usePatchHrProfile(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: HrProfilePatch) => (await api.patch<HrProfile>(`/workforce/hr/profiles/${userId}`, b)).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['work'] }); },
  });
}

export interface BirthdayRow { userId: string; name: string; department: string | null; nextDate: string; month: number; day: number; daysUntil: number; shared?: boolean }
export interface BirthdayList { today: string; days: number; items: BirthdayRow[] }
export const useHrBirthdays = (days: number) =>
  useQuery({ queryKey: key('birthdays', days), queryFn: async () => (await api.get<BirthdayList>('/workforce/hr/birthdays', { days })).data });
export const useSharedBirthdays = (days: number, enabled = true) =>
  useQuery({ queryKey: key('shared-birthdays', days), enabled, queryFn: async () => (await api.get<BirthdayList>('/workforce/birthdays/upcoming', { days })).data });

export type ProbationState = 'IN_PROBATION' | 'ENDING_SOON' | 'DECISION_DUE' | 'UNDER_REVIEW' | 'CONFIRMED';
export type ProbationDecision = 'CONFIRM' | 'EXTEND' | 'MARK_FOR_REVIEW';
export interface ProbationRow {
  userId: string;
  name: string;
  department: string | null;
  managerId: string | null;
  managerName: string | null;
  positionTitle: string | null;
  startDate: string;
  months: number;
  endDate: string;
  state: ProbationState;
  daysLeft: number;
  latestDecision: { decision: ProbationDecision; at: string } | null;
  extensions: number;
}
export function useProbationList(q: Q) {
  return useQuery({
    queryKey: key('probation', q),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<ProbationRow[]>('/workforce/hr/probation', q);
      return { items: r.data, counts: ((r.meta as { counts?: Record<string, number> }).counts ?? {}) as Record<string, number>, pagination: r.meta.pagination as { hasMore: boolean; page?: number; limit: number; total?: number } | undefined };
    },
  });
}
export interface ProbationHistoryRow { id: string; decision: ProbationDecision | null; months: number | null; previousEnd: string | null; newEnd: string | null; note: string | null; decidedBy: string | null; decidedAt: string | null }
export const useProbationHistory = (userId: string | null) =>
  useQuery({ queryKey: key('probation-history', userId ?? ''), enabled: Boolean(userId), queryFn: async () => (await api.get<ProbationHistoryRow[]>(`/workforce/hr/probation/${userId}/history`)).data });
export function useProbationDecision(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: { decision: ProbationDecision; months?: number; note?: string }) => (await api.post<ProbationRow>(`/workforce/hr/probation/${userId}/decision`, b)).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['work'] }); },
  });
}

/** Policy (workforce_settings). `effective` = defaults + overrides. */
export type PolicyConfig = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface WorkforceSettings { effective: PolicyConfig; overrides: PolicyConfig; defaults: PolicyConfig; version: number; updatedAt: string | null; note: string }
export const useWorkforceSettings = () =>
  useQuery({ queryKey: key('settings'), queryFn: async () => (await api.get<WorkforceSettings>('/workforce/settings')).data });
export function usePatchWorkforceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: PolicyConfig) => (await api.patch<WorkforceSettings>('/workforce/settings', patch)).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['work'] }); },
  });
}
