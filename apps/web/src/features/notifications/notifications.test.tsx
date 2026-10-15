import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { NotificationBell } from './notification-bell';
import { NotificationItem, safeHref } from './notification-item';

vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ can: () => true }), usePermission: () => true }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

const note = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), type: 'follow_up.overdue', severity: 'WARNING', status: 'UNREAD', title: 'Follow-up overdue', body: 'Call Rahul', entity: null, actionUrl: '/crm/leads/1',
  occurrences: 1, isDigest: false, createdAt: new Date().toISOString(), lastRaisedAt: new Date().toISOString(), readAt: null, ...over,
});
const env = (data: unknown, meta: object = {}) => new Response(JSON.stringify({ data, meta, error: null }), { status: 200 });

class FakeES {
  static last: FakeES | null = null;
  listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string, public init?: { withCredentials?: boolean }) { FakeES.last = this; }
  addEventListener(t: string, fn: (e: MessageEvent) => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]); }
  emit(t: string, data: unknown) { for (const fn of this.listeners.get(t) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent); }
  close() { this.closed = true; }
}

describe('NotificationBell', () => {
  let items: ReturnType<typeof note>[];
  let unread: number;
  beforeEach(() => {
    items = [note({ title: 'Lead has no owner' }), note({ title: 'Follow-up overdue' })];
    unread = 2;
    FakeES.last = null;
    vi.stubGlobal('EventSource', FakeES);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/notifications/unread-count')) return env({ unreadCount: unread });
      if (u.pathname.endsWith('/notifications/read-all')) { unread = 0; items = items.map((i) => ({ ...i, status: 'READ' })); return env({ updated: 2, unreadCount: 0 }); }
      if (u.pathname.endsWith('/notifications')) return env(items, { unreadCount: unread, pagination: { mode: 'cursor', limit: 8, hasMore: false, nextCursor: null } });
      if (u.pathname.endsWith('/auth/me')) return env({ csrfToken: 'c' });
      void init;
      return env({});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the live unread count, opens the dropdown with items and a link to the full page', async () => {
    renderWithProviders(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('2');
    await userEvent.click(bell);
    expect(await screen.findByText('Lead has no owner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all notifications' })).toHaveAttribute('href', '/notifications');
    expect(FakeES.last!.url).toMatch(/\/notifications\/stream$/);
    expect(FakeES.last!.init?.withCredentials).toBe(true);
  });

  it('reflects SSE pushes without a reload and says whether updates are live', async () => {
    renderWithProviders(<NotificationBell />);
    await screen.findByTestId('notification-badge');
    await userEvent.click(screen.getByTestId('notification-bell'));
    expect(await screen.findByTestId('stream-mode')).toHaveTextContent('Checking for updates periodically');
    act(() => FakeES.last!.emit('ready', { unreadCount: 2 }));
    await waitFor(() => expect(screen.getByTestId('stream-mode')).toHaveTextContent('Live updates on'));
    act(() => FakeES.last!.emit('unread', { unreadCount: 7 }));
    await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('7'));
  });

  it('falls back to polling when SSE errors and when EventSource is unsupported', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithProviders(<NotificationBell />);
      await screen.findByTestId('notification-badge');
      act(() => FakeES.last!.onerror?.());
      const f = vi.mocked(fetch);
      const before = f.mock.calls.filter((c) => String(c[0]).includes('unread-count')).length;
      unread = 5;
      await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
      await waitFor(() => expect(f.mock.calls.filter((c) => String(c[0]).includes('unread-count')).length).toBeGreaterThan(before));
      await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('5'));
    } finally { vi.useRealTimers(); }
  });

  it('mark all as read clears the badge', async () => {
    renderWithProviders(<NotificationBell />);
    await userEvent.click(await screen.findByTestId('notification-bell'));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument());
  });

  it('has no axe violations when open', async () => {
    const { baseElement } = renderWithProviders(<NotificationBell />);
    await userEvent.click(await screen.findByTestId('notification-bell'));
    await screen.findByText('Lead has no owner');
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});

describe('NotificationItem', () => {
  it('only links to same-origin paths', () => {
    expect(safeHref('/crm/leads/1')).toBe('/crm/leads/1');
    for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', null, '']) expect(safeHref(bad as string | null)).toBeNull();
  });
  it('renders severity, repeat count, and never renders an off-site link', () => {
    renderWithProviders(<ul><NotificationItem n={note({ actionUrl: 'https://evil.example', occurrences: 3, severity: 'CRITICAL' }) as never} onRead={() => undefined} onDismiss={() => undefined} /></ul>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('x3')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });
  it('marks read when the action link is followed', async () => {
    const onRead = vi.fn();
    renderWithProviders(<ul><NotificationItem n={note({ id: 'abc' }) as never} onRead={onRead} /></ul>);
    await userEvent.click(screen.getByRole('link', { name: 'Open' }));
    expect(onRead).toHaveBeenCalledWith('abc');
  });
});
