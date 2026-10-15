'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { pk, useApiGet, useApiList } from '../common/api';
import type { PipStatus } from './pip-logic';

export interface PipCheckpoint {
  id: string;
  title: string;
  dueDate: string | null;
  status: 'PENDING' | 'DONE' | 'MISSED';
  notes: string | null;
  completedAt: string | null;
}
export interface Pip {
  id: string;
  proposedByManager?: boolean;
  employeeId: string;
  employeeName: string | null;
  createdByName: string | null;
  status: PipStatus;
  reason: string;
  kpiGaps: Array<{ key: string; name: string; target?: number; actual?: number }>;
  evidence: string | null;
  goals: Array<{ title: string; measure?: string }>;
  measures: string[];
  durationDays: number;
  startDate: string | null;
  endDate: string | null;
  proposedEndDate: string | null;
  extensionCount: number;
  extensionReason: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  employeeAcknowledgedAt: string | null;
  finalReview: string | null;
  recommendedAction: string | null;
  cancelReason: string | null;
  version: number;
  checkpoints: PipCheckpoint[];
  history?: Array<{ from: string | null; to: string; actorName: string | null; note: string | null; at: string }>;
}

type Q = Record<string, string | number | undefined>;
export const usePips = (q: Q) => useApiList<Pip>(pk('pips'), '/people/pips', q);
export const usePip = (id: string) => useApiGet<Pip>(pk('pips', id), `/people/pips/${id}`);

function useInv<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }) });
}
export const useProposePip = () => useInv(async (b: unknown) => (await api.post<Pip>('/people/pips/propose', b)).data);
export const useCreatePip = () => useInv(async (b: unknown) => (await api.post<Pip>('/people/pips', b)).data);
export const useUpdatePipDraft = (id: string) => useInv(async (b: unknown) => (await api.patch<Pip>(`/people/pips/${id}`, b)).data);
export const usePipTransition = (id: string) => useInv(async (b: Record<string, unknown>) => (await api.post<Pip>(`/people/pips/${id}/transition`, b)).data);
export const usePipApprove = (id: string) => useInv(async (b: { decision: 'APPROVE' | 'RETURN'; startDate?: string; note?: string }) => (await api.post<Pip>(`/people/pips/${id}/approve`, b)).data);
export const usePipAcknowledge = (id: string) => useInv(async () => (await api.post<Pip>(`/people/pips/${id}/acknowledge`, {})).data);
export const useCheckpoint = (id: string) =>
  useInv(async (v: { cid: string; status: 'PENDING' | 'DONE' | 'MISSED'; notes?: string }) => (await api.patch<Pip>(`/people/pips/${id}/checkpoints/${v.cid}`, { status: v.status, notes: v.notes })).data);
