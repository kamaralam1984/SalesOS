import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  replace: vi.fn(),
  perms: new Set<string>(['reports:export', 'reports:view', 'kpi:view']),
  search: new URLSearchParams(),
}));

vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: h.post, delete: h.del, patch: vi.fn(), put: vi.fn() },
}));
vi.mock('@/features/auth/auth-provider', () => {
  const can = (p: string | string[] | null) => (p === null ? true : (Array.isArray(p) ? p : [p]).some((k) => h.perms.has(k)));
  return {
    useAuth: () => ({ can, hasRole: () => false, user: { id: 'u1' } }),
    usePermission: (p: string | string[]) => can(p),
    Can: ({ children, permission, fallback = null }: { children: React.ReactNode; permission: string | string[]; fallback?: React.ReactNode }) => (can(permission) ? <>{children}</> : <>{fallback}</>),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: h.replace }), usePathname: () => '/dashboard/founder', useSearchParams: () => h.search }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { ApiError } from '@/lib/api/client';
import { FounderDashboard } from './founder-dashboard';
import { ManagerDashboard } from './manager-dashboard';
import { ExecutiveDashboard } from './executive-dashboard';
import { AdminHealth } from './admin-health';
import { KpiTile } from './kpi-tile';
import { ReportPage } from '../reporting/report-page';
import { ReconciliationPage } from '../reporting/reconciliation-page';
import { ExportButtons } from '../reporting/export-buttons';
import type { KpiResult } from '@/lib/api/hooks/analytics';

const fallback = (path: string, scope = 'org') => {
  if (path === '/kpis/filter-options') return { data: { scopeLevel: scope, teams: [], programs: [], sources: [], owners: [] }, meta: {} };
  return { data: [], meta: {} };
};
const AXE = { rules: { region: { enabled: false } } };

const kpi = (id: string, over: Partial<KpiResult> = {}): KpiResult => ({
  id, name: `Name of ${id}`, unit: 'PERCENT', currency: null, status: 'OK', value: '70.7', numerator: '212000.00', denominator: '300000.00', nullReason: null, note: null,
  dateRange: { from: '2026-07-01', to: '2026-07-31', timezone: 'Asia/Kolkata', asOf: '2026-07-31' }, period: { type: 'MONTH', startsOn: '2026-07-01', endsOn: '2026-07-31', label: 'Jul 2026' },
  filters: { applied: {}, ignored: [], scopeLevel: 'org', narrowedByFilter: false },
  definition: { id, summary: 'Booked sales net of refunds as a share of the target.', approvalStatus: 'PROPOSED_DEFAULT_AWAITING_OWNER_APPROVAL', formula: 'actual / target x 100', zeroDenominator: 'No target set -> dash' },
  breakdown: null, caution: null, dataSource: null, isEstimate: false, computedAt: '2026-10-15T05:00:00.000Z', freshness: { kind: 'LIVE', computedAt: '2026-10-15T05:00:00.000Z', dataAsOf: '2026-10-15T05:00:00.000Z', ageSeconds: 0, cadence: 'On request' }, ...over,
});
const targetTiles = (id: string) => ({ month: kpi(id), quarter: kpi(id, { value: null, nullReason: 'NO_TARGET', numerator: '0.00', denominator: null }), year: kpi(id, { value: null, nullReason: 'NO_TARGET', numerator: null, denominator: null }) });

const founderPayload = () => ({
  dashboard: 'founder', generatedAt: '2026-10-15T05:00:00.000Z', dateRange: { from: '2026-07-01', to: '2026-07-31', timezone: 'Asia/Kolkata', asOf: '2026-07-31' }, period: { type: 'MONTH', startsOn: '2026-07-01', endsOn: '2026-07-31', label: 'Jul 2026' }, currency: 'INR',
  filters: { applied: {}, scopeLevel: 'org', narrowedByFilter: false },
  targets: { revenue: targetTiles('KPI-REV-001'), collections: targetTiles('KPI-REV-002'), enrolments: targetTiles('KPI-REV-004') },
  kpis: Object.fromEntries(['KPI-SAL-001', 'KPI-SAL-002', 'KPI-SAL-003', 'KPI-SAL-004', 'KPI-SAL-005', 'KPI-SAL-006', 'KPI-TEA-001', 'KPI-TEA-003', 'KPI-PRD-003', 'KPI-EXC-005', 'KPI-EXC-001', 'KPI-EXC-002', 'KPI-EXC-003', 'KPI-EXC-004', 'KPI-CX-001', 'KPI-CX-002', 'KPI-CX-003', 'KPI-CX-004', 'KPI-FND-001', 'KPI-FND-002', 'KPI-FND-003', 'KPI-PRO-001', 'KPI-PRO-002', 'KPI-TEA-004', 'KPI-TEA-005'].map((id) => [id, kpi(id)])),
  panels: {
    revenueTrend: { status: 'OK', months: [{ month: 'Feb 2026', startsOn: '2026-02-01', endsOn: '2026-02-28', net: '0.00', booked: '0.00', refundsApproved: '0.00', enrolments: 0, wonDeals: 0 }, { month: 'Jul 2026', startsOn: '2026-07-01', endsOn: '2026-07-31', net: '212000.00', booked: '225000.00', refundsApproved: '13000.00', enrolments: 4, wonDeals: 4 }] },
    revenueDaily: { status: 'OK', series: [{ date: '2026-07-01', amount: '0.00', cumulative: '0.00' }, { date: '2026-07-02', amount: '212000.00', cumulative: '212000.00' }] },
    pipeline: { status: 'OK', stages: [{ stage: 'OPEN', deals: 1, amount: '40000.00', weightedAmount: '6000.00', probability: '0.15' }, { stage: 'NEGOTIATION', deals: 1, amount: '100000.00', weightedAmount: '60000.00', probability: '0.6' }, { stage: 'PAYMENT_PENDING', deals: 0, amount: '0.00', weightedAmount: '0.00', probability: '0.85' }] },
    forecastRisk: { status: 'OK', unscheduledDeals: 1, unscheduledAmount: '20000.00', slippedDeals: 2, slippedAmount: '140000.00', note: 'Deals without a future expected close date are not counted.' },
    teamPerformance: { status: 'OK', members: [{ userId: 'm1', name: 'Manager A', role: 'manager', revenueTarget: '150000.00', revenueActual: '140000.00', achievementPct: '93.3', callAttempts: 8, uniqueClients: 6, followUpsCompleted: 3, onTimePct: '40.0', overdueOpen: 2, activeLeads: 3, leadsWon: 1, conversionPct: '16.7' }, { userId: 'm2', name: 'Manager B', role: 'manager', revenueTarget: null, revenueActual: '0.00', achievementPct: null, callAttempts: 0, uniqueClients: 0, followUpsCompleted: 0, onTimePct: null, overdueOpen: 0, activeLeads: 0, leadsWon: 0, conversionPct: null }] },
    risks: { status: 'OK', items: { overdueTasks: 2, unassignedLeads: 1, noNextActionLeads: 0, openComplaints: 3 } },
    founderReport: { status: 'FORBIDDEN', requires: 'founder-reports:view' },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.perms = new Set(['reports:export', 'reports:view', 'kpi:view']);
  h.search = new URLSearchParams();
  h.get.mockImplementation(async (path: string) => {
    if (path === '/dashboard/ceo') return { data: founderPayload(), meta: {} };
    if (path === '/kpis/filter-options') return { data: { scopeLevel: 'org', teams: [{ id: 't1', name: 'Team A' }], programs: [{ id: 'p1', name: 'CBAX', code: 'CBAX' }], sources: [{ id: 's1', name: 'Meta Ads' }], owners: [{ id: 'u9', name: 'Exec A1' }] }, meta: {} };
    if (path === '/reports/saved-filters') return { data: [], meta: {} };
    return { data: null, meta: {} };
  });
});

describe('KpiTile', () => {
  it('shows value, fraction, date range, currency, freshness and filters', () => {
    renderWithProviders(<KpiTile kpi={kpi('KPI-REV-001', { unit: 'CURRENCY', currency: 'INR', value: '212000.00', filters: { applied: { teamId: 'x' }, ignored: ['programId'], scopeLevel: 'team', narrowedByFilter: true } })} />);
    const tile = screen.getByRole('article', { name: 'Name of KPI-REV-001' });
    expect(within(tile).getByText('₹2,12,000')).toBeInTheDocument();
    expect(within(tile).getByText('₹2,12,000 / ₹3,00,000')).toBeInTheDocument();
    expect(within(tile).getByText(/1 Jul 2026 – 31 Jul 2026/)).toBeInTheDocument();
    expect(within(tile).getByText(/INR/)).toBeInTheDocument();
    expect(within(tile).getByText(/Live, computed/)).toBeInTheDocument();
    expect(within(tile).getByText(/filtered by team/)).toBeInTheDocument();
    expect(within(tile).getByText(/not applicable here: program/)).toBeInTheDocument();
  });
  it('a null value is an em dash with the reason, never 0%', () => {
    renderWithProviders(<KpiTile kpi={kpi('KPI-REV-001', { value: null, nullReason: 'NO_TARGET', numerator: '110000.00', denominator: null })} />);
    const tile = screen.getByRole('article');
    expect(within(tile).getByText('—')).toBeInTheDocument();
    expect(within(tile).getByText('No target set for this scope and period')).toBeInTheDocument();
    expect(tile.textContent).not.toMatch(/NaN|Infinity|0%/);
    expect(within(tile).queryByRole('progressbar')).toBeNull();
  });
  it('the definition tooltip opens with formula, zero rule and approval status', async () => {
    const user = userEvent.setup();
    renderWithProviders(<KpiTile kpi={kpi('KPI-REV-001')} />);
    await user.click(screen.getByRole('button', { name: 'Definition of Name of KPI-REV-001' }));
    expect(await screen.findByText('Booked sales net of refunds as a share of the target.')).toBeInTheDocument();
    expect(screen.getByText('actual / target x 100')).toBeInTheDocument();
    expect(screen.getByText('Proposed default, awaiting owner approval')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Full definition' })).toHaveAttribute('href', '/reporting/kpis#KPI-REV-001');
  });
  it('permission-denied, restricted and error states do not show a number', () => {
    renderWithProviders(<><KpiTile kpi={kpi('A', { status: 'FORBIDDEN', value: null })} /><KpiTile kpi={kpi('B', { status: 'RESTRICTED', value: null })} /><KpiTile kpi={kpi('C', { status: 'ERROR', value: null })} /></>);
    expect(screen.getByText('Not available to your role')).toBeInTheDocument();
    expect(screen.getByText('Shown only as an organisation-level aggregate')).toBeInTheDocument();
    expect(screen.getByText('Could not be computed right now')).toBeInTheDocument();
  });
  it('estimates and cautions are labelled; call KPIs name their data source', () => {
    renderWithProviders(<KpiTile kpi={kpi('KPI-PRD-001', { unit: 'COUNT', value: '11', numerator: '11', denominator: null, isEstimate: true, caution: 'Only 2 responses', dataSource: 'MANUAL 11, PROVIDER 1', freshness: { kind: 'CACHED', computedAt: '2026-10-15T05:00:00.000Z', dataAsOf: '2026-10-15T05:00:00.000Z', ageSeconds: 20, cadence: 'x' } })} />);
    expect(screen.getByText('Estimate')).toBeInTheDocument();
    expect(screen.getByText('Only 2 responses')).toBeInTheDocument();
    expect(screen.getByText(/source: MANUAL 11, PROVIDER 1/)).toBeInTheDocument();
    expect(screen.getByText(/Cached, computed/)).toBeInTheDocument();
  });
  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<KpiTile kpi={kpi('KPI-REV-001')} />);
    expect(await axe(container, AXE)).toHaveNoViolations();
  });
});

describe('FounderDashboard', () => {
  it('renders targets, trends, pipeline, team table and risks from the API, never mock numbers', async () => {
    renderWithProviders(<FounderDashboard />);
    expect(screen.getByRole('status')).toBeInTheDocument(); // loading skeleton first
    expect(await screen.findByRole('heading', { name: 'Revenue vs target' })).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith('/dashboard/ceo', expect.objectContaining({ period: 'MONTH' }), expect.anything());
    expect(screen.getAllByText('70.7%').length).toBeGreaterThan(3);
    expect(screen.getByTestId('dashboard-meta').textContent).toMatch(/1 Jul 2026 to 31 Jul 2026 \(IST\)/);
    expect(screen.getAllByText('Open pipeline by stage').length).toBeGreaterThan(0);
    expect(screen.getByText(/2 open deals worth ₹1,40,000/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Manager performance' })).toBeInTheDocument();
    expect(screen.getByText('Overdue tasks')).toBeInTheDocument();
    // unsupported by the role: a labelled panel, not a crash
    expect(screen.getByText('Your role does not include access to this panel.')).toBeInTheDocument();
  });
  it('team achievement without a target shows a dash and the reason (not 0%)', async () => {
    renderWithProviders(<FounderDashboard />);
    await screen.findByRole('table', { name: 'Manager performance' });
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Manager B'))!;
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(row).getByText('No target set')).toBeInTheDocument();
  });
  it('chart has a table toggle and a text summary (accessible alternative)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FounderDashboard />);
    const chart = (await screen.findByText('Net revenue by month')).closest('section')!;
    expect(within(chart).getByText(/Latest month, Jul 2026: ₹2,12,000 net of approved refunds/)).toBeInTheDocument();
    await user.click(within(chart).getByRole('button', { name: /Table/ }));
    expect(within(chart).getByRole('table')).toBeInTheDocument();
  });
  it('filters write to the URL and the dashboard re-queries with them (server still intersects with scope)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FounderDashboard />);
    await screen.findByRole('heading', { name: 'Revenue vs target' });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Team A' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Team'), 't1');
    expect(h.replace).toHaveBeenCalledWith('/dashboard/founder?teamId=t1');
  });
  it('export buttons are shown only to holders of reports:export', async () => {
    renderWithProviders(<FounderDashboard />);
    await screen.findByRole('heading', { name: 'Revenue vs target' });
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
  });
  it('export buttons are hidden without the permission', async () => {
    h.perms = new Set(['reports:view', 'kpi:view']);
    renderWithProviders(<FounderDashboard />);
    await screen.findByRole('heading', { name: 'Revenue vs target' });
    expect(screen.queryByRole('button', { name: /Export CSV/ })).toBeNull();
  });
  it('shows the permission-denied state on 403 and an error with retry otherwise', async () => {
    h.get.mockImplementation(async (path: string) => {
      if (path === '/dashboard/ceo') throw new ApiError({ status: 403, code: 'FORBIDDEN', message: 'no' });
      return fallback(path, 'org');
    });
    const { unmount } = renderWithProviders(<FounderDashboard />);
    expect(await screen.findByText('You do not have access to this area')).toBeInTheDocument();
    unmount();
    h.get.mockImplementation(async (path: string) => {
      if (path === '/dashboard/ceo') throw new ApiError({ status: 500, code: 'INTERNAL', message: 'boom' });
      return fallback(path, 'org');
    });
    renderWithProviders(<FounderDashboard />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<FounderDashboard />);
    await screen.findByRole('heading', { name: 'Revenue vs target' });
    expect(await axe(container, AXE)).toHaveNoViolations();
  }, 20_000);
});

describe('ManagerDashboard / ExecutiveDashboard / AdminHealth', () => {
  it('manager roster comes from the API and explains attempts vs clients', async () => {
    h.get.mockImplementation(async (path: string) => {
      if (path === '/dashboard/manager') return { data: { ...founderPayload(), dashboard: 'manager', panels: { roster: { status: 'OK', members: founderPayload().panels.teamPerformance.members }, risks: { status: 'OK', items: { overdueTasks: 2 } }, callbacks: { status: 'OK', callbacksPending: 3, callbacksOverdue: 1, byOwner: [] }, funnelHealth: { status: 'OK', stages: [] }, kra: { status: 'OK', weekStart: '2026-07-13', assignments: [] }, people: { status: 'OK', coaching: { oneOnOnesHeld: 1, oneOnOnesUpcoming: 0, coachingSessions: 2, openCoachingActions: 0 } } } }, meta: {} };
      return fallback(path, 'team');
    });
    renderWithProviders(<ManagerDashboard />);
    expect(await screen.findByRole('table', { name: 'Team members' })).toBeInTheDocument();
    expect(screen.getByText(/one client called three times counts as 3 attempts and 1 client/i)).toBeInTheDocument();
    expect(screen.getByText('Callbacks pending')).toBeInTheDocument();
    expect(screen.getByText(/No KPI or KRA assignment for the week of 13 Jul 2026/)).toBeInTheDocument();
  });
  it('executive workspace shows incentive STATUS only', async () => {
    h.get.mockImplementation(async (path: string) => {
      if (path === '/dashboard/salesperson') return { data: { ...founderPayload(), dashboard: 'executive', targets: { revenue: targetTiles('KPI-REV-001'), collections: targetTiles('KPI-REV-002') }, panels: { incentive: { status: 'OK', items: [{ periodStart: '2026-06-01', periodEnd: '2026-06-30', status: 'APPROVED', paidAt: null }], note: 'Status only.' }, pipeline: { status: 'OK', stages: [] }, kra: { status: 'OK', weekStart: '2026-07-13', assignments: [] } } }, meta: {} };
      return fallback(path, 'own');
    });
    renderWithProviders(<ExecutiveDashboard />);
    expect(await screen.findByText('Approved incentive status')).toBeInTheDocument();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).toBeNull();
  });
  it('admin health lists operational signals only', async () => {
    h.get.mockImplementation(async () => ({ data: { generatedAt: '2026-10-15T05:00:00.000Z', businessData: false, note: 'x', services: { database: { ok: true, latencyMs: 3 }, redis: { ok: false, latencyMs: 40, error: 'ECONNREFUSED' } }, queues: { outbox: { ok: true, byStatus: { PENDING: 2 } }, imports: { ok: true, byStatus: {} } }, dataQuality: { lastReconciliationAt: '2026-10-15T03:00:00.000Z', checks: 10, passed: 10, failed: 0, skipped: 1, ageMinutes: 120 }, process: { uptimeSeconds: 600, node: 'v24', rssMb: 120, heapUsedMb: 60, env: 'test' } }, meta: {} }));
    renderWithProviders(<AdminHealth />);
    expect(await screen.findByText('Database')).toBeInTheDocument();
    expect(screen.getByText('ECONNREFUSED')).toBeInTheDocument();
    expect(screen.getByText(/operational signals only/i)).toBeInTheDocument();
    expect(screen.getByText('Event outbox')).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('ReportPage', () => {
  const report = (over: Record<string, unknown> = {}) => ({
    report: 'follow-ups', title: 'Follow-up discipline', description: 'd',
    columns: [{ key: 'owner', label: 'Owner', type: 'text' }, { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'onTimePct', label: 'On-time %', type: 'pct' }],
    rows: [{ owner: 'Exec A1', revenue: '110000.00', onTimePct: '33.3' }, { owner: 'Exec B2', revenue: '20000.00', onTimePct: null }],
    rowCount: 2, truncated: false, rowLimit: 500, summary: {}, kpis: [kpi('KPI-PRD-002', { unit: 'COUNT', value: '5' })],
    meta: { dateRange: { from: '2026-07-01', to: '2026-07-31', timezone: 'Asia/Kolkata' }, period: { type: 'MONTH', startsOn: '2026-07-01', endsOn: '2026-07-31', label: 'Jul 2026' }, currency: 'INR', filters: { applied: {}, scopeLevel: 'org', narrowedByFilter: false }, definitions: [{ id: 'KPI-PRD-002', name: 'Follow-ups completed', approvalStatus: 'PROPOSED_DEFAULT_AWAITING_OWNER_APPROVAL' }], computedAt: '2026-10-15T05:00:00.000Z', freshness: { kind: 'LIVE', computedAt: '2026-10-15T05:00:00.000Z' }, detailWithheld: false }, ...over,
  });
  it('renders rows with money, percent and dashes, the KPI strip and definitions', async () => {
    h.get.mockImplementation(async (path: string) => (path === '/reports/follow-ups' ? { data: report(), meta: {} } : fallback(path, 'org')));
    renderWithProviders(<ReportPage reportKey="follow-ups" />);
    expect(await screen.findByRole('table', { name: 'Follow-up discipline' })).toBeInTheDocument();
    expect(screen.getAllByText('₹1,10,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('33.3%').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('not available').length).toBeGreaterThan(0);
    expect(screen.getByText(/KPI definitions behind this report/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Excel/ })).toBeInTheDocument();
  });
  it('tells the user when rows were truncated or withheld by access level', async () => {
    h.get.mockImplementation(async (path: string) => (path === '/reports/follow-ups' ? { data: report({ truncated: true, rowLimit: 500, rows: [], rowCount: 0, meta: { ...report().meta, detailWithheld: true } }), meta: {} } : fallback(path, 'summary')));
    renderWithProviders(<ReportPage reportKey="follow-ups" />);
    expect(await screen.findByText(/Per-person rows are withheld at your access level/)).toBeInTheDocument();
    expect(screen.getByText(/Showing the first 500 rows/)).toBeInTheDocument();
  });
  it('is permission gated in the UI (the API still enforces)', () => {
    h.perms = new Set(['kpi:view']);
    renderWithProviders(<ReportPage reportKey="team-performance" />);
    expect(screen.getByText('You do not have access to this area')).toBeInTheDocument();
  });
});

describe('ReconciliationPage', () => {
  it('shows matches and mismatches with raw vs dashboard values (not colour only)', async () => {
    h.get.mockImplementation(async (path: string) => (path === '/reports/reconciliation' ? { data: { ranAt: '2026-10-15T05:00:00.000Z', dateRange: { from: '2026-07-01', to: '2026-07-31', timezone: 'Asia/Kolkata' }, scope: { level: 'org', orgWide: true }, summary: { total: 2, passed: 1, failed: 1, skipped: 0, allPassed: false, accuracyPct: '50.0' }, checks: [{ id: 'a', name: 'New leads', kpiId: 'KPI-EXC-004', expected: '11', actual: '11', difference: '0', tolerance: '0', status: 'PASS', note: null }, { id: 'b', name: 'Net revenue', kpiId: 'KPI-REV-001', expected: '212000.00', actual: '211000.00', difference: '1000.00', tolerance: '0.01', status: 'FAIL', note: null }], method: 'Independent SQL.', durationMs: 12 }, meta: {} } : fallback(path, 'org')));
    renderWithProviders(<ReconciliationPage />);
    expect(await screen.findByText(/1 checks failed/)).toBeInTheDocument();
    expect(screen.getAllByText('Match').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mismatch').length).toBeGreaterThan(0);
    expect(screen.getAllByText('211000.00').length).toBeGreaterThan(0);
  });
});

describe('ExportButtons', () => {
  it('requests an export through the API with the current filters; the file is not generated client side', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({ data: { id: 'e1', status: 'QUEUED', report: 'funnel', format: 'CSV', rowCount: null, truncated: false, rowCap: 100, fileName: null, downloadable: false }, meta: {} });
    h.get.mockResolvedValue({ data: { id: 'e1', status: 'QUEUED' }, meta: {} });
    renderWithProviders(<ExportButtons report="funnel" params={{ from: '2026-07-01', to: '2026-07-31', teamId: 't1' }} />);
    await user.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/reports/exports', { report: 'funnel', format: 'CSV', params: { from: '2026-07-01', to: '2026-07-31', teamId: 't1' } }));
    expect(await screen.findByText('Preparing the file')).toBeInTheDocument();
  });
});
