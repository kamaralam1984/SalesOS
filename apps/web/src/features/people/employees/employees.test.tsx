import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import type { AuthState } from '../hrkit/auth-mock';

const auth = vi.hoisted(() => ({ userId: 'hr', perms: {} as AuthState['perms'] }));
vi.mock('@/features/auth/auth-provider', async () => (await import('../hrkit/auth-mock')).makeAuthModule(auth));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/people/employees' }));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  api: { get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
import { EmployeeDetailPage, EmployeesPage } from './employees-page';

beforeEach(() => { get.mockReset(); });

describe('employee records (HR only)', () => {
  it('is permission-denied for anyone without hr:records:view, and never calls the API', () => {
    auth.perms = { 'coaching:view': 'org', 'reviews:view': 'org' };
    renderWithProviders(<EmployeesPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/do not have access/i);
    expect(get).not.toHaveBeenCalled();
  });
  it('shows the restricted-data banner and the list for HR', async () => {
    auth.perms = { 'hr:records:view': 'org', 'hr:records:manage': 'org' };
    get.mockResolvedValue({ data: [{ id: 'x', userId: 'u', name: 'Ravi', employmentType: 'FULL_TIME', positionTitle: 'Sales Executive', joinDate: '2026-01-05', probationEndDate: null, exitDate: null, exitType: null, exitReason: null, updatedAt: null }], meta: { pagination: { hasMore: false, limit: 25, mode: 'page', page: 1 } } });
    renderWithProviders(<EmployeesPage />);
    expect(screen.getByText('Restricted HR data')).toBeInTheDocument();
    expect(screen.getByText(/written to the audit log/i)).toBeInTheDocument();
    expect((await screen.findAllByText('Ravi')).length).toBeGreaterThan(0);
  });
  it('detail view states it is not an HRMS and is read-only without manage permission', async () => {
    auth.perms = { 'hr:records:view': 'org' };
    get.mockResolvedValue({ data: { id: 'x', userId: 'u', name: 'Ravi', employmentType: 'FULL_TIME', positionTitle: 'Sales Executive', joinDate: '2026-01-05', probationEndDate: null, exitDate: null, exitType: null, exitReason: null, updatedAt: 't' }, meta: {} });
    renderWithProviders(<EmployeeDetailPage id="u" />);
    expect(await screen.findByText(/not an hrms/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save record' })).not.toBeInTheDocument();
  });
});
