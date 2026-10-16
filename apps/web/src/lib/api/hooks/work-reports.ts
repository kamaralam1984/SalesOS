'use client';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { API_BASE_URL, ApiError, api } from '../client';

/** Workforce reports and exports (area D2). */
export const WORKFORCE_REPORT_KEYS = ['attendance', 'leave', 'earned-leave', 'tasks', 'goals', 'holidays', 'probation', 'birthdays', 'department-performance', 'weekly-progress', 'new-joiners'] as const;
export type WorkforceReportKey = (typeof WORKFORCE_REPORT_KEYS)[number];

export interface ReportColumn { key: string; label: string; type: 'text' | 'int' | 'number' | 'pct' | 'date' }
export type ReportCell = string | number | boolean | null;
export interface WorkforceReport {
  report: WorkforceReportKey;
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  summary: Record<string, number | string | null | Record<string, number>>;
  truncated: boolean;
  rowCap: number;
  scopeLevel: string;
  range: { from: string; to: string };
  filters: { departmentId: string | null; userId: string | null; groupBy: string | null };
}
export interface ReportFilters { from?: string; to?: string; departmentId?: string; groupBy?: 'department' | 'manager'; page?: number; limit?: number }

export function useWorkforceReport(key: WorkforceReportKey, f: ReportFilters, enabled = true) {
  return useQuery({
    queryKey: ['work', 'reports', key, f] as const,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<WorkforceReport>(`/workforce/reports/${key}`, { ...f });
      return { report: r.data, pagination: r.meta.pagination as { hasMore: boolean; page?: number; limit: number; total?: number; totalPages?: number } | undefined };
    },
  });
}

/** Authenticated download (cookie session; the server audits it). Nothing is cached by the service worker. */
export async function downloadWorkforceReport(key: WorkforceReportKey, f: ReportFilters, format: 'csv' | 'xlsx'): Promise<{ rowCount: number; truncated: boolean }> {
  const url = new URL(`${API_BASE_URL}/workforce/reports/${key}/export`);
  url.searchParams.set('format', format);
  for (const [k, v] of Object.entries({ from: f.from, to: f.to, departmentId: f.departmentId, groupBy: f.groupBy })) if (v) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { credentials: 'include', cache: 'no-store' });
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = 'Export failed';
    try {
      const env = (await res.json()) as { error?: { code?: string; message?: string } };
      code = env.error?.code ?? code;
      message = env.error?.message ?? message;
    } catch { /* not JSON */ }
    throw new ApiError({ status: res.status, code, message });
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `workforce_${key}.${format}`;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
  return { rowCount: Number(res.headers.get('x-row-count') ?? 0), truncated: res.headers.get('x-truncated') === 'true' };
}
export function useExportWorkforceReport(key: WorkforceReportKey) {
  return useMutation({ mutationFn: (v: { filters: ReportFilters; format: 'csv' | 'xlsx' }) => downloadWorkforceReport(key, v.filters, v.format) });
}
