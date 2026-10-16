'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { qk } from '../keys';
import type { RoleKey } from '../types';

export interface DevUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: RoleKey[];
  activeSessions: number;
}
export interface DevOverview {
  users: number;
  activeUsers: number;
  activeSessions: number;
  usersPerRole: Record<string, number>;
}
export interface ServerStatus {
  checkedAt: string;
  probeMs: number;
  services: { database: 'ok' | 'down'; redis: 'ok' | 'down'; worker: 'ok' | 'stale' | 'unknown' };
  worker: { status: string; instances: number; lastHeartbeatAgeSeconds: number | null };
  outbox: { pending: number; dead: number; oldestPendingSeconds: number } | null;
  process: { nodeVersion: string; uptimeSeconds: number; rssBytes: number; heapUsedBytes: number; env: string };
  host: {
    cpuCount: number;
    loadAvg: number[];
    totalMemBytes: number;
    freeMemBytes: number;
    hostUptimeSeconds: number;
    disk: { totalBytes: number; freeBytes: number } | null;
  };
}

export const useDevOverview = () =>
  useQuery({ queryKey: qk.devpanel.overview, queryFn: async () => (await api.get<DevOverview>('/dev-panel/overview')).data });

export const useDevUsers = (q: { search?: string; role?: string; isActive?: string }) =>
  useQuery({
    queryKey: qk.devpanel.users(q),
    queryFn: async () => (await api.get<DevUser[]>('/dev-panel/users', { ...q, limit: 200 })).data,
  });

export const useServerStatus = (enabled: boolean) =>
  useQuery({
    queryKey: qk.devpanel.server,
    enabled,
    refetchInterval: enabled ? 15_000 : false,
    queryFn: async () => (await api.get<ServerStatus>('/dev-panel/server')).data,
  });

export function useSetDevRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; roles: RoleKey[] }) =>
      (await api.post<{ id: string; roles: RoleKey[] }>(`/dev-panel/users/${v.id}/roles`, { roles: v.roles })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.devpanel.all }),
  });
}

export function useRevokeSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ revoked: number }>(`/dev-panel/users/${id}/revoke-sessions`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.devpanel.all }),
  });
}

export function useForceLogoutAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reason: string) => (await api.post<{ revoked: number }>('/dev-panel/sessions/force-logout-all', { reason })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.devpanel.all }),
  });
}
