import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mergeMessages } from '@/i18n/merge';
import en from '../../../../messages/en.json';
import enMeetings from '../../../../messages/en.meetings.json';
import { makeAuth } from '../../people/test-support';

const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => ({ ...(await orig<typeof import('@/lib/api/client')>()), api: { get: h.get, post: h.post } }));

import { MeetingsCard } from './meetings-card';

const messages = mergeMessages(en as never, enMeetings as never);
function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Kolkata"><QueryClientProvider client={client}><MeetingsCard /></QueryClientProvider></NextIntlClientProvider>);
}
const m = (over: object = {}) => ({ id: 'm1', title: 'All-hands', url: 'https://us06web.zoom.us/j/84017415725?pwd=x', note: 'Bring your targets', startsAt: '2026-10-20T10:00:00Z', endsAt: '2026-10-20T11:00:00Z', createdByName: 'HR Hina', status: 'UPCOMING', joinedAt: null, ...over });

beforeEach(() => { h.get.mockReset(); h.post.mockReset(); h.auth = makeAuth({ 'meetings:view': 'own' }, ['SALES_EXECUTIVE'], 'me'); });

describe('MeetingsCard (home page)', () => {
  it('shows a meeting addressed to the person with a Join link, and records the join when pressed', async () => {
    h.get.mockResolvedValue({ data: [m(), m({ id: 'm2', title: 'Live demo', status: 'LIVE' })] });
    h.post.mockResolvedValue({ data: { joinedAt: '2026-10-20T10:05:00Z' } });
    renderCard();
    expect(await screen.findByText('All-hands')).toBeTruthy();
    expect(screen.getByText('Live now')).toBeTruthy();
    expect(screen.getAllByText('Bring your targets').length).toBeGreaterThan(0);
    const links = screen.getAllByRole('link', { name: /Join Zoom meeting/ });
    expect(links[0]!.getAttribute('href')).toBe('https://us06web.zoom.us/j/84017415725?pwd=x');
    expect(links[0]!.getAttribute('target')).toBe('_blank');
    expect(links[0]!.getAttribute('rel')).toContain('noopener');
    fireEvent.click(links[0]!);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/meetings/m1/join', {}));
  });

  it('renders nothing when there is no meeting, and nothing without the permission', async () => {
    h.get.mockResolvedValue({ data: [] });
    const { container } = renderCard();
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('does not fetch and shows nothing for someone without meetings:view', () => {
    h.auth = makeAuth({}, ['SALES_EXECUTIVE'], 'me');
    const { container } = renderCard();
    expect(container.querySelector('section')).toBeNull();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('never makes a non-Zoom link clickable', async () => {
    h.get.mockResolvedValue({ data: [m({ url: 'http://evil.example/x' })] });
    renderCard();
    expect(await screen.findByText('All-hands')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Join Zoom meeting/ })).toBeNull();
  });

  it('managers get a link to manage meetings', async () => {
    h.auth = makeAuth({ 'meetings:view': 'own', 'meetings:manage': 'org' }, ['HR'], 'me');
    h.get.mockResolvedValue({ data: [m()] });
    renderCard();
    expect((await screen.findByRole('link', { name: 'Manage meetings' })).getAttribute('href')).toBe('/work/hr/meetings');
  });
});
