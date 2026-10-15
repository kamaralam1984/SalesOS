import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { makeAuth, one, page } from '@/features/people/test-support';
import { messages, renderWork } from '../test-utils';

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
import { DirectoryPage } from './directory-page';
import { Employee360Page } from './employee-360-page';
import { WorkHubPage } from './hub-page';
import { OrgChartPage } from './org-chart-page';

const NA = { available: false };
const employee = (over: Record<string, unknown> = {}) => ({
  attendance: { available: true, day: '2026-10-15', dayKind: 'WORKING', holidayName: null, record: { status: 'PRESENT', checkInAt: '2026-10-15T04:00:00Z', checkOutAt: null, workMinutes: null } },
  tasks: { available: true, hasData: true, open: 2, overdue: 1, dueToday: 1, items: [{ id: 't1', title: 'Call Rohit', status: 'IN_PROGRESS', priority: 'HIGH', dueAt: '2026-10-14T04:00:00Z', overdue: true }] },
  goals: { available: true, hasData: true, items: [{ id: 'g1', title: 'Close 10 deals', status: 'ACTIVE', risk: 'AT_RISK', progressPct: 30, targetDate: '2026-11-30', nextMilestone: { title: 'Five deals', dueDate: '2026-11-01' } }] },
  leave: { available: true, year: '2026', hasData: true, balances: [{ typeKey: 'CASUAL', name: 'Casual leave', remaining: 3, used: 1, pending: 1 }], earnedLeave: { required: 20, eligibleDays: 12, daysToNextCredit: 8, creditsGiven: 1, processedThrough: '2026-10-14', started: true } },
  upcomingHolidays: { available: true, items: [{ date: '2026-10-20', name: 'Diwali', kind: 'NATIONAL' }] },
  announcements: { available: true, hasData: true, items: [{ id: 'a1', title: 'Office closed Friday', body: 'Enjoy the long weekend', publishedAt: '2026-10-14T05:00:00Z', expiresAt: null }] },
  birthdays: { available: true, hasData: true, items: [{ userId: 'u9', name: 'Meera Joshi', daysAway: 3, date: '10-18' }] },
  ...over,
});
const dash = (over: Record<string, unknown> = {}) => ({ generatedAt: '2026-10-15T05:00:00Z', today: '2026-10-15', timezone: 'Asia/Kolkata', scopeLevel: 'own', employee: employee(), team: null, organisation: null, ...over });

beforeEach(() => {
  h.get.mockReset(); h.post.mockReset(); h.patch.mockReset(); h.del.mockReset();
  h.auth = makeAuth({ 'workforce:dashboard:view': 'own', 'directory:view': 'org' }, ['SALES_EXECUTIVE'], 'me');
});

describe('WorkHubPage', () => {
  it('shows the loading state, then the employee blocks (attendance, tasks, goals, leave, holidays, announcements, birthdays)', async () => {
    h.get.mockResolvedValue(one(dash()));
    renderWork(<WorkHubPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: /work hub/i })).toBeInTheDocument();
    expect(await screen.findByText('Office closed Friday')).toBeInTheDocument();
    expect(screen.getByText(/2 open · 1 overdue · 1 due today/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /progress of close 10 deals: 30 percent/i })).toHaveAttribute('aria-valuenow', '30');
    expect(screen.getByText(/12 of 20 eligible days/)).toBeInTheDocument();
    expect(screen.getByText('Diwali')).toBeInTheDocument();
    expect(screen.getByText('Meera Joshi')).toBeInTheDocument();
    expect(screen.queryByText(/My team/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Organisation' })).not.toBeInTheDocument();
  });

  it('shows honest empty states for blocks without data', async () => {
    h.get.mockResolvedValue(one(dash({ employee: employee({ tasks: { available: true, hasData: false, open: 0, overdue: 0, dueToday: 0, items: [] }, goals: { available: true, hasData: false, items: [] }, birthdays: { available: true, hasData: false, items: [] }, attendance: { available: true, day: '2026-10-15', dayKind: 'WORKING', holidayName: null, record: null } }) })));
    renderWork(<WorkHubPage />);
    expect(await screen.findByText('No open tasks.')).toBeInTheDocument();
    expect(screen.getByText('No active goals.')).toBeInTheDocument();
    expect(screen.getByText('Not marked yet today.')).toBeInTheDocument();
    expect(screen.getByText('No shared birthdays coming up.')).toBeInTheDocument();
  });

  it('renders the team and organisation blocks with drill-down links for HR/Boss', async () => {
    h.auth = makeAuth({ 'workforce:dashboard:view': 'org' }, ['HR'], 'hr');
    h.get.mockResolvedValue(one(dash({
      scopeLevel: 'org',
      team: { members: 4, attendance: { available: true, hasData: true, members: 4, counts: { PRESENT: 3 }, notMarked: 1 }, tasks: NA, goals: NA, leave: { available: true, hasData: true, pending: 1, items: [{ id: 'l1', userId: 'u2', name: 'Asha Rao', typeKey: 'CASUAL', startDate: '2026-10-20', endDate: '2026-10-21', days: 2, status: 'PENDING_MANAGER' }] }, drilldown: [{ key: 'directory', href: '/work/directory' }, { key: 'approvals', href: '/work/approvals' }] },
      organisation: { headcount: 42, onProbation: 5, newJoinersLast30Days: 2, departments: [{ department: 'Sales', headcount: 30, href: '/work/org-chart?view=department&department=Sales' }], probationEndingSoon: { windowDays: 14, items: [{ userId: 'u3', name: 'Ravi Kumar', endDate: '2026-10-22', daysLeft: 7 }] }, birthdays: NA, pendingLeave: { available: true, hasData: true, pending: 3 }, attendanceExceptions: { available: true, hasData: false, today: {}, missingCheckOutYesterday: 0 }, earnedLeave: { available: true, hasData: false, creditsLast30Days: 0, items: [] } },
    })));
    renderWork(<WorkHubPage />);
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales' })).toHaveAttribute('href', '/work/org-chart?view=department&department=Sales');
    expect(screen.getByRole('link', { name: 'Ravi Kumar' })).toHaveAttribute('href', '/work/people/u3');
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Team shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('No attendance exceptions today.')).toBeInTheDocument();
  });

  it('shows the error state with retry, and the permission-denied page without the permission', async () => {
    h.get.mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL', message: 'boom' }));
    renderWork(<WorkHubPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    h.get.mockResolvedValue(one(dash()));
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Office closed Friday')).toBeInTheDocument();
  });

  it('is denied without workforce:dashboard:view and does not call the API', () => {
    h.auth = makeAuth({}, [], 'x');
    renderWork(<WorkHubPage />);
    expect(screen.getByText((messages as { denied: { title: string } }).denied.title)).toBeInTheDocument();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    h.get.mockResolvedValue(one(dash()));
    const { container } = renderWork(<WorkHubPage />);
    await screen.findByText('Office closed Friday');
    expect(await axe(container)).toHaveNoViolations();
  });
});

const row = (i: number, over: Record<string, unknown> = {}) => ({ id: `u${i}`, name: `Person ${i}`, employeeCode: `E-${i}`, designation: 'Telecaller', department: 'Sales', manager: { id: 'm1', name: 'Mgr One' }, status: 'ACTIVE', ...over });

describe('DirectoryPage', () => {
  it('lists minimum-data cards, links to the 360 view and sends the search/filter to the API', async () => {
    h.get.mockImplementation(async (path: string) => (path.endsWith('/departments') ? one(['Sales', 'Support']) : page([row(1), row(2, { status: 'PROBATION' })])));
    renderWork(<DirectoryPage />);
    expect(await screen.findByText('Person 1')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /person 1/i })[0]).toHaveAttribute('href', '/work/people/u1');
    expect(within(screen.getByRole('list', { name: 'Employee directory' })).getByText('On probation')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'asha');
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/workforce/directory', expect.objectContaining({ search: 'asha', page: 1, limit: 20 })));
    await userEvent.selectOptions(screen.getByLabelText('Department'), 'Support');
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/workforce/directory', expect.objectContaining({ department: 'Support' })));
  });
  it('shows the empty state, filtered-empty state and error state', async () => {
    h.get.mockImplementation(async (path: string) => (path.endsWith('/departments') ? one([]) : page([])));
    renderWork(<DirectoryPage />);
    expect(await screen.findByText('No employees to show')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(await screen.findByText('No one matches these filters')).toBeInTheDocument();
  });
  it('shows an error with retry', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'X', message: 'x' }));
    renderWork(<DirectoryPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
  it('is denied without directory:view', () => {
    h.auth = makeAuth({}, []);
    renderWork(<DirectoryPage />);
    expect(h.get).not.toHaveBeenCalled();
  });
  it('has no axe violations', async () => {
    h.get.mockImplementation(async (path: string) => (path.endsWith('/departments') ? one(['Sales']) : page([row(1)])));
    const { container } = renderWork(<DirectoryPage />);
    await screen.findByText('Person 1');
    expect(await axe(container)).toHaveNoViolations();
  });
});

const p360 = (over: Record<string, unknown> = {}) => ({
  id: 'u2', generatedAt: '2026-10-15T00:00:00Z',
  profile: { available: true, id: 'u2', name: 'Asha Rao', employeeCode: 'E-2', designation: 'Telecaller', department: 'Sales', manager: { id: 'm1', name: 'Mgr One' }, status: 'ACTIVE', joinDate: '2026-01-05', employmentType: 'FULL_TIME', workLocation: 'Pune', hrContact: null, email: null, isSelf: false },
  hr: NA, performance: NA, attendance: NA, leave: NA, probation: NA, activity: NA, ...over,
});

describe('Employee360Page', () => {
  it('shows the profile and says plainly which sections the viewer cannot see (no hidden data)', async () => {
    h.get.mockResolvedValue(one(p360()));
    renderWork(<Employee360Page id="u2" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('Pune')).toBeInTheDocument();
    expect(screen.getAllByText('Not visible to you').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByRole('button', { name: /edit hr details/i })).not.toBeInTheDocument();
  });
  it('renders every permitted section for HR and offers the HR edit dialog', async () => {
    h.auth = makeAuth({ 'directory:view': 'org', 'hr:records:manage': 'org' }, ['HR'], 'hr');
    h.get.mockResolvedValue(one(p360({
      hr: { available: true, employmentType: 'FULL_TIME', joinDate: '2026-01-05', exitDate: null, exitType: null, hasProfile: true },
      probation: { available: true, hasData: true, startDate: '2026-01-05', durationMonths: 3, endDate: '2026-04-05', status: 'COMPLETED', daysLeft: null, reviews: [] },
      attendance: { available: true, hasData: true, month: '2026-10', counts: { PRESENT: 8, LATE: 1 }, recent: [{ id: 'r1', date: '2026-10-14', status: 'PRESENT', checkInAt: null, checkOutAt: null, workMinutes: 480 }] },
      leave: { available: true, year: '2026', hasData: true, balances: [{ typeKey: 'CASUAL', name: 'Casual leave', remaining: 5, used: 1, pending: 0 }] },
      performance: { available: true, goals: { available: true, hasData: true, byRisk: { AT_RISK: 1 }, items: [{ id: 'g1', title: 'Close 10 deals', status: 'ACTIVE', risk: 'AT_RISK', progressPct: 30, startDate: '2026-10-01', targetDate: '2026-11-14' }] }, tasks: { available: false } },
      activity: { available: true, hasData: false, items: [] },
    })));
    renderWork(<Employee360Page id="u2" />);
    expect(await screen.findByText('Casual leave')).toBeInTheDocument();
    expect(screen.getByText('Present: 8')).toBeInTheDocument();
    expect(screen.getByText('Tasks are not visible to you.')).toBeInTheDocument();
    expect(screen.getByText('No recent activity.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /edit hr details/i }));
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/workforce/hr/profiles/u2'));
  });
  it('shows not-found style error for a 404 and has no axe violations', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Employee not found' }));
    renderWork(<Employee360Page id="zzz" />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
  it('has no axe violations', async () => {
    h.get.mockResolvedValue(one(p360()));
    const { container } = renderWork(<Employee360Page id="u2" />);
    await screen.findByRole('heading', { level: 1, name: 'Asha Rao' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

const node = (id: string, name: string, children: unknown[] = [], over: Record<string, unknown> = {}) => ({ id, name, employeeCode: null, designation: 'Lead', department: 'Sales', status: 'ACTIVE', managerId: null, directReports: children.length, children, ...over });
const chart = (over: Record<string, unknown> = {}) => ({ view: 'organisation', department: null, team: null, roots: [node('f', 'Founder One', [node('t', 'Team Lead', [node('e', 'Exec One')])])], total: 3, truncated: false, limits: { maxNodes: 1000, maxDepth: 12 }, departments: ['Sales'], teams: [{ id: 'tm1', name: 'Team A' }], ...over });

describe('OrgChartPage', () => {
  it('renders the reporting tree and collapses/expands a branch', async () => {
    h.get.mockResolvedValue(one(chart()));
    renderWork(<OrgChartPage />);
    expect(await screen.findByRole('link', { name: /Founder One/ })).toHaveAttribute('href', '/work/people/f');
    expect(screen.getByRole('link', { name: /Exec One/ })).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Collapse Team Lead' });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(btn);
    expect(screen.queryByRole('link', { name: /Exec One/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand Team Lead' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/Photos are not stored/)).toBeInTheDocument();
  });
  it('warns when truncated, requests the department view, and shows empty', async () => {
    h.get.mockResolvedValue(one(chart({ truncated: true })));
    renderWork(<OrgChartPage />);
    expect(await screen.findByText(/cut at 1000 people/)).toBeInTheDocument();
    h.get.mockResolvedValue(one(chart({ roots: [], total: 0 })));
    await userEvent.selectOptions(screen.getByLabelText('View'), 'department');
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/workforce/org-chart', expect.objectContaining({ view: 'department' })));
    expect(await screen.findByText('Choose a department to see its chart')).toBeInTheDocument();
  });
  it('has no axe violations', async () => {
    h.get.mockResolvedValue(one(chart()));
    const { container } = renderWork(<OrgChartPage />);
    await screen.findByRole('link', { name: /Founder One/ });
    expect(await axe(container)).toHaveNoViolations();
  });
  it('within() sanity: tree is a list', async () => {
    h.get.mockResolvedValue(one(chart()));
    renderWork(<OrgChartPage />);
    const list = await screen.findByRole('list', { name: 'Organisation chart' });
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
  });
});
