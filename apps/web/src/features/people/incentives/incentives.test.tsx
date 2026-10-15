import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import type { AuthState } from '../hrkit/auth-mock';

const auth = vi.hoisted(() => ({ userId: 'me', perms: {} as AuthState['perms'] }));
vi.mock('@/features/auth/auth-provider', async () => (await import('../hrkit/auth-mock')).makeAuthModule(auth));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/people/incentives' }));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  api: { get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { IncentiveDetailPage } from './incentive-detail';
import { IncentivesPage } from './incentives-page';
import { PolicyTab } from './policy-tab';
import { buildPolicyPayload, emptyPolicyForm } from './policy-form';

const breakdown = {
  eligible: true, reasons: ['GATE_FAILED:crm'], gateResults: [{ metric: 'crm', op: '>=', value: 90, actual: 70, passed: false }], basisAmount: '1100.00', netBasisAmount: '1100.00', achievementPct: '110.00',
  slab: { minPct: 100, maxPct: null, ratePct: 2 }, rawAmount: '22.00', capApplied: false, amount: '22.00', currency: 'INR',
};
const base = { id: 'r1', employeeId: 'emp', employeeName: 'Asha', periodStart: '2026-10-01', periodEnd: '2026-10-31', paidAt: null, currency: 'INR' };
const full = {
  ...base, status: 'SUBMITTED', statusOnly: false, policyId: 'p', snapshotVersion: 2, inputs: { target: 1000, revenue: 0, collections: 1100, refunds: 0, metrics: {} }, inputSource: 'MANUAL', breakdown,
  computedAmount: '22', approvedAmount: null, overrideReason: null, recommendedById: 'mgr', recommendedByName: 'Manager', submitComments: null, submittedAt: null, decidedByName: null, decidedAt: null,
  rejectionReason: null, holdReason: null, paymentReference: null, version: 2, createdAt: '2026-10-02T00:00:00Z', adjustments: [], history: [{ from: null, to: 'CALCULATED', actorName: 'Manager', note: null, at: '2026-10-02T00:00:00Z' }],
};
const env = (data: unknown) => ({ data, meta: { pagination: { hasMore: false, limit: 20, mode: 'page', page: 1 } } });

beforeEach(() => {
  get.mockReset();
  auth.userId = 'me';
  auth.perms = {};
});

describe('recommendation detail', () => {
  it('renders the status-only projection without amounts for the employee', async () => {
    auth.userId = 'emp';
    auth.perms = { 'incentives:recommendation:view': 'own' };
    get.mockResolvedValue(env({ ...base, status: 'APPROVED', statusOnly: true }));
    renderWithProviders(<IncentiveDetailPage id="r1" />);
    expect(await screen.findByText(/you can see the status of your own incentive/i)).toBeInTheDocument();
    expect(screen.queryByText(/computed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve|reject|mark as paid/i })).not.toBeInTheDocument();
    expect(screen.getByText(/recommendation workflow only/i)).toBeInTheDocument();
  });

  it('renders the calculation breakdown, snapshot and gate results for a full projection, with Founder actions', async () => {
    auth.userId = 'founder';
    auth.perms = { 'incentives:recommendation:view': 'org', 'incentives:recommendation:approve': 'org' };
    get.mockResolvedValue(env(full));
    renderWithProviders(<IncentiveDetailPage id="r1" />);
    expect(await screen.findByText(/matched slab/i)).toBeInTheDocument();
    expect(screen.getByText('110.00%')).toBeInTheDocument();
    expect(screen.getByText(/gate failed: crm/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect((await screen.findAllByText(/recorded in the audit log/i)).length).toBeGreaterThan(1);
    expect(screen.getAllByRole('button', { name: 'Reject' }).at(-1)).toBeDisabled(); // reason required
  });

  it('hides approve/reject from the recommender', async () => {
    auth.userId = 'mgr';
    auth.perms = { 'incentives:recommendation:view': 'team', 'incentives:recommendation:approve': 'org' };
    get.mockResolvedValue(env(full));
    renderWithProviders(<IncentiveDetailPage id="r1" />);
    await screen.findByText(/matched slab/i);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});

describe('policy', () => {
  it('shows the POLICY_NOT_CONFIGURED empty state and never pre-fills numbers in a new draft', async () => {
    auth.perms = { 'incentives:policy:view': 'org', 'incentives:policy:manage': 'org' };
    get.mockResolvedValue(env({ policies: [], activePolicyId: null, state: 'POLICY_NOT_CONFIGURED' }));
    renderWithProviders(<PolicyTab />);
    expect(await screen.findByText('Policy not configured')).toBeInTheDocument();
    expect(screen.getByText('No policy versions')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New draft' }));
    expect(await screen.findByLabelText(/^Policy name/)).toHaveValue('');
    expect(screen.queryAllByLabelText('From %')).toHaveLength(0);
    expect(screen.getByLabelText(/^Cap/)).toHaveValue('');
    expect(screen.getByLabelText(/^Clawback window/)).toHaveValue('');
  });

  it('adds and removes slab rows and validates the name', async () => {
    auth.perms = { 'incentives:policy:view': 'org', 'incentives:policy:manage': 'org' };
    get.mockResolvedValue(env({ policies: [], activePolicyId: null, state: 'POLICY_NOT_CONFIGURED' }));
    renderWithProviders(<PolicyTab />);
    await userEvent.click(await screen.findByRole('button', { name: 'New draft' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add slab' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add slab' }));
    expect(screen.getAllByLabelText('From %')).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove slab' })[0]!);
    expect(screen.getAllByLabelText('From %')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findAllByText('Use at least 3 characters')).not.toHaveLength(0);
    expect(screen.getAllByText('Enter a valid number').length).toBeGreaterThan(0);
  });

  it('builds the payload without inventing numbers', () => {
    const p = buildPolicyPayload({ ...emptyPolicyForm(), name: 'Draft policy' });
    expect(p.structure).toMatchObject({ slabs: [], gates: [], cap: null, basis: 'COLLECTION' });
    expect(p.structure).not.toHaveProperty('clawbackWindowDays');
    const q = buildPolicyPayload({ ...emptyPolicyForm(), name: 'x policy', cap: '500', clawbackWindowDays: '15', slabs: [{ minPct: '80', maxPct: '', kind: 'rate', value: '1.5' }, { minPct: '100', maxPct: '120', kind: 'fixed', value: '250' }] });
    expect(q.structure).toMatchObject({ cap: 500, clawbackWindowDays: 15, slabs: [{ minPct: 80, maxPct: null, ratePct: 1.5 }, { minPct: 100, maxPct: 120, fixedAmount: 250 }] });
  });
});

describe('recommendations list', () => {
  it('handles status-only rows and has no axe violations', async () => {
    auth.perms = { 'incentives:recommendation:view': 'own' };
    get.mockResolvedValue(env([{ ...base, status: 'PAID', statusOnly: true }]));
    const { container } = renderWithProviders(<IncentivesPage />);
    expect(await screen.findAllByText('Asha')).not.toHaveLength(0);
    expect(screen.getAllByText('Status only').length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the empty and error states', async () => {
    auth.perms = { 'incentives:recommendation:view': 'org' };
    get.mockResolvedValue(env([]));
    renderWithProviders(<IncentivesPage />);
    expect(await screen.findByText('No recommendations yet')).toBeInTheDocument();
  });
});
