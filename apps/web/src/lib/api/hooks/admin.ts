'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { qk } from '../keys';
import type { AuditLogEntry, OrgSettings, PermissionCatalogueEntry } from '../types';

export interface AuditQuery {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

export function useAuditLogs(q: AuditQuery) {
  return useQuery({
    queryKey: qk.audit.list(q),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<AuditLogEntry[] | { items: AuditLogEntry[] }>('/audit-logs', {
        ...q,
      });
      return {
        items: Array.isArray(r.data) ? r.data : r.data.items,
        pagination: r.meta.pagination,
      };
    },
  });
}

export function useOrgSettings() {
  return useQuery({
    queryKey: qk.orgSettings,
    queryFn: async () => (await api.get<{ settings: OrgSettings }>('/org/settings')).data.settings,
  });
}

export function useUpdateOrgSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<OrgSettings>) =>
      (await api.patch<{ settings: OrgSettings }>('/org/settings', input)).data.settings,
    onSuccess: (data) => qc.setQueryData(qk.orgSettings, data),
  });
}

export function usePermissionCatalogue() {
  return useQuery({
    queryKey: qk.permissionCatalogue,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await api.get<{ permissions: PermissionCatalogueEntry[] }>('/permissions/catalogue')).data
        .permissions,
  });
}
