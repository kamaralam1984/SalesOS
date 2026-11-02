'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export interface ModuleRow {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
  /** how many permission keys the switch controls */
  permissions: number;
}
export interface ModuleList {
  modules: ModuleRow[];
}

const key = ['devpanel', 'modules'] as const;

export const useModules = () => useQuery({ queryKey: key, queryFn: async () => (await api.get<ModuleList>('/dev-panel/features/modules')).data });

/** Switch one module for the whole organisation. Permissions change for everyone, so the session's own permission list is refreshed too. */
export function useSetModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { module: string; enabled: boolean }) => (await api.put<ModuleList>(`/dev-panel/features/modules/${encodeURIComponent(v.module)}`, { enabled: v.enabled })).data,
    onSuccess: (list) => {
      qc.setQueryData(key, list);
      void qc.invalidateQueries({ queryKey: ['auth'] });
      void qc.invalidateQueries({ queryKey: ['devpanel', 'features'] });
    },
  });
}
