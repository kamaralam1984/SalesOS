'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { pk, useApiGet, useApiList } from '../common/api';

export interface RecognitionProgram {
  id: string;
  key: string;
  name: string;
  description: string | null;
  kind: 'TOP_PERFORMER' | 'CULTURE' | 'MILESTONE' | 'AWARD';
  criteria: string | null;
}
export interface RecognitionItem {
  id: string;
  programId: string;
  programName: string;
  programKind: RecognitionProgram['kind'];
  recipientId: string;
  recipientName: string | null;
  reason: string;
  periodLabel: string | null;
  competencyKey: string | null;
  isPublic: boolean;
  createdAt: string;
  grantedByName?: string | null;
}

export const useWall = (page: number) => useApiList<RecognitionItem>(pk('recognition', 'wall'), '/people/recognitions', { wall: 'true', page, limit: 12 });
export const useMyRecognitions = (page: number) => useApiList<RecognitionItem>(pk('recognition', 'scoped'), '/people/recognitions', { page, limit: 12 });
export const usePrograms = () => useApiGet<RecognitionProgram[]>(pk('recognition', 'programs'), '/people/recognition-programs');

export function useGrantRecognition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: unknown) => (await api.post<{ id: string }>('/people/recognitions', b)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}
export function useCreateProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: unknown) => (await api.post<RecognitionProgram>('/people/recognition-programs', b)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}
