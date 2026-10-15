'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

/** Workforce attendance + holidays (area A). Query keys: ['work','attendance',...] and ['work','holidays',...]; every mutation invalidates its tree. */
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'WFH' | 'LATE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'ON_LEAVE' | 'UNPAID_LEAVE';
export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ['PRESENT', 'LATE', 'WFH', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'UNPAID_LEAVE', 'HOLIDAY', 'WEEKLY_OFF'];
export type DayKind = 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY';

export interface AttendanceRecord {
  id: string; userId: string; date: string; status: AttendanceStatus; checkInAt: string | null; checkOutAt: string | null; workMinutes: number | null;
  source: 'SELF' | 'MANAGER' | 'HR' | 'SYSTEM'; note: string | null; version: number; needsReview?: boolean;
}
export interface AttendanceToday {
  date: string; timezone: string; dayKind: DayKind; holiday: { name: string; kind: string } | null; record: AttendanceRecord | null;
  can: { checkIn: boolean; checkOut: boolean }; policy: { lateAfter: string; fullDayMinutes: number; selfCheckIn: boolean };
}
export interface AttendanceDay {
  date: string; dayKind: DayKind; holiday: string | null; record: AttendanceRecord | null; leave: { typeKey: string; status: string; halfDay: string } | null;
}
export type AttendanceSummary = Record<AttendanceStatus, number> & { workMinutes: number };
export interface AttendanceMonth { userId: string; userName: string; month: string; from: string; to: string; summary: AttendanceSummary; workingDays: number; days: AttendanceDay[] }
export interface TeamSummary { date: string; dayKind: DayKind; total: number; recorded: number; notMarked: number; byStatus: Partial<Record<AttendanceStatus, number>> }
export interface AttendanceCorrection {
  id: string; userId: string; userName: string | null; date: string; oldValue: { status: string | null }; newValue: { status: string }; reason: string; correctedById: string; correctedByName: string | null; createdAt: string;
}

export const attKeys = {
  all: ['work', 'attendance'] as const,
  today: ['work', 'attendance', 'today'] as const,
  month: (userId: string | undefined, month: string | undefined) => ['work', 'attendance', 'month', userId ?? 'me', month ?? 'current'] as const,
  team: (date: string | undefined) => ['work', 'attendance', 'team', date ?? 'today'] as const,
  corrections: (q: object) => ['work', 'attendance', 'corrections', q] as const,
};

export const useAttendanceToday = () => useQuery({ queryKey: attKeys.today, queryFn: async () => (await api.get<AttendanceToday>('/workforce/attendance/today')).data });
export const useAttendanceMonth = (userId: string | undefined, month: string | undefined) =>
  useQuery({
    queryKey: attKeys.month(userId, month), placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<AttendanceMonth>('/workforce/attendance/month', { userId, month })).data,
  });
export const useTeamAttendanceSummary = (date: string | undefined, enabled = true) =>
  useQuery({ queryKey: attKeys.team(date), enabled, queryFn: async () => (await api.get<TeamSummary>('/workforce/attendance/team-summary', { date })).data });
export function useAttendanceCorrections(q: { userId?: string; page: number; limit: number }, enabled = true) {
  return useQuery({
    queryKey: attKeys.corrections(q), enabled, placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<AttendanceCorrection[]>('/workforce/attendance/corrections', { userId: q.userId, page: q.page, limit: q.limit });
      return { items: r.data, hasMore: Boolean((r.meta.pagination as { hasMore?: boolean } | undefined)?.hasMore) };
    },
  });
}

function useAttMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: attKeys.all }) });
}
export const useCheckIn = () => useAttMutation((b: { mode: 'OFFICE' | 'WFH' }) => api.post<AttendanceRecord>('/workforce/attendance/check-in', b).then((r) => r.data));
export const useCheckOut = () => useAttMutation(() => api.post<AttendanceRecord>('/workforce/attendance/check-out', {}).then((r) => r.data));
export interface CorrectionInput { userId: string; date: string; status: AttendanceStatus; reason: string; checkInAt?: string | null; checkOutAt?: string | null; version?: number }
export const useCorrectAttendance = () => useAttMutation((b: CorrectionInput) => api.put<AttendanceRecord>('/workforce/attendance/records', b).then((r) => r.data));

/* ---------------------------------------------------------------- holidays */
export type HolidayKind = 'NATIONAL' | 'REGIONAL' | 'COMPANY' | 'OPTIONAL' | 'RESTRICTED';
export const HOLIDAY_KINDS: readonly HolidayKind[] = ['NATIONAL', 'REGIONAL', 'COMPANY', 'OPTIONAL', 'RESTRICTED'];
export interface Holiday { id: string; date: string; name: string; kind: HolidayKind; location: string | null; status: 'SUGGESTED' | 'APPROVED'; suggested: boolean; approvedAt: string | null }
export const holidayKeys = { all: ['work', 'holidays'] as const, list: (year: number) => ['work', 'holidays', 'list', year] as const };

export const useHolidays = (year: number) =>
  useQuery({ queryKey: holidayKeys.list(year), queryFn: async () => (await api.get<Holiday[]>('/workforce/holidays', { year, limit: 100 })).data });

function useHolidayMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: holidayKeys.all });
      await qc.invalidateQueries({ queryKey: attKeys.all }); // day kinds in the month view
    },
  });
}
export interface HolidayInput { date: string; name: string; kind: HolidayKind; location?: string | null; status?: 'SUGGESTED' | 'APPROVED' }
export const useCreateHoliday = () => useHolidayMutation((b: HolidayInput) => api.post<Holiday>('/workforce/holidays', b).then((r) => r.data));
export const useUpdateHoliday = () => useHolidayMutation((v: { id: string; body: Partial<HolidayInput> }) => api.patch<Holiday>(`/workforce/holidays/${v.id}`, v.body).then((r) => r.data));
export const useDeleteHoliday = () => useHolidayMutation((id: string) => api.delete<{ id: string }>(`/workforce/holidays/${id}`).then((r) => r.data));
export const useApproveHoliday = () => useHolidayMutation((id: string) => api.post<Holiday>(`/workforce/holidays/${id}/approve`, {}).then((r) => r.data));
export const useSuggestHolidays = () => useHolidayMutation((year: number) => api.post<{ year: number; created: Holiday[]; skipped: number }>('/workforce/holidays/suggest', { year }).then((r) => r.data));
