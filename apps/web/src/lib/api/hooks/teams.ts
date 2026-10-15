'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { qk } from '../keys';
import type { Team, TeamMember } from '../types';

/** API returns all visible teams in one list (no pagination, no per-team GET). */
export function useTeams() {
  return useQuery({
    queryKey: qk.teams.list({}),
    queryFn: async () => {
      const r = await api.get<Team[]>('/teams');
      return { items: r.data, warnings: r.meta.warnings ?? [] };
    },
  });
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  membershipRole: 'LEAD' | 'MEMBER';
}

export function useTeamMembers(id: string | null) {
  return useQuery({
    queryKey: [...qk.teams.detail(id ?? ''), 'members'] as const,
    enabled: Boolean(id),
    queryFn: async () => {
      const r = await api.get<MemberRow[]>(`/teams/${id}/members`);
      const members: TeamMember[] = r.data.map((m) => ({
        userId: m.id,
        name: m.name,
        email: m.email,
        membershipRole: m.membershipRole,
      }));
      return { members, warnings: r.meta.warnings ?? [] };
    },
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; leadUserId?: string }) =>
      (await api.post<Team>('/teams', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.teams.all }),
  });
}

/** Resolves with the API's non-blocking warnings (e.g. soft team-size limit exceeded). */
export function useAddTeamMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; membershipRole?: 'LEAD' | 'MEMBER' }) => {
      const r = await api.post<unknown>(`/teams/${teamId}/members`, input);
      return { warnings: r.meta.warnings ?? [] };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.teams.all }),
  });
}

export function useRemoveTeamMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      (await api.delete<unknown>(`/teams/${teamId}/members/${userId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.teams.all }),
  });
}
