'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_BASE_URL, ApiError } from '../client';

/* ------------------------------------------------------------------ wire types (mirror apps/api reporting module)
 * Values are STRINGS (Decimal-safe, rounded by the server per the KPI definition). `null` = not computable: render a dash and the reason. */
export type KpiUnit = 'PERCENT' | 'COUNT' | 'CURRENCY' | 'MINUTES' | 'HOURS' | 'DAYS' | 'SCORE' | 'RATIO';
export type KpiStatus = 'OK' | 'NO_DATA' | 'FORBIDDEN' | 'RESTRICTED' | 'ERROR';
export type NullReason = 'ZERO_DENOMINATOR' | 'NO_TARGET' | 'NO_DATA' | 'NO_SNAPSHOT' | 'INSUFFICIENT_RESPONSES' | 'NOT_COMPUTABLE';

export interface KpiResult {
  id: string;
  name: string;
  unit: KpiUnit;
  currency: string | null;
  status: KpiStatus;
  value: string | null;
  numerator: string | null;
  denominator: string | null;
  nullReason: NullReason | null;
  note: string | null;
  dateRange: { from: string; to: string; timezone: string; asOf: string };
  period: { type: string; startsOn: string; endsOn: string; label: string };
  filters: { applied: Record<string, string>; ignored: string[]; scopeLevel: string; narrowedByFilter: boolean };
  definition: { id: string; summary: string; approvalStatus: string; formula: string; zeroDenominator: string };
  breakdown: Record<string, unknown> | null;
  caution: string | null;
  dataSource: string | null;
  isEstimate: boolean;
  computedAt: string;
  freshness: { kind: 'LIVE' | 'CACHED'; computedAt: string; dataAsOf: string; ageSeconds: number; cadence: string };
}

export interface KpiMeta {
  id: string;
  name: string;
  group: string;
  source: string;
  unit: KpiUnit;
  definition: string;
  numerator: string;
  denominator: string;
  window: string;
  exclusions: string;
  tables: string[];
  rounding: string;
  owner: string;
  refresh: string;
  zeroDenominator: string;
  formula: string;
  implementation: string;
  decisions: string[];
  approvalStatus: string;
  requires: string | null;
  minScope: string;
  filters: string[];
}

export interface AnalyticsQuery {
  from?: string;
  to?: string;
  period?: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
  asOf?: string;
  teamId?: string;
  programId?: string;
  sourceId?: string;
  ownerId?: string;
  by?: string;
}

export type PanelState<T> = ({ status: 'OK' } & T) | { status: 'FORBIDDEN'; requires: string } | { status: 'ERROR'; message: string };

export interface DashboardEnvelope {
  dashboard: string;
  generatedAt: string;
  dateRange: { from: string; to: string; timezone: string; asOf: string };
  period: { type: string; startsOn: string; endsOn: string; label: string };
  currency: string;
  filters: { applied: Record<string, string>; scopeLevel: string; narrowedByFilter: boolean };
  targets: Record<string, { month: KpiResult; quarter: KpiResult; year: KpiResult }>;
  kpis: Record<string, KpiResult>;
  panels: Record<string, PanelState<Record<string, unknown>>>;
  today?: Record<string, KpiResult>;
  view?: string;
}

export interface ReportColumn { key: string; label: string; type: 'text' | 'int' | 'money' | 'pct' | 'number' | 'date' }
export interface ReportResult {
  report: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | boolean | null>>;
  rowCount: number;
  truncated: boolean;
  rowLimit: number;
  summary: Record<string, unknown>;
  kpis: KpiResult[];
  meta: {
    dateRange: { from: string; to: string; timezone: string };
    period: { type: string; startsOn: string; endsOn: string; label: string };
    currency: string;
    filters: { applied: Record<string, string>; scopeLevel: string; narrowedByFilter: boolean; by?: string };
    definitions: Array<{ id: string; name: string; approvalStatus: string }>;
    computedAt: string;
    freshness: { kind: string; computedAt: string };
    detailWithheld: boolean;
  };
}

export interface ReconCheck { id: string; name: string; kpiId: string | null; expected: string | null; actual: string | null; difference: string | null; tolerance: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; note: string | null }
export interface Reconciliation {
  ranAt: string;
  runId?: string;
  dateRange: { from: string; to: string; timezone: string };
  scope: { level: string; orgWide: boolean };
  summary: { total: number; passed: number; failed: number; skipped: number; allPassed: boolean; accuracyPct: string | null };
  checks: ReconCheck[];
  method: string;
  durationMs: number;
}

export interface ExportRecord {
  id: string;
  report: string;
  format: 'CSV' | 'XLSX';
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
  appliedFilters: Record<string, unknown>;
  scopeLevel: string;
  rowCap: number;
  rowCount: number | null;
  truncated: boolean;
  fileName: string | null;
  sizeBytes: number | null;
  error: string | null;
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string;
  downloadable: boolean;
}

export interface FilterOptions {
  scopeLevel: string;
  teams: Array<{ id: string; name: string }>;
  programs: Array<{ id: string; name: string; code: string }>;
  sources: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string }>;
}

export interface SavedFilter { id: string; name: string; target: string; filters: AnalyticsQuery; isDefault: boolean; updatedAt: string }

const clean = (q: AnalyticsQuery) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Record<string, string>;
const ak = (...parts: unknown[]) => ['analytics', ...parts] as const;

/* ------------------------------------------------------------------ queries */
export const useDashboard = (kind: 'ceo' | 'team-lead' | 'manager' | 'salesperson' | 'admin', q: AnalyticsQuery = {}) =>
  useQuery({ queryKey: ak('dashboard', kind, clean(q)), placeholderData: keepPreviousData, refetchInterval: 120_000, queryFn: async ({ signal }) => (await api.get<DashboardEnvelope>(`/dashboard/${kind}`, clean(q), signal)).data });

export interface SystemHealth {
  generatedAt: string;
  businessData: false;
  note: string;
  services: Record<string, { ok: boolean; latencyMs: number; error?: string }>;
  queues: Record<string, { ok: boolean; byStatus: Record<string, number>; oldestPendingAt?: string | null }>;
  dataQuality: { lastReconciliationAt: string; checks: number; passed: number; failed: number; skipped: number; ageMinutes: number } | null;
  process: { uptimeSeconds: number; node: string; rssMb: number; heapUsedMb: number; env: string };
}
export const useSystemHealth = () => useQuery({ queryKey: ak('health'), refetchInterval: 30_000, queryFn: async () => (await api.get<SystemHealth>('/dashboard/admin')).data });

export const useKpiDefinitions = () => useQuery({ queryKey: ak('definitions'), staleTime: 300_000, queryFn: async () => (await api.get<KpiMeta[]>('/kpis/definitions')).data });
export const useKpi = (id: string, q: AnalyticsQuery = {}) => useQuery({ queryKey: ak('kpi', id, clean(q)), placeholderData: keepPreviousData, queryFn: async () => (await api.get<KpiResult>(`/kpis/${id}`, clean(q))).data });
export const useKpiHistory = (id: string, enabled: boolean) => useQuery({ queryKey: ak('history', id), enabled, queryFn: async () => (await api.get<{ id: string; points: Array<{ periodStart: string; periodEnd: string; value: string | null; unit: string }> }>(`/kpis/${id}/history`)).data });
export const useFilterOptions = () => useQuery({ queryKey: ak('filter-options'), staleTime: 120_000, queryFn: async () => (await api.get<FilterOptions>('/kpis/filter-options')).data });

export const useReport = (key: string, q: AnalyticsQuery & { limit?: number }, enabled = true) =>
  useQuery({ queryKey: ak('report', key, clean(q)), enabled, placeholderData: keepPreviousData, queryFn: async ({ signal }) => (await api.get<ReportResult>(`/reports/${key}`, clean(q), signal)).data });

export const useReconciliation = (q: AnalyticsQuery, enabled = true) =>
  useQuery({ queryKey: ak('reconciliation', clean(q)), enabled, queryFn: async () => (await api.get<Reconciliation>('/reports/reconciliation', clean(q))).data });

export function useRunReconciliation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (q: AnalyticsQuery) => (await api.post<Reconciliation>('/reports/reconciliation/run', clean(q))).data, onSuccess: () => void qc.invalidateQueries({ queryKey: ak('reconciliation') }) });
}

/* ------------------------------------------------------------------ exports */
export const useExports = () => useQuery({ queryKey: ak('exports'), queryFn: async () => (await api.get<ExportRecord[]>('/reports/exports', { limit: 25 })).data });
export const useExportStatus = (id: string | null) =>
  useQuery({
    queryKey: ak('export', id),
    enabled: Boolean(id),
    queryFn: async () => (await api.get<ExportRecord>(`/reports/exports/${id}`)).data,
    refetchInterval: (query) => (query.state.data && ['QUEUED', 'RUNNING'].includes(query.state.data.status) ? 2000 : false),
  });
export function useCreateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: { report: string; format: 'CSV' | 'XLSX'; params: AnalyticsQuery }) => (await api.post<ExportRecord>('/reports/exports', { ...b, params: clean(b.params) })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ak('exports') }),
  });
}

/** Authenticated download (cookie session). The browser saves the file; nothing is cached by the service worker (private API data). */
export async function downloadExport(rec: Pick<ExportRecord, 'id' | 'fileName'>): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/reports/exports/${rec.id}/download`, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new ApiError({ status: res.status, code: `HTTP_${res.status}`, message: res.status === 410 ? 'This export has expired' : 'Download failed' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = rec.fileName ?? `export-${rec.id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ------------------------------------------------------------------ saved filters */
export const useSavedFilters = (target?: string) => useQuery({ queryKey: ak('saved', target ?? 'all'), queryFn: async () => (await api.get<SavedFilter[]>('/reports/saved-filters', target ? { target } : undefined)).data });
export function useSaveFilter() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (b: { name: string; target: string; filters: AnalyticsQuery; isDefault?: boolean }) => (await api.post<SavedFilter>('/reports/saved-filters', { ...b, filters: clean(b.filters) })).data, onSuccess: () => void qc.invalidateQueries({ queryKey: ak('saved') }) });
}
export function useDeleteSavedFilter() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => (await api.delete(`/reports/saved-filters/${id}`)).data, onSuccess: () => void qc.invalidateQueries({ queryKey: ak('saved') }) });
}
