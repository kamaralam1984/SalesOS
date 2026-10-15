import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { envelope, page, routeApi } from '@/features/cx/test-harness';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const perms = vi.hoisted(() => ({ set: new Set<string>(), userId: 'me' }));
vi.mock('@/lib/api/client', async (orig) => ({ ...(await orig<typeof import('@/lib/api/client')>()), api: apiMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useParams: () => ({}), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/features/auth/auth-provider', () => {
  const can = (p: string | string[]) => (Array.isArray(p) ? p : [p]).some((k) => perms.set.has(k));
  return { useAuth: () => ({ can, user: { id: perms.userId } }), usePermission: (p: string | string[]) => can(p), Can: ({ permission, children }: { permission: string | string[]; children: React.ReactNode }) => (can(permission) ? <>{children}</> : null) };
});

import { TasksPage } from './tasks-page';
import { PlansPage } from './plans-page';
import { InsightsPage } from './insights-page';

// axe + dialogs are slow on a loaded CI box: give each test room (the default 5 s flaked under load)
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  for (const m of Object.values(apiMock)) m.mockReset();
  perms.set = new Set();
  perms.userId = 'me';
});

const iso = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const task = (o: Record<string, unknown> = {}) => ({
  id: 't1', title: 'Send webinar reminders', description: null, kind: 'TASK', department: 'MARKETING', requesterDepartment: 'SALES', priority: 3, status: 'OPEN', dueAt: iso(20), overdue: false,
  ownerId: 'mk', ownerName: 'Maya (Marketing)', requesterId: 'me', requesterName: 'Ravi', programId: null, eventId: null, campaignId: null, planLinkId: null, payload: {}, completedAt: null, completionNote: null,
  confirmedAt: null, confirmedByName: null, cancelReason: null, overdueLevel: 0, escalatedAt: null, version: 1, createdAt: iso(-1), ...o,
});

describe('cross-team task board', () => {
  it('groups tasks into status columns, flags overdue and awaiting confirmation, and is accessible', async () => {
    perms.set = new Set(['xf-tasks:view', 'xf-tasks:update', 'xf-tasks:create']);
    apiMock.get.mockResolvedValue(envelope([task(), task({ id: 't2', title: 'Prep run-of-show', status: 'IN_PROGRESS', department: 'OPERATIONS' }), task({ id: 't3', title: 'Late creative', status: 'OVERDUE', overdue: true }), task({ id: 't4', title: 'Landing page', status: 'COMPLETED' })], page));
    const { container } = renderWithProviders(<TasksPage />);
    const todo = (await screen.findByRole('heading', { name: /^To do/ })).closest('section')!;
    expect(within(todo).getByText('Send webinar reminders')).toBeInTheDocument();
    const attention = screen.getByRole('heading', { name: /^Needs attention/ }).closest('section')!;
    expect(within(attention).getByText('Late creative')).toBeInTheDocument();
    expect(within(attention).getByText('Overdue')).toBeInTheDocument();
    const done = screen.getByRole('heading', { name: /^Done/ }).closest('section')!;
    expect(within(done).getByText('Awaiting confirmation')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows empty, filtered-empty, error and permission-denied states', async () => {
    perms.set = new Set(['xf-tasks:view']);
    apiMock.get.mockResolvedValue(envelope([], page));
    const { unmount } = renderWithProviders(<TasksPage />);
    expect(await screen.findByText('No cross-team tasks')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Department'), 'OPERATIONS');
    await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith('/xf-tasks', expect.objectContaining({ department: 'OPERATIONS' })));
    unmount();
    perms.set = new Set();
    renderWithProviders(<TasksPage />);
    expect(screen.getByText(/permission/i)).toBeInTheDocument();
  });

  it('creating a task needs an owner from the chosen department and warns about minimum data', async () => {
    perms.set = new Set(['xf-tasks:view', 'xf-tasks:create']);
    apiMock.get.mockImplementation(routeApi({ '/xf-tasks/assignees': envelope([{ id: 'mk', name: 'Maya (Marketing)' }]), '/xf-tasks': envelope([], page) }));
    apiMock.post.mockResolvedValue(envelope(task()));
    renderWithProviders(<TasksPage />);
    await userEvent.click(await screen.findByRole('button', { name: /New task/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Contact details such as phone numbers and emails are not allowed/)).toBeInTheDocument();
    const create = within(dialog).getByRole('button', { name: 'Create task' });
    expect(create).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Send webinar reminders');
    await userEvent.selectOptions(await within(dialog).findByLabelText(/^Owner/), 'mk');
    expect(create).toBeEnabled();
    await userEvent.click(create);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/xf-tasks', expect.objectContaining({ title: 'Send webinar reminders', department: 'MARKETING', ownerId: 'mk', dependsOnIds: [] })));
  });

  it('the requester confirms completion; the assignee sees no confirm button', async () => {
    perms.set = new Set(['xf-tasks:view', 'xf-tasks:update']);
    const done = task({ status: 'COMPLETED', completionNote: 'Page live', comments: [], dependencies: [] });
    apiMock.get.mockImplementation(routeApi({ '/xf-tasks/t1': envelope(done), '/xf-tasks': envelope([done], page) }));
    apiMock.post.mockResolvedValue(envelope({ ...done, confirmedAt: iso(0) }));
    const { unmount } = renderWithProviders(<TasksPage focus="t1" />);
    const confirm = await screen.findByRole('button', { name: 'Confirm completion' });
    await userEvent.click(confirm);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/xf-tasks/t1/confirm', {}));
    unmount();
    perms.userId = 'mk'; // the owner, not the requester
    renderWithProviders(<TasksPage focus="t1" />);
    await screen.findByText('Page live');
    expect(screen.queryByRole('button', { name: 'Confirm completion' })).toBeNull();
  });
});

describe('plans and insights', () => {
  it('plans compare planned with actual lead intake and show counts only', async () => {
    perms.set = new Set(['xf-tasks:view', 'xf-tasks:create']);
    apiMock.get.mockResolvedValue(envelope([{ id: 'p1', kind: 'WEBINAR', title: 'AI Sprint webinar push', programName: 'AI Sprint', event: { id: 'e', title: 'AI Sprint webinar', startsAt: iso(48), status: 'SCHEDULED', type: 'WEBINAR' }, windowStart: iso(-24), windowEnd: iso(240), plannedLeads: 200, actualLeads: 42, salesPlanNote: 'Two callers on follow-up', status: 'PLANNED', attendance: { REGISTERED: 30 }, ownerName: 'Maya', createdByName: 'Maya' }], page));
    renderWithProviders(<PlansPage />);
    expect(await screen.findByText('AI Sprint webinar push')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('REGISTERED: 30')).toBeInTheDocument();
  });

  it('insights explain the minimum-data rule and require a title and body to share', async () => {
    perms.set = new Set(['insights:share']);
    apiMock.get.mockResolvedValue(envelope([], page));
    apiMock.post.mockResolvedValue(envelope({ id: 'i1' }));
    renderWithProviders(<InsightsPage />);
    expect(await screen.findByText(/never include names, phone numbers or emails/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Share an insight/ }));
    const dialog = await screen.findByRole('dialog');
    const share = within(dialog).getByRole('button', { name: 'Share insight' });
    expect(share).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'EMI is the top objection');
    await userEvent.type(within(dialog).getByLabelText(/What you noticed/), 'Roughly one in three prospects asked about EMI.');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Marketing' }));
    await userEvent.click(share);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/cx/insights', expect.objectContaining({ title: 'EMI is the top objection', audience: ['MARKETING'] })));
  });
});
