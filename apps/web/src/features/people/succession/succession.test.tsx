import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import type { AuthState } from '../hrkit/auth-mock';

const auth = vi.hoisted(() => ({ userId: 'me', perms: { 'succession:view': 'org', 'succession:manage': 'org' } as AuthState['perms'] }));
vi.mock('@/features/auth/auth-provider', async () => (await import('../hrkit/auth-mock')).makeAuthModule(auth));
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
import { SuccessionBoard } from './board';
import type { Position } from './api';

const pos = (over: Partial<Position> = {}): Position => ({
  id: 'p', title: 'Sales Team Lead', roleKey: 'SALES_TEAM_LEAD', incumbentId: 'i', incumbentName: 'Priya', notes: null, coverage: 'COVERED',
  readyNow: [{ id: 'c1', userId: 'u1', name: 'Manager A', readiness: 'READY_NOW', developmentActions: [{ title: 'Lead quarterly review', status: 'OPEN' }], notes: null }],
  readyLater: [{ id: 'c2', userId: 'u2', name: 'Manager B', readiness: 'READY_LATER', developmentActions: [], notes: null }], ...over,
});

describe('SuccessionBoard', () => {
  it('shows ready-now and ready-later columns with people, actions and coverage', () => {
    renderWithProviders(<SuccessionBoard positions={[pos()]} onAdd={vi.fn()} onMove={vi.fn()} onRemove={vi.fn()} />);
    const now = screen.getByRole('region', { name: 'Ready now' });
    const later = screen.getByRole('region', { name: 'Ready later' });
    expect(within(now).getByText('Manager A')).toBeInTheDocument();
    expect(within(now).getByText(/Lead quarterly review/)).toBeInTheDocument();
    expect(within(later).getByText('Manager B')).toBeInTheDocument();
    expect(screen.getByText('Covered')).toBeInTheDocument();
    expect(within(now).getByRole('button', { name: 'Move to ready later' })).toBeInTheDocument();
  });
  it('flags a missing bench honestly and hides management controls without succession:manage', () => {
    auth.perms = { 'succession:view': 'org' };
    renderWithProviders(<SuccessionBoard positions={[pos({ coverage: 'NO_BENCH', readyNow: [], readyLater: [], incumbentName: null })]} onAdd={vi.fn()} />);
    expect(screen.getByText('No bench')).toBeInTheDocument();
    expect(screen.getAllByText('Nobody yet')).toHaveLength(2);
    expect(screen.getByText(/vacant/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to bench' })).not.toBeInTheDocument();
  });
});
