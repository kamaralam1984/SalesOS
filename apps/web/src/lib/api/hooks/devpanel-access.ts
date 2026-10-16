'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import type { RoleKey } from '../types';

export type Scope = 'own' | 'team' | 'org' | 'summary';
export interface AccessPermission {
  key: string;
  domain: string;
  description: string;
  sensitive: boolean;
  grants: Partial<Record<RoleKey, Scope>>;
}
export interface AccessMatrix {
  roles: RoleKey[];
  domains: string[];
  totalPermissions: number;
  totals: Record<string, number>;
  permissions: AccessPermission[];
}
export interface EffectivePermissions {
  user: { id: string; name: string; email: string; isActive: boolean };
  roles: RoleKey[];
  total: number;
  permissions: Array<{ key: string; scope: Scope; domain: string; sensitive: boolean; via: RoleKey[] }>;
}
export interface FlagsResponse {
  environment: string;
  flags: Array<{ key: string; group: string; status: string }>;
}
export interface RunbookResponse {
  executesCommands: boolean;
  sections: Array<{
    id: string;
    title: string;
    source: string;
    steps: Array<{ title: string; command?: string; note?: string }>;
  }>;
}

const k = {
  matrix: ['devpanel', 'access', 'matrix'] as const,
  user: (id: string) => ['devpanel', 'access', 'user', id] as const,
  flags: ['devpanel', 'access', 'flags'] as const,
  runbook: ['devpanel', 'access', 'runbook'] as const,
};

export const useAccessMatrix = () =>
  useQuery({ queryKey: k.matrix, queryFn: async () => (await api.get<AccessMatrix>('/dev-panel/access/matrix')).data, staleTime: 60_000 });

export const useEffectivePermissions = (id: string | null) =>
  useQuery({
    queryKey: k.user(id ?? ''),
    enabled: !!id,
    queryFn: async () => (await api.get<EffectivePermissions>(`/dev-panel/access/matrix/user/${id}`)).data,
  });

export const useAccessFlags = () =>
  useQuery({ queryKey: k.flags, queryFn: async () => (await api.get<FlagsResponse>('/dev-panel/access/flags')).data });

export const useAccessRunbook = () =>
  useQuery({ queryKey: k.runbook, queryFn: async () => (await api.get<RunbookResponse>('/dev-panel/access/runbook')).data, staleTime: 300_000 });
