'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_HOME_WIDGETS, type HomeWidgetEntry, type HomeWidgetId } from '@/features/mobile/home/widgets';
import { api } from '../client';

/** Per-role home layout: which widgets, in what order, at what size. Set by the Founder or Developer; everyone else only reads their own. */
export interface MyHomeLayout { source: 'ROLE' | 'DEFAULT'; role: string | null; widgets: HomeWidgetEntry[] }
export interface RoleHomeLayout { role: string; customised: boolean; widgets: HomeWidgetEntry[]; applicable: HomeWidgetId[] }
export interface HomeLayoutOverview { widgets: Array<{ id: HomeWidgetId; requires: string[]; callTeam: boolean }>; roles: RoleHomeLayout[] }

const key = ['home-layout'] as const;

export const FALLBACK_LAYOUT: MyHomeLayout = { source: 'DEFAULT', role: null, widgets: DEFAULT_HOME_WIDGETS.map((w) => ({ ...w })) };

export const useMyHomeLayout = (enabled = true) =>
  useQuery({ queryKey: [...key, 'mine'], enabled, staleTime: 60_000, queryFn: async () => (await api.get<MyHomeLayout>('/home-layout')).data });

export const useHomeLayoutOverview = (enabled = true) =>
  useQuery({ queryKey: [...key, 'roles'], enabled, queryFn: async () => (await api.get<HomeLayoutOverview>('/home-layout/roles')).data });

export function useSaveHomeLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { role: string; widgets: HomeWidgetEntry[] }) => (await api.put<RoleHomeLayout>(`/home-layout/roles/${v.role}`, { widgets: v.widgets })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useResetHomeLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (role: string) => (await api.delete<RoleHomeLayout>(`/home-layout/roles/${role}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}
