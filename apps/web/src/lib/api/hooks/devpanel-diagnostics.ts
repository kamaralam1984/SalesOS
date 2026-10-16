'use client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

const key = {
  all: ['devpanel', 'diagnostics'] as const,
  health: ['devpanel', 'diagnostics', 'health'] as const,
  jobs: ['devpanel', 'diagnostics', 'jobs'] as const,
  errors: (kind: string) => ['devpanel', 'diagnostics', 'errors', kind] as const,
  migrations: ['devpanel', 'diagnostics', 'migrations'] as const,
  build: ['devpanel', 'diagnostics', 'build'] as const,
};

export type Verdict = 'ok' | 'slow' | 'down' | 'unknown';

export interface DiagHealth {
  checkedAt: string;
  thresholds: { dbSlowMs: number; dbDownMs: number; redisSlowMs: number; redisDownMs: number; outboxSlowSeconds: number; outboxDownSeconds: number };
  database: { latencyMs: number | null; samples: number; verdict: Verdict };
  redis: { latencyMs: number | null; samples: number; verdict: Verdict };
  worker: { status: string; instances: number; lastHeartbeatAgeSeconds: number | null; verdict: Verdict };
  outbox: { pending: number | null; dead: number | null; oldestPendingSeconds: number | null; verdict: Verdict };
}
export interface DiagJob {
  id: string;
  source: 'outbox';
  eventType: string;
  aggregateType: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  availableAt: string;
}
export interface DiagErrors {
  scope: 'process-memory';
  note: string;
  bufferSize: number;
  slowThresholdMs: number;
  capturingSince: string;
  held: number;
  items: Array<{ method: string; route: string; status: number; durationMs: number; requestId: string | null; at: string; kind: 'error' | 'slow' }>;
}
export type DiagMigrations =
  | { available: false; reason: string }
  | {
      available: true;
      count: number;
      problems: string[];
      latest: { name: string; finishedAt: string | null } | null;
      items: Array<{ name: string; startedAt: string; finishedAt: string | null; rolledBackAt: string | null; appliedSteps: number; state: 'applied' | 'unfinished' | 'rolled_back' }>;
    };
export interface DiagBuild {
  version: string;
  gitCommit: string | null;
  buildTime: string | null;
  nodeVersion: string;
  nodeEnv: string;
  uptimeSeconds: number;
  platform: string;
}

const B = '/dev-panel/diagnostics';

export const useDiagHealth = () =>
  useQuery({ queryKey: key.health, refetchInterval: 15_000, queryFn: async () => (await api.get<DiagHealth>(`${B}/health`)).data });

export const useDiagJobs = () =>
  useInfiniteQuery({
    queryKey: key.jobs,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const r = await api.get<DiagJob[]>(`${B}/jobs`, { limit: 25, cursor: pageParam });
      return { items: r.data ?? [], next: r.meta?.pagination?.nextCursor ?? null, total: (r.meta as { total?: number } | undefined)?.total ?? null };
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });

export const useDiagErrors = (kind: 'all' | 'error' | 'slow') =>
  useQuery({ queryKey: key.errors(kind), queryFn: async () => (await api.get<DiagErrors>(`${B}/errors`, { kind, limit: 100 })).data });

export const useDiagMigrations = () => useQuery({ queryKey: key.migrations, queryFn: async () => (await api.get<DiagMigrations>(`${B}/migrations`)).data });
export const useDiagBuild = () => useQuery({ queryKey: key.build, queryFn: async () => (await api.get<DiagBuild>(`${B}/build`)).data });

function useJobMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key.jobs });
      void qc.invalidateQueries({ queryKey: key.health });
    },
  });
}
export const useRetryJob = () => useJobMutation((id: string) => api.post(`${B}/jobs/${id}/retry`));
export const useDiscardJob = () => useJobMutation((v: { id: string; reason: string }) => api.post(`${B}/jobs/${v.id}/discard`, { reason: v.reason }));
export const useRetryAllJobs = () =>
  useJobMutation(async () => (await api.post<{ requeued: number; remaining: number; cap: number }>(`${B}/jobs/retry-all`)).data);
