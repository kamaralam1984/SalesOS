import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import type { AuthState } from '../hrkit/auth-mock';

const auth = vi.hoisted(() => ({ userId: 'me', perms: {} as AuthState['perms'] }));
vi.mock('@/features/auth/auth-provider', async () => (await import('../hrkit/auth-mock')).makeAuthModule(auth));
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { PlanCard } from './plan-card';
import type { Plan } from './api';

const plan: Plan = {
  id: 'p', employeeId: 'e', employeeName: 'Ravi', startDate: '2026-10-01', status: 'ACTIVE', progress: { total: 4, done: 1, skipped: 1, pct: 33 },
  items: [
    { id: 'a', title: 'Set up CRM access', category: 'TOOLS', description: null, dueDate: '2026-10-03', status: 'DONE', completedAt: null, notes: null, overdue: false },
    { id: 'b', title: 'Read SOPs', category: 'ONBOARDING', description: null, dueDate: '2026-10-05', status: 'PENDING', completedAt: null, notes: null, overdue: true },
    { id: 'c', title: 'Shadow calls', category: 'TRAINING', description: null, dueDate: '2026-10-20', status: 'SKIPPED', completedAt: null, notes: null, overdue: false },
  ],
};

beforeEach(() => { auth.perms = { 'onboarding:view': 'own' }; });

describe('PlanCard', () => {
  it('renders progress, overdue and skipped flags', () => {
    renderWithProviders(<ul><PlanCard plan={plan} /></ul>);
    expect(screen.getByRole('progressbar', { name: 'Checklist progress' })).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByText('1 of 3 done (33%)')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument();
  });
  it('offers Skip only to managers', () => {
    const { unmount } = renderWithProviders(<ul><PlanCard plan={plan} /></ul>);
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    unmount();
    auth.perms = { 'onboarding:view': 'team', 'onboarding:manage': 'team' };
    renderWithProviders(<ul><PlanCard plan={plan} /></ul>);
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
  });
  it('shows no percentage when nothing is countable', () => {
    renderWithProviders(<ul><PlanCard plan={{ ...plan, items: [], progress: { total: 0, done: 0, skipped: 0, pct: null } }} /></ul>);
    expect(screen.getByText('No countable items')).toBeInTheDocument();
  });
});
