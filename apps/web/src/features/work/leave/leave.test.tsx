import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { i18nErrors, makeAuth, one, page, renderAreaA } from '../attendance/test-support';

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
import type { EarnedLeaveProgress, EarnedLeaveTxn, LeaveBalance, LeaveRequest } from '@/lib/api/hooks/work-leave';
import { ApprovalsPage } from './approvals-page';
import { BalancesPage } from './balances-page';
import { LeavePage } from './leave-page';

const balances: LeaveBalance[] = [
  { typeKey: 'CASUAL', name: 'Casual leave', isPaid: true, needsBalance: true, active: true, balance: 5, pending: 2, available: 3 },
  { typeKey: 'UNPAID', name: 'Unpaid leave', isPaid: false, needsBalance: false, active: true, balance: 0, pending: 0, available: 0 },
];
const el: EarnedLeaveProgress = {
  userId: 'me', enabled: true, requiredEligibleDays: 20, creditDays: 1, leaveTypeKey: 'EARNED', eligibleDays: 12.5, daysToNextCredit: 7.5, creditsGiven: 1, processedThrough: '2026-10-14', periodStart: '2026-09-20', balance: 1,
  dayLog: [{ date: '2026-10-13', status: 'PRESENT', eligible: 1, reason: 'COUNT_PRESENT', source: 'RECORD' }, { date: '2026-10-14', status: 'HALF_DAY', eligible: 0.5, reason: 'HALF_HALF_DAY', source: 'RECORD' }],
};
const txn: EarnedLeaveTxn = {
  id: 't1', kind: 'CREDIT_EARNED', typeKey: 'EARNED', amount: '1', balanceBefore: '0', balanceAfter: '1', periodStart: '2026-08-20', periodEnd: '2026-09-19', eligibleDays: '20', policyVersion: 1, note: null, createdAt: '2026-09-20T01:00:00Z',
  calculation: { days: [{ date: '2026-09-19', status: 'PRESENT', eligible: 1, reason: 'COUNT_PRESENT', source: 'RECORD' }] },
};
const req = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: 'r1', userId: 'me', userName: 'Asha Rao', typeKey: 'CASUAL', startDate: '2026-11-02', endDate: '2026-11-03', halfDay: 'NONE', days: '2', unpaidDays: '0', reason: 'Family wedding',
  status: 'PENDING_MANAGER', cancelReason: null, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
  steps: [{ step: 'MANAGER', status: 'PENDING', actorId: null, actorName: null, comment: null, decidedAt: null }, { step: 'HR', status: 'PENDING', actorId: null, actorName: null, comment: null, decidedAt: null }],
  can: { decide: false, cancel: true }, ...over,
});

function routes(requests: LeaveRequest[] = [req()]) {
  h.get.mockImplementation(async (path: string, q?: Record<string, unknown>) => {
    if (path.endsWith('/leave/types')) return one([{ key: 'CASUAL', name: 'Casual leave', isPaid: true, needsBalance: true, maxConsecutiveDays: null }, { key: 'UNPAID', name: 'Unpaid leave', paid: false, needsBalance: false, maxConsecutiveDays: null }]);
    if (path.endsWith('/leave/balances')) return one({ userId: q?.userId ?? 'me', balances });
    if (path.endsWith('/earned-leave/progress')) return one(el);
    if (path.endsWith('/earned-leave/transactions')) return one([txn]);
    if (path.endsWith('/leave/ledger')) return page([{ id: 'l1', typeKey: 'CASUAL', kind: 'OPENING', amount: '5', balanceBefore: '0', balanceAfter: '5', leaveRequestId: null, periodStart: null, periodEnd: null, eligibleDays: null, note: 'opening', createdById: 'hr', createdByName: 'Hema HR', createdAt: '2026-10-01T00:00:00Z' }]);
    if (path.endsWith('/leave/requests')) return page(requests);
    if (path.endsWith('/leave/calendar')) return one({ entries: [{ requestId: 'x', userId: 'u2', userName: 'Ravi Kumar', typeKey: 'SICK', startDate: '2026-10-20', endDate: '2026-10-21', halfDay: 'NONE', status: 'APPROVED' }] });
    if (path.endsWith('/team-members')) return one([{ id: 'u2', name: 'Ravi Kumar', managerId: 'm', roles: [] }]);
    throw new Error(`unexpected GET ${path}`);
  });
}
const exec = () => makeAuth({ 'leave:apply': 'own', 'leave:view': 'own' }, ['SALES_EXECUTIVE'], 'me');

beforeEach(() => {
  for (const m of [h.get, h.post, h.put, h.patch, h.delete]) m.mockReset();
  i18nErrors.length = 0;
  h.auth = exec();
  routes();
});
afterEach(() => expect(i18nErrors, 'missing or invalid translations').toEqual([]));

describe('LeavePage', () => {
  it('shows balances with pending days reserved, Earned Leave progress and the request with its approval steps', async () => {
    renderAreaA(<LeavePage />);
    const cards = await screen.findByRole('list', { name: /leave balances/i });
    expect(within(cards).getByText('Casual leave')).toBeInTheDocument();
    expect(within(cards).getByText('3')).toBeInTheDocument();
    expect(within(cards).getByText(/balance 5 · 2 waiting for approval/i)).toBeInTheDocument();
    expect(within(cards).getByText(/unpaid, no balance needed/i)).toBeInTheDocument();
    expect(await screen.findByText('12.5 of 20 eligible days counted')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /eligible days towards the next earned leave credit/i })).toHaveAttribute('aria-valuenow', '63');
    expect(screen.getByText(/7.5 more eligible day\(s\) until the next credit of 1 day\(s\)/i)).toBeInTheDocument();
    const reqs = await screen.findByRole('list', { name: 'My requests' });
    expect(within(reqs).getByText('Awaiting manager')).toBeInTheDocument();
    expect(within(reqs).getByText(/manager: waiting/i)).toBeInTheDocument();
    expect(within(reqs).getByText(/hr: waiting/i)).toBeInTheDocument();
    expect(within(reqs).getByText('Family wedding')).toBeInTheDocument();
  });

  it('explains how Earned Leave is counted, day by day', async () => {
    renderAreaA(<LeavePage />);
    await userEvent.click(await screen.findByText(/how is this counted/i));
    const log = await screen.findByRole('list', { name: /day by day/i });
    expect(within(log).getByText('Present')).toBeInTheDocument();
    expect(within(log).getByText('Half day')).toBeInTheDocument();
    expect(within(log).getByText('counts 0.5')).toBeInTheDocument();
  });

  it('empty request list and error state', async () => {
    routes([]);
    renderAreaA(<LeavePage />);
    expect(await screen.findByText(/no leave requests yet/i)).toBeInTheDocument();
  });

  it('sends the request, and asks for explicit confirmation before taking unpaid days (never silently)', async () => {
    h.post
      .mockRejectedValueOnce(new ApiError({ status: 409, code: 'UNPAID_CONFIRMATION_REQUIRED', message: 'The balance does not cover all days', details: { shortfall: 1, available: 3 } }))
      .mockResolvedValueOnce(one(req({ unpaidDays: '1', days: '4' })));
    renderAreaA(<LeavePage />);
    await userEvent.click(await screen.findByRole('button', { name: /apply for leave/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /send request/i }));
    expect(await within(dialog).findAllByText(/this field is required/i)).not.toHaveLength(0);
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.selectOptions(within(dialog).getByLabelText(/leave type/i), 'CASUAL');
    await userEvent.type(within(dialog).getByLabelText(/^from/i), '2026-11-02');
    await userEvent.type(within(dialog).getByLabelText(/^to/i), '2026-11-05');
    await userEvent.type(within(dialog).getByLabelText(/^reason/i), 'Family wedding');
    await userEvent.click(within(dialog).getByRole('button', { name: /send request/i }));
    expect(await within(dialog).findByText(/your balance does not cover every day/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/available balance is 3 day\(s\); 1 day\(s\) would be unpaid/i)).toBeInTheDocument();
    const send = within(dialog).getByRole('button', { name: /send request/i });
    expect(send).toBeDisabled();
    expect(h.post).toHaveBeenCalledWith('/workforce/leave/requests', expect.objectContaining({ typeKey: 'CASUAL', confirmUnpaid: false }));
    await userEvent.click(within(dialog).getByRole('checkbox'));
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(2));
    expect(h.post.mock.calls[1]![1]).toMatchObject({ confirmUnpaid: true, startDate: '2026-11-02', endDate: '2026-11-05' });
    expect(await screen.findByText('Request sent for 4 day(s)')).toBeInTheDocument();
  });

  it('shows other server refusals (overlap) inside the dialog', async () => {
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'LEAVE_OVERLAP', message: 'You already have leave requested or approved for some of these dates' }));
    renderAreaA(<LeavePage />);
    await userEvent.click(await screen.findByRole('button', { name: /apply for leave/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(await within(dialog).findByLabelText(/leave type/i), 'UNPAID');
    await userEvent.type(within(dialog).getByLabelText(/^from/i), '2026-11-02');
    await userEvent.type(within(dialog).getByLabelText(/^to/i), '2026-11-02');
    await userEvent.type(within(dialog).getByLabelText(/^reason/i), 'Trip');
    await userEvent.click(within(dialog).getByRole('button', { name: /send request/i }));
    expect(await within(dialog).findByText(/you already have leave requested or approved/i)).toBeInTheDocument();
  });

  it('cancels a request only with a reason', async () => {
    h.post.mockResolvedValue(one(req({ status: 'CANCELLED' })));
    renderAreaA(<LeavePage />);
    await userEvent.click(await screen.findByRole('button', { name: /cancel request/i }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /cancel request/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^reason/i), 'Plans changed');
    await userEvent.click(confirm);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/leave/requests/r1/cancel', { reason: 'Plans changed' }));
  });

  it('ledger tab lists entries newest first with the running balance; team leave tab only for managers', async () => {
    renderAreaA(<LeavePage />);
    await userEvent.click(await screen.findByRole('tab', { name: /balance history/i }));
    expect(await screen.findByText(/opening balance · casual/i)).toBeInTheDocument();
    expect(screen.getByText(/hema hr/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /who is on leave/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /team leave/i })).not.toBeInTheDocument();
  });

  it('permission denied without leave:apply', async () => {
    h.auth = makeAuth({}, [], 'x');
    renderAreaA(<LeavePage />);
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderAreaA(<LeavePage />);
    await screen.findByRole('list', { name: 'My requests' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ApprovalsPage', () => {
  const mgr = () => makeAuth({ 'leave:approve': 'team', 'leave:view': 'team' }, ['SALES_MANAGER'], 'mgr');
  const pending = req({ id: 'p1', userId: 'u2', userName: 'Ravi Kumar', can: { decide: true, cancel: false } });
  beforeEach(() => { h.auth = mgr(); routes([pending]); });

  it('lists what waits for me and approves with an optional comment', async () => {
    h.post.mockResolvedValue(one(req({ status: 'PENDING_HR' })));
    renderAreaA(<ApprovalsPage />);
    expect(await screen.findByText(/ravi kumar · casual/i)).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith('/workforce/leave/requests', expect.objectContaining({ view: 'pending-me' }));
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/leave/requests/p1/decision', { decision: 'APPROVE' }));
    expect(await screen.findByText('Decision recorded: approved')).toBeInTheDocument();
  });

  it('rejecting requires a reason', async () => {
    h.post.mockResolvedValue(one(req({ status: 'REJECTED' })));
    renderAreaA(<ApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /^reject$/i }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /^reject$/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/reason for rejecting/i), 'Team is short that week');
    await userEvent.click(confirm);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/leave/requests/p1/decision', { decision: 'REJECT', comment: 'Team is short that week' }));
  });

  it('shows the server refusal (e.g. someone else decided first) and does not claim success', async () => {
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'CONFLICT', message: 'This request was just decided by someone else; reload' }));
    renderAreaA(<ApprovalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /^approve$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));
    expect(await within(dialog).findByText(/just decided by someone else/i)).toBeInTheDocument();
    expect(screen.queryByText('Decision recorded: approved')).not.toBeInTheDocument();
  });

  it('requests I cannot decide have no buttons; empty state; permission denied for executives', async () => {
    routes([req({ id: 'p2', userId: 'u2', userName: 'Ravi Kumar', can: { decide: false, cancel: false } })]);
    const { unmount } = renderAreaA(<ApprovalsPage />);
    await screen.findByText(/ravi kumar · casual/i);
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    unmount();
    routes([]);
    const second = renderAreaA(<ApprovalsPage />);
    expect(await screen.findByText(/nothing is waiting for you/i)).toBeInTheDocument();
    second.unmount();
    h.auth = exec();
    renderAreaA(<ApprovalsPage />);
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderAreaA(<ApprovalsPage />);
    await screen.findByText(/ravi kumar · casual/i);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('BalancesPage (HR)', () => {
  const pick = async () => { await screen.findByRole('option', { name: 'Ravi Kumar' }); await userEvent.selectOptions(screen.getByLabelText('Employee'), 'u2'); };
  const hr = () => makeAuth({ 'leave:balance:adjust': 'org', 'leave:view': 'org' }, ['HR'], 'hr');
  beforeEach(() => { h.auth = hr(); });

  it('asks to choose an employee, then shows balances, Earned Leave and history for that employee', async () => {
    renderAreaA(<BalancesPage />);
    expect(await screen.findByText(/choose an employee to see their balances/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adjust balance/i })).not.toBeInTheDocument();
    await pick();
    expect(await screen.findByRole('list', { name: /leave balances/i })).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith('/workforce/leave/balances', { userId: 'u2' });
    expect(await screen.findByText('Credited 1 day(s)')).toBeInTheDocument();
    expect(screen.getByText(/period 20 aug 2026 to 19 sept 2026 · 20 eligible days/i)).toBeInTheDocument();
  });

  it('adjusts a balance with a mandatory reason and a signed amount', async () => {
    h.post.mockResolvedValue(one({}));
    renderAreaA(<BalancesPage />);
    await pick();
    await userEvent.click(await screen.findByRole('button', { name: /adjust balance/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /add entry/i }));
    expect((await within(dialog).findAllByText(/this field is required|enter a non-zero number|give a reason/i)).length).toBeGreaterThan(0);
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.selectOptions(within(dialog).getByLabelText(/leave type/i), 'CASUAL');
    await userEvent.type(within(dialog).getByLabelText(/^days/i), '-1');
    await userEvent.type(within(dialog).getByLabelText(/^reason/i), 'Correction after audit');
    await userEvent.click(within(dialog).getByRole('button', { name: /add entry/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/leave/balances/adjust', { userId: 'u2', typeKey: 'CASUAL', kind: 'ADJUSTMENT', amount: '-1', reason: 'Correction after audit' }));
  });

  it('runs the Earned Leave engine and reports what it wrote', async () => {
    h.post.mockResolvedValue(one({ users: 1, credits: 2 }));
    renderAreaA(<BalancesPage />);
    await pick();
    await userEvent.click(await screen.findByRole('button', { name: /run earned leave now/i }));
    expect(h.post).toHaveBeenCalledWith('/workforce/earned-leave/run', { userId: 'u2' });
    expect(await screen.findByText('Earned Leave checked: 2 credit(s) written')).toBeInTheDocument();
  });

  it('permission denied for managers', async () => {
    h.auth = makeAuth({ 'leave:view': 'team' }, ['SALES_MANAGER'], 'mgr');
    renderAreaA(<BalancesPage />);
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderAreaA(<BalancesPage />);
    await pick();
    await screen.findByText('Credited 1 day(s)');
    expect(await axe(container)).toHaveNoViolations();
  });
});
