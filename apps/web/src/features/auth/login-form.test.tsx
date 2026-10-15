import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { LoginPage } from './login-form';

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(search),
}));

const envelope = (status: number, data: unknown, error: unknown = null) =>
  new Response(JSON.stringify({ data, meta: {}, error }), { status });

const meOk = {
  user: {
    id: 'u',
    organizationId: 'o',
    email: 'a@x.co',
    name: 'A',
    isActive: true,
    managerId: null,
    roles: ['FOUNDER_CEO'],
  },
  permissions: [],
  scope: {
    organizationId: 'o',
    teamIds: [],
    directReportCount: 0,
    visibleUserCount: 1,
    delegatedFromUserIds: [],
  },
  csrfToken: 'c',
  session: { expiresAt: '2099-01-01T00:00:00Z', idleExpiresAt: '2099-01-01T00:00:00Z' },
};

describe('LoginPage', () => {
  beforeEach(() => {
    replace.mockReset();
    search = '';
  });

  it('shows validation errors without calling the API', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(envelope(401, null, { code: 'UNAUTHENTICATED', message: 'x' }));
    vi.stubGlobal('fetch', f);
    renderWithProviders(<LoginPage />);
    await waitFor(() => expect(f).toHaveBeenCalled()); // /auth/me bootstrap only
    f.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findAllByText('This field is required')).toHaveLength(2);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows an accessible error for bad credentials and stays on the page', async () => {
    const f = vi.fn(async (url: string) =>
      String(url).endsWith('/auth/login')
        ? envelope(401, null, { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' })
        : envelope(401, null, { code: 'UNAUTHENTICATED', message: 'x' }),
    );
    vi.stubGlobal('fetch', f);
    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/work email/i), 'a@x.co');
    await userEvent.type(screen.getByLabelText(/^password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
    expect(replace).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('redirects to the role dashboard after a successful login', async () => {
    let loggedIn = false;
    const f = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth/login')) {
        loggedIn = true;
        return envelope(200, { user: meOk.user, csrfToken: 'c' });
      }
      return loggedIn
        ? envelope(200, meOk)
        : envelope(401, null, { code: 'UNAUTHENTICATED', message: 'x' });
    });
    vi.stubGlobal('fetch', f);
    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/work email/i), 'a@x.co');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Correct-horse-1');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/founder'));
    vi.unstubAllGlobals();
  });

  it('shows the idle logout notice and has no axe violations', async () => {
    search = 'reason=idle';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(envelope(401, null, { code: 'UNAUTHENTICATED', message: 'x' })),
    );
    const { container } = renderWithProviders(<LoginPage />);
    expect(await screen.findByText(/signed out for inactivity/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    vi.unstubAllGlobals();
  });
});
