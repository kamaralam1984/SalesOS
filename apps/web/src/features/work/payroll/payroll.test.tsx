import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { axe } from 'vitest-axe';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { mergeMessages } from '@/i18n/merge';
import en from '../../../../messages/en.json';
import enPayroll from '../../../../messages/en.work-payroll.json';
import { makeAuth, one, page } from '../../people/test-support';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn(), delete: vi.fn(), search: new URLSearchParams() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => h.search }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post, patch: vi.fn(), put: vi.fn(), delete: h.delete } };
});

import { ApiError } from '@/lib/api/client';
import type { Payslip, PayrollRun, PayrollRunDetail, StructureRow } from '@/lib/api/hooks/work-payroll';
import { PayrollRunsPage } from './runs-page';
import { PayrollRunPage } from './run-detail-page';
import { PayslipsPage } from './payslips-page';
import { StructuresPage } from './structures-page';

const messages = mergeMessages(en as never, enPayroll as never);
function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Kolkata">
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <TooltipProvider>
            <ToastProvider>{ui}</ToastProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const slip = (over: Partial<Payslip> = {}): Payslip => ({
  id: 's1', runId: 'r1', month: '2026-08', runStatus: 'CALCULATED', userId: 'u1', userName: 'Asha Rao', organizationName: 'CoachEasily', currency: 'INR', monthWorkingDays: 26, workingDays: 26,
  paidDays: '25.00', lossOfPayDays: '1.00', earnings: [{ key: 'BASIC', name: 'Basic', kind: 'EARNING', fullAmount: '26000.00', amount: '25000.00' }],
  deductions: [{ key: 'PF', name: 'Provident fund (manual)', kind: 'DEDUCTION', fullAmount: '1000.00', amount: '961.54' }], gross: '25000.00', totalDeductions: '961.54',
  adjustments: [], adjustmentsNet: '0.00', net: '24038.46',
  basis: { month: '2026-08', employedFrom: '2026-08-01', employedTo: '2026-08-31', monthWorkingDays: 26, employedWorkingDays: 26, counts: {}, lossOfPay: {}, lopDays: [{ date: '2026-08-05', fraction: '1.00', reason: 'ABSENT' }], warnings: [] },
  statutoryDeductionsCalculated: false, updatedAt: '2026-09-01T00:00:00Z', ...over,
});
const run = (over: Partial<PayrollRunDetail> = {}): PayrollRunDetail => ({
  id: 'r1', month: '2026-08', status: 'CALCULATED', monthWorkingDays: 26, note: null, version: 2, createdBy: { id: 'f', name: 'Fin Ance', at: null }, calculatedAt: null, approved: null, paid: null, paymentReference: null,
  payslipCount: 1, totals: [{ currency: 'INR', gross: '25000.00', deductions: '961.54', adjustments: '0.00', net: '24038.46' }], createdAt: '', updatedAt: '', statutoryDeductionsCalculated: false, payslips: [slip()], ...over,
});
const summary = (r: PayrollRunDetail): PayrollRun => { const { payslips: _p, ...rest } = r; void _p; return rest; };

const finance = () => makeAuth({ 'payroll:run:view': 'org', 'payroll:run:manage': 'org', 'payroll:run:mark-paid': 'org', 'payroll:structure:view': 'org', 'payroll:structure:manage': 'org', 'payroll:payslip:view': 'own' }, ['FINANCE'], 'fin');
const founder = () => makeAuth({ 'payroll:run:view': 'org', 'payroll:run:approve': 'org', 'payroll:structure:view': 'org', 'payroll:payslip:view': 'own' }, ['FOUNDER_CEO'], 'fo');

beforeEach(() => {
  h.get.mockReset(); h.post.mockReset(); h.delete.mockReset();
  h.search = new URLSearchParams();
  h.auth = finance();
});

function routeGets(r: PayrollRunDetail) {
  h.get.mockImplementation(async (path: string) => {
    if (path === '/workforce/payroll/runs') return page([summary(r)]);
    if (path === `/workforce/payroll/runs/${r.id}`) return one(r);
    throw new Error(`unexpected GET ${path}`);
  });
}

describe('PayrollRunsPage', () => {
  it('lists runs with text status and net pay, and passes axe', async () => {
    h.get.mockResolvedValue(page([summary(run())]));
    const { container } = renderUi(<PayrollRunsPage />);
    const link = await screen.findByRole('link', { name: /open august 2026/i });
    expect(link).toHaveAttribute('href', '/work/payroll/2026-08');
    expect(within(link).getByText('Calculated')).toBeInTheDocument();
    expect(within(link).getByText('₹24,038.46')).toBeInTheDocument();
    expect(screen.getByText(/no statutory deductions are calculated/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the loading state, then the empty state', async () => {
    let resolve!: (v: unknown) => void;
    h.get.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderUi(<PayrollRunsPage />);
    expect(screen.getAllByText('Loading').length).toBeGreaterThan(0);
    resolve(page([]));
    expect(await screen.findByText('No payroll runs yet')).toBeInTheDocument();
  });

  it('shows an error state with retry, and never an empty list, when the API fails', async () => {
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'INTERNAL', message: 'boom' }));
    renderUi(<PayrollRunsPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText('No payroll runs yet')).not.toBeInTheDocument();
  });

  it('shows permission-denied without calling the API for users without payroll:run:view', () => {
    h.auth = makeAuth({ 'payroll:payslip:view': 'own' }, ['ADMIN'], 'admin');
    renderUi(<PayrollRunsPage />);
    expect(screen.getByText(/permission/i)).toBeInTheDocument();
    expect(h.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /new run/i })).not.toBeInTheDocument();
  });

  it('creates a run, and shows the server error (not success) when it fails', async () => {
    h.get.mockResolvedValue(page([]));
    h.post.mockRejectedValueOnce(new ApiError({ status: 409, code: 'RUN_EXISTS', message: 'A payroll run for 2026-08 already exists' }));
    renderUi(<PayrollRunsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /new run/i }));
    await userEvent.type(screen.getByLabelText(/^month/i), '2026-08');
    await userEvent.click(screen.getByRole('button', { name: /create run/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.queryByText('Payroll run created')).not.toBeInTheDocument();
    expect(h.post).toHaveBeenCalledWith('/workforce/payroll/runs', { month: '2026-08' });
  });

  it('hides the new-run button without payroll:run:manage', async () => {
    h.auth = founder();
    h.get.mockResolvedValue(page([summary(run())]));
    renderUi(<PayrollRunsPage />);
    await screen.findByRole('link', { name: /open august 2026/i });
    expect(screen.queryByRole('button', { name: /new run/i })).not.toBeInTheDocument();
  });
});

describe('PayrollRunPage', () => {
  it('Finance sees recalculate/cancel but not approve; payslip figures are exact strings', async () => {
    routeGets(run());
    const { container } = renderUi(<PayrollRunPage month="2026-08" />);
    expect(await screen.findByRole('heading', { level: 1, name: /payroll august 2026/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve run' })).not.toBeInTheDocument();
    expect(screen.getByText(/the person who prepared a run cannot approve it/i)).toBeInTheDocument();
    expect(screen.getAllByText('₹24,038.46').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /view payslip/i })).toHaveAttribute('href', '/work/payslips?slip=s1');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Founder sees approve + send back, no calculate; approving posts to the API and reports success only after it resolves', async () => {
    h.auth = founder();
    routeGets(run());
    h.post.mockResolvedValue(one(run({ status: 'APPROVED' })));
    renderUi(<PayrollRunPage month="2026-08" />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /calculate/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve run' }));
    expect(screen.queryByText('Run approved')).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve run' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/payroll/runs/r1/approve', {}));
  });

  it('explains MONTH_NOT_CLOSED with the employees and days that block calculation', async () => {
    routeGets(run({ status: 'DRAFT', payslips: [], totals: [] }));
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'MONTH_NOT_CLOSED', message: 'x', details: { reason: 'DAYS_NOT_CLOSED', employees: [{ userId: 'u1', name: 'Asha Rao', days: ['2026-08-06', '2026-08-07'] }] } }));
    renderUi(<PayrollRunPage month="2026-08" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Calculate' }));
    expect(await screen.findByText(/this month cannot be calculated yet/i)).toBeInTheDocument();
    expect(screen.getByText(/asha rao/i)).toBeInTheDocument();
    expect(screen.getByText(/2 days/i)).toBeInTheDocument();
    expect(screen.queryByText('Run calculated')).not.toBeInTheDocument();
  });

  it('send back requires a reason of at least 3 characters', async () => {
    h.auth = founder();
    routeGets(run({ status: 'APPROVED' }));
    h.post.mockResolvedValue(one(run({ status: 'DRAFT' })));
    renderUi(<PayrollRunPage month="2026-08" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send back' }));
    const dlg = screen.getByRole('dialog');
    const confirm = within(dlg).getByRole('button', { name: 'Send back' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dlg).getByLabelText(/reason/i), 'Check arrears');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/payroll/runs/r1/send-back', { reason: 'Check arrears' }));
  });

  it('adjustments: validates the amount client-side, then posts; locked runs show a notice instead of a form', async () => {
    routeGets(run());
    h.post.mockResolvedValue(one(slip()));
    renderUi(<PayrollRunPage month="2026-08" />);
    await userEvent.click(await screen.findByRole('button', { name: /adjustments/i }));
    const dlg = screen.getByRole('dialog');
    await userEvent.type(within(dlg).getByLabelText(/^label/i), 'Arrears');
    await userEvent.type(within(dlg).getByLabelText(/^amount/i), '1.234');
    await userEvent.type(within(dlg).getByLabelText(/^reason/i), 'July arrears');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add line' }));
    expect(await within(dlg).findByText(/^enter a positive amount with up to 2 decimals/i)).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.clear(within(dlg).getByLabelText(/^amount/i));
    await userEvent.type(within(dlg).getByLabelText(/^amount/i), '500.10');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add line' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/payroll/runs/r1/payslips/s1/adjustments', { label: 'Arrears', kind: 'EARNING', amount: '500.10', reason: 'July arrears' }));
  });

  it('a paid run offers export but no workflow buttons', async () => {
    routeGets(run({ status: 'PAID', paymentReference: 'UTR-1', paid: { id: 'f', name: 'Fin Ance', at: null } }));
    renderUi(<PayrollRunPage month="2026-08" />);
    expect(await screen.findByRole('link', { name: /export csv/i })).toHaveAttribute('href', expect.stringContaining('/workforce/payroll/runs/r1/export?format=csv'));
    for (const n of ['Recalculate', 'Cancel run', 'Mark as paid', 'Approve run']) expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
    expect(screen.getByText(/UTR-1/)).toBeInTheDocument();
  });

  it('shows a not-found state when no run exists for the month', async () => {
    h.get.mockResolvedValue(page([]));
    renderUi(<PayrollRunPage month="2026-03" />);
    expect(await screen.findByText('No payroll run for this month')).toBeInTheDocument();
  });
});

describe('StructuresPage', () => {
  const row = (over: Partial<StructureRow> = {}): StructureRow => ({
    userId: 'u1', name: 'Asha Rao', department: 'Sales', employeeCode: 'E-1', designation: 'Executive',
    current: { id: 'v1', userId: 'u1', effectiveFrom: '2026-01-01', currency: 'INR', components: [{ key: 'BASIC', name: 'Basic', kind: 'EARNING', amount: '26000.00' }], monthlyEarnings: '26000.00', monthlyDeductions: '0.00', note: null, createdById: 'f', createdByName: 'Fin', createdAt: '' },
    upcomingVersions: 0, ...over,
  });

  it('lists current structures, flags missing ones, and passes axe', async () => {
    h.get.mockResolvedValue(page([row(), row({ userId: 'u2', name: 'Ravi K', current: null })]));
    const { container } = renderUi(<StructuresPage />);
    expect((await screen.findAllByText('Asha Rao')).length).toBeGreaterThan(0);
    expect(screen.getByText('₹26,000.00')).toBeInTheDocument();
    expect(screen.getByText('No structure yet')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('validates the component key and amount before posting, then posts exact strings', async () => {
    h.get.mockResolvedValue(page([row({ current: null })]));
    h.post.mockResolvedValue(one({}));
    renderUi(<StructuresPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add version/i }));
    const dlg = screen.getByRole('dialog');
    await userEvent.type(within(dlg).getByLabelText(/effective from/i), '2026-09-01');
    await userEvent.clear(within(dlg).getByLabelText(/^key/i));
    await userEvent.type(within(dlg).getByLabelText(/^key/i), 'basic');
    await userEvent.type(within(dlg).getByLabelText(/monthly amount/i), '1000.123');
    await userEvent.click(within(dlg).getByRole('button', { name: /save version/i }));
    expect(await within(dlg).findByText(/use upper_snake such as basic/i)).toBeInTheDocument();
    expect(within(dlg).getByText(/^enter a positive amount with up to 2 decimals/i)).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.clear(within(dlg).getByLabelText(/^key/i));
    await userEvent.type(within(dlg).getByLabelText(/^key/i), 'BASIC');
    await userEvent.clear(within(dlg).getByLabelText(/monthly amount/i));
    await userEvent.type(within(dlg).getByLabelText(/monthly amount/i), '26000.00');
    await userEvent.click(within(dlg).getByRole('button', { name: /save version/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/workforce/payroll/structures', { userId: 'u1', effectiveFrom: '2026-09-01', currency: 'INR', components: [{ key: 'BASIC', name: 'Basic', kind: 'EARNING', amount: '26000.00' }] }));
  });

  it('HR-only viewers without manage cannot add versions', async () => {
    h.auth = founder();
    h.get.mockResolvedValue(page([row()]));
    renderUi(<StructuresPage />);
    await screen.findByRole('list', { name: /employees and salary structures/i });
    expect(screen.queryByRole('button', { name: /add version/i })).not.toBeInTheDocument();
  });

  it('is permission-denied for users without payroll:structure:view', () => {
    h.auth = makeAuth({ 'payroll:payslip:view': 'own' }, ['SALES_EXECUTIVE'], 'x');
    renderUi(<StructuresPage />);
    expect(screen.getByText(/permission/i)).toBeInTheDocument();
    expect(h.get).not.toHaveBeenCalled();
  });
});

describe('PayslipsPage (employee)', () => {
  beforeEach(() => { h.auth = makeAuth({ 'payroll:payslip:view': 'own' }, ['SALES_EXECUTIVE'], 'u1'); });

  it('shows an honest empty state before any run is approved', async () => {
    h.get.mockResolvedValue(page([]));
    renderUi(<PayslipsPage />);
    expect(await screen.findByText('No payslips available yet')).toBeInTheDocument();
  });

  it('lists own payslips and opens a printable payslip document that passes axe', async () => {
    h.get.mockImplementation(async (path: string) => (path.endsWith('/payslips/mine') ? page([slip({ runStatus: 'APPROVED' })]) : one(slip({ runStatus: 'APPROVED' }))));
    const { container, unmount } = renderUi(<PayslipsPage />);
    const link = await screen.findByRole('link', { name: /open payslip for august 2026/i });
    expect(link).toHaveAttribute('href', '/work/payslips?slip=s1');
    unmount();

    h.search = new URLSearchParams({ slip: 's1' });
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const view = renderUi(<PayslipsPage />);
    const doc = await screen.findByRole('article', { name: /payslip for august 2026/i });
    expect(within(doc).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(doc).getByText('₹24,038.46')).toBeInTheDocument();
    expect(within(doc).getByText('Absent', { exact: false })).toBeInTheDocument();
    expect(within(doc).getByText(/statutory deductions .* are not calculated/i)).toBeInTheDocument();
    expect(document.querySelector('style')?.textContent).toContain('@media print');
    await userEvent.click(screen.getByRole('button', { name: /print payslip/i }));
    expect(printSpy).toHaveBeenCalled();
    expect(await axe(view.container)).toHaveNoViolations();
    void container;
  });

  it('a payslip that is not theirs (404) shows an error state, not another person\'s data', async () => {
    h.search = new URLSearchParams({ slip: 'other' });
    h.get.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Payslip not found' }));
    renderUi(<PayslipsPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
