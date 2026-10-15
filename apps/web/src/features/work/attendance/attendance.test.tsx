import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { i18nErrors, makeAuth, one, page, renderAreaA } from './test-support';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post, put: h.put, patch: h.patch, delete: h.delete } };
});

import { ApiError } from '@/lib/api/client';
import type { AttendanceMonth, AttendanceToday, Holiday } from '@/lib/api/hooks/work-attendance';
import { AttendancePage } from './attendance-page';
import { HolidaysPage } from './holidays-page';

const rec = (over: object = {}) => ({ id: 'r1', userId: 'me', date: '2026-10-15', status: 'PRESENT', checkInAt: '2026-10-15T03:40:00Z', checkOutAt: null, workMinutes: null, source: 'SELF', note: null, version: 1, ...over });
const today = (over: Partial<AttendanceToday> = {}): AttendanceToday => ({
  date: '2026-10-15', timezone: 'Asia/Kolkata', dayKind: 'WORKING', holiday: null, record: null, can: { checkIn: true, checkOut: false }, policy: { lateAfter: '10:15', fullDayMinutes: 480, selfCheckIn: true }, ...over,
});
const month = (over: Partial<AttendanceMonth> = {}): AttendanceMonth => ({
  userId: 'me', userName: 'Asha Rao', month: '2026-10', from: '2026-10-01', to: '2026-10-31', workingDays: 26,
  summary: { PRESENT: 10, ABSENT: 1, HALF_DAY: 2, WFH: 1, LATE: 1, HOLIDAY: 1, WEEKLY_OFF: 4, ON_LEAVE: 1, UNPAID_LEAVE: 0, workMinutes: 4000 },
  days: [
    { date: '2026-10-01', dayKind: 'WORKING', holiday: null, record: rec({ id: 'a', date: '2026-10-01', status: 'LATE', checkInAt: '2026-10-01T04:50:00Z', checkOutAt: '2026-10-01T12:00:00Z', workMinutes: 500 }) as never, leave: null },
    { date: '2026-10-02', dayKind: 'HOLIDAY', holiday: 'Gandhi Jayanti', record: null, leave: null },
    { date: '2026-10-03', dayKind: 'WORKING', holiday: null, record: null, leave: { typeKey: 'CASUAL', status: 'PENDING_MANAGER', halfDay: 'NONE' } },
    { date: '2026-10-04', dayKind: 'WEEKLY_OFF', holiday: null, record: null, leave: null },
  ], ...over,
});
const teamSummary = { date: '2026-10-15', dayKind: 'WORKING', total: 3, recorded: 2, notMarked: 1, byStatus: { PRESENT: 1, WFH: 1 } };

function routes(opts: { today?: AttendanceToday; month?: AttendanceMonth } = {}) {
  h.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/today')) return one(opts.today ?? today());
    if (path.endsWith('/month')) return one(opts.month ?? month());
    if (path.endsWith('/team-summary')) return one(teamSummary);
    if (path.endsWith('/corrections')) return page([{ id: 'c1', userId: 'u2', userName: 'Ravi Kumar', date: '2026-10-12', oldValue: { status: null }, newValue: { status: 'PRESENT' }, reason: 'Forgot to check in', correctedById: 'm', correctedByName: 'Tara Lead', createdAt: '2026-10-13T05:00:00Z' }]);
    if (path.endsWith('/team-members')) return one([{ id: 'u2', name: 'Ravi Kumar', managerId: 'm', roles: [] }]);
    throw new Error(`unexpected GET ${path}`);
  });
}
const exec = () => makeAuth({ 'attendance:self': 'own', 'attendance:view': 'own' }, ['SALES_EXECUTIVE'], 'me');
const manager = () => makeAuth({ 'attendance:self': 'own', 'attendance:view': 'team', 'attendance:correct': 'team' }, ['SALES_MANAGER'], 'mgr');

beforeEach(() => {
  for (const m of [h.get, h.post, h.put, h.patch, h.delete]) m.mockReset();
  i18nErrors.length = 0;
  h.auth = exec();
  routes();
});
afterEach(() => expect(i18nErrors, 'missing or invalid translations').toEqual([]));

describe('AttendancePage', () => {
  it('shows a loading state, then the not-checked-in prompt with the late rule and check-in buttons', async () => {
    renderAreaA(<AttendancePage />);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(await screen.findByText(/check-in after 10:15 counts as late/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check in \(office\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /work from home/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^check out$/i })).not.toBeInTheDocument();
  });

  it('checks in with the chosen mode and shows success; the server decides the status', async () => {
    h.post.mockResolvedValue(one(rec()));
    renderAreaA(<AttendancePage />);
    await userEvent.click(await screen.findByRole('button', { name: /work from home/i }));
    expect(h.post).toHaveBeenCalledWith('/workforce/attendance/check-in', { mode: 'WFH' });
    expect(await screen.findByText('Checked in')).toBeInTheDocument();
  });

  it('shows the server error when check-in is refused (never claims success)', async () => {
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'ALREADY_CHECKED_IN', message: 'Attendance for today is already recorded' }));
    renderAreaA(<AttendancePage />);
    await userEvent.click(await screen.findByRole('button', { name: /check in \(office\)/i }));
    expect(await screen.findByText('Attendance for today is already recorded')).toBeInTheDocument();
    expect(screen.queryByText('Checked in')).not.toBeInTheDocument();
  });

  it('check-out flags a short day for review', async () => {
    routes({ today: today({ record: rec() as never, can: { checkIn: false, checkOut: true } }) });
    h.post.mockResolvedValue(one(rec({ status: 'HALF_DAY', checkOutAt: '2026-10-15T05:00:00Z', workMinutes: 80, needsReview: true })));
    renderAreaA(<AttendancePage />);
    await userEvent.click(await screen.findByRole('button', { name: /^check out$/i }));
    expect(h.post).toHaveBeenCalledWith('/workforce/attendance/check-out', {});
    expect(await screen.findByText(/short day: it was marked as a half day/i)).toBeInTheDocument();
  });

  it('weekly off, holiday and disabled self check-in are explained, with no check-in button', async () => {
    routes({ today: today({ dayKind: 'HOLIDAY', holiday: { name: 'Diwali', kind: 'COMPANY' }, can: { checkIn: false, checkOut: false }, policy: { lateAfter: '10:15', fullDayMinutes: 480, selfCheckIn: false } }) });
    renderAreaA(<AttendancePage />);
    expect(await screen.findByText(/today is a holiday: diwali/i)).toBeInTheDocument();
    expect(screen.getByText(/self check-in is turned off/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /check in/i })).not.toBeInTheDocument();
  });

  it('the month list explains every day kind, leave and source; executives get no team tab and no correct button', async () => {
    renderAreaA(<AttendancePage />);
    const list = await screen.findByRole('list', { name: /days of the month/i });
    expect(within(list).getByText('Gandhi Jayanti')).toBeInTheDocument();
    expect(within(list).getByText('Weekly off')).toBeInTheDocument();
    expect(within(list).getByText(/leave: awaiting manager/i)).toBeInTheDocument();
    expect(within(list).getByText('Late')).toBeInTheDocument();
    expect(within(list).getAllByText(/self check-in/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: /my team/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^correct$/i })).not.toBeInTheDocument();
  });

  it('shows an error state with retry when the API fails', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'INTERNAL', message: 'boom' }));
    renderAreaA(<AttendancePage />);
    expect((await screen.findAllByRole('button', { name: /try again/i })).length).toBeGreaterThan(0);
  });

  it('permission denied without attendance:self', async () => {
    h.auth = makeAuth({}, [], 'x');
    renderAreaA(<AttendancePage />);
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('a manager sees the team tab with a summary and corrects a record with a mandatory reason', async () => {
    h.auth = manager();
    h.put.mockResolvedValue(one(rec()));
    renderAreaA(<AttendancePage />);
    await userEvent.click(await screen.findByRole('tab', { name: /my team/i }));
    expect(await screen.findByText('Not recorded')).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Employee'), 'u2');
    const correct = await screen.findAllByRole('button', { name: /^correct$/i });
    await userEvent.click(correct[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /save correction/i }));
    expect(await within(dialog).findByText(/give a reason \(at least 5 characters\)/i)).toBeInTheDocument();
    expect(h.put).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/^reason/i), 'Forgot to check in');
    await userEvent.click(within(dialog).getByRole('button', { name: /save correction/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const [path, body] = h.put.mock.calls[0]!;
    expect(path).toBe('/workforce/attendance/records');
    expect(body).toMatchObject({ userId: 'u2', date: '2026-10-01', reason: 'Forgot to check in', version: 1 });
  });

  it('the corrections tab lists old and new value with who and why', async () => {
    renderAreaA(<AttendancePage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Corrections' }));
    expect(await screen.findByText(/no record → present/i)).toBeInTheDocument();
    expect(screen.getByText(/reason: forgot to check in/i)).toBeInTheDocument();
    expect(screen.getByText(/corrected by tara lead/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderAreaA(<AttendancePage />);
    await screen.findByRole('list', { name: /days of the month/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('HolidaysPage', () => {
  const holiday = (over: Partial<Holiday> = {}): Holiday => ({ id: 'h1', date: '2026-10-02', name: 'Gandhi Jayanti', kind: 'NATIONAL', location: null, status: 'APPROVED', suggested: false, approvedAt: null, ...over });
  const hr = () => makeAuth({ 'holidays:view': 'org', 'holidays:manage': 'org' }, ['HR'], 'hr');
  beforeEach(() => { h.auth = makeAuth({ 'holidays:view': 'org' }, ['SALES_EXECUTIVE'], 'me'); });

  it('employees see the approved calendar without manage controls', async () => {
    h.get.mockResolvedValue(one([holiday()]));
    renderAreaA(<HolidaysPage />);
    expect(await screen.findByText('Gandhi Jayanti')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add holiday/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it('empty state', async () => {
    h.get.mockResolvedValue(one([]));
    renderAreaA(<HolidaysPage />);
    expect(await screen.findByText(/no holidays for/i)).toBeInTheDocument();
  });

  it('HR sees suggestions as not counting, approves one, and gets the server error if it fails', async () => {
    h.auth = hr();
    h.get.mockResolvedValue(one([holiday({ id: 's1', name: 'Republic Day', status: 'SUGGESTED', suggested: true })]));
    h.post.mockRejectedValueOnce(new ApiError({ status: 409, code: 'ALREADY_APPROVED', message: 'This holiday is already approved' }));
    renderAreaA(<HolidaysPage />);
    expect(await screen.findByText(/suggested holidays do not count as days off until you approve them/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(h.post).toHaveBeenCalledWith('/workforce/holidays/s1/approve', {});
    expect(await screen.findByText('This holiday is already approved')).toBeInTheDocument();
  });

  it('HR adds a holiday through the validated form', async () => {
    h.auth = hr();
    h.get.mockResolvedValue(one([]));
    h.post.mockResolvedValue(one(holiday()));
    renderAreaA(<HolidaysPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add holiday/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: /save holiday/i }));
    expect(await within(dialog).findByText(/enter a name \(at least 2 characters\)/i)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Foundation Day');
    await userEvent.click(within(dialog).getByRole('button', { name: /save holiday/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/holidays', expect.objectContaining({ name: 'XFoundation Day', kind: 'COMPANY', location: null })));
  });

  it('has no axe violations', async () => {
    h.get.mockResolvedValue(one([holiday()]));
    const { container } = renderAreaA(<HolidaysPage />);
    await screen.findByText('Gandhi Jayanti');
    expect(await axe(container)).toHaveNoViolations();
  });
});
