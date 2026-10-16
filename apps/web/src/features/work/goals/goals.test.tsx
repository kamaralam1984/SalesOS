import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { makeAuth, one, page, renderWork } from '../test-support';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn(), patch: vi.fn(), push: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post, patch: h.patch, put: vi.fn(), delete: vi.fn() } };
});

import { ApiError } from '@/lib/api/client';
import type { Goal, GoalDetail } from '@/lib/api/hooks/work-goals';
import { GoalDetailPage } from './goal-detail';
import { GoalsPage } from './goals-page';

const can = (over: Partial<Goal['can']> = {}): Goal['can'] => ({ progress: false, edit: false, milestones: false, comment: false, submit: false, completeDirect: false, verify: false, return: false, cancel: false, ...over });
const goal = (over: Partial<GoalDetail> = {}): GoalDetail => ({
  id: 'g1', ownerId: 'me', ownerName: 'Asha Rao', reviewerId: 'mgr', reviewerName: 'Tara Lead', createdById: 'me', createdByName: 'Asha Rao',
  title: 'Enrol thirty learners', description: 'Q4 push', startDate: '2026-10-01', targetDate: '2026-11-14', cycleDays: 45,
  targetValue: '30', currentValue: '12', unit: 'enrolments', progressPct: 40, status: 'ACTIVE', risk: 'ON_TRACK', riskApplies: true, elapsedPct: 33, daysToTarget: 30,
  submittedAt: null, verifiedAt: null, verifiedByName: null, version: 3, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z',
  milestones: [{ id: 'm1', title: 'First batch', dueDate: '2026-10-20', done: false, doneAt: null }],
  can: can({ progress: true, edit: true, milestones: true, comment: true, submit: true, cancel: true }),
  updates: [{ id: 'u1', kind: 'PROGRESS', authorId: 'me', authorName: 'Asha Rao', currentValue: '12', progressPct: 40, note: 'twelve signed', createdAt: '2026-10-10T00:00:00Z' }],
  tasks: [{ id: 't1', title: 'Call stalled leads', status: 'IN_PROGRESS', priority: 'HIGH', dueAt: null, assigneeId: 'me', assigneeName: 'Asha Rao' }], tasksAvailable: true, ...over,
});
const summary = { total: 4, byStatus: { ACTIVE: 3 }, byRisk: { AT_RISK: 1, OVERDUE: 1 }, awaitingMyVerification: 2 };
const routeGets = (items: Goal[], hasMore = false) =>
  h.get.mockImplementation(async (path: string) => (path.endsWith('/summary') ? one(summary) : page(items, hasMore)));

beforeEach(() => {
  h.get.mockReset(); h.post.mockReset(); h.patch.mockReset(); h.push.mockReset();
  h.auth = makeAuth({ 'goals:view': 'own', 'goals:create': 'own', 'goals:update': 'own', 'work-tasks:view': 'own' }, ['SALES_EXECUTIVE'], 'me');
});

describe('GoalsPage states', () => {
  it('shows loading, then the list with risk, status and progress as text', async () => {
    routeGets([goal({ risk: 'AT_RISK' })]);
    renderWork(<GoalsPage />);
    expect(screen.getAllByRole('status').some((e) => e.getAttribute('aria-busy') === 'true')).toBe(true);
    const link = await screen.findByRole('link', { name: /enrol thirty learners/i });
    expect(within(link).getByText('At risk')).toBeInTheDocument();
    expect(within(link).getByText('Active')).toBeInTheDocument();
    expect(within(link).getByText('40%')).toBeInTheDocument();
    expect(within(link).getByRole('progressbar', { name: 'Goal progress' })).toHaveAttribute('aria-valuenow', '40');
    expect(link).toHaveAttribute('href', '/work/goals/g1');
  });

  it('shows the empty state with guidance', async () => {
    routeGets([]);
    renderWork(<GoalsPage />);
    expect(await screen.findByText('No goals here yet')).toBeInTheDocument();
    expect(screen.getByText(/create a goal for this cycle/i)).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'INTERNAL', message: 'boom', requestId: 'req-1' }));
    renderWork(<GoalsPage />);
    expect(await screen.findByText('req-1')).toBeInTheDocument();
    routeGets([goal()]);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: /enrol thirty learners/i })).toBeInTheDocument();
  });

  it('shows permission denied without the goals:view permission (no request is made)', async () => {
    h.auth = makeAuth({}, ['SALES_EXECUTIVE'], 'me');
    renderWork(<GoalsPage />);
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('shows the 403 message from the server as its own state', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 403, code: 'FORBIDDEN', message: 'no' }));
    renderWork(<GoalsPage />);
    expect((await screen.findAllByText(/do not have permission/i)).length).toBeGreaterThan(0);
  });

  it('employees see only My goals; managers get team, review and everyone views', async () => {
    routeGets([goal()]);
    const { unmount } = renderWork(<GoalsPage />);
    await screen.findByRole('link', { name: /enrol thirty learners/i });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['My goals']);
    expect(screen.queryByText('Waiting for my verification')).not.toBeInTheDocument();
    unmount();
    h.auth = makeAuth({ 'goals:view': 'team', 'goals:create': 'team', 'goals:review': 'team', 'work-tasks:view': 'team' }, ['SALES_MANAGER'], 'mgr');
    renderWork(<GoalsPage />);
    await screen.findByRole('link', { name: /enrol thirty learners/i });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['My goals', 'Team goals', 'To review', 'Everyone I can see']);
    expect(screen.getByText('Waiting for my verification')).toBeInTheDocument();
  });

  it('filters by status and sends the view and filter to the API from page 1', async () => {
    routeGets([goal()]);
    renderWork(<GoalsPage />);
    await screen.findByRole('link', { name: /enrol thirty learners/i });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/workforce/goals', expect.objectContaining({ view: 'mine', status: 'ACTIVE', page: 1, limit: 10 })));
  });

  it('paginates', async () => {
    routeGets([goal()], true);
    renderWork(<GoalsPage />);
    await screen.findByRole('link', { name: /enrol thirty learners/i });
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/workforce/goals', expect.objectContaining({ page: 2 })));
  });

  it('creates a goal: validates, posts, then opens the new goal', async () => {
    routeGets([]);
    h.post.mockResolvedValue(one(goal({ id: 'new1' })));
    renderWork(<GoalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /new goal/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /create goal/i }));
    expect(await within(dialog).findByText('Use at least 3 characters')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/^goal/i), 'Enrol thirty learners');
    await userEvent.type(within(dialog).getByLabelText(/measurable target/i), '30');
    await userEvent.type(within(dialog).getByLabelText(/^unit/i), 'enrolments');
    await userEvent.click(within(dialog).getByRole('button', { name: /create goal/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/goals', { title: 'Enrol thirty learners', targetValue: '30', unit: 'enrolments' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/work/goals/new1'));
  });

  it('picking a start date fills the target date 45 days later, and the user can still change it', async () => {
    routeGets([]);
    renderWork(<GoalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /new goal/i }));
    const dialog = await screen.findByRole('dialog');
    const start = within(dialog).getByLabelText(/^start date/i) as HTMLInputElement;
    const target = within(dialog).getByLabelText(/^target date/i) as HTMLInputElement;
    await userEvent.type(start, '2026-10-16');
    expect(target.value).toBe('2026-11-29');
    await userEvent.clear(target);
    await userEvent.type(target, '2026-12-31');
    await userEvent.clear(start);
    await userEvent.type(start, '2026-10-20');
    expect(target.value).toBe('2026-12-31');
  });

  it('a leader can set the same goal for everyone in one go', async () => {
    h.auth = makeAuth({ 'goals:view': 'org', 'goals:create': 'org' }, ['FOUNDER_CEO'], 'me');
    h.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/summary')) return one(summary);
      if (path.includes('team-members')) return one([{ id: 'me', name: 'Me' }, { id: 'u1', name: 'Rajat' }, { id: 'u2', name: 'Monica' }]);
      return page([], false);
    });
    h.post.mockResolvedValue(one(goal({ id: 'g' })));
    renderWork(<GoalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /new goal/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^goal/i }), 'Enrol thirty learners');
    await userEvent.selectOptions(within(dialog).getByLabelText(/goal for/i), '__all__');
    await userEvent.type(within(dialog).getByLabelText(/^start date/i), '2026-10-16');
    await userEvent.click(within(dialog).getByRole('button', { name: /create goal/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(2));
    expect(h.post).toHaveBeenCalledWith('/workforce/goals', expect.objectContaining({ ownerId: 'u1', startDate: '2026-10-16', targetDate: '2026-11-29' }));
    expect(h.post).toHaveBeenCalledWith('/workforce/goals', expect.objectContaining({ ownerId: 'u2' }));
    expect(h.push).not.toHaveBeenCalled();
  });

  it('a failed create shows the server message and never claims success', async () => {
    routeGets([]);
    h.post.mockRejectedValue(new ApiError({ status: 422, code: 'INVALID_REVIEWER', message: 'The reviewer cannot be the goal owner' }));
    renderWork(<GoalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /new goal/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^goal/i), 'Valid goal title');
    await userEvent.click(within(dialog).getByRole('button', { name: /create goal/i }));
    expect(await within(dialog).findByText('The reviewer cannot be the goal owner')).toBeInTheDocument();
    expect(screen.queryByText('Goal created')).not.toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    routeGets([goal(), goal({ id: 'g2', title: 'Second goal', risk: 'OVERDUE', status: 'PENDING_VERIFICATION' })]);
    const { container } = renderWork(<GoalsPage />);
    await screen.findByRole('link', { name: /second goal/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('GoalDetailPage', () => {
  it('shows progress, milestones, linked tasks and activity', async () => {
    h.get.mockResolvedValue(one(goal()));
    renderWork(<GoalDetailPage id="g1" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Enrol thirty learners' })).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: 'Goal progress' })[0]).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('First batch')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /call stalled leads/i })).toHaveAttribute('href', '/work/tasks/t1');
    expect(screen.getByText('twelve signed')).toBeInTheDocument();
    expect(screen.getByText(/progress is 12 of 30 enrolments/i)).toBeInTheDocument();
  });

  it('the owner posts progress with the current version', async () => {
    h.get.mockResolvedValue(one(goal()));
    h.post.mockResolvedValue(one(goal({ progressPct: 50, currentValue: '15', version: 4 })));
    renderWork(<GoalDetailPage id="g1" />);
    const input = await screen.findByLabelText(/current value/i);
    await userEvent.clear(input);
    await userEvent.type(input, '15');
    await userEvent.type(screen.getByLabelText(/note \(optional\)/i), 'three more');
    await userEvent.click(screen.getByRole('button', { name: /save progress/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/goals/g1/progress', { version: 3, currentValue: '15', note: 'three more' }));
    expect(await screen.findByText('Progress saved')).toBeInTheDocument();
  });

  it('rejects an invalid progress value locally', async () => {
    h.get.mockResolvedValue(one(goal()));
    renderWork(<GoalDetailPage id="g1" />);
    const input = await screen.findByLabelText(/current value/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    await userEvent.click(screen.getByRole('button', { name: /save progress/i }));
    expect(await screen.findByText(/number with up to 2 decimals/i)).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });

  it('a stale-version conflict is shown, not swallowed as success', async () => {
    h.get.mockResolvedValue(one(goal()));
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'STALE_VERSION', message: 'The goal changed; reload and retry' }));
    renderWork(<GoalDetailPage id="g1" />);
    await userEvent.click(await screen.findByRole('button', { name: /save progress/i }));
    expect(await screen.findByText('The goal changed; reload and retry')).toBeInTheDocument();
    expect(screen.queryByText('Progress saved')).not.toBeInTheDocument();
  });

  it('submit asks for confirmation and posts to /submit', async () => {
    h.get.mockResolvedValue(one(goal({ progressPct: 100 })));
    h.post.mockResolvedValue(one(goal({ status: 'PENDING_VERIFICATION' })));
    renderWork(<GoalDetailPage id="g1" />);
    expect(await screen.findByText(/progress is at 100%/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /submit for verification/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/goals/g1/submit', { version: 3 }));
  });

  it('a pending goal tells the owner who verifies it and offers no progress form', async () => {
    h.get.mockResolvedValue(one(goal({ status: 'PENDING_VERIFICATION', can: can({ comment: true }) })));
    renderWork(<GoalDetailPage id="g1" />);
    expect(await screen.findByText(/tara lead will verify it or send it back/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save progress/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit for verification/i })).not.toBeInTheDocument();
  });

  it('the reviewer verifies, and must give a note to return a goal', async () => {
    h.auth = makeAuth({ 'goals:view': 'team', 'goals:review': 'team' }, ['SALES_MANAGER'], 'mgr');
    h.get.mockResolvedValue(one(goal({ ownerId: 'emp', status: 'PENDING_VERIFICATION', can: can({ verify: true, return: true, cancel: true, comment: true }) })));
    h.post.mockResolvedValue(one(goal({ status: 'COMPLETED' })));
    renderWork(<GoalDetailPage id="g1" />);
    expect(await screen.findByText(/this goal was submitted/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save progress/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /return for more work/i }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    expect(await within(dialog).findByText('Write at least 3 characters')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/note for the owner/i), 'Attach the sheet');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/goals/g1/return', { version: 3, note: 'Attach the sheet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^verify$/i }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/goals/g1/verify', { version: 3 }));
  });

  it('cancelling sends the reason as `reason`', async () => {
    h.get.mockResolvedValue(one(goal()));
    h.post.mockResolvedValue(one(goal({ status: 'CANCELLED' })));
    renderWork(<GoalDetailPage id="g1" />);
    await userEvent.click(await screen.findByRole('button', { name: /cancel goal/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'priorities changed');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/goals/g1/cancel', { version: 3, reason: 'priorities changed' }));
  });

  it('toggling a milestone patches it; viewers without rights see no controls', async () => {
    h.get.mockResolvedValue(one(goal()));
    h.patch.mockResolvedValue(one(goal()));
    const { unmount } = renderWork(<GoalDetailPage id="g1" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /mark "first batch" as done/i }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledWith('/workforce/goals/g1/milestones/m1', { done: true }));
    unmount();
    h.get.mockResolvedValue(one(goal({ can: can() })));
    renderWork(<GoalDetailPage id="g1" />);
    await screen.findByText('First batch');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add milestone/i })).not.toBeInTheDocument();
    expect(screen.getByText(/only the goal owner can post progress/i)).toBeInTheDocument();
  });

  it('overdue and at-risk goals explain why with numbers, not colour alone', async () => {
    h.get.mockResolvedValue(one(goal({ risk: 'OVERDUE', progressPct: 20, elapsedPct: 100 })));
    renderWork(<GoalDetailPage id="g1" />);
    expect(await screen.findByText(/past its target date/i)).toBeInTheDocument();
    expect(screen.getByText(/progress is 20% while 100% of the cycle has passed/i)).toBeInTheDocument();
  });

  it('shows not-found (404) and permission-denied states', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Goal not found' }));
    const { unmount } = renderWork(<GoalDetailPage id="nope" />);
    expect(await screen.findByText(/could not find that record/i)).toBeInTheDocument();
    unmount();
    h.auth = makeAuth({}, [], 'x');
    renderWork(<GoalDetailPage id="g1" />);
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    h.get.mockResolvedValue(one(goal({ risk: 'AT_RISK' })));
    const { container } = renderWork(<GoalDetailPage id="g1" />);
    await screen.findByRole('heading', { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });
});
