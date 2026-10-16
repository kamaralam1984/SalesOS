'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

/** Auto-refresh interval of the Overview tab. */
export const OVERVIEW_REFRESH_MS = 20_000;

export type AlertSeverity = 'critical' | 'warning' | 'info';
export interface DashboardSnapshot {
  checkedAt: string;
  probeMs: number;
  health: {
    status: 'ok' | 'degraded' | 'down';
    database: 'ok' | 'down';
    redis: 'ok' | 'down';
    worker: 'ok' | 'stale' | 'unknown';
    workerInstances: number;
    outbox: { pending: number; dead: number; oldestPendingSeconds: number } | null;
  };
  users: { total: number; active: number; perRole: Record<string, number> };
  liveSessions: number;
  alerts24h: {
    windowHours: number;
    counters: {
      accountLockouts: number;
      failedLogins: number;
      forceLogouts: number;
      roleChanges: number;
      deadOutboxEvents: number | null;
      currentlyLockedAccounts: number;
    };
    alerts: Array<{ key: string; severity: AlertSeverity; count: number | null }>;
  };
}
export type IntegrationState = 'not_configured' | 'blocked' | 'disabled' | 'healthy' | 'degraded' | 'unknown';
export interface DashboardIntegration {
  provider: string;
  kind: string;
  enabled: boolean;
  mode: string;
  credentialsStored: boolean;
  blocked: boolean;
  state: IntegrationState;
  lastHealthAt: string | null;
  lastHealthStatus: string | null;
  last7d: { deliveriesOk: number; deliveriesFailed: number; webhooksAccepted: number; webhooksFailed: number; lastSuccessAt: string | null; lastFailureAt: string | null };
}
export interface DashboardIntegrations {
  checkedAt: string;
  configured: number;
  items: DashboardIntegration[];
}
export interface DashboardBackup {
  checkedAt: string;
  status: 'OK' | 'STALE' | 'MISSING' | 'UNKNOWN';
  reason: string | null;
  lastBackupAt: string | null;
  ageHours: number | null;
  sizeBytes: number | null;
  hasChecksum: boolean | null;
  maxAgeHours: number;
}

const key = { snapshot: ['devpanel', 'overview-tab', 'snapshot'] as const, integrations: ['devpanel', 'overview-tab', 'integrations'] as const, backup: ['devpanel', 'overview-tab', 'backup'] as const };

export const useDashboardSnapshot = () =>
  useQuery({ queryKey: key.snapshot, refetchInterval: OVERVIEW_REFRESH_MS, queryFn: async () => (await api.get<DashboardSnapshot>('/dev-panel/dashboard')).data });

export const useDashboardIntegrations = (enabled: boolean) =>
  useQuery({ queryKey: key.integrations, enabled, refetchInterval: enabled ? OVERVIEW_REFRESH_MS : false, queryFn: async () => (await api.get<DashboardIntegrations>('/dev-panel/dashboard/integrations')).data });

export const useDashboardBackup = (enabled: boolean) =>
  useQuery({ queryKey: key.backup, enabled, refetchInterval: enabled ? OVERVIEW_REFRESH_MS * 3 : false, queryFn: async () => (await api.get<DashboardBackup>('/dev-panel/dashboard/backup')).data });
