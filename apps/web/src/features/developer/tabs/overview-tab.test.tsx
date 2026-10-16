import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWork } from '@/features/work/test-utils';

const h = vi.hoisted(() => ({ get: vi.fn(), perms: new Set<string>(['devpanel:access', 'devpanel:config:view']) }));
vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: vi.fn(), delete: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ can: (p: string) => h.perms.has(p), user: { id: 'u1' } }),
}));

import { ApiError } from '@/lib/api/client';
import { OverviewTab } from './overview-tab';

const snapshot = {
  checkedAt: '2026-10-16T05:00:00.000Z',
  probeMs: 12,
  health: { status: 'degraded', database: 'ok', redis: 'ok', worker: 'stale', workerInstances: 1, outbox: { pending: 0, dead: 2, oldestPendingSeconds: 0 } },
  users: { total: 10, active: 9, perRole: { DEVELOPER: 1, SALES_EXECUTIVE: 4 } },
  liveSessions: 3,
  alerts24h: {
    windowHours: 24,
    counters: { accountLockouts: 1, failedLogins: 4, forceLogouts: 0, roleChanges: 0, deadOutboxEvents: 2, currentlyLockedAccounts: 1 },
    alerts: [{ key: 'deadOutbox', severity: 'critical', count: 2 }, { key: 'lockouts', severity: 'warning', count: 1 }],
  },
};
const ok = (data: unknown) => ({ data, meta: {} });

beforeEach(() => {
  h.get.mockReset();
  h.perms = new Set(['devpanel:access', 'devpanel:config:view']);
});

describe('Developer Panel overview tab', () => {
  it('renders health, alerts, integrations and an honest UNKNOWN backup', async () => {
    h.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/integrations')) return ok({ checkedAt: snapshot.checkedAt, configured: 1, items: [{ provider: 'acme-mail', kind: 'EMAIL', enabled: true, mode: 'SANDBOX', credentialsStored: true, blocked: false, state: 'unknown', lastHealthAt: null, lastHealthStatus: null, last7d: { deliveriesOk: 0, deliveriesFailed: 0, webhooksAccepted: 0, webhooksFailed: 0, lastSuccessAt: null, lastFailureAt: null } }] });
      if (path.endsWith('/backup')) return ok({ checkedAt: snapshot.checkedAt, status: 'UNKNOWN', reason: 'BACKUP_DIR_NOT_SET', lastBackupAt: null, ageHours: null, sizeBytes: null, hasChecksum: null, maxAgeHours: 26 });
      return ok(snapshot);
    });
    renderWork(<OverviewTab />);
    expect(await screen.findByText('Degraded: needs attention')).toBeInTheDocument();
    expect(screen.getByText(/2 events failed permanently in the outbox/)).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(await screen.findByText('acme-mail')).toBeInTheDocument();
    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText(/no backup folder configured/)).toBeInTheDocument();
  });

  it('shows the no-alerts state and hides config cards without devpanel:config:view', async () => {
    h.perms = new Set(['devpanel:access']);
    h.get.mockResolvedValue(ok({ ...snapshot, health: { ...snapshot.health, status: 'ok', worker: 'ok', outbox: { pending: 0, dead: 0, oldestPendingSeconds: 0 } }, alerts24h: { ...snapshot.alerts24h, alerts: [] } }));
    renderWork(<OverviewTab />);
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    expect(screen.getByText('No alerts. Nothing needs attention.')).toBeInTheDocument();
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument();
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('shows an error state with retry when the API fails', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'INTERNAL', message: 'boom' }));
    renderWork(<OverviewTab />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0));
  });
});
