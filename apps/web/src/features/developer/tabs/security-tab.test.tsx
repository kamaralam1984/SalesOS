import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { renderWithProviders as renderWithProviders0 } from '@/test/utils';
import en from '../../../../messages/en.json';
import devSecurity from '../../../../messages/en.dev-security.json';

const messages = { ...en, developer: { ...(en as unknown as { developer: object }).developer, ...devSecurity.developer } };
const renderWithProviders = (ui: React.ReactElement) =>
  renderWithProviders0(<NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Kolkata">{ui}</NextIntlClientProvider>);

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: h.post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { SecurityTab } from './security-tab';

const session = (o: Record<string, unknown>) => ({
  id: 's1', userId: 'u1', userName: 'Asha Rao', userEmail: 'asha@x.test', createdAt: '2026-10-16T05:00:00Z', lastSeenAt: '2026-10-16T06:00:00Z',
  expiresAt: '2026-10-16T14:00:00Z', ip: '10.0.0.1', userAgent: 'Chrome', isCurrent: false, ...o,
});

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/sessions')) return { data: [session({}), session({ id: 's2', userId: 'u2', userName: 'Dev Me', isCurrent: true })], meta: { pagination: { nextCursor: null } } };
    if (path.endsWith('/locked-accounts')) return { data: [{ id: 'u3', name: 'Locked Lee', email: 'lee@x.test', failedLoginCount: 0, lockedUntil: '2099-01-01T00:00:00Z', lastLoginAt: null, isLocked: true }] };
    return { data: [], meta: {} };
  });
});

describe('SecurityTab', () => {
  it('lists sessions, disables killing your own, and kills another after confirmation', async () => {
    h.post.mockResolvedValue({ data: { id: 's1', revoked: 1 } });
    renderWithProviders(<SecurityTab />);
    expect((await screen.findAllByText('Asha Rao')).length).toBeGreaterThan(0);
    const buttons = screen.getAllByRole('button', { name: /Kill session/ });
    expect(buttons[1]).toBeDisabled();
    await userEvent.click(buttons[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kill session' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/dev-panel/security/sessions/s1/revoke'));
  });

  it('shows an error state when sessions fail to load', async () => {
    h.get.mockRejectedValue(new Error('boom'));
    renderWithProviders(<SecurityTab />);
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });

  it('unlocks a locked account after confirmation', async () => {
    h.post.mockResolvedValue({ data: { id: 'u3', unlocked: true } });
    renderWithProviders(<SecurityTab />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Locked accounts' }));
    expect((await screen.findAllByText('Locked Lee')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: /Unlock/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/dev-panel/security/users/u3/unlock'));
  });
});
