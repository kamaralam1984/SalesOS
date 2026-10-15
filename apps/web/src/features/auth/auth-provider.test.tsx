import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { AuthProvider, Can, usePermission } from './auth-provider';
import { setCsrfToken } from '@/lib/api/client';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/users',
  useSearchParams: () => new URLSearchParams(),
}));

const me = {
  user: {
    id: 'u1',
    organizationId: 'o1',
    email: 'a@x.co',
    name: 'Asha',
    isActive: true,
    managerId: null,
    roles: ['SALES_MANAGER'],
  },
  permissions: [
    { key: 'users:view', scope: 'team' },
    { key: 'leads:view', scope: 'own' },
  ],
  scope: {
    organizationId: 'o1',
    teamIds: [],
    directReportCount: 0,
    visibleUserCount: 1,
    delegatedFromUserIds: [],
  },
  csrfToken: 't',
  session: { expiresAt: '2099-01-01T00:00:00Z', idleExpiresAt: '2099-01-01T00:00:00Z' },
};

function Probe() {
  const team = usePermission('users:view', 'team');
  const org = usePermission('users:view', 'org');
  const any = usePermission(['nope:x', 'leads:view']);
  return (
    <ul>
      <li>team:{String(team)}</li>
      <li>org:{String(org)}</li>
      <li>any:{String(any)}</li>
      <Can permission="users:create" fallback={<li>cannot-create</li>}>
        <li>can-create</li>
      </Can>
    </ul>
  );
}

describe('AuthProvider + permission helpers', () => {
  it('derives scope-aware permission checks from /auth/me', async () => {
    setCsrfToken(null);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: me, meta: {}, error: null }), { status: 200 }),
        ),
    );
    renderWithProviders(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('team:true')).toBeInTheDocument());
    expect(screen.getByText('org:false')).toBeInTheDocument();
    expect(screen.getByText('any:true')).toBeInTheDocument();
    expect(screen.getByText('cannot-create')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('redirects to /login (preserving the path) when there is no session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: null,
            meta: {},
            error: { code: 'UNAUTHENTICATED', message: 'no' },
          }),
          { status: 401 },
        ),
      ),
    );
    renderWithProviders(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fadmin%2Fusers'));
    vi.unstubAllGlobals();
  });
});
