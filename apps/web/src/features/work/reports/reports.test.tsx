import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { makeAuth, one } from '@/features/people/test-support';
import { renderWork } from '../test-utils';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams('') }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { ApiError } from '@/lib/api/client';
import { ReportsPage } from './reports-page';

const report = (over: Record<string, unknown> = {}) => ({
  report: 'attendance', title: 'Attendance report',
  columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'employee', label: 'Employee', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'workMinutes', label: 'Worked minutes', type: 'int' }, { key: 'pct', label: 'Share', type: 'pct' }],
  rows: [{ date: '2026-10-14', employee: 'Asha Rao', status: 'PRESENT', workMinutes: 480, pct: 62.5 }, { date: '2026-10-14', employee: 'Ravi Kumar', status: 'ABSENT', workMinutes: null, pct: null }],
  summary: { records: 2, byStatus: { PRESENT: 1, ABSENT: 1 }, attendancePct: 50 },
  truncated: false, rowCap: 10000, scopeLevel: 'org', range: { from: '2026-10-01', to: '2026-10-15' }, filters: { departmentId: null, userId: null, groupBy: null }, ...over,
});
const res = (r: unknown, hasMore = false) => ({ data: r, meta: { pagination: { mode: 'page', page: 1, limit: 25, hasMore, total: 2 } } });
const hr = () => makeAuth({ 'workforce:reports:view': 'org', 'workforce:reports:export': 'org', 'birthdays:view': 'org' }, ['HR'], 'hr');
const route = (r: unknown) => async (path: string) => (path === '/workforce/directory/departments' ? one(['Sales']) : res(r));

beforeEach(() => { h.get.mockReset(); h.auth = hr(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('ReportsPage', () => {
  it('renders the table with a caption, dashes for missing values (never zero), summary and scope text', async () => {
    h.get.mockImplementation(route(report()));
    renderWork(<ReportsPage />);
    expect(await screen.findByRole('table', { name: 'Attendance report' })).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('62.5%')).toBeInTheDocument();
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells.filter((c) => c === '—').length).toBe(2); // null minutes and null pct
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/showing the whole organisation/)).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith('/workforce/reports/attendance', expect.objectContaining({ page: 1, limit: 25 }));
  });
  it('switches report and passes the filters; blocks an inverted date range', async () => {
    h.get.mockImplementation(route(report()));
    renderWork(<ReportsPage />);
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Report'), 'department-performance');
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/workforce/reports/department-performance', expect.objectContaining({ groupBy: 'department' })));
    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'manager');
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/workforce/reports/department-performance', expect.objectContaining({ groupBy: 'manager' })));
    const calls = h.get.mock.calls.length;
    await userEvent.type(screen.getByLabelText('From'), '2026-10-20');
    await userEvent.type(screen.getByLabelText('To'), '2026-10-01');
    expect(await screen.findAllByText('The start date must not be after the end date.')).not.toHaveLength(0);
    expect(h.get.mock.calls.slice(calls).filter(([, q]) => q && (q as { from?: string; to?: string }).from === '2026-10-20' && (q as { to?: string }).to === '2026-10-01')).toHaveLength(0);
  });
  it('hides the birthdays report and the export buttons without the matching permissions', async () => {
    h.auth = makeAuth({ 'workforce:reports:view': 'team' }, ['SALES_MANAGER'], 'm');
    h.get.mockImplementation(route(report({ scopeLevel: 'team' })));
    renderWork(<ReportsPage />);
    await screen.findByRole('table');
    expect(screen.queryByRole('option', { name: 'Birthdays' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument();
    expect(screen.getByText(/showing your team/)).toBeInTheDocument();
  });
  it('shows the empty, truncated and error states', async () => {
    h.get.mockImplementation(route(report({ rows: [], summary: {} })));
    const { unmount } = renderWork(<ReportsPage />);
    expect(await screen.findByText('No rows for these filters')).toBeInTheDocument();
    unmount();
    h.get.mockImplementation(route(report({ truncated: true, rowCap: 1 })));
    const t = renderWork(<ReportsPage />);
    expect(await screen.findByText(/Only the first 1 rows are included/)).toBeInTheDocument();
    t.unmount();
    h.get.mockRejectedValue(new ApiError({ status: 500, code: 'X', message: 'x' }));
    renderWork(<ReportsPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
  it('is denied without workforce:reports:view', () => {
    h.auth = makeAuth({}, []);
    renderWork(<ReportsPage />);
    expect(h.get).not.toHaveBeenCalled();
  });
  it('exports via an authenticated download, reports the row count, and shows a failure honestly', async () => {
    h.get.mockImplementation(route(report()));
    const blob = new Blob(['a,b'], { type: 'text/csv' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, blob: async () => blob, headers: new Headers({ 'content-disposition': 'attachment; filename="workforce_attendance_2026-10-01_2026-10-15.csv"', 'x-row-count': '2', 'x-truncated': 'false' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: { code: 'FORBIDDEN', message: 'No' } }) });
    vi.stubGlobal('fetch', fetchMock);
    const url = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() }));
    renderWork(<ReportsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('Export downloaded: 2 rows. The export is logged.')).toBeInTheDocument();
    const [u, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(u).toContain('/workforce/reports/attendance/export?format=csv');
    expect(init).toMatchObject({ credentials: 'include', cache: 'no-store' });
    await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    expect(await screen.findByText(/not allowed|permission|access/i)).toBeInTheDocument();
  });
  it('has no axe violations', async () => {
    h.get.mockImplementation(route(report()));
    const { container } = renderWork(<ReportsPage />);
    await screen.findByRole('table');
    expect(await axe(container)).toHaveNoViolations();
  });
});
