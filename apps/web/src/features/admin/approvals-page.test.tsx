import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { mergeMessages } from '@/i18n/merge';
import en from '../../../messages/en.json';
import enApprovals from '../../../messages/en.approvals.json';
import type { AuthState } from '../people/hrkit/auth-mock';

const auth = vi.hoisted(() => ({ userId: 'me', perms: {} as AuthState['perms'] }));
vi.mock('@/features/auth/auth-provider', async () => (await import('../people/hrkit/auth-mock')).makeAuthModule(auth));
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  api: { get, post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { ApprovalsPage } from './approvals-page';

const messages = mergeMessages(en as never, enApprovals as never);
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Kolkata">
      <QueryClientProvider client={client}><ThemeProvider><TooltipProvider><ToastProvider><ApprovalsPage /></ToastProvider></TooltipProvider></ThemeProvider></QueryClientProvider>
    </NextIntlClientProvider>,
  );
}
const pending = (over: object = {}) => ({ id: 'u1', name: 'Riya Rao', email: 'riya@x.co', department: null, roles: ['SALES_EXECUTIVE'], createdAt: '2026-10-17T05:00:00Z', createdById: 'hr1', createdByName: 'HR Hina', canApprove: true, ...over });

beforeEach(() => { get.mockReset(); post.mockReset(); auth.perms = { 'users:approve': 'org', 'users:password:reset': 'org' }; });

describe('Approvals page', () => {
  it('is denied without approve or reset permission', () => {
    auth.perms = {};
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(/do not have access/i);
  });

  it('approving shows the one-time invite link once; an account you created cannot be approved by you', async () => {
    get.mockImplementation(async (path: string) => ({ data: path === '/users/pending' ? [pending(), pending({ id: 'u2', name: 'Own Account', createdById: 'me', canApprove: false })] : [] }));
    post.mockResolvedValue({ data: { id: 'u1', approvalStatus: 'APPROVED', invite: { link: 'https://x.test/invite/accept?token=abc', expiresAt: '2026-10-24T00:00:00Z' } } });
    renderPage();
    expect(await screen.findByText('Riya Rao')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Approve' });
    expect(buttons[1]).toBeDisabled();
    expect(screen.getByText(/You created this account/)).toBeInTheDocument();
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/users/u1/approve', {}));
    expect(await screen.findByDisplayValue('https://x.test/invite/accept?token=abc')).toBeInTheDocument();
    expect(screen.getByText(/shown only now/)).toBeInTheDocument();
  });

  it('lists password reset requests and issues a one-time reset link', async () => {
    get.mockImplementation(async (path: string) => ({ data: path === '/users/password-resets' ? [{ id: 'r1', userId: 'u5', name: 'Amit', email: 'amit@x.co', roles: ['SALES_EXECUTIVE'], requestedAt: '2026-10-17T05:00:00Z', canIssue: true }] : [] }));
    post.mockResolvedValue({ data: { userId: 'u5', name: 'Amit', email: 'amit@x.co', link: 'https://x.test/reset-password?token=zzz', expiresAt: '2026-10-17T06:00:00Z' } });
    renderPage();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Password reset requests' }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: 'Password reset requests' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create reset link' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/users/password-resets/r1/issue', {}));
    expect(await screen.findByDisplayValue('https://x.test/reset-password?token=zzz')).toBeInTheDocument();
  });
});
