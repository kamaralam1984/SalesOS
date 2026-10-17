'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { RoleKey } from '../types';

/** Extra company Zoom meetings (HR / Founder / Developer announce them; the people they are addressed to see them on the home page). */
export type MeetingStatus = 'UPCOMING' | 'LIVE' | 'ENDED' | 'CANCELLED';
export interface MeetingAudience { everyone: boolean; roles: RoleKey[]; teamIds: string[]; userIds: string[] }
export interface HomeMeeting { id: string; title: string; url: string; note: string | null; startsAt: string; endsAt: string; createdByName: string; status: MeetingStatus; joinedAt: string | null }
export interface MeetingRow { id: string; title: string; url: string; note: string | null; startsAt: string; endsAt: string; createdByName: string; status: MeetingStatus; audience: MeetingAudience; invitedCount: number; joinedCount: number }
export interface MeetingDetail { id: string; title: string; url: string; note: string | null; startsAt: string; endsAt: string; status: MeetingStatus; audience: MeetingAudience; invited: Array<{ id: string; name: string; joinedAt: string | null }> }
export interface MeetingOptions { roles: RoleKey[]; teams: Array<{ id: string; name: string }>; people: Array<{ id: string; name: string; roles: RoleKey[] }> }
export interface MeetingFilters { q?: string; status?: MeetingStatus | ''; audience?: 'EVERYONE' | 'SELECTED' | ''; roleKey?: string; teamId?: string; userId?: string; from?: string; to?: string }
export interface NewMeeting { title: string; url: string; startsAt: string; durationMinutes: number; note?: string; audience: Omit<MeetingAudience, 'everyone'> & { everyone: boolean } }

const key = ['meetings'] as const;

/** What the signed-in person sees on the home page. Refreshes every minute so a meeting that was just posted appears without a reload. */
export const useActiveMeetings = (enabled = true) =>
  useQuery({ queryKey: [...key, 'active'], enabled, refetchInterval: 60_000, staleTime: 30_000, queryFn: async () => (await api.get<HomeMeeting[]>('/meetings/active')).data });

export const useMeetings = (f: MeetingFilters) =>
  useQuery({
    queryKey: [...key, 'list', f],
    queryFn: async () => (await api.get<MeetingRow[]>('/meetings', Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>)).data,
  });

export const useMeetingOptions = () => useQuery({ queryKey: [...key, 'options'], staleTime: 60_000, queryFn: async () => (await api.get<MeetingOptions>('/meetings/options')).data });
export const useMeetingDetail = (id: string | null) =>
  useQuery({ queryKey: [...key, 'detail', id], enabled: Boolean(id), queryFn: async () => (await api.get<MeetingDetail>(`/meetings/${id}`)).data });

function useMeetingMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
}
export const useCreateMeeting = () => useMeetingMutation(async (b: NewMeeting) => (await api.post<{ id: string; invitedCount: number }>('/meetings', b)).data);
export const useCancelMeeting = () => useMeetingMutation(async (id: string) => (await api.delete(`/meetings/${id}`)).data);
/** Recorded when someone presses Join; a failure must never block opening the meeting, so callers ignore errors. */
export const useJoinMeeting = () => useMeetingMutation(async (id: string) => (await api.post<{ joinedAt: string }>(`/meetings/${id}/join`, {})).data);
