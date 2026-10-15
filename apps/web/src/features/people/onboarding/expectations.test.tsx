import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import type { AuthState } from '../hrkit/auth-mock';

const auth = vi.hoisted(() => ({ userId: 'me', perms: {} as AuthState['perms'] }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('@/features/auth/auth-provider', async () => (await import('../hrkit/auth-mock')).makeAuthModule(auth));
vi.mock('@/features/auth/require-permission', () => ({ RequirePermission: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/api/client', async (orig) => ({ ...(await orig<typeof import('@/lib/api/client')>()), api }));

import { ExpectationsTab } from './onboarding-page';

const EXP = [
  { id: 'e1', roleKey: 'SALES_EXECUTIVE', kind: 'OWNERSHIP', title: 'Own your pipeline', body: 'Every lead has a next action.', acknowledgedByMe: false, acknowledgedAt: null, mustAcknowledge: true },
  { id: 'e2', roleKey: 'SALES_EXECUTIVE', kind: 'ACCOUNTABILITY', title: 'Keep promises', body: 'Do what you say.', acknowledgedByMe: true, acknowledgedAt: '2026-10-12T05:00:00Z', mustAcknowledge: true },
  { id: 'e3', roleKey: 'SALES_MANAGER', kind: 'CULTURE', title: 'Coach weekly', body: 'One coaching session a week.', acknowledgedByMe: false, acknowledgedAt: null, mustAcknowledge: false },
];
const AXE = { rules: { region: { enabled: false } } };

beforeEach(() => {
  vi.clearAllMocks();
  auth.perms = { 'onboarding:view': 'own' };
  api.get.mockImplementation(async (path: string) => {
    if (path === '/people/expectations') return { data: EXP, meta: {} };
    if (path === '/people/expectations/adoption') return { data: [{ id: 'e1', roleKey: 'SALES_EXECUTIVE', kind: 'OWNERSHIP', title: 'Own your pipeline', audience: 4, acknowledged: 1, pending: [{ id: 'u3', name: 'Exec A2' }] }], meta: {} };
    return { data: [], meta: {} };
  });
  api.post.mockResolvedValue({ data: { acknowledged: true }, meta: {} });
});

describe('expectations: acknowledgement (JD-HR-009)', () => {
  it('the employee can acknowledge their own role\'s expectation once; others show status or nothing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExpectationsTab />);
    expect(await screen.findByText('Own your pipeline')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /i have read and acknowledge this/i })).toHaveLength(1); // e1 only
    expect(screen.getByTestId('ack-done')).toHaveTextContent(/you acknowledged this on/i); // e2
    expect(await axe(document.body, AXE)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: /i have read and acknowledge this/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/people/expectations/e1/acknowledge', {}));
  });

  it('executives do not see the adoption list; managers and above see counts and who is pending', async () => {
    renderWithProviders(<ExpectationsTab />);
    await screen.findByText('Own your pipeline');
    expect(screen.queryByTestId('ack-adoption')).not.toBeInTheDocument();
  });

  it('adoption panel for team scope', async () => {
    auth.perms = { 'onboarding:view': 'team' };
    renderWithProviders(<ExpectationsTab />);
    const list = await screen.findByTestId('ack-adoption');
    expect(list).toHaveTextContent('1 of 4 acknowledged');
    expect(list).toHaveTextContent('Still to acknowledge: Exec A2');
  });

  it('shows the server error and does not claim success when acknowledging fails', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api/client');
    api.post.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Expectation not found' }));
    renderWithProviders(<ExpectationsTab />);
    await user.click(await screen.findByRole('button', { name: /i have read and acknowledge this/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not find that record/i);
  });
});
