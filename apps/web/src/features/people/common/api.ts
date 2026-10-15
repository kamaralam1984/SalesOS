'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/** Query-key helper for every people/sop/incentives/resources/engagement query: ['people', ...parts]. Invalidate with ['people'] or a prefix. */
export const pk = (...parts: Array<string | number | object | undefined>) => ['people', ...parts] as const;

export interface PageInfo {
  hasMore: boolean;
  nextCursor?: string | null;
  page?: number;
  limit: number;
}

/** GET a paginated list endpoint -> { items, pagination }. Use `page` (1-based) for page mode. */
export function useApiList<T>(key: readonly unknown[], path: string, query: Record<string, string | number | boolean | undefined | null> = {}, enabled = true) {
  return useQuery({
    queryKey: [...key, query] as const,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<T[]>(path, query);
      return { items: r.data, pagination: r.meta.pagination as PageInfo | undefined };
    },
  });
}

/** GET a single (non-paginated) resource. */
export function useApiGet<T>(key: readonly unknown[], path: string, query: Record<string, string | number | boolean | undefined | null> = {}, enabled = true) {
  return useQuery({ queryKey: [...key, query] as const, enabled, queryFn: async () => (await api.get<T>(path, query)).data });
}

export interface PersonOption {
  id: string;
  name: string;
  managerId: string | null;
  roles: string[];
}

/** People the caller can coach / review / assign (server-scoped: team for managers, org for team lead/HR, self for executives). */
export function useTeamMemberOptions(enabled = true) {
  return useApiGet<PersonOption[]>(pk('team-members'), '/people/team-members', {}, enabled);
}

/** YYYY-MM-DD in UTC for <input type="date">. */
export const toDateInput = (d: Date = new Date()) => d.toISOString().slice(0, 10);
