import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { mergeMessages } from '@/i18n/merge';
import en from '../../../messages/en.json';
import enHomeLayout from '../../../messages/en.home-layout.json';
import type { AuthState } from '../people/hrkit/auth-mock';

const auth = vi.hoisted(() => ({ userId: 'me', perms: {} as AuthState['perms'] }));
vi.mock('@/features/auth/auth-provider', async () => (await import('../people/hrkit/auth-mock')).makeAuthModule(auth));
const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  api: { get, post: vi.fn(), patch: vi.fn(), put, delete: vi.fn() },
}));

import { HomeLayoutPage, moveWidget } from './home-layout-page';
import { DEFAULT_HOME_WIDGETS } from '@/features/mobile/home/widgets';

const overview = {
  widgets: [],
  roles: [
    { role: 'SALES_EXECUTIVE', customised: false, widgets: DEFAULT_HOME_WIDGETS, applicable: ['meetings', 'stats', 'attendance', 'goal', 'onboarding', 'followups', 'quickActions', 'workspace'] },
    { role: 'HR', customised: false, widgets: DEFAULT_HOME_WIDGETS, applicable: ['meetings', 'attendance', 'goal', 'onboarding', 'workspace'] },
  ],
};

const messages = mergeMessages(en as never, enHomeLayout as never);
function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Kolkata">
      <QueryClientProvider client={client}><ThemeProvider><TooltipProvider><ToastProvider>{ui}</ToastProvider></TooltipProvider></ThemeProvider></QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => { get.mockReset(); put.mockReset(); auth.perms = { 'home-layout:manage': 'org' }; });

describe('moveWidget', () => {
  const l = DEFAULT_HOME_WIDGETS;
  it('moves up and down, and ignores moves past the ends', () => {
    expect(moveWidget(l, 1, -1).map((w) => w.id).slice(0, 2)).toEqual(['stats', 'meetings']);
    expect(moveWidget(l, 0, 1).map((w) => w.id).slice(0, 2)).toEqual(['stats', 'meetings']);
    expect(moveWidget(l, 0, -1)).toEqual([...l]);
    expect(moveWidget(l, l.length - 1, 1)).toEqual([...l]);
  });
});

describe('home layout page', () => {
  it('is denied without home-layout:manage', () => {
    auth.perms = {};
    renderWithProviders(<HomeLayoutPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/do not have access/i);
  });

  it('reorders, hides and resizes a widget for a role and saves exactly that', async () => {
    get.mockResolvedValue({ data: overview });
    put.mockResolvedValue({ data: { role: 'SALES_EXECUTIVE', customised: true, widgets: [], applicable: [] } });
    renderWithProviders(<HomeLayoutPage />);
    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Move up: Attendance' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show: Call buttons' }));
    const goalSize = screen.getByRole('group', { name: 'Size: 45-day goal' });
    fireEvent.click(within(goalSize).getByRole('button', { name: 'Large' }));
    expect(screen.getByRole('status')).toHaveTextContent(/unsaved/i);
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [path, body] = put.mock.calls[0] as [string, { widgets: Array<{ id: string; visible: boolean; size: string }> }];
    expect(path).toBe('/home-layout/roles/SALES_EXECUTIVE');
    expect(body.widgets.map((w) => w.id).slice(0, 2)).toEqual(['meetings', 'attendance']);
    expect(body.widgets.find((w) => w.id === 'quickActions')?.visible).toBe(false);
    expect(body.widgets.find((w) => w.id === 'goal')?.size).toBe('L');
  });

  it('says when a widget does not apply to the chosen role', async () => {
    get.mockResolvedValue({ data: overview });
    renderWithProviders(<HomeLayoutPage />);
    await screen.findByRole('list');
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'HR' } });
    expect(await screen.findAllByText(/Not used by this role/)).toHaveLength(3);
  });

  it('shows every role as a phone preview with its own widgets', async () => {
    get.mockResolvedValue({ data: overview });
    renderWithProviders(<HomeLayoutPage />);
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /All roles/ }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: /All roles/ }));
    const previews = await screen.findAllByRole('img');
    expect(previews).toHaveLength(2);
    expect(previews[1]).not.toHaveAttribute('aria-label', expect.stringContaining('Priority follow-ups'));
    expect(previews[0]).toHaveAttribute('aria-label', expect.stringContaining('Priority follow-ups'));
  });
});
