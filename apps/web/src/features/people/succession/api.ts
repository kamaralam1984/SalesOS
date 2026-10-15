'use client';
import { useApiGet, pk } from '../common/api';
import { useApiMutation } from '../hrkit/kit';

export interface DevAction { title: string; dueDate?: string; status: 'OPEN' | 'IN_PROGRESS' | 'DONE' }
export interface BenchCandidate { id: string; userId: string; name: string | null; readiness: 'READY_NOW' | 'READY_LATER'; developmentActions: DevAction[]; notes: string | null }
export interface Position {
  id: string;
  title: string;
  roleKey: string;
  incumbentId: string | null;
  incumbentName: string | null;
  notes: string | null;
  readyNow: BenchCandidate[];
  readyLater: BenchCandidate[];
  coverage: 'COVERED' | 'DEVELOPING' | 'NO_BENCH';
}
export const useSuccession = () => useApiGet<Position[]>(pk('succession'), '/people/succession');
export const useCreatePosition = () => useApiMutation<Record<string, unknown>>('post', () => '/people/succession/positions');
export const useSaveBench = () => useApiMutation<Record<string, unknown>>('post', () => '/people/succession');
export const useRemoveBench = () => useApiMutation<string>('delete', (id) => `/people/succession/candidates/${id}`);
