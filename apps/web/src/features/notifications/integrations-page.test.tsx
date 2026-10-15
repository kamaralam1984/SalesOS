import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { setCsrfToken } from '@/lib/api/client';
import { IntegrationsPage } from './integrations-page';

vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ can: () => true }), usePermission: () => true }));

const prov = (over: object) => ({
  provider: 'sandbox-email', kind: 'EMAIL', label: 'Email (sandbox / dev log)', blockedReason: null, sandbox: true, enabled: true, mode: 'SANDBOX', settings: {}, hasSecret: true, hasWebhookSecret: false,
  lastHealthAt: null, lastHealthStatus: null, lastError: null, status: 'ENABLED', ...over,
});
const delivery = (over: object) => ({
  id: crypto.randomUUID(), channel: 'EMAIL', provider: 'sandbox-email', to: 'q***@example.com', subject: 'Hello', status: 'SENT', statusLabel: 'Sent to provider (not confirmed delivered)',
  attempts: 1, maxAttempts: 5, nextAttemptAt: new Date().toISOString(), providerReference: 'sbx_1', errorCode: null, errorMessage: null, createdAt: new Date().toISOString(), ...over,
});

describe('IntegrationsPage', () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  beforeEach(() => {
    calls.length = 0;
    setCsrfToken('tok');
    const ok = (data: unknown, meta = {}) => new Response(JSON.stringify({ data, meta, error: null }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      calls.push({ path: u.pathname.replace('/api/v1', ''), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.pathname.endsWith('/integrations/health')) return ok({ deliveriesLast24h: { SENT: 2, DELIVERED: 1 }, deadLetters: 1, failedFiles: 0, deadOutboxEvents: 0, oldestQueuedOverdueSeconds: 0, note: '' });
      if (u.pathname.endsWith('/integrations/deliveries')) return ok([delivery({ status: 'SENT' }), delivery({ status: 'DEAD_LETTER', statusLabel: 'DEAD_LETTER', errorCode: 'SANDBOX_TEMPORARY_FAILURE', attempts: 5 }), delivery({ status: 'DELIVERED', statusLabel: 'Delivered (provider confirmed)' })]);
      if (u.pathname.endsWith('/integrations/failures')) return ok({ deliveries: [], files: [], deadEvents: [] });
      if (u.pathname.endsWith('/integrations')) return ok([prov({}), prov({ provider: 'resend', label: 'Resend', sandbox: false, enabled: false, hasSecret: false, status: 'BLOCKED', blockedReason: 'DEC-013: no approved provider, credentials, consent/DLT/template approvals' })]);
      return ok({});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows blocked real providers with the reason, and never lets them be enabled', async () => {
    renderWithProviders(<IntegrationsPage />);
    const resend = await screen.findByTestId('provider-resend');
    expect(within(resend).getByText('Blocked')).toBeInTheDocument();
    expect(within(resend).getByText(/DEC-013/)).toBeInTheDocument();
    await userEvent.click(within(resend).getByRole('button', { name: 'Configure' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('switch', { name: 'Enabled' })).toBeDisabled();
    expect(within(dlg).getByText('This provider is blocked and cannot be enabled.')).toBeInTheDocument();
  });

  it('secrets are write-only password fields; saving sends only what was typed', async () => {
    renderWithProviders(<IntegrationsPage />);
    const card = await screen.findByTestId('provider-sandbox-email');
    expect(within(card).getByText('Secret stored')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Configure' }));
    const dlg = await screen.findByRole('dialog');
    const secret = within(dlg).getByLabelText('API secret');
    const hook = within(dlg).getByLabelText('Webhook signing secret');
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveValue('');
    expect(hook).toHaveAttribute('type', 'password');
    await userEvent.type(hook, 'a-very-long-webhook-secret');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe('/integrations/sandbox-email');
    expect(patch.body).toMatchObject({ enabled: true, mode: 'SANDBOX', webhookSecret: 'a-very-long-webhook-secret' });
    expect(patch.body).not.toHaveProperty('secret');
  });

  it('delivery log never calls an accepted message "delivered" and offers retry only for failed ones', async () => {
    renderWithProviders(<IntegrationsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Delivery log' }));
    const rows = await screen.findAllByTestId('delivery-row');
    expect(rows).toHaveLength(3);
    const sent = rows.find((r) => r.getAttribute('data-status') === 'SENT')!;
    expect(within(sent).getByText('Sent to provider')).toBeInTheDocument();
    expect(within(sent).queryByText('Delivered', { exact: true })).not.toBeInTheDocument();
    expect(within(sent).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    const delivered = rows.find((r) => r.getAttribute('data-status') === 'DELIVERED')!;
    expect(within(delivered).getByText('Delivered', { exact: true })).toBeInTheDocument();
    expect(within(delivered).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    const dead = rows.find((r) => r.getAttribute('data-status') === 'DEAD_LETTER')!;
    await userEvent.click(within(dead).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/retry'))).toBe(true));
  });

  it('has no axe violations', async () => {
    const { baseElement } = renderWithProviders(<IntegrationsPage />);
    await screen.findByTestId('provider-resend');
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
