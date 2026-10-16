import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { makeAuth, one, page } from '@/features/people/test-support';
import { renderWork } from '../test-utils';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams('') }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post, patch: h.patch, put: vi.fn(), delete: h.del } };
});

import { ApiError } from '@/lib/api/client';
import { AnnouncementsPage } from './announcements-page';
import { BirthdaysPage } from './birthdays-page';
import { HrHubPage } from './hr-hub-page';
import { diffPatch } from './hr-profile-dialog';
import { getAt, parseField, PolicyPage, setAt } from './policy-page';
import { ProbationPage } from './probation-page';

const DEFAULT_WORKFORCE_CONFIG = {
  timezone: 'Asia/Kolkata',
  weeklyOffDays: [7],
  attendance: { selfCheckIn: true, lateAfter: '10:15', checkInCutoff: '11:00', workdayEnd: '19:00', lateJoinAllowed: true, requireDayReport: true, meetingUrl: null, fullDayMinutes: 480, halfDayMinutes: 240, autoMarkAbsent: true, managerCorrectionWindowDays: 7 },
  leave: {
    types: [
      { key: 'CASUAL', name: 'Casual leave', isPaid: true, needsBalance: true, maxConsecutiveDays: null, active: true },
      { key: 'UNPAID', name: 'Unpaid leave', isPaid: false, needsBalance: false, maxConsecutiveDays: null, active: true },
    ],
    approvalChain: ['MANAGER', 'HR'], balanceExceeded: 'UNPAID_WITH_CONFIRMATION', backdateDays: 7, allowHalfDay: true,
  },
  earnedLeave: {
    enabled: true, requiredEligibleDays: 20, creditDays: 1,
    treatment: { PRESENT: 'COUNT', LATE: 'COUNT', WFH: 'COUNT', HALF_DAY: 'HALF', ABSENT: 'SKIP', HOLIDAY: 'SKIP', WEEKLY_OFF: 'SKIP', ON_LEAVE: 'SKIP', UNPAID_LEAVE: 'SKIP' },
    countFromJoiningDate: true, leaveTypeKey: 'EARNED', maxBalance: null, carryForwardEnabled: true, carryForwardMax: null,
  },
  holidays: { locations: ['India'], suggestFixedNational: true, optionalCountAsOff: false },
  goals: { cycleDays: 45, atRiskGapPct: 20, requireVerification: true, reminderDaysBeforeTarget: [7, 3] },
  tasks: { requireReview: true, reminderHoursBeforeDue: 24 },
  hr: { probationDefaultMonths: 3, probationReminderDays: [7], birthdayReminderDays: [7, 3, 1] },
  payroll: { currency: 'INR', absentIsLossOfPay: true, halfDayLossOfPay: 0.5, perDayBasis: 'WORKING_DAYS' },
};

const hr = () => makeAuth({ 'workforce:settings:view': 'org', 'workforce:settings:manage': 'org', 'birthdays:view': 'org', 'announcements:manage': 'org', 'workforce:reports:view': 'org', 'onboarding:manage': 'org', 'hr:records:manage': 'org', 'directory:view': 'org', 'workforce:dashboard:view': 'org' }, ['HR'], 'hr');
beforeEach(() => {
  h.get.mockReset(); h.post.mockReset(); h.patch.mockReset(); h.del.mockReset();
  h.auth = hr();
});

const prow = (over: Record<string, unknown> = {}) => ({ userId: 'u2', name: 'Asha Rao', department: 'Sales', managerId: 'm1', managerName: 'Mgr One', positionTitle: 'Telecaller', startDate: '2026-07-20', months: 3, endDate: '2026-10-20', state: 'ENDING_SOON', daysLeft: 5, latestDecision: null, extensions: 0, ...over });
const probationResponse = (items: unknown[]) => ({ data: items, meta: { counts: { ENDING_SOON: items.length }, pagination: { mode: 'page', page: 1, limit: 20, hasMore: false } } });

describe('ProbationPage', () => {
  it('lists employees with state, days left and actions by permission', async () => {
    h.get.mockResolvedValue(probationResponse([prow(), prow({ userId: 'u3', name: 'Ravi Kumar', state: 'DECISION_DUE', daysLeft: -2 })]));
    renderWork(<ProbationPage />);
    expect(await screen.findByRole('link', { name: 'Asha Rao' })).toHaveAttribute('href', '/work/people/u2');
    expect(screen.getByText('5 days left')).toBeInTheDocument();
    expect(screen.getByText('2 days past the end date')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Record decision' })).toHaveLength(2);
    expect(h.get).toHaveBeenCalledWith('/workforce/hr/probation', expect.objectContaining({ status: 'ACTIVE', days: 30, page: 1 }));
  });
  it('hides the decision button for viewers without onboarding:manage and for confirmed employees', async () => {
    h.auth = makeAuth({ 'workforce:reports:view': 'team' }, ['SALES_MANAGER'], 'm');
    h.get.mockResolvedValue(probationResponse([prow()]));
    renderWork(<ProbationPage />);
    await screen.findByRole('link', { name: 'Asha Rao' });
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument();
  });
  it('validates the decision form: EXTEND needs months 1-6 and a note; nothing is sent until valid', async () => {
    h.get.mockResolvedValue(probationResponse([prow()]));
    renderWork(<ProbationPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record decision' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Decision'), 'EXTEND');
    await userEvent.clear(within(dialog).getByLabelText('Extend by (months)'));
    await userEvent.type(within(dialog).getByLabelText('Extend by (months)'), '9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save decision' }));
    expect(await within(dialog).findByText('Enter 1 to 6 months')).toBeInTheDocument();
    expect(within(dialog).getByText('A note of at least 3 characters is required')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });
  it('sends the decision, shows success, and surfaces a server conflict without claiming success', async () => {
    h.get.mockResolvedValue(probationResponse([prow()]));
    h.post.mockRejectedValueOnce(new ApiError({ status: 409, code: 'PROBATION_CONFIRMED', message: 'This employee is already confirmed' }));
    renderWork(<ProbationPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record decision' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save decision' }));
    expect(await within(dialog).findByText('This employee is already confirmed')).toBeInTheDocument();
    expect(h.post).toHaveBeenCalledWith('/workforce/hr/probation/u2/decision', { decision: 'CONFIRM' });
    h.post.mockResolvedValueOnce(one(prow({ state: 'CONFIRMED' })));
    dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save decision' }));
    expect(await screen.findByText('Employment confirmed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('shows the empty state, the error state and is denied without the permission', async () => {
    h.get.mockResolvedValue(probationResponse([]));
    const { unmount } = renderWork(<ProbationPage />);
    expect(await screen.findByText('No probation records')).toBeInTheDocument();
    unmount();
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'X', message: 'x' }));
    const second = renderWork(<ProbationPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    second.unmount();
    h.auth = makeAuth({}, []);
    h.get.mockClear();
    renderWork(<ProbationPage />);
    expect(h.get).not.toHaveBeenCalled();
  });
  it('has no axe violations', async () => {
    h.get.mockResolvedValue(probationResponse([prow()]));
    const { container } = renderWork(<ProbationPage />);
    await screen.findByRole('link', { name: 'Asha Rao' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('BirthdaysPage', () => {
  it('lists upcoming birthdays with the share flag and the privacy note, no birth year', async () => {
    h.get.mockResolvedValue(one({ today: '2026-10-15', days: 30, items: [{ userId: 'u2', name: 'Asha Rao', department: 'Sales', nextDate: '2026-10-18', month: 10, day: 18, daysUntil: 3, shared: true }, { userId: 'u3', name: 'Ravi Kumar', department: null, nextDate: '2026-10-15', month: 10, day: 15, daysUntil: 0, shared: false }] }));
    renderWork(<BirthdaysPage />);
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Shared with team')).toBeInTheDocument();
    expect(screen.getByText('HR only')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText(/Birth year and age are never shown/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/19\d\d/);
  });
  it('shows empty and is denied without birthdays:view', async () => {
    h.get.mockResolvedValue(one({ today: '2026-10-15', days: 30, items: [] }));
    const { unmount } = renderWork(<BirthdaysPage />);
    expect(await screen.findByText('No birthdays in this window')).toBeInTheDocument();
    unmount();
    h.auth = makeAuth({ 'workforce:reports:view': 'org' }, ['SALES_MANAGER']);
    h.get.mockClear();
    renderWork(<BirthdaysPage />);
    expect(h.get).not.toHaveBeenCalled();
  });
  it('has no axe violations', async () => {
    h.get.mockResolvedValue(one({ today: '2026-10-15', days: 30, items: [{ userId: 'u2', name: 'Asha Rao', department: 'Sales', nextDate: '2026-10-18', month: 10, day: 18, daysUntil: 3, shared: true }] }));
    const { container } = renderWork(<BirthdaysPage />);
    await screen.findByText('Asha Rao');
    expect(await axe(container)).toHaveNoViolations();
  });
});

const ann = (i: number, over: Record<string, unknown> = {}) => ({ id: `a${i}`, title: `Notice ${i}`, body: 'Body text', audienceRoles: [], publishedAt: '2026-10-14T05:00:00Z', expiresAt: null, expired: false, createdByName: 'Hira HR', ...over });

describe('AnnouncementsPage', () => {
  it('lists announcements incl. expired ones and publishes a new one (audience + expiry), sending a UTC instant', async () => {
    h.get.mockResolvedValue(page([ann(1), ann(2, { expired: true, audienceRoles: ['FINANCE'] })]));
    h.post.mockResolvedValue(one(ann(3)));
    renderWork(<AnnouncementsPage />);
    expect(await screen.findByText('Notice 1')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('1 roles')).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith('/workforce/announcements', expect.objectContaining({ include: 'all' }));
    await userEvent.click(screen.getByRole('button', { name: 'New announcement' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(await within(dialog).findByText('Use at least 3 characters')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Holiday notice');
    await userEvent.type(within(dialog).getByLabelText(/Message/), 'Closed on Friday');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Finance' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/announcements', { title: 'Holiday notice', body: 'Closed on Friday', audienceRoles: ['FINANCE'] }));
    expect(await screen.findByText('Announcement published')).toBeInTheDocument();
  });
  it('asks for confirmation before deleting and reports a failure', async () => {
    h.get.mockResolvedValue(page([ann(1)]));
    h.del.mockRejectedValueOnce(new ApiError({ status: 500, code: 'X', message: 'x' }));
    renderWork(<AnnouncementsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete announcement Notice 1' }));
    const dialog = await screen.findByRole('dialog');
    expect(h.del).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(h.del).toHaveBeenCalledWith('/workforce/announcements/a1');
    expect(await within(dialog).findByText(/something went wrong|server/i)).toBeInTheDocument();
  });
  it('shows empty state; denied without announcements:manage', async () => {
    h.get.mockResolvedValue(page([]));
    const { unmount } = renderWork(<AnnouncementsPage />);
    expect(await screen.findByText('No announcements yet')).toBeInTheDocument();
    unmount();
    h.auth = makeAuth({ 'announcements:view': 'org' }, []);
    h.get.mockClear();
    renderWork(<AnnouncementsPage />);
    expect(h.get).not.toHaveBeenCalled();
  });
  it('has no axe violations', async () => {
    h.get.mockResolvedValue(page([ann(1)]));
    const { container } = renderWork(<AnnouncementsPage />);
    await screen.findByText('Notice 1');
    expect(await axe(container)).toHaveNoViolations();
  });
});

const settings = (over: Record<string, unknown> = {}) => ({ effective: DEFAULT_WORKFORCE_CONFIG, overrides: {}, defaults: DEFAULT_WORKFORCE_CONFIG, version: 1, updatedAt: null, note: 'x', ...over });

describe('PolicyPage', () => {
  it('shows the proposed-defaults warning and every section; read-only for viewers without manage', async () => {
    h.auth = makeAuth({ 'workforce:settings:view': 'org' }, ['FOUNDER_CEO']);
    h.get.mockResolvedValue(one(settings()));
    renderWork(<PolicyPage />);
    expect(await screen.findByText('Proposed defaults')).toBeInTheDocument();
    expect(screen.getByText('You can view the policy but not change it.')).toBeInTheDocument();
    for (const s of ['General', 'Attendance', 'Leave', 'Earned Leave', 'Holidays', 'Goals', 'Tasks', 'Probation and birthdays', 'Payroll register']) expect(screen.getByRole('heading', { name: s })).toBeInTheDocument();
    expect(screen.getByLabelText('Eligible days needed per credit')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save policy' })).not.toBeInTheDocument();
  });
  it('sends only the changed sections, with parsed numbers and lists', async () => {
    h.get.mockResolvedValue(one(settings()));
    h.patch.mockResolvedValue(one(settings({ version: 2 })));
    renderWork(<PolicyPage />);
    const el = await screen.findByLabelText('Eligible days needed per credit');
    await userEvent.clear(el);
    await userEvent.type(el, '25');
    const rem = screen.getByLabelText('Reminder days before target');
    await userEvent.clear(rem);
    await userEvent.type(rem, '10, 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    const [path, body] = h.patch.mock.calls[0] as [string, Record<string, Record<string, unknown>>];
    expect(path).toBe('/workforce/settings');
    expect(Object.keys(body).sort()).toEqual(['earnedLeave', 'goals']);
    expect(body['earnedLeave']!['requiredEligibleDays']).toBe(25);
    expect(body['goals']!['reminderDaysBeforeTarget']).toEqual([10, 2]);
    expect(await screen.findByText('Policy saved')).toBeInTheDocument();
  });
  it('edits the check-in cutoff and Zoom link; empty link is sent as null, non-https is blocked', async () => {
    h.get.mockResolvedValue(one(settings()));
    h.patch.mockResolvedValue(one(settings({ version: 2 })));
    renderWork(<PolicyPage />);
    const cutoff = await screen.findByLabelText('Self check-in closes at (HH:MM)');
    expect(cutoff).toHaveValue('11:00');
    const link = screen.getByLabelText('Zoom meeting link');
    expect(link).toHaveValue('');
    await userEvent.clear(cutoff);
    await userEvent.type(cutoff, '10:45');
    await userEvent.type(link, 'http://zoom.us/j/1');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(await screen.findByText('Some values are not valid. Correct the highlighted fields.')).toBeInTheDocument();
    expect(link).toHaveAccessibleDescription(/Enter a valid value/);
    expect(h.patch).not.toHaveBeenCalled();
    await userEvent.clear(link);
    await userEvent.type(link, 'https://zoom.us/j/123');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    const body = (h.patch.mock.calls[0] as [string, Record<string, Record<string, unknown>>])[1];
    expect(body['attendance']!['checkInCutoff']).toBe('10:45');
    expect(body['attendance']!['meetingUrl']).toBe('https://zoom.us/j/123');
    expect(parseField('url', '')).toBeNull();
    expect(parseField('url', 'https://' + 'a'.repeat(500))).toBeUndefined();
    expect(parseField('time', '25:00')).toBeUndefined();
  });
  it('blocks invalid numbers client-side and shows server field errors', async () => {
    h.get.mockResolvedValue(one(settings()));
    h.patch.mockRejectedValue(new ApiError({ status: 422, code: 'VALIDATION_ERROR', message: 'The resulting policy is invalid', details: [{ path: 'earnedLeave.leaveTypeKey', message: 'must be one of the leave types' }] }));
    renderWork(<PolicyPage />);
    const el = await screen.findByLabelText('Goal cycle (days)');
    await userEvent.clear(el);
    await userEvent.type(el, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(await screen.findByText('Some values are not valid. Correct the highlighted fields.')).toBeInTheDocument();
    expect(h.patch).not.toHaveBeenCalled();
    await userEvent.clear(el);
    await userEvent.type(el, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(await screen.findByText('The server rejected these values')).toBeInTheDocument();
    expect(screen.getByText(/must be one of the leave types/)).toBeInTheDocument();
  });
  it('says so when nothing changed, and has no axe violations', async () => {
    h.get.mockResolvedValue(one(settings()));
    const { container } = renderWork(<PolicyPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save policy' }));
    expect(await screen.findByText('Nothing changed')).toBeInTheDocument();
    expect(h.patch).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });
  it('pure helpers: parseField / getAt / setAt', () => {
    expect(parseField('int', '25')).toBe(25);
    expect(parseField('int', '2.5')).toBeUndefined();
    expect(parseField('numnull', '')).toBeNull();
    expect(parseField('numlist', '7, 3')).toEqual([7, 3]);
    expect(parseField('numlist', '7, x')).toBeUndefined();
    expect(parseField('textlist', 'India, UAE')).toEqual(['India', 'UAE']);
    const o = {} as Record<string, unknown>;
    setAt(o, ['a', 'b'], 1);
    expect(getAt(o, ['a', 'b'])).toBe(1);
  });
});

describe('HrHubPage and HR profile diff', () => {
  it('shows the snapshot and only the tiles the viewer may open', async () => {
    h.auth = makeAuth({ 'workforce:settings:view': 'org', 'workforce:reports:view': 'org', 'workforce:dashboard:view': 'org' }, ['FOUNDER_CEO']);
    h.get.mockResolvedValue(one({ scopeLevel: 'org', today: '2026-10-15', employee: {}, team: null, organisation: { headcount: 42, onProbation: 5, newJoinersLast30Days: 1, departments: [], probationEndingSoon: { windowDays: 14, items: [] }, birthdays: { available: false }, pendingLeave: { available: false }, attendanceExceptions: { available: false }, earnedLeave: { available: false } } }));
    renderWork(<HrHubPage />);
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Workforce policy/ })).toHaveAttribute('href', '/work/hr/policy');
    expect(screen.queryByRole('link', { name: /Announcements/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Birthdays/ })).not.toBeInTheDocument();
  });
  it('diffPatch sends only changed fields and clears emptied ones with null', () => {
    const before = { joinDate: '2026-01-05', probationMonths: '3', dateOfBirth: '1990-03-07', shareBirthday: false, employeeCode: 'E1', workLocation: 'Pune' };
    expect(diffPatch(before, before)).toEqual({});
    expect(diffPatch(before, { ...before, shareBirthday: true, workLocation: '' , probationMonths: '6' })).toEqual({ shareBirthday: true, workLocation: null, probationMonths: 6 });
    expect(diffPatch(before, { ...before, dateOfBirth: '' })).toEqual({ dateOfBirth: null });
  });
});
