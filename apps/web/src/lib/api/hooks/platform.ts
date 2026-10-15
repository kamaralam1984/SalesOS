'use client';
/** Platform (notifications, files, integrations, AI, devices) API hooks. Query keys are local to this file. */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_BASE_URL, ApiError, getCsrfToken, setCsrfToken } from '../client';

export const pk = {
  notifications: ['notifications'] as const,
  notificationList: (q: object) => ['notifications', 'list', q] as const,
  unread: ['notifications', 'unread'] as const,
  prefs: ['notifications', 'prefs'] as const,
  types: ['notifications', 'types'] as const,
  rules: ['notifications', 'rules'] as const,
  files: (q: object) => ['files', q] as const,
  fileSettings: ['files', 'settings'] as const,
  integrations: ['integrations'] as const,
  health: ['integrations', 'health'] as const,
  failures: ['integrations', 'failures'] as const,
  deliveries: (q: object) => ['integrations', 'deliveries', q] as const,
  aiStatus: ['ai', 'status'] as const,
  aiConfig: ['ai', 'config'] as const,
  aiUsage: (d: number) => ['ai', 'usage', d] as const,
};

// ───────── notifications ─────────
export interface NotificationDto {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: 'UNREAD' | 'READ' | 'DISMISSED';
  title: string;
  body: string | null;
  entity: { type: string; id: string } | null;
  actionUrl: string | null;
  occurrences: number;
  isDigest: boolean;
  createdAt: string;
  lastRaisedAt: string;
  readAt: string | null;
}

export interface NotificationQuery {
  status?: 'ALL' | 'UNREAD' | 'READ';
  type?: string;
}

export function useNotificationList(q: NotificationQuery) {
  return useInfiniteQuery({
    queryKey: pk.notificationList(q),
    initialPageParam: undefined as string | undefined,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }) => {
      const r = await api.get<NotificationDto[]>('/notifications', { limit: 20, cursor: pageParam, status: q.status ?? 'ALL', type: q.type });
      return { items: r.data, next: r.meta.pagination?.nextCursor ?? undefined, unreadCount: (r.meta as { unreadCount?: number }).unreadCount ?? 0 };
    },
    getNextPageParam: (last) => last.next,
  });
}

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: pk.unread,
    enabled,
    refetchInterval: false,
    queryFn: async () => (await api.get<{ unreadCount: number }>('/notifications/unread-count')).data.unreadCount,
  });
}

export function useRecentNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications', 'recent'],
    enabled,
    queryFn: async () => (await api.get<NotificationDto[]>('/notifications', { limit: 8, status: 'ALL' })).data,
  });
}

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: pk.notifications });
}

export function useNotificationActions() {
  const inv = useInvalidateNotifications();
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: inv });
  const dismiss = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/dismiss`), onSuccess: inv });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: inv });
  return { read, dismiss, readAll };
}

export interface NotificationTypeInfo {
  key: string;
  label: string;
  category: string;
  severity: string;
  mandatory: boolean;
  defaultChannels: string[];
}
export function useNotificationTypes() {
  return useQuery({ queryKey: pk.types, staleTime: 10 * 60_000, queryFn: async () => (await api.get<NotificationTypeInfo[]>('/notifications/types')).data });
}

export type Channel = 'IN_APP' | 'EMAIL' | 'WHATSAPP' | 'SMS' | 'CALENDAR';
export interface PreferencesDto {
  preferences: Array<{ type: string; channel: Channel; enabled: boolean }>;
  quietHours: { quietStart: string; quietEnd: string; timezone: string } | null;
  organisationDefaults: { quietStart: string; quietEnd: string; timezone: string; workingDays: number[] };
}
export function usePreferences() {
  return useQuery({ queryKey: pk.prefs, queryFn: async () => (await api.get<PreferencesDto>('/notifications/preferences')).data });
}
export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { preferences: PreferencesDto['preferences']; quietHours?: PreferencesDto['quietHours'] }) => (await api.put<PreferencesDto>('/notifications/preferences', body)).data,
    onSuccess: (d) => qc.setQueryData(pk.prefs, d),
  });
}

export interface RulesDto {
  rules: Array<{ type: string; enabled: boolean; channels: Channel[]; severity: string | null; bypassQuietHours: boolean }>;
  orgConfig: { quietStart: string; quietEnd: string; timezone: string; workingDays: number[]; digestThreshold: number; digestWindowMinutes: number };
}
export function useRules(enabled: boolean) {
  return useQuery({ queryKey: pk.rules, enabled, queryFn: async () => (await api.get<RulesDto>('/notifications/rules')).data });
}
export function useSaveRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { rules?: Array<{ type: string; enabled?: boolean; channels?: Channel[]; bypassQuietHours?: boolean }>; orgConfig?: Partial<RulesDto['orgConfig']> }) => (await api.patch<RulesDto>('/notifications/rules', body)).data,
    onSuccess: (d) => qc.setQueryData(pk.rules, d),
  });
}

// ───────── files ─────────
export interface FileDto {
  id: string;
  displayName: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  category: string;
  status: 'PENDING' | 'SCANNING' | 'PROCESSING' | 'READY' | 'REJECTED' | 'FAILED';
  progress: number;
  scanStatus: string;
  scanLabel: string;
  processingNote: string | null;
  lastError: string | null;
  downloadable: boolean;
  hasDerivative: boolean;
  createdAt: string;
  uploaderId: string;
}
const ACTIVE = new Set(['PENDING', 'SCANNING', 'PROCESSING']);
export function useFileList(q: { entityType?: string; entityId?: string }) {
  return useQuery({
    queryKey: pk.files(q),
    queryFn: async () => (await api.get<FileDto[]>('/files', { limit: 50, entityType: q.entityType, entityId: q.entityId })).data,
    // poll while anything is still being processed
    refetchInterval: (query) => ((query.state.data ?? []).some((f) => ACTIVE.has(f.status)) ? 2000 : false),
  });
}
export function useFileActions() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ['files'] });
  const retry = useMutation({ mutationFn: (id: string) => api.post(`/files/${id}/retry`), onSuccess: inv });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/files/${id}`), onSuccess: inv });
  return { retry, remove };
}
export async function getDownloadUrl(id: string): Promise<string> {
  return (await api.get<{ url: string }>(`/files/${id}/download-url`)).data.url;
}

export interface UploadHandle {
  promise: Promise<FileDto>;
  abort: () => void;
}
async function ensureCsrf() {
  if (getCsrfToken()) return;
  const r = await api.get<{ csrfToken?: string }>('/auth/me');
  if (r.data?.csrfToken) setCsrfToken(r.data.csrfToken);
}
/** Multipart upload with progress (XHR: fetch has no upload progress). Server decides what is acceptable. */
export function uploadFile(file: File, opts: { entityType?: string; entityId?: string; purpose?: string; onProgress?: (pct: number) => void }): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = (async () => {
    await ensureCsrf();
    return new Promise<FileDto>((resolve, reject) => {
      const form = new FormData();
      if (opts.entityType && opts.entityId) {
        form.append('entityType', opts.entityType);
        form.append('entityId', opts.entityId);
      }
      if (opts.purpose) form.append('purpose', opts.purpose);
      form.append('file', file, file.name);
      xhr.open('POST', `${API_BASE_URL}/files`);
      xhr.withCredentials = true;
      const csrf = getCsrfToken();
      if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
      xhr.onerror = () => reject(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Could not reach the server. Nothing was saved.' }));
      xhr.onabort = () => reject(new ApiError({ status: 0, code: 'ABORTED', message: 'Upload cancelled' }));
      xhr.onload = () => {
        let env: { data?: FileDto; error?: { code: string; message: string } } = {};
        try { env = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && env.data) resolve(env.data);
        else reject(new ApiError({ status: xhr.status, code: env.error?.code ?? `HTTP_${xhr.status}`, message: env.error?.message ?? 'Upload failed' }));
      };
      xhr.send(form);
    });
  })();
  return { promise, abort: () => xhr.abort() };
}

export interface FileSettingsDto {
  settings: { maxBytesByCategory: { image: number; document: number; csv: number }; userQuotaBytes: number; orgQuotaBytes: number; signedUrlTtlSeconds: number; purgeAfterDays: number; maxImagePixels: number };
  allowed: Array<{ extension: string; category: string; mimes: string[] }>;
  scanner: string;
  pdfOptimiser: string;
}
export function useFileSettings(enabled: boolean) {
  return useQuery({ queryKey: pk.fileSettings, enabled, queryFn: async () => (await api.get<FileSettingsDto>('/files/settings')).data });
}
export function useSaveFileSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: object) => api.patch('/files/settings', b), onSuccess: () => qc.invalidateQueries({ queryKey: pk.fileSettings }) });
}

// ───────── integrations ─────────
export interface IntegrationDto {
  provider: string;
  kind: string;
  label: string;
  blockedReason: string | null;
  sandbox: boolean;
  enabled: boolean;
  mode: 'SANDBOX' | 'LIVE';
  settings: Record<string, unknown>;
  hasSecret: boolean;
  hasWebhookSecret: boolean;
  lastHealthAt: string | null;
  lastHealthStatus: string | null;
  lastError: string | null;
  status: 'BLOCKED' | 'ENABLED' | 'DISABLED';
}
export function useIntegrations() {
  return useQuery({ queryKey: pk.integrations, queryFn: async () => (await api.get<IntegrationDto[]>('/integrations')).data });
}
export function usePatchIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { provider: string; body: object }) => (await api.patch<IntegrationDto>(`/integrations/${v.provider}`, v.body)).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: pk.integrations }); },
  });
}
export function useSendTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { provider: string; to: string; body: string }) => (await api.post<DeliveryDto>(`/integrations/${v.provider}/test`, { to: v.to, body: v.body })).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['integrations'] }); },
  });
}
export function useCheckHealth() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (p: string) => api.post(`/integrations/${p}/health`), onSuccess: () => qc.invalidateQueries({ queryKey: pk.integrations }) });
}
export interface HealthSummary {
  deliveriesLast24h: Record<string, number>;
  deadLetters: number;
  failedFiles: number;
  deadOutboxEvents: number;
  oldestQueuedOverdueSeconds: number;
  note: string;
}
export function useHealthSummary() {
  return useQuery({ queryKey: pk.health, refetchInterval: 15_000, queryFn: async () => (await api.get<HealthSummary>('/integrations/health')).data });
}
export interface DeliveryDto {
  id: string;
  channel: string;
  provider: string;
  to: string;
  subject: string | null;
  status: string;
  statusLabel: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  providerReference: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}
export function useDeliveries(q: { status?: string }) {
  return useQuery({
    queryKey: pk.deliveries(q),
    refetchInterval: 10_000,
    queryFn: async () => (await api.get<DeliveryDto[]>('/integrations/deliveries', { limit: 50, status: q.status })).data,
  });
}
export function useRetryDelivery() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.post(`/integrations/deliveries/${id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: pk.integrations }) });
}
export interface FailuresDto {
  deliveries: Array<DeliveryDto & { recoverable: boolean }>;
  files: Array<{ id: string; displayName: string; status: string; error: string | null; attempts: number; recoverable: boolean; createdAt: string }>;
  deadEvents: Array<{ id: string; eventType: string; error: string | null; attempts: number; createdAt: string; note: string }>;
}
export function useFailures() {
  return useQuery({ queryKey: pk.failures, refetchInterval: 15_000, queryFn: async () => (await api.get<FailuresDto>('/integrations/failures')).data });
}

// ───────── AI ─────────
export interface AiSuggestionDto {
  id: string;
  feature: string;
  status: 'DRAFT' | 'ACCEPTED' | 'EDITED' | 'REJECTED';
  output: Record<string, unknown>;
  editedOutput: Record<string, unknown> | null;
  sources: { origin: string; period: { from: string | null; to: string | null }; noteCount: number; redactions: number; warnings: string[]; callSources?: string[] };
  provider: string;
  model: string;
  createdAt: string;
  label: string;
}
export type AiRunResult = { insufficientData: true; message: string; label: string; suggestion: null } | { insufficientData: false; label: string; suggestion: AiSuggestionDto };
export function useAiStatus(enabled = true) {
  return useQuery({ queryKey: pk.aiStatus, enabled, staleTime: 60_000, retry: false, queryFn: async () => (await api.get<{ enabled: boolean; label: string }>('/ai/status')).data });
}
export function useAiRun(feature: 'summarize' | 'extract' | 'draft-followup') {
  return useMutation({ mutationFn: async (body: { text?: string; leadId?: string; channel?: string }) => (await api.post<AiRunResult>(`/ai/${feature}`, body)).data });
}
export function useAiReview() {
  return useMutation({
    mutationFn: async (v: { id: string; action: 'ACCEPT' | 'EDIT' | 'REJECT'; editedOutput?: Record<string, unknown> }) =>
      (await api.patch<AiSuggestionDto>(`/ai/suggestions/${v.id}`, { action: v.action, editedOutput: v.editedOutput })).data,
  });
}
export interface AiConfigDto {
  enabled: boolean;
  provider: 'fake' | 'openai' | 'gemini' | 'anthropic';
  model: string;
  rateLimitPerMinute: number;
  redactPii: boolean;
  providersAvailable: Record<string, boolean>;
  note: string;
}
export function useAiConfig() {
  return useQuery({ queryKey: pk.aiConfig, queryFn: async () => (await api.get<AiConfigDto>('/ai/config')).data });
}
export function useSaveAiConfig() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (b: Partial<AiConfigDto>) => (await api.patch<AiConfigDto>('/ai/config', b)).data, onSuccess: (d) => { qc.setQueryData(pk.aiConfig, d); void qc.invalidateQueries({ queryKey: pk.aiStatus }); } });
}
export interface AiUsageDto {
  days: number;
  requests: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  byOutcome: Record<string, number>;
  byFeature: Array<{ feature: string; requests: number; costUsd: number; avgLatencyMs: number }>;
  recent: Array<{ id: string; feature: string; provider: string; model: string; outcome: string; latencyMs: number; errorCode: string | null; costUsd: number; createdAt: string }>;
  costNote: string;
}
export function useAiUsage(days = 30, enabled = true) {
  return useQuery({ queryKey: pk.aiUsage(days), enabled, queryFn: async () => (await api.get<AiUsageDto>('/ai/usage', { days })).data });
}
