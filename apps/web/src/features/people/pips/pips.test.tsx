import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { makeAuth, one, page } from '../test-support';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post, patch: h.patch, put: vi.fn(), delete: vi.fn() } };
});

import { ApiError } from '@/lib/api/client';
import { PipDetailPage } from './pip-detail';
import { PipsPage } from './pips-page';
import type { Pip } from './api';

const basePip = (over: Partial<Pip> = {}): Pip => ({
  id: 'p1', employeeId: 'emp', employeeName: 'Asha Rao', createdByName: 'Tara Lead', status: 'PENDING_APPROVAL', reason: 'Revenue below 60% for two months', kpiGaps: [{ key: 'rev', name: 'Revenue', target: 100, actual: 55 }],
  evidence: null, goals: [{ title: 'Reach 80%' }], measures: ['Weekly review'], durationDays: 30, startDate: null, endDate: null, proposedEndDate: null, extensionCount: 0, extensionReason: null,
  approvedByName: null, approvedAt: null, employeeAcknowledgedAt: null, finalReview: null, recommendedAction: null, cancelReason: null, version: 2,
  checkpoints: [{ id: 'c1', title: 'Mid-point', dueDate: '2026-11-01', status: 'PENDING', notes: null, completedAt: null }],
  history: [{ from: null, to: 'DRAFT', actorName: 'Tara Lead', note: null, at: '2026-10-01T00:00:00Z' }, { from: 'DRAFT', to: 'PENDING_APPROVAL', actorName: 'Tara Lead', note: null, at: '2026-10-02T00:00:00Z' }], ...over,
});
const founder = () => makeAuth({ 'pip:view': 'org', 'pip:approve': 'org' }, ['FOUNDER_CEO'], 'founder');

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.patch.mockReset();
  h.auth = founder();
});

describe('PipDetailPage', () => {
  it('shows the restricted banner, stepper, plan and history', async () => {
    h.get.mockResolvedValue(one(basePip()));
    renderWithProviders(<PipDetailPage id="p1" />);
    expect(await screen.findByRole('heading', { level: 1, name: /plan: asha rao/i })).toBeInTheDocument();
    expect(screen.getByText(/restricted hr data/i)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /plan progress/i })).toBeInTheDocument();
    expect(screen.getByText(/waiting for the employee/i)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'History' })).toBeInTheDocument();
  });

  it('renders the "employee acknowledgement required" API error (409 PIP_ACK_REQUIRED) as a clear explanation', async () => {
    h.get.mockResolvedValue(one(basePip()));
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'PIP_ACK_REQUIRED', message: 'The employee must acknowledge the plan before it can start; a reminder was queued' }));
    renderWithProviders(<PipDetailPage id="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: /approve and start/i }));
    await userEvent.click(screen.getAllByRole('button', { name: /approve and start/i }).at(-1)!);
    expect(await screen.findByText(/the employee has not acknowledged the plan/i)).toBeInTheDocument();
    expect(screen.getByText(/a reminder was sent to the employee/i)).toBeInTheDocument();
    expect(h.post).toHaveBeenCalledWith('/people/pips/p1/approve', { decision: 'APPROVE' });
    // dialog stays open: nothing is claimed as started
    expect(screen.queryByText('Plan started')).not.toBeInTheDocument();
  });

  it('offers only the legal, permitted buttons (Founder on ACTIVE: no submit/extend/success)', async () => {
    h.get.mockResolvedValue(one(basePip({ status: 'ACTIVE', startDate: '2026-10-01', endDate: '2026-10-31', employeeAcknowledgedAt: '2026-10-01T00:00:00Z' })));
    renderWithProviders(<PipDetailPage id="p1" />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: /complete as not improved/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel plan/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request extension/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete as improved/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit for approval/i })).not.toBeInTheDocument();
  });

  it('the employee sees an acknowledge button and nothing else', async () => {
    h.auth = makeAuth({ 'pip:view': 'own' }, ['SALES_EXECUTIVE'], 'emp');
    h.get.mockResolvedValue(one(basePip()));
    h.post.mockResolvedValue(one(basePip({ employeeAcknowledgedAt: '2026-10-03T00:00:00Z' })));
    renderWithProviders(<PipDetailPage id="p1" />);
    const btn = await screen.findByRole('button', { name: /acknowledge plan/i });
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    await userEvent.click(btn);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/people/pips/p1/acknowledge', {}));
  });

  it('cancelling requires a reason and explains the consequence', async () => {
    h.get.mockResolvedValue(one(basePip({ status: 'ACTIVE', startDate: '2026-10-01', endDate: '2026-10-31' })));
    h.post.mockResolvedValue(one(basePip({ status: 'CANCELLED' })));
    renderWithProviders(<PipDetailPage id="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: /cancel plan/i }));
    expect(screen.getByText(/cancelled permanently/i)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /cancel plan/i }).at(-1)!);
    expect(await screen.findByText('This field is required')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/^reason/i), 'Employee transferred');
    await userEvent.click(screen.getAllByRole('button', { name: /cancel plan/i }).at(-1)!);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/people/pips/p1/transition', { to: 'CANCELLED', reason: 'Employee transferred' }));
  });

  it('shows not-found and permission-denied states', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'x' }));
    const { unmount } = renderWithProviders(<PipDetailPage id="p1" />);
    expect(await screen.findByText(/could not find that record/i)).toBeInTheDocument();
    unmount();
    h.auth = makeAuth({ 'resources:view': 'org' }, ['ADMIN']);
    renderWithProviders(<PipDetailPage id="p1" />);
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    h.get.mockResolvedValue(one(basePip()));
    const { container } = renderWithProviders(<PipDetailPage id="p1" />);
    await screen.findByRole('heading', { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PipsPage states', () => {
  it('loading then list', async () => {
    h.get.mockResolvedValue(page([basePip()]));
    renderWithProviders(<PipsPage />);
    expect(screen.getAllByRole('status').some((e) => e.getAttribute('aria-busy') === 'true')).toBe(true);
    expect(await screen.findByRole('link', { name: /asha rao/i })).toHaveAttribute('href', '/people/pips/p1');
    expect(screen.getByText(/restricted hr data/i)).toBeInTheDocument();
  });
  it('empty', async () => {
    h.get.mockResolvedValue(page([]));
    renderWithProviders(<PipsPage />);
    expect(await screen.findByText('No improvement plans')).toBeInTheDocument();
  });
  it('error', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'X', message: 'boom' }));
    renderWithProviders(<PipsPage />);
    expect(await screen.findByText(/something went wrong on our side/i)).toBeInTheDocument();
  });
  it('denied for Admin without any request', () => {
    h.auth = makeAuth({ 'resources:view': 'org' }, ['ADMIN']);
    renderWithProviders(<PipsPage />);
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
    expect(h.get).not.toHaveBeenCalled();
  });
  it('only people with pip:create see "New plan"', async () => {
    h.get.mockResolvedValue(page([]));
    renderWithProviders(<PipsPage />);
    await screen.findByText('No improvement plans');
    expect(screen.queryByRole('button', { name: /new plan/i })).not.toBeInTheDocument();
  });
  it('has no axe violations', async () => {
    h.get.mockResolvedValue(page([basePip()]));
    const { container } = renderWithProviders(<PipsPage />);
    await screen.findByRole('link', { name: /asha rao/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
