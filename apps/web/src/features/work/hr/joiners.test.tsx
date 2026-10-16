import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeAuth, one, page } from '@/features/people/test-support';
import { renderWork } from '../test-utils';

vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { JoinersPage } from './joiners-page';

const options = {
  roles: ['SALES_MANAGER', 'SALES_EXECUTIVE'], managers: [{ id: 'm1', name: 'Prachi Waghmare' }], templates: [],
  defaultPlan: Array.from({ length: 12 }, (_, i) => ({ title: `Step ${i}`, dueDay: i + 1 })),
  suggestedTasks: [{ title: 'Complete product training and send the notes to your manager', dueDay: 7, priority: 'HIGH' }, { title: 'Log your first 20 follow-up calls with next actions', dueDay: 21, priority: 'MEDIUM' }],
};
const report = {
  report: 'new-joiners', title: 'New joiner 90-day progress report', columns: [], summary: {}, truncated: false, rowCap: 10000, scopeLevel: 'org', range: { from: '2026-07-18', to: '2026-10-16' }, filters: { departmentId: null, userId: null, groupBy: null },
  rows: [{ employee: 'Nitin New', department: 'Sales', manager: 'Prachi Waghmare', position: 'Sales Executive', joined: '2026-10-07', day: 10, daysLeftOf90: 80, onboardingItems: 12, onboardingDonePct: 25, tasks: 4, tasksDone: 1, taskCompletionPct: 25, attendancePct: 100, lateDays: 0, avgDayReportPct: 70, avgGoalProgressPct: null, nextReview: 'Day 30 review' }],
};
const route = () => h.get.mockImplementation(async (path: string) => {
  if (path.endsWith('/joiners/options')) return one(options);
  if (path.includes('/workforce/reports/new-joiners')) return { data: { ...report, rows: report.rows }, meta: { pagination: { mode: 'page', limit: 100, page: 1, hasMore: false, total: 1, totalPages: 1 } } };
  return page([], false);
});

beforeEach(() => {
  h.get.mockReset(); h.post.mockReset();
  h.auth = makeAuth({ 'joiners:manage': 'org', 'workforce:reports:view': 'org', 'workforce:reports:export': 'org' }, ['HR'], 'hr1');
});

describe('JoinersPage (HR and the Boss)', () => {
  it('shows each new joiner with the day of 90, training, tasks, attendance and the next review', async () => {
    route();
    renderWork(<JoinersPage />);
    expect(await screen.findByText('Nitin New')).toBeInTheDocument();
    expect(screen.getByText('Day 10 of 90')).toBeInTheDocument();
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
    expect(screen.getByText('Next: Day 30 review')).toBeInTheDocument();
  });

  it('joining an employee validates the form, posts everything in one request and shows the invite link', async () => {
    route();
    h.post.mockResolvedValue(one({ userId: 'u9', name: 'Riya Rao', email: 'riya@example.com', positionTitle: 'Sales Executive (Telecaller)', joinDate: '2026-10-16', probationEnd: '2027-01-16', planId: 'p1', planItems: 12, reviewDays: [30, 60, 90], tasks: 2, invite: { link: 'https://x.test/invite/accept?token=abc', expiresAt: '2026-10-23T00:00:00Z' }, warnings: [] }));
    renderWork(<JoinersPage />);
    await userEvent.click(await screen.findByRole('button', { name: /join new employee/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Join employee' }));
    expect((await within(dialog).findAllByText('This field is required')).length).toBeGreaterThanOrEqual(2);
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/^full name/i), 'Riya Rao');
    await userEvent.type(within(dialog).getByLabelText(/^work email/i), 'riya@example.com');
    await userEvent.type(within(dialog).getByLabelText(/^post/i), 'Sales Executive (Telecaller)');
    await userEvent.selectOptions(within(dialog).getByLabelText(/reports to/i), 'm1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Join employee' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    const [path, body] = h.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/workforce/hr/joiners');
    expect(body).toMatchObject({ name: 'Riya Rao', email: 'riya@example.com', roles: ['SALES_EXECUTIVE'], managerId: 'm1', positionTitle: 'Sales Executive (Telecaller)' });
    expect((body.tasks as unknown[]).length).toBe(2);
    expect(await screen.findByText('Riya Rao has joined')).toBeInTheDocument();
    expect(screen.getByText('https://x.test/invite/accept?token=abc')).toBeInTheDocument();
  });

  it('shows the server message when the email is already used', async () => {
    route();
    const { ApiError } = await import('@/lib/api/client');
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'EMAIL_TAKEN', message: 'A user with this email already exists' }));
    renderWork(<JoinersPage />);
    await userEvent.click(await screen.findByRole('button', { name: /join new employee/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(await within(dialog).findByLabelText(/^full name/i), 'Dup');
    await userEvent.type(within(dialog).getByLabelText(/^work email/i), 'dup@example.com');
    await userEvent.type(within(dialog).getByLabelText(/^post/i), 'Executive');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Join employee' }));
    expect(await within(dialog).findByText('A user with this email already exists')).toBeInTheDocument();
  });
});
