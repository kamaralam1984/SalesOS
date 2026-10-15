'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { qk } from '../keys';
import type { RoleKey, UserListItem } from '../types';

export interface UsersQuery {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: 'true' | 'false' | '';
}

export function useUsers(q: UsersQuery) {
  return useQuery({
    queryKey: qk.users.list(q),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<UserListItem[] | { items: UserListItem[] }>('/users', {
        page: q.page,
        limit: q.limit,
        search: q.search,
        isActive: q.isActive || undefined,
      });
      const items = Array.isArray(r.data) ? r.data : r.data.items;
      return { items, pagination: r.meta.pagination };
    },
  });
}

export function useUser(id: string | null) {
  return useQuery({
    queryKey: qk.users.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => (await api.get<UserListItem>(`/users/${id}`)).data,
  });
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.users.all });
}

export interface CreateUserInput {
  email: string;
  name: string;
  roles: RoleKey[];
  managerId?: string | null;
  department?: string | null;
  teamIds?: string[];
}

export function useCreateUser() {
  const inv = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: CreateUserInput) =>
      (await api.post<UserListItem>('/users', input)).data,
    onSuccess: inv,
  });
}

export function useUpdateUser(id: string) {
  const inv = useInvalidateUsers();
  return useMutation({
    mutationFn: async (input: { name?: string; managerId?: string | null; department?: string | null }) =>
      (await api.patch<UserListItem>(`/users/${id}`, input)).data,
    onSuccess: inv,
  });
}

export function useSetUserRoles() {
  const inv = useInvalidateUsers();
  return useMutation({
    mutationFn: async ({ id, roles }: { id: string; roles: RoleKey[] }) =>
      (await api.post<UserListItem>(`/users/${id}/roles`, { roles })).data,
    onSuccess: inv,
  });
}

export function useDeactivateUser() {
  const inv = useInvalidateUsers();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await api.post<unknown>(`/users/${id}/deactivate`, { reason })).data,
    onSuccess: inv,
  });
}

export function useReactivateUser() {
  const inv = useInvalidateUsers();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      (await api.post<unknown>(`/users/${id}/reactivate`, {})).data,
    onSuccess: inv,
  });
}

/** Manual invite link for users who have not set a password yet (used while no email provider is enabled). The link is shown once. */
export function useInviteLink() {
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      (await api.post<{ link: string; expiresAt: string }>(`/users/${id}/invite-link`, {})).data,
  });
}
