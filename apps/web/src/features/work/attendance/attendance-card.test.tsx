import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('says how late it already is before check-in, and again when the check-in window has closed', async () => {
    h.get.mockResolvedValue(one(today({ lateByMinutes: 269 })));
    const first = renderCard();
    expect(await screen.findByText('You are 4h 29m late. Office time started at 10:15.')).toBeTruthy();
    first.unmount();
    h.get.mockResolvedValue(one(today({ lateByMinutes: 269, checkInClosed: true, can: { checkIn: false, checkOut: false } })));
    renderCard();
    expect(await screen.findByText('You are 4h 29m late. Office time started at 10:15.')).toBeTruthy();
    expect(screen.getByText(/Check-in closed at/)).toBeTruthy();
  });

  it('after check-in shows the minutes late, the meeting button time, and overtime after check-out', async () => {
    h.get.mockResolvedValue(one(today({
      record: { ...present, status: 'LATE', lateMinutes: 23, meetingJoinedAt: '2026-10-15T05:12:00Z', checkOutAt: '2026-10-15T14:10:00Z', overtimeMinutes: 70, workMinutes: 630 },
      can: { checkIn: false, checkOut: false }, policy: { lateAfter: '10:15', fullDayMinutes: 480, selfCheckIn: true, checkInCutoff: '11:00', workdayEnd: '19:00' },
    })));
    renderCard();
    expect(await screen.findByText('You checked in 23m late.')).toBeTruthy();
    expect(screen.getByText('Overtime: 1h 10m after 19:00.')).toBeTruthy();
    expect(screen.getByText(/You pressed the meeting button at/)).toBeTruthy();
  });

  it('pressing the meeting button records it, and the link still opens in a new tab', async () => {
    h.post.mockResolvedValue({ data: { joinedAt: '2026-10-15T05:12:00Z', first: true }, meta: {} });
    h.get.mockResolvedValue(one(today({ record: present, can: { checkIn: false, checkOut: true }, meeting: { url: 'https://zoom.us/j/123' } })));
    renderCard();
    const a = await screen.findByRole('link', { name: /Join Zoom meeting/ });
    fireEvent.click(a);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/attendance/meeting-join', {}));
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('after the cutoff it asks for a reason before a late check-in and sends it with the request', async () => {
    h.get.mockResolvedValue(one(today({ lateJoin: true, lateByMinutes: 120 })));
    h.post.mockResolvedValue(one(present));
    renderCard();
    expect(await screen.findByText(/You can still check in with a reason/)).toBeTruthy();
    expect(screen.queryByText(/Check-in closes at/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Check in \(office\)/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check in' }));
    expect(await within(dialog).findByText('Write the reason (at least 3 characters)')).toBeTruthy();
    expect(h.post).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason for joining late/), { target: { value: 'Client visit' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/attendance/check-in', { mode: 'OFFICE', reason: 'Client visit' }));
  });

  it('check-out asks how much of today\'s work is done (and a note when it is not everything) and sends both', async () => {
    h.get.mockResolvedValue(one(today({ record: present, can: { checkIn: false, checkOut: true }, policy: { lateAfter: '10:15', fullDayMinutes: 480, selfCheckIn: true, checkInCutoff: '11:00', requireDayReport: true } })));
    h.post.mockResolvedValue(one({ ...present, checkOutAt: '2026-10-15T13:00:00Z' }));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Check out/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check out' }));
    expect(await within(dialog).findByText('Enter a number from 0 to 100')).toBeTruthy();
    expect(h.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '50%' }));
    expect(within(dialog).getByDisplayValue('50')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check out' }));
    expect(await within(dialog).findByText('Add a short note on what is pending')).toBeTruthy();
    expect(h.post).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/What is still pending/), { target: { value: 'Two follow-ups' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check out' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/attendance/check-out', { dayReportPct: 50, dayReportNote: 'Two follow-ups' }));
  });
});
