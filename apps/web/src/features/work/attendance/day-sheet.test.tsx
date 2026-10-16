import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { makeAuth, one, renderAreaA } from './test-support';

const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/api/client', async (orig) => ({ ...(await orig<typeof import('@/lib/api/client')>()), api: { get: h.get, post: vi.fn() } }));

import type { DaySheet } from '@/lib/api/hooks/work-attendance';
import { DaySheetPanel } from './day-sheet';

const item = (o: Partial<DaySheet['items'][number]>) => ({ userId: 'u', name: 'Person', status: null, checkInAt: null, lateMinutes: null, meetingJoinedAt: null, checkOutAt: null, workMinutes: null, overtimeMinutes: null, source: null, ...o });
const sheet = (over: Partial<DaySheet> = {}): DaySheet => ({
  date: '2026-10-16', dayKind: 'WORKING', timezone: 'Asia/Kolkata', policy: { lateAfter: '10:15', workdayEnd: '19:00', meetingConfigured: true },
  totals: { people: 4, marked: 3, notMarked: 1, late: 2, lateMinutes: 53, meetingJoined: 1, overtimeMinutes: 90 },
  items: [
    item({ userId: 'a', name: 'Rajat Dhore', status: 'PRESENT', checkInAt: '2026-10-16T04:30:00Z', lateMinutes: 0, meetingJoinedAt: '2026-10-16T04:40:00Z', checkOutAt: '2026-10-16T14:30:00Z', overtimeMinutes: 90 }),
    item({ userId: 'b', name: 'Monica Shah', status: 'LATE', checkInAt: '2026-10-16T05:08:00Z', lateMinutes: 23 }),
    item({ userId: 'c', name: 'Sushma Surve', status: 'LATE', checkInAt: '2026-10-16T05:45:00Z', lateMinutes: 30 }),
    item({ userId: 'd', name: 'Simran Patil' }),
  ], ...over,
});

beforeEach(() => { h.auth = makeAuth({ 'attendance:view': 'org' }, ['HR'], 'hr1'); h.get.mockReset(); });

describe('DaySheetPanel (HR / managers)', () => {
  it('shows who came when, how late, who pressed the meeting button, and overtime', async () => {
    h.get.mockResolvedValue(one(sheet()));
    renderAreaA(<DaySheetPanel date="2026-10-16" />);
    const list = await screen.findByRole('list', { name: 'People on this day' });
    const rajat = within(list).getByText('Rajat Dhore').closest('li')!;
    expect(within(rajat).getByText('On time')).toBeTruthy();
    expect(within(rajat).getByText(/Joined/)).toBeTruthy();
    expect(within(rajat).getByText('+1h 30m overtime')).toBeTruthy();
    const monica = within(list).getByText('Monica Shah').closest('li')!;
    expect(within(monica).getByText('23m late')).toBeTruthy();
    expect(within(monica).getByText('Not joined')).toBeTruthy();
    const simran = within(list).getByText('Simran Patil').closest('li')!;
    expect(within(simran).getByText('Not recorded')).toBeTruthy();
    // totals: 2 came late (53 minutes together), 1 of 3 pressed the meeting button, 1h 30m overtime
    expect(screen.getByText('53m in total')).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getAllByText('1h 30m').length).toBeGreaterThan(0);
    expect(h.get).toHaveBeenCalledWith('/workforce/attendance/day', { date: '2026-10-16' });
  });

  it('does not pretend nobody joined when no meeting link is set', async () => {
    h.get.mockResolvedValue(one(sheet({ policy: { lateAfter: '10:15', workdayEnd: '19:00', meetingConfigured: false } })));
    renderAreaA(<DaySheetPanel date="2026-10-16" />);
    expect(await screen.findByText('No meeting link is set')).toBeTruthy();
    expect(screen.queryByText('Not joined')).toBeNull();
  });

  it('shows an empty state', async () => {
    h.get.mockResolvedValue(one(sheet({ items: [], totals: { people: 0, marked: 0, notMarked: 0, late: 0, lateMinutes: 0, meetingJoined: 0, overtimeMinutes: 0 } })));
    renderAreaA(<DaySheetPanel date="2026-10-16" />);
    expect(await screen.findByText('Nobody to show for this day.')).toBeTruthy();
  });
});
