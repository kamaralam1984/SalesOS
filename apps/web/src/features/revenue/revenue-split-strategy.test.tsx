import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), can: vi.fn<(p?: unknown) => boolean>(() => true) }));
vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: h.post, patch: h.patch, put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/features/auth/auth-provider', () => {
  const can = (p: string | string[] | null) => (p === null ? true : h.can(p));
  return {
    useAuth: () => ({ can, hasRole: () => true, user: { id: 'u1' } }),
    usePermission: (p: string | string[]) => h.can(p),
    Can: ({ children, permission, fallback = null }: { children: React.ReactNode; permission: string | string[]; fallback?: React.ReactNode }) => (h.can(permission) ? <>{children}</> : <>{fallback}</>),
  };
});
vi.mock('@/features/auth/require-permission', () => ({ RequirePermission: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/revenue/strategy', useSearchParams: () => new URLSearchParams() }));

import { CloseDealDialog } from './deal-dialogs';
import { StrategyPage } from './strategy-page';
import { equalShares, splitState } from './lib';

const AXE = { rules: { region: { enabled: false } } };

describe('splitState / equalShares (pure, exact in hundredths)', () => {
  it('requires a total of exactly 100.00, unique users, positive percentages with at most 2 decimals', () => {
    expect(splitState([{ userId: 'a', sharePct: '60' }, { userId: 'b', sharePct: '40' }]).ok).toBe(true);
    expect(splitState([{ userId: 'a', sharePct: '33.33' }, { userId: 'b', sharePct: '33.33' }, { userId: 'c', sharePct: '33.34' }]).ok).toBe(true);
    const off = splitState([{ userId: 'a', sharePct: '60' }, { userId: 'b', sharePct: '39.99' }]);
    expect(off).toMatchObject({ ok: false, total: '99.99', remaining: '0.01' });
    expect(off.problems).toContain('SUM_NOT_100');
    expect(splitState([{ userId: 'a', sharePct: '50' }, { userId: 'a', sharePct: '50' }]).problems).toContain('DUPLICATE_USER');
    expect(splitState([{ userId: '', sharePct: '100' }]).problems).toContain('USER_MISSING');
    for (const bad of ['0', '-5', '12.345', 'abc', '', '100.01']) expect(splitState([{ userId: 'a', sharePct: bad }]).problems, bad).toContain('SHARE_INVALID');
    expect(splitState([]).problems).toContain('EMPTY');
  });
  it('equal shares always add up to exactly 100.00', () => {
    for (const n of [1, 2, 3, 4, 6, 7, 9, 10]) {
      const rows = equalShares(n).map((sharePct, i) => ({ userId: `u${i}`, sharePct }));
      expect(splitState(rows), String(n)).toMatchObject({ ok: true, total: '100.00' });
    }
    expect(equalShares(3)).toEqual(['33.34', '33.33', '33.33']);
  });
});

describe('close dialog: multi-owner credit split (Team Lead / Founder)', () => {
  const deal = { id: 'd1', amount: '50000.00', ownerId: 'u2', ownerName: 'Exec A1', leadName: 'Asha Rao' };
  beforeEach(() => {
    vi.clearAllMocks();
    h.can.mockImplementation(() => true);
    h.get.mockImplementation(async (path: string) => {
      if (path === '/users') return { data: [{ id: 'u2', name: 'Exec A1', email: 'a1@x', roles: ['SALES_EXECUTIVE'] }, { id: 'u3', name: 'Exec A2', email: 'a2@x', roles: ['SALES_EXECUTIVE'] }], meta: {} };
      if (path === '/leads/meta') return { data: { stages: [], lostReasons: [], sources: [], programs: [], callOutcomes: [], objectionCategories: [], taskTypes: [] }, meta: {} };
      return { data: [], meta: {} };
    });
  });

  it('sends the split only when it adds up to 100%, with the chosen people', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({ data: { id: 'd1', stage: 'WON' }, meta: {} });
    renderWithProviders(<CloseDealDialog open onOpenChange={() => undefined} deal={deal} />);
    await user.click(await screen.findByRole('checkbox', { name: /share credit/i }));
    const box = await screen.findByTestId('credit-split');
    expect(within(box).getByRole('status')).toHaveTextContent(/add up to 100%/i);
    await user.click(within(box).getByRole('button', { name: /add person/i }));
    await user.selectOptions(await within(box).findByLabelText(/credited person 2/i), 'u3');
    await user.clear(within(box).getByLabelText(/share % 1/i));
    await user.type(within(box).getByLabelText(/share % 1/i), '70');
    await user.type(within(box).getByLabelText(/share % 2/i), '20');
    expect(within(box).getByRole('status')).toHaveTextContent('Total 90.00% - 10.00% left to allocate');
    await user.click(screen.getByRole('button', { name: /close as won/i }));
    expect(h.post).not.toHaveBeenCalled();
    await user.clear(within(box).getByLabelText(/share % 2/i));
    await user.type(within(box).getByLabelText(/share % 2/i), '30');
    expect(within(box).getByRole('status')).toHaveTextContent(/add up to 100%/i);
    expect(await axe(document.body, AXE)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: /close as won/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![1]).toEqual({ outcome: 'WON', finalAmount: '50000.00', credits: [{ userId: 'u2', sharePct: '70' }, { userId: 'u3', sharePct: '30' }] });
  }, 30_000);

  it('refuses duplicate people and offers an equal split', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CloseDealDialog open onOpenChange={() => undefined} deal={deal} />);
    await user.click(await screen.findByRole('checkbox', { name: /share credit/i }));
    const box = await screen.findByTestId('credit-split');
    await user.click(within(box).getByRole('button', { name: /add person/i }));
    await user.selectOptions(within(box).getByLabelText(/credited person 2/i), 'u2');
    await user.click(within(box).getByRole('button', { name: /split equally/i }));
    expect(within(box).getByRole('status')).toHaveTextContent(/only once/i);
    await user.click(screen.getByRole('button', { name: /close as won/i }));
    expect(h.post).not.toHaveBeenCalled();
  }, 30_000);

  it('is not offered to people without targets:approve', async () => {
    h.can.mockImplementation((p: unknown) => p !== 'targets:approve');
    renderWithProviders(<CloseDealDialog open onOpenChange={() => undefined} deal={deal} />);
    await screen.findByText(/does not mean the money has arrived/i);
    expect(screen.queryByRole('checkbox', { name: /share credit/i })).not.toBeInTheDocument();
  });
});

describe('strategy plans page', () => {
  const plan = { id: 'sp1', title: 'Q4 enrolment push', summary: 'Concentrate on webinar-to-demo conversion', status: 'ACTIVE', ownerId: 'u1', ownerName: 'Team Lead', periodId: null, periodLabel: null, createdAt: '2026-10-01T05:00:00Z', initiatives: [{ id: 'si1', title: 'Weekly demo slots', notes: 'Two per week', ownerId: 'u1', ownerName: 'Team Lead', status: 'PLANNED', dueOn: '2026-11-30' }] };
  beforeEach(() => {
    vi.clearAllMocks();
    h.can.mockImplementation(() => true);
    h.get.mockImplementation(async (path: string) => (path === '/strategy-plans' ? { data: [plan], meta: {} } : { data: [], meta: {} }));
    h.patch.mockResolvedValue({ data: plan, meta: {} });
    h.post.mockResolvedValue({ data: plan, meta: {} });
  });

  it('lists plans with their initiatives, lets an editor change statuses and add a plan or initiative; is accessible', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StrategyPage />);
    expect(await screen.findByText('Q4 enrolment push')).toBeInTheDocument();
    expect(screen.getByText('Weekly demo slots')).toBeInTheDocument();
    expect(await axe(document.body, AXE)).toHaveNoViolations();
    await user.selectOptions(screen.getByLabelText(/status of weekly demo slots/i), 'IN_PROGRESS');
    await waitFor(() => expect(h.patch).toHaveBeenCalledWith('/strategy-initiatives/si1', { status: 'IN_PROGRESS' }));
    await user.click(screen.getByRole('button', { name: /add initiative/i }));
    await user.click(await screen.findByRole('button', { name: /^add$/i }));
    expect(await screen.findByText(/enter at least 3 characters/i)).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: /^initiative/i }), 'Referral week');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/strategy-plans/sp1/initiatives', { title: 'Referral week' }));
  });

  it('read-only for users without targets:update: no create/edit controls', async () => {
    h.can.mockImplementation((p: unknown) => p !== 'targets:update');
    renderWithProviders(<StrategyPage />);
    expect(await screen.findByText('Q4 enrolment push')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add initiative/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/status of weekly demo slots/i)).not.toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
  });

  it('shows an error state with retry when the API fails', async () => {
    const { ApiError } = await import('@/lib/api/client');
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'INTERNAL', message: 'boom' }));
    renderWithProviders(<StrategyPage />);
    expect(await screen.findByText(/could not load strategy plans/i)).toBeInTheDocument();
  });
});
