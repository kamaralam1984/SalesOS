'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { pk, useApiGet, useApiList } from '../common/api';

export const COACHING_TOPICS = ['CALL_QUALITY', 'OBJECTION_HANDLING', 'CONSULTATIVE_SELLING', 'CLOSING', 'NEGOTIATION', 'PIPELINE_MANAGEMENT', 'FORECASTING', 'CRM_USAGE', 'LEADERSHIP', 'OTHER'] as const;
export const SESSION_KINDS = ['COACHING', 'SCORECARD_REVIEW', 'CALL_REVIEW', 'ROLE_PLAY'] as const;
export const NOTE_VISIBILITY = ['COACH_ONLY', 'PARTICIPANTS', 'MANAGEMENT'] as const;
export type ActionStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface CoachingAction {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string | null;
  dueDate: string | null;
  status: ActionStatus;
  completedAt?: string | null;
  sessionId?: string | null;
  oneOnOneId?: string | null;
  sourceRef?: string | null;
}
export interface CoachingSession {
  id: string;
  kind: (typeof SESSION_KINDS)[number];
  sessionDate: string;
  durationMin: number;
  topics: (typeof COACHING_TOPICS)[number][];
  callRef: string | null;
  noteVisibility: (typeof NOTE_VISIBILITY)[number];
  coachId: string;
  coachName: string | null;
  participants: { userId: string; name: string | null }[];
  notes: string | null;
  notesHidden: boolean;
  actions: CoachingAction[];
  createdAt: string;
}
export interface OneOnOne {
  id: string;
  managerId: string;
  managerName: string | null;
  employeeId: string;
  employeeName: string | null;
  status: 'SCHEDULED' | 'HELD' | 'CANCELLED';
  scheduledFor: string;
  durationMin: number;
  agenda: string | null;
  sharedNotes: string | null;
  privateNotes: string | null;
  actions: CoachingAction[];
}
export interface CoachingHours {
  from: string;
  to: string;
  totalMinutes: number;
  totalHours: number;
  coaches: { coachId: string; coachName: string | null; sessionMinutes: number; oneOnOneMinutes: number; sessions: number; oneOnOnes: number; totalMinutes: number; totalHours: number }[];
  minutesByTopic: Record<string, number>;
}

type Q = Record<string, string | number | undefined>;
export const useSessions = (q: Q) => useApiList<CoachingSession>(pk('coaching', 'sessions'), '/coaching/sessions', q);
export const useOneOnOnes = (q: Q) => useApiList<OneOnOne>(pk('coaching', 'one-on-ones'), '/coaching/one-on-ones', q);
export const useCoachingActions = (q: Q) => useApiList<CoachingAction>(pk('coaching', 'actions'), '/coaching/actions', q);
export const useCoachingHours = (from: string, to: string) => useApiGet<CoachingHours>(pk('coaching', 'hours'), '/coaching/hours', { from, to });

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: unknown) => (await api.post<CoachingSession>('/coaching/sessions', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}
export function useCreateOneOnOne() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: unknown) => (await api.post<OneOnOne>('/coaching/one-on-ones', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}
export function useUpdateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; status: ActionStatus }) => (await api.patch<unknown>(`/coaching/actions/${v.id}`, { status: v.status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}
