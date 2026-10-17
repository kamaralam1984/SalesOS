import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { mergeMessages } from '@/i18n/merge';
import en from '../../../../messages/en.json';
import enMeetings from '../../../../messages/en.meetings.json';
import enHomeLayout from '../../../../messages/en.home-layout.json';
import { makeAuth } from '../../people/test-support';

const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/api/client', async (orig) => ({ ...(await orig<typeof import('@/lib/api/client')>()), api: { get: h.get, post: h.post, delete: h.del, patch: vi.fn(), put: vi.fn() } }));

import { MeetingsPage, defaultStart } from './meetings-page';

const messages = mergeMessages(en as never, enMeetings as never, enHomeLayout as never);
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Kolkata">
      <QueryClientProvider client={client}><ThemeProvider><TooltipProvider><ToastProvider><MeetingsPage /></ToastProvider></TooltipProvider></ThemeProvider></QueryClientProvider>
    </NextIntlClientProvider>,
  );
}
const options = { roles: ['SALES_MANAGER', 'SALES_EXECUTIVE'], teams: [{ id: 't1', name: 'Team A' }], people: [{ id: 'u1', name: 'Riya Rao', roles: ['SALES_EXECUTIVE'] }, { id: 'u2', name: 'Amit Das', roles: ['SALES_MANAGER'] }] };
const row = (over: object = {}) => ({ id: 'm1', title: 'Sales review', url: 'https://zoom.us/j/1', note: null, startsAt: '2026-10-20T10:00:00Z', endsAt: '2026-10-20T11:00:00Z', createdByName: 'HR Hina', status: 'UPCOMING', audience: { everyone: false, roles: ['SALES_MANAGER'], teamIds: ['t1'], userIds: [] }, invitedCount: 4, joinedCount: 1, ...over });

beforeEach(() => {
  h.get.mockReset(); h.post.mockReset(); h.del.mockReset();
  h.auth = makeAuth({ 'meetings:manage': 'org', 'meetings:view': 'own' }, ['HR'], 'me');
  h.get.mockImplementation(async (path: string) => ({ data: path === '/meetings/options' ? options : path === '/meetings' ? [row(), row({ id: 'm2', title: 'All hands', audience: { everyone: true, roles: [], teamIds: [], userIds: [] }, invitedCount: 10, joinedCount: 10, status: 'ENDED' })] : path === '/meetings/m1' ? { id: 'm1', invited: [{ id: 'u1', name: 'Riya Rao', joinedAt: '2026-10-20T10:05:00Z' }, { id: 'u2', name: 'Amit Das', joinedAt: null }] } : [] }));
});

describe('defaultStart', () => {
  it('rounds up to the next quarter hour in IST', () => {
    expect(defaultStart(new Date('2026-10-20T04:31:00Z'))).toBe('2026-10-20T10:15');
    expect(defaultStart(new Date('2026-10-20T04:45:00Z'))).toBe('2026-10-20T10:15');
  });
});

describe('Meetings page (HR / Founder / Developer)', () => {
  it('is denied without meetings:manage', () => {
    h.auth = makeAuth({ 'meetings:view': 'own' }, ['SALES_EXECUTIVE'], 'me');
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(/do not have access/i);
  });

  it('announces a meeting for everyone with the Zoom link and time in IST', async () => {
    h.post.mockResolvedValue({ data: { id: 'new', invitedCount: 24 } });
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Meeting title/), { target: { value: 'Quarterly all-hands' } });
    fireEvent.change(screen.getByLabelText(/Zoom link/), { target: { value: 'https://us06web.zoom.us/j/84017415725' } });
    fireEvent.change(screen.getByLabelText(/Start \(IST\)/), { target: { value: '2026-10-21T15:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Announce meeting' }));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    const [path, body] = h.post.mock.calls[0] as [string, { startsAt: string; durationMinutes: number; audience: { everyone: boolean } }];
    expect(path).toBe('/meetings');
    expect(body.startsAt).toBe('2026-10-21T10:00:00.000Z'); // 15:30 IST
    expect(body.durationMinutes).toBe(60);
    expect(body.audience).toEqual({ everyone: true, roles: [], teamIds: [], userIds: [] });
  });

  it('asks for a role, team or person when "chosen people only" is selected, then sends the choice', async () => {
    h.post.mockResolvedValue({ data: { id: 'new', invitedCount: 2 } });
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Meeting title/), { target: { value: 'Managers sync' } });
    fireEvent.change(screen.getByLabelText(/Zoom link/), { target: { value: 'https://zoom.us/j/9' } });
    fireEvent.click(screen.getByLabelText('Chosen people only'));
    fireEvent.click(screen.getByRole('button', { name: 'Announce meeting' }));
    expect(await screen.findByText('Choose at least one role, team or person.')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Sales Manager' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Riya Rao' }));
    fireEvent.click(screen.getByRole('button', { name: 'Announce meeting' }));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect((h.post.mock.calls[0] as [string, { audience: object }])[1].audience).toEqual({ everyone: false, roles: ['SALES_MANAGER'], teamIds: [], userIds: ['u1'] });
  });

  it('rejects a link that is not https before sending', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Meeting title/), { target: { value: 'Bad link' } });
    fireEvent.change(screen.getByLabelText(/Zoom link/), { target: { value: 'http://zoom.us/j/1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Announce meeting' }));
    expect(await screen.findByText('Paste a valid https Zoom link')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });

  it('lists meetings with who they are for and how many joined, and filters through the API', async () => {
    renderPage();
    expect(await screen.findByText('Sales review')).toBeInTheDocument();
    expect(screen.getByText(/Roles: Sales Manager/)).toBeInTheDocument();
    expect(screen.getByText(/Teams: 1/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Meetings' })).getByText('Everyone')).toBeInTheDocument();
    expect(screen.getByText(/Invited: 4 · 1 of 4 joined/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'LIVE' } });
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/meetings', expect.objectContaining({ status: 'LIVE' })));
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 't1' } });
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/meetings', expect.objectContaining({ status: 'LIVE', teamId: 't1' })));
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'u1' } });
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/meetings', expect.objectContaining({ userId: 'u1' })));
  });

  it('shows who was invited and who joined', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Who joined' }))[0]!);
    const dlg = within(await screen.findByRole('dialog'));
    expect(await dlg.findByText('Riya Rao')).toBeInTheDocument();
    expect(dlg.getByText(/^Joined /)).toBeInTheDocument();
    expect(dlg.getByText('Not joined yet')).toBeInTheDocument();
  });

  it('cancels an upcoming meeting after confirmation (ended meetings cannot be cancelled)', async () => {
    h.del.mockResolvedValue({ data: { id: 'm1', status: 'CANCELLED' } });
    renderPage();
    const buttons = await screen.findAllByRole('button', { name: 'Cancel meeting' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel meeting' }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('/meetings/m1'));
  });
});
