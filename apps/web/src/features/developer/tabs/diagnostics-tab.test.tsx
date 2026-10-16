import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import en from '../../../../messages/en.json';
import enDiag from '../../../../messages/en.dev-diagnostics.json';
import hiDiag from '../../../../messages/hi.dev-diagnostics.json';
import mrDiag from '../../../../messages/mr.dev-diagnostics.json';
import { mergeMessages } from '@/i18n/merge';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), can: vi.fn<(p?: string) => boolean>(() => true) }));
vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: h.post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ can: h.can, user: { id: 'u1' } }) }));

import { DiagnosticsTab } from './diagnostics-tab';

const messages = mergeMessages(en as never, enDiag as never);
const wrap = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Kolkata">
      <QueryClientProvider client={client}><TooltipProvider><ToastProvider>{ui}</ToastProvider></TooltipProvider></QueryClientProvider>
    </NextIntlClientProvider>,
  );
};

const ok = (data: unknown, meta: unknown = {}) => Promise.resolve({ data, meta });
beforeEach(() => {
  h.get.mockReset(); h.post.mockReset();
  h.can.mockImplementation(() => true);
  h.get.mockImplementation((path: string) => {
    if (path.endsWith('/health')) return ok({ checkedAt: new Date().toISOString(), thresholds: { dbSlowMs: 100, dbDownMs: 1000, redisSlowMs: 50, redisDownMs: 1000, outboxSlowSeconds: 60, outboxDownSeconds: 300 }, database: { latencyMs: 3.2, samples: 5, verdict: 'ok' }, redis: { latencyMs: 80, samples: 5, verdict: 'slow' }, worker: { status: 'unknown', instances: 0, lastHeartbeatAgeSeconds: null, verdict: 'unknown' }, outbox: { pending: 1, dead: 1, oldestPendingSeconds: 0, verdict: 'slow' } });
    if (path.endsWith('/jobs')) return ok([{ id: 'j1', source: 'outbox', eventType: 'email.send', aggregateType: 'user', attempts: 5, lastError: 'smtp refused', createdAt: new Date().toISOString(), availableAt: new Date().toISOString() }], { pagination: { mode: 'cursor', limit: 25, hasMore: false, nextCursor: null }, total: 1 });
    if (path.endsWith('/errors')) return ok({ scope: 'process-memory', note: '', bufferSize: 200, slowThresholdMs: 1000, capturingSince: new Date().toISOString(), held: 1, items: [{ method: 'GET', route: '/api/v1/x/:id', status: 500, durationMs: 12, requestId: 'r1', at: new Date().toISOString(), kind: 'error' }] });
    if (path.endsWith('/migrations')) return ok({ available: false, reason: 'x' });
    if (path.endsWith('/build')) return ok({ version: '0.1.0', gitCommit: null, buildTime: null, nodeVersion: 'v24', nodeEnv: 'test', uptimeSeconds: 120, platform: 'linux/x64' });
    return Promise.reject(new Error(path));
  });
});

describe('DiagnosticsTab', () => {
  it('renders every section with honest states', async () => {
    wrap(<DiagnosticsTab />);
    expect(await screen.findByText('email.send')).toBeInTheDocument();
    expect(screen.getByText('smtp refused')).toBeInTheDocument();
    expect(await screen.findByText(/Migration history is not available/)).toBeInTheDocument();
    expect(screen.getAllByText('Slow').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not set').length).toBe(2);
    expect(screen.getAllByText(/\/api\/v1\/x\/:id/).length).toBeGreaterThan(0);
  });

  it('retries a job through the API', async () => {
    h.post.mockResolvedValue({ data: { id: 'j1', requeued: true }, meta: {} });
    wrap(<DiagnosticsTab />);
    await screen.findByText('email.send');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/dev-panel/diagnostics/jobs/j1/retry'));
  });

  it('hides job actions without devpanel:jobs:manage', async () => {
    h.can.mockImplementation((p?: string) => p !== 'devpanel:jobs:manage');
    wrap(<DiagnosticsTab />);
    await screen.findByText('email.send');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry all' })).toBeNull();
  });

  it('keeps the same key tree in hi and mr as en', () => {
    const keys = (o: unknown, p = ''): string[] => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => keys(v, `${p}.${k}`)) : [p]);
    expect(keys(hiDiag).sort()).toEqual(keys(enDiag).sort());
    expect(keys(mrDiag).sort()).toEqual(keys(enDiag).sort());
  });
});
