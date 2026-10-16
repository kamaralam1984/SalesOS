'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export interface MaintenanceDetail {
  enabled: boolean;
  message: string | null;
  eta: string | null;
  enabledAt: string | null;
  enabledBy: { id: string; name: string } | null;
}
export interface MaintenancePublicStatus {
  enabled: boolean;
  message: string | null;
  eta: string | null;
}

export const maintenanceKeys = {
  detail: ['devpanel', 'maintenance'] as const,
  status: ['maintenance', 'status'] as const,
};

export const useMaintenance = () =>
  useQuery({
    queryKey: maintenanceKeys.detail,
    refetchInterval: 20_000,
    queryFn: async () => (await api.get<MaintenanceDetail>('/dev-panel/maintenance')).data,
  });

/** Public status (works before login). Polls every 30s only while maintenance is on. */
export const useMaintenanceStatus = (enabled = true) =>
  useQuery({
    queryKey: maintenanceKeys.status,
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.data?.enabled ? 30_000 : false),
    queryFn: async () => (await api.get<MaintenancePublicStatus>('/maintenance/status')).data,
  });

export function useEnableMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { message: string; eta?: string }) => (await api.post<MaintenanceDetail>('/dev-panel/maintenance/enable', v)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: maintenanceKeys.detail });
      void qc.invalidateQueries({ queryKey: maintenanceKeys.status });
    },
  });
}

export function useDisableMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<MaintenanceDetail>('/dev-panel/maintenance/disable', {})).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: maintenanceKeys.detail });
      void qc.invalidateQueries({ queryKey: maintenanceKeys.status });
    },
  });
}
