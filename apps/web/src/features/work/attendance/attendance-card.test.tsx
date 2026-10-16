import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { ThemeProvider } from '@/components/theme/theme-provider';
import en from '../../../../messages/en.json';
import enAttendance from '../../../../messages/en.work-attendance.json';
import enDash from '../../../../messages/en.dash-attendance.json';
import { mergeMessages } from '@/i18n/merge';
import { makeAuth, one } from '../../people/test-support';

const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post } };
});

import type { AttendanceToday } from '@/lib/api/hooks/work-attendance';
import { AttendanceCard } from './attendance-card';

const messages = mergeMessages(en as never, enAttendance as never, enDash as never);
function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Kolkata">
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <TooltipProvider>
            <ToastProvider><AttendanceCard variant="mobile" /></ToastProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}
const today = (over: Partial<AttendanceToday> = {}): AttendanceToday => ({
  date: '2026-10-15', timezone: 'Asia/Kolkata', dayKind: 'WORKING', holiday: null, record: null, can: { checkIn: true, checkOut: false },
  policy: { lateAfter: '10:15', fullDayMinutes: 480, selfCheckIn: true, checkInCutoff: '11:00' }, ...over,
});
const present = { id: 'r1', userId: 'me', date: '2026-10-15', status: 'PRESENT' as const, checkInAt: '2026-10-15T03:40:00Z', checkOutAt: null, workMinutes: null, source: 'SELF' as const, note: null, version: 1 };

describe('AttendanceCard', () => {
  beforeEach(() => {
    h.auth = makeAuth({ 'attendance:self': 'own' }, ['SALES_EXECUTIVE'], 'me');
    h.get.mockReset();
    h.post.mockReset();
  });

  it('shows not-checked-in with check-in buttons and the closing hint', async () => {
    h.get.mockResolvedValue(one(today()));
    renderCard();
    expect(await screen.findByText('Not checked in')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Check in \(office\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Check in \(WFH\)/ })).toBeTruthy();
    expect(screen.getByText(/Check-in closes at/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open attendance' }).getAttribute('href')).toBe('/work/attendance');
  });

  it('shows the calm closed state without check-in buttons', async () => {
    h.get.mockResolvedValue(one(today({ checkInClosed: true, can: { checkIn: false, checkOut: false } })));
    renderCard();
    expect(await screen.findByText(/Check-in closed at .* IST\. Ask HR or your manager\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Check in/ })).toBeNull();
  });

  it('shows present with check-out and a safe Zoom link', async () => {
    h.get.mockResolvedValue(one(today({ record: present, can: { checkIn: false, checkOut: true }, meeting: { url: 'https://zoom.us/j/123' } })));
    renderCard();
    expect(await screen.findByText('Present')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Check out/ })).toBeTruthy();
    const a = screen.getByRole('link', { name: /Join Zoom meeting/ });
    expect(a.getAttribute('href')).toBe('https://zoom.us/j/123');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders nothing without attendance:self and does not fetch', () => {
    h.auth = makeAuth({}, ['SALES_EXECUTIVE'], 'me');
    const { container } = renderCard();
    expect(container.querySelector('section')).toBeNull();
    expect(h.get).not.toHaveBeenCalled();
  });
});
