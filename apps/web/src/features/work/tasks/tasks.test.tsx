import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { makeAuth, one, page, renderWork } from '../test-support';
import { taskActions } from './task-logic';

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
import type { WorkTask, WorkTaskDetail } from '@/lib/api/hooks/work-tasks';
import { TaskDetailPage } from './task-detail';
import { TasksPage } from './tasks-page';

const task = (over: Partial<WorkTaskDetail> = {}): WorkTaskDetail => ({
  id: 't1', title: 'Call the stalled leads', description: 'All forty', priority: 'HIGH', status: 'ASSIGNED', project: 'Q4 push', evidence: null, reviewNote: null,
  assignerId: 'mgr', assignerName: 'Tara Lead', assigneeId: 'me', assigneeName: 'Asha Rao', dueAt: '2099-01-01T10:00:00Z', completedAt: null, overdue: false, goalId: null, goalTitle: null,
  version: 2, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  can: { transitions: { ACCEPTED: true, IN_PROGRESS: true, REJECTED: true }, edit: false, comment: true },
  events: [{ id: 'e1', kind: 'CREATED', actorId: 'mgr', actorName: 'Tara Lead', fromStatus: null, toStatus: 'ASSIGNED', note: null, createdAt: '2026-10-01T00:00:00Z' }], ...over,
});
const summary = { total: 3, byStatus: {}, overdue: 1, dueSoon: 1, mine: { open: 2, overdue: 1 }, awaitingMyReview: 1 };
const routeGets = (items: WorkTask[], hasMore = false) =>
  h.get.mockImplementation(async (path: string) => (path.endsWith('/summary') ? one(summary) : page(items, hasMore)));

beforeEach(() => {
  h.get.mockReset(); h.post.mockReset(); h.patch.mockReset(); h.push.mockReset();
  h.auth = makeAuth({ 'work-tasks:view': 'own', 'work-tasks:create': 'own', 'work-tasks:update': 'own', 'goals:view': 'own' }, ['SALES_EXECUTIVE'], 'me');
});

describe('taskActions (buttons from server permissions)', () => {
  it('maps can.transitions to the right buttons per status', () => {
    expect(taskActions({ status: 'ASSIGNED', can: { transitions: { ACCEPTED: true, IN_PROGRESS: true, REJECTED: true }, edit: false, comment: true } }).map((a) => a.key)).toEqual(['ACCEPTED', 'IN_PROGRESS', 'REJECTED']);
    expect(taskActions({ status: 'REVIEW', can: { transitions: { COMPLETED: true, IN_PROGRESS: true, CANCELLED: true }, edit: true, comment: true } }).map((a) => `${a.key}:${a.noteRequired}`)).toEqual(['SEND_BACK:true', 'COMPLETED:false', 'CANCELLED:false']);
    expect(taskActions({ status: 'REJECTED', can: { transitions: { ASSIGNED: true, CANCELLED: true }, edit: true, comment: true } }).map((a) => a.key)).toEqual(['REASSIGN', 'CANCELLED']);
    expect(taskActions({ status: 'COMPLETED', can: { transitions: {}, edit: false, comment: true } })).toEqual([]);
  });
});

describe('TasksPage states', () => {
  it('shows loading, then tasks with overdue/priority/status as text', async () => {
    routeGets([task({ overdue: true, status: 'IN_PROGRESS' })]);
    renderWork(<TasksPage />);
    expect(screen.getAllByRole('status').some((e) => e.getAttribute('aria-busy') === 'true')).toBe(true);
    const link = await screen.findByRole('link', { name: /call the stalled leads/i });
    expect(within(link).getByText('Overdue')).toBeInTheDocument();
    expect(within(link).getByText('High')).toBeInTheDocument();
    expect(within(link).getByText('In progress')).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/work/tasks/t1');
    expect(await screen.findByText('My overdue tasks')).toBeInTheDocument();
  });

  it('shows the empty, filtered-empty, error and permission-denied states', async () => {
    routeGets([]);
    const first = renderWork(<TasksPage />);
    expect(await screen.findByText('No tasks here yet')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Due'), 'overdue');
    expect(await screen.findByText('No tasks match these filters')).toBeInTheDocument();
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/workforce/tasks', expect.objectContaining({ overdue: 'true', view: 'mine' })));
    first.unmount();
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'INTERNAL', message: 'x', requestId: 'req-9' }));
    const second = renderWork(<TasksPage />);
    expect(await screen.findByText('req-9')).toBeInTheDocument();
    second.unmount();
    h.auth = makeAuth({}, [], 'me');
    renderWork(<TasksPage />);
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
  });

  it('view tabs follow permissions', async () => {
    routeGets([task()]);
    const { unmount } = renderWork(<TasksPage />);
    await screen.findByRole('link', { name: /call the stalled leads/i });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['My tasks']);
    unmount();
    h.auth = makeAuth({ 'work-tasks:view': 'team', 'work-tasks:create': 'team', 'work-tasks:update': 'team' }, ['SALES_MANAGER'], 'mgr');
    renderWork(<TasksPage />);
    await screen.findByRole('link', { name: /call the stalled leads/i });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['My tasks', 'Assigned by me', 'Team tasks', 'Everyone I can see']);
  });

  it('creates a task: validates, rejects a past due date, posts, opens it', async () => {
    routeGets([]);
    h.post.mockResolvedValue(one(task({ id: 'new1' })));
    renderWork(<TasksPage />);
    await userEvent.click(await screen.findByRole('button', { name: /new task/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /create task/i }));
    expect(await within(dialog).findByText('Use at least 3 characters')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^task/i), 'Send the brochure');
    const due = within(dialog).getByLabelText(/due date and time/i);
    await userEvent.type(due, '2020-01-01T10:00');
    await userEvent.click(within(dialog).getByRole('button', { name: /create task/i }));
    expect(await within(dialog).findByText('The due date cannot be in the past')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.clear(due);
    await userEvent.click(within(dialog).getByRole('button', { name: /create task/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/tasks', { title: 'Send the brochure', priority: 'MEDIUM' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/work/tasks/new1'));
  });

  it('has no axe violations', async () => {
    routeGets([task(), task({ id: 't2', title: 'Second task', overdue: true })]);
    const { container } = renderWork(<TasksPage />);
    await screen.findByRole('link', { name: /second task/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('TaskDetailPage', () => {
  it('shows details and history', async () => {
    h.get.mockResolvedValue(one(task({ goalId: 'g1', goalTitle: 'Enrol thirty learners' })));
    renderWork(<TaskDetailPage id="t1" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Call the stalled leads' })).toBeInTheDocument();
    expect(screen.getAllByText('Tara Lead').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Enrol thirty learners' })).toHaveAttribute('href', '/work/goals/g1');
    expect(screen.getByRole('list', { name: 'History' })).toBeInTheDocument();
  });

  it('the assignee accepts with the current version', async () => {
    h.get.mockResolvedValue(one(task()));
    h.post.mockResolvedValue(one(task({ status: 'ACCEPTED' })));
    renderWork(<TaskDetailPage id="t1" />);
    await userEvent.click(await screen.findByRole('button', { name: /^accept$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/tasks/t1/transition', { to: 'ACCEPTED', version: 2 }));
    expect(await screen.findByText('Task accepted')).toBeInTheDocument();
  });

  it('declining needs a reason and sends it', async () => {
    h.get.mockResolvedValue(one(task()));
    h.post.mockResolvedValue(one(task({ status: 'REJECTED' })));
    renderWork(<TaskDetailPage id="t1" />);
    await userEvent.click(await screen.findByRole('button', { name: /^decline$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    expect(await within(dialog).findByText('Write at least 3 characters')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'No capacity this week');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/tasks/t1/transition', { to: 'REJECTED', version: 2, note: 'No capacity this week' }));
  });

  it('review: the assigner can complete or send back (note required); the assignee only sees no completion', async () => {
    h.auth = makeAuth({ 'work-tasks:view': 'team', 'work-tasks:update': 'team' }, ['SALES_MANAGER'], 'mgr');
    h.get.mockResolvedValue(one(task({ status: 'REVIEW', evidence: 'Sheet in drive', can: { transitions: { COMPLETED: true, IN_PROGRESS: true, CANCELLED: true }, edit: true, comment: true } })));
    h.post.mockResolvedValue(one(task({ status: 'COMPLETED' })));
    renderWork(<TaskDetailPage id="t1" />);
    expect(await screen.findByText('Sheet in drive')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /send back/i }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    expect(await within(dialog).findByText('Write at least 3 characters')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /mark complete/i }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/tasks/t1/transition', { to: 'COMPLETED', version: 2 }));
  });

  it('a conflict is shown inside the dialog and success is not claimed', async () => {
    h.get.mockResolvedValue(one(task()));
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'ILLEGAL_TRANSITION', message: 'Cannot move a task from COMPLETED to ACCEPTED' }));
    renderWork(<TaskDetailPage id="t1" />);
    await userEvent.click(await screen.findByRole('button', { name: /^accept$/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    expect(await within(dialog).findByText(/cannot move a task/i)).toBeInTheDocument();
    expect(screen.queryByText('Task accepted')).not.toBeInTheDocument();
  });

  it('a finished task offers no actions; commenting posts the note', async () => {
    h.get.mockResolvedValue(one(task({ status: 'COMPLETED', completedAt: '2026-10-05T00:00:00Z', can: { transitions: {}, edit: false, comment: true } })));
    h.post.mockResolvedValue(one(task({ status: 'COMPLETED' })));
    renderWork(<TaskDetailPage id="t1" />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /accept|start work|decline|mark complete/i })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'Thanks all');
    await userEvent.click(screen.getByRole('button', { name: /post comment/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/tasks/t1/comment', { note: 'Thanks all' }));
  });

  it('viewers who cannot comment are told so; overdue tasks explain it', async () => {
    h.get.mockResolvedValue(one(task({ overdue: true, can: { transitions: {}, edit: false, comment: false } })));
    renderWork(<TaskDetailPage id="t1" />);
    expect(await screen.findByText('This task is overdue')).toBeInTheDocument();
    expect(screen.getByText(/can read this task but not comment/i)).toBeInTheDocument();
  });

  it('shows not-found and permission-denied states', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Task not found' }));
    const { unmount } = renderWork(<TaskDetailPage id="nope" />);
    expect(await screen.findByText(/could not find that record/i)).toBeInTheDocument();
    unmount();
    h.auth = makeAuth({}, [], 'x');
    renderWork(<TaskDetailPage id="t1" />);
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    h.get.mockResolvedValue(one(task({ overdue: true })));
    const { container } = renderWork(<TaskDetailPage id="t1" />);
    await screen.findByRole('heading', { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });
});
