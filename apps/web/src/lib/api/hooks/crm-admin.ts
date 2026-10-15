'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL, ApiError, CSRF_HEADER, api, apiRequest, getCsrfToken } from '../client';
import type { PaginationMeta } from '../types';
import { crmKey } from './crm';

/* ------------------------------------------------------------------ imports */
export interface ImportPreview {
  header: string[];
  totalRows: number;
  mapping: Record<string, number>;
  nameFrom?: 'fullName' | 'firstLast' | null;
  template?: string;
  dryRun?: { rowsWithProblems: number; missingName: number; missingContact: number; invalidEmail: number };
  sample: string[][];
  problems: string[];
}
export interface ImportJob {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' | 'CANCELLED';
  fileName: string | null;
  totalRows: number;
  processedRows: number;
  progressPercent: number;
  createdRows: number;
  duplicateRows: number;
  skippedRows: number;
  errorRows: number;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface ImportOptions {
  mapping?: Record<string, string>;
  sourceId?: string | null;
  programId?: string | null;
  assignment: 'none' | 'round_robin' | 'user';
  assigneeId?: string | null;
  consentStatus?: string;
  template?: 'GENERIC' | 'LEADSQUARED' | 'ZOHO' | 'HUBSPOT';
}
export interface ImportErrorRow {
  id: string;
  rowNumber: number;
  severity: 'ERROR' | 'WARNING';
  code: string;
  field: string | null;
  message: string;
}

/** Large CSVs are sent as a raw text/csv body (the JSON parser is capped at 100 kB); options travel in the query. */
async function uploadCsv<T>(path: string, csv: string, fileName: string, options: ImportOptions, key?: string): Promise<{ data: T; warnings: string[] }> {
  const url = new URL(`${API_BASE_URL}${path}`);
  url.searchParams.set('fileName', fileName);
  url.searchParams.set('options', JSON.stringify(options));
  const headers: Record<string, string> = { 'Content-Type': 'text/csv', Accept: 'application/json' };
  const csrf = getCsrfToken();
  if (csrf) headers[CSRF_HEADER] = csrf;
  if (key) headers['Idempotency-Key'] = key;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: csv, credentials: 'include', cache: 'no-store' });
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Could not reach the server. Nothing was saved.' });
  }
  const env = (await res.json().catch(() => null)) as { data: T; meta?: { warnings?: string[] }; error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok || env?.error) throw new ApiError({ status: res.status, code: env?.error?.code ?? `HTTP_${res.status}`, message: env?.error?.message ?? 'Upload failed', details: env?.error?.details });
  return { data: env!.data, warnings: env?.meta?.warnings ?? [] };
}

export const previewImport = (csv: string, fileName: string, options: ImportOptions) =>
  uploadCsv<ImportPreview>('/leads/import/preview', csv, fileName, options).then((r) => r.data);

export function useCreateImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { csv: string; fileName: string; options: ImportOptions; key?: string }) => uploadCsv<ImportJob>('/leads/import', i.csv, i.fileName, i.options, i.key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }),
  });
}

export const useImports = () =>
  useQuery({
    queryKey: crmKey('imports'),
    queryFn: async () => (await api.get<ImportJob[]>('/leads/import', { limit: 20 })).data,
  });

/** Polls every 1.5 s while the job is queued/running (the worker updates progress). */
export function useImportJob(id: string | null) {
  return useQuery({
    queryKey: crmKey('imports', id),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'].includes(q.state.data.status) ? false : 1500),
    queryFn: async () => (await api.get<ImportJob>(`/leads/import/${id}`)).data,
  });
}

export const useImportErrors = (id: string | null, enabled: boolean) =>
  useQuery({
    queryKey: crmKey('imports', id, 'errors'),
    enabled: Boolean(id) && enabled,
    queryFn: async () => (await api.get<ImportErrorRow[]>(`/leads/import/${id}/errors`, { limit: 100 })).data,
  });

export function useRetryImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<ImportJob>(`/leads/import/${id}/retry`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }),
  });
}

/** Downloads the full CSV error report through the authenticated API (cookie + credentials). */
export async function downloadImportReport(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/leads/import/${id}/errors?format=csv`, { credentials: 'include' });
  if (!res.ok) throw new ApiError({ status: res.status, code: `HTTP_${res.status}`, message: 'Could not download the report' });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `import-${id}-errors.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/* ------------------------------------------------------------------ events */
export type AttendanceStatus = 'INVITED' | 'REGISTERED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED' | 'RESCHEDULED' | 'FOLLOWED_UP' | 'CONVERTED' | 'NOT_CONVERTED';
export interface CrmEvent {
  id: string;
  type: 'WEBINAR' | 'DEMO' | 'EVENT';
  title: string;
  programId: string | null;
  startsAt: string;
  endsAt: string | null;
  capacity: number | null;
  location: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  counts?: Record<string, number>;
}
export const useEvents = (q: { type?: string; upcoming?: boolean } = {}) =>
  useQuery({ queryKey: crmKey('events', q), queryFn: async () => (await api.get<CrmEvent[]>('/events', { ...q, limit: 50 })).data });
export const useEvent = (id: string) => useQuery({ queryKey: crmKey('events', 'detail', id), queryFn: async () => (await api.get<CrmEvent>(`/events/${id}`)).data });
export interface Attendee {
  id: string;
  status: AttendanceStatus;
  joinedAt: string | null;
  reason: string | null;
  lead: { id: string; fullName: string; phone?: string | null; assignedToId?: string | null };
}
export const useAttendees = (id: string) =>
  useQuery({ queryKey: crmKey('events', id, 'attendance'), queryFn: async () => (await api.get<Attendee[]>(`/events/${id}/attendance`, { limit: 100 })).data });

function useMut<I, O>(fn: (i: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }) });
}
export const useCreateEvent = () =>
  useMut(async (i: { type: string; title: string; startsAt: string; endsAt?: string; programId?: string | null; capacity?: number | null; location?: string }) => (await api.post<CrmEvent>('/events', i)).data);
export const useUpdateEvent = () =>
  useMut(async (i: { id: string; status?: string; title?: string }) => {
    const { id, ...body } = i;
    return (await api.patch<CrmEvent>(`/events/${id}`, body)).data;
  });
export const useSetAttendance = () =>
  useMut(async (i: { eventId: string; leadId: string; status: AttendanceStatus; reason?: string; newEventId?: string }) => {
    const { eventId, ...body } = i;
    const r = await api.post(`/events/${eventId}/attendance`, body);
    return { data: r.data, warnings: r.meta.warnings ?? [] };
  });

/** Legal next states per docs/state-machines.md section 2 (CONVERTED/NOT_CONVERTED are derived by the system). */
export const NEXT_ATTENDANCE: Record<AttendanceStatus, AttendanceStatus[]> = {
  INVITED: ['REGISTERED'],
  REGISTERED: ['ATTENDED', 'NO_SHOW', 'CANCELLED'],
  NO_SHOW: ['RESCHEDULED'],
  RESCHEDULED: ['REGISTERED'],
  ATTENDED: ['FOLLOWED_UP'],
  FOLLOWED_UP: [],
  CANCELLED: [],
  CONVERTED: [],
  NOT_CONVERTED: [],
};

/* ------------------------------------------------------------------ configuration */
export interface Program { id: string; code: string; name: string; kind: string; description: string | null; isActive: boolean; sortOrder: number }
export interface Source { id: string; name: string; type: string; isActive: boolean; campaigns: { id: string; name: string }[] }
export interface StageCfg { id: string; key: string; label: string; category: string; sortOrder: number; skippable: boolean; canClose: boolean; isActive: boolean; isSystem: boolean }
export interface LostReasonCfg { id: string; key: string; label: string; requiresNote: boolean; reactivateAfterDays: number | null; isActive: boolean }
export interface RuleRow { id: string | null; ruleKey: string; teamId: string | null; description: string; config: Record<string, unknown>; isActive: boolean; isDefault: boolean }
export interface AssignRule { id: string; teamId: string; isEnabled: boolean; dailyCap: number | null; excludedUserIds: string[] }

const useList = <T,>(key: string, path: string, enabled = true) =>
  useQuery({ queryKey: crmKey('cfg', key), enabled, queryFn: async () => (await api.get<T[]>(path)).data });
export const usePrograms = (enabled = true) => useList<Program>('programs', '/programs', enabled);
export const useSources = (enabled = true) => useList<Source>('sources', '/lead-sources', enabled);
export const useStages = (enabled = true) => useList<StageCfg>('stages', '/lead-stages', enabled);
export const useLostReasons = (enabled = true) => useList<LostReasonCfg>('lost', '/lost-reasons', enabled);
export const useRules = (enabled = true) => useList<RuleRow>('rules', '/automation-rules', enabled);
export const useAssignRules = (enabled = true) => useList<AssignRule>('assign', '/assignment-rules', enabled);

export const useCreateProgram = () => useMut(async (i: { code: string; name: string; kind: string; description?: string }) => (await api.post('/programs', i)).data);
export const useUpdateProgram = () => useMut(async (i: { id: string; name?: string; isActive?: boolean }) => { const { id, ...b } = i; return (await api.patch(`/programs/${id}`, b)).data; });
export const useCreateSource = () => useMut(async (i: { name: string; type: string }) => (await api.post('/lead-sources', i)).data);
export const useUpdateSource = () => useMut(async (i: { id: string; isActive?: boolean }) => { const { id, ...b } = i; return (await api.patch(`/lead-sources/${id}`, b)).data; });
export const useCreateCampaign = () => useMut(async (i: { sourceId: string; name: string }) => (await api.post('/campaigns', i)).data);
export const useUpdateStage = () => useMut(async (i: { id: string; label?: string; skippable?: boolean; canClose?: boolean; isActive?: boolean }) => { const { id, ...b } = i; return (await api.patch(`/lead-stages/${id}`, b)).data; });
export const useCreateStage = () => useMut(async (i: { key: string; label: string; category: string; sortOrder: number; skippable: boolean; canClose: boolean }) => (await api.post('/lead-stages', i)).data);
export const useCreateLostReason = () => useMut(async (i: { key: string; label: string; requiresNote: boolean; reactivateAfterDays: number | null }) => (await api.post('/lost-reasons', i)).data);
export const useUpdateLostReason = () => useMut(async (i: { id: string; label?: string; requiresNote?: boolean; reactivateAfterDays?: number | null; isActive?: boolean }) => { const { id, ...b } = i; return (await api.patch(`/lost-reasons/${id}`, b)).data; });
export const useUpsertRule = () => useMut(async (i: { ruleKey: string; teamId?: string | null; config: Record<string, unknown>; isActive?: boolean }) => (await api.post('/automation-rules', { isActive: true, ...i })).data);
export const useUpsertAssignRule = () => useMut(async (i: { teamId: string; isEnabled: boolean; dailyCap: number | null; excludedUserIds: string[] }) => (await api.put('/assignment-rules', { sourceIds: [], programIds: [], ...i })).data);

/* ------------------------------------------------------------------ live updates (SSE + polling fallback) */
export type StreamMode = 'connecting' | 'live' | 'polling';

export interface StreamDeps {
  EventSourceCtor?: typeof EventSource;
  pollMs?: number;
}

/**
 * Opens EventSource(`${API}/stream`, withCredentials) and invalidates the CRM caches on task / notification /
 * exception events. When EventSource is missing or errors, falls back to polling GET /stream/poll and re-tries SSE later.
 */
export function useCrmStream(enabled = true, deps: StreamDeps = {}) {
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<StreamMode>('connecting');
  const [lastEventAt, setLastEventAt] = React.useState<number | null>(null);
  const cursor = React.useRef<string | null>(null);
  const ES = deps.EventSourceCtor ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);
  const pollMs = deps.pollMs ?? 15_000;

  React.useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const touch = () => {
      setLastEventAt(Date.now());
      void qc.invalidateQueries({ queryKey: ['crm'] });
    };
    const poll = async () => {
      try {
        const since = cursor.current ?? new Date(Date.now() - 60_000).toISOString();
        const r = await apiRequest<{ cursor: string; events: { type: string }[] }>('/stream/poll', { query: { since }, skipUnauthorizedHandler: true });
        cursor.current = r.data.cursor;
        if (r.data.events.some((e) => e.type !== 'exceptions')) touch();
      } catch {
        /* offline / forbidden: next tick retries */
      }
    };
    const startPolling = () => {
      if (closed || timer) return;
      setMode('polling');
      void poll();
      timer = setInterval(() => void poll(), pollMs);
      retry = setTimeout(() => {
        if (timer) clearInterval(timer);
        timer = null;
        connect();
      }, 120_000);
    };
    const connect = () => {
      if (closed) return;
      if (!ES) return startPolling();
      try {
        es = new ES(`${API_BASE_URL}/stream`, { withCredentials: true });
      } catch {
        return startPolling();
      }
      es.addEventListener('ready', () => setMode('live'));
      es.addEventListener('cursor', (e) => {
        cursor.current = (JSON.parse((e as MessageEvent).data) as { cursor: string }).cursor;
      });
      for (const t of ['task', 'notification', 'exceptions']) es.addEventListener(t, () => touch());
      es.onerror = () => {
        es?.close();
        es = null;
        startPolling();
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (timer) clearInterval(timer);
      if (retry) clearTimeout(retry);
    };
  }, [enabled, qc, ES, pollMs]);

  return { mode, lastEventAt };
}

export type { PaginationMeta };
