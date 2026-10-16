import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), can: vi.fn(() => true), logout: vi.fn() }));
vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: h.post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ can: h.can, logout: h.logout, user: { id: 'u1' } }),
}));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/hooks/use-api-error', () => ({ useApiErrorMessage: () => (e: unknown) => ({ message: String((e as Error)?.message ?? e) }) }));

import { NextIntlClientProvider } from 'next-intl';
import en from '../../../messages/en.json';
import devMaint from '../../../messages/en.dev-maintenance.json';
import { MaintenanceGate } from './maintenance-gate';
import { MaintenanceTab } from '@/features/developer/tabs/maintenance-tab';

const messages = { ...en, developer: { ...(en as { developer?: object }).developer, ...devMaint.developer } };
const ui = (node: React.ReactNode) => <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Kolkata">{node}</NextIntlClientProvider>;
const wrap = (node: React.ReactNode) => renderWithProviders(ui(node) as React.ReactElement);

describe('MaintenanceGate', () => {
  it('shows the maintenance page to non-developers while ON', async () => {
    h.can.mockReturnValue(false);
    h.get.mockResolvedValue({ data: { enabled: true, message: 'Back at five', eta: null } });
    wrap(<MaintenanceGate><p>app content</p></MaintenanceGate>);
    expect(await screen.findByText('Back at five')).toBeInTheDocument();
    expect(screen.queryByText('app content')).not.toBeInTheDocument();
  });
  it('shows a banner and the app to developers while ON', async () => {
    h.can.mockReturnValue(true);
    h.get.mockResolvedValue({ data: { enabled: true, message: 'x message', eta: null } });
    wrap(<MaintenanceGate><p>app content</p></MaintenanceGate>);
    expect(await screen.findByText(/Maintenance mode is ON/)).toBeInTheDocument();
    expect(screen.getByText('app content')).toBeInTheDocument();
  });
  it('renders the app when OFF or when the status call fails (fail open)', async () => {
    h.can.mockReturnValue(false);
    h.get.mockRejectedValue(new Error('boom'));
    wrap(<MaintenanceGate><p>app content</p></MaintenanceGate>);
    expect(await screen.findByText('app content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('MaintenanceTab', () => {
  it('asks for confirmation before enabling, then posts', async () => {
    h.get.mockResolvedValue({ data: { enabled: false, message: null, eta: null, enabledAt: null, enabledBy: null } });
    h.post.mockResolvedValue({ data: { enabled: true } });
    wrap(<MaintenanceTab />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Message shown to users/), 'Upgrading now');
    await user.click(screen.getByRole('button', { name: 'Turn on maintenance mode' }));
    expect(await screen.findByText('Block everyone except developers?')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, turn it on' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/dev-panel/maintenance/enable', { message: 'Upgrading now' }));
  });
  it('shows ON state with who enabled it and a disable button', async () => {
    h.get.mockResolvedValue({ data: { enabled: true, message: 'Fixing', eta: null, enabledAt: '2026-10-16T10:00:00.000Z', enabledBy: { id: 'd', name: 'Dev Dana' } } });
    wrap(<MaintenanceTab />);
    expect((await screen.findAllByText('Maintenance mode is ON')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Turned on by Dev Dana/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off maintenance mode' })).toBeInTheDocument();
  });
  it('shows an error state when the load fails', async () => {
    h.get.mockRejectedValue(new Error('nope'));
    wrap(<MaintenanceTab />);
    expect(await screen.findByText('Could not load the maintenance state.')).toBeInTheDocument();
  });
});
