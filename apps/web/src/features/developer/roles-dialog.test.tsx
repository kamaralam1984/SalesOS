import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from '@salesos/ui';
import { renderWork } from '@/features/work/test-utils';

const h = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: vi.fn(), post: h.post, delete: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'me' } }),
}));

import { ApiError } from '@/lib/api/client';
import { RolesDialog } from './developer-panel';
import type { DevUser } from '@/lib/api/hooks/devpanel';

const user = { id: 'u1', name: 'Asha Rao', email: 'asha@example.test', roles: ['SALES_EXECUTIVE'], isActive: true, activeSessions: 0 } as unknown as DevUser;
const show = () => renderWork(<Dialog open><RolesDialog user={user} onClose={() => undefined} /></Dialog>);

beforeEach(() => { h.post.mockClear(); });

describe('Developer Panel role toggles', () => {
  it('a secondary role switch saves at once with the full role set', async () => {
    h.post.mockResolvedValue({ data: { id: 'u1', roles: ['SALES_EXECUTIVE', 'FINANCE'] } });
    show();
    await userEvent.click(await screen.findByRole('switch', { name: 'Finance' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/dev-panel/users/u1/roles', { roles: ['SALES_EXECUTIVE', 'FINANCE'] }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Finance' })).toBeChecked());
  });

  it('turning another primary role on replaces the current primary in the same request', async () => {
    h.post.mockResolvedValue({ data: { id: 'u1', roles: ['SALES_MANAGER'] } });
    show();
    await userEvent.click(await screen.findByRole('switch', { name: 'Sales Manager' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/dev-panel/users/u1/roles', { roles: ['SALES_MANAGER'] }));
    expect(screen.getByRole('switch', { name: 'Sales Executive' })).not.toBeChecked();
  });

  it('Developer and Founder need an explicit confirmation before they are granted', async () => {
    h.post.mockResolvedValue({ data: { id: 'u1', roles: ['DEVELOPER'] } });
    show();
    await userEvent.click(await screen.findByRole('switch', { name: 'Developer (Super Admin)' }));
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Yes, grant/ }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/dev-panel/users/u1/roles', { roles: ['DEVELOPER'] }));
  });

  it('shows the server error and keeps the switch as it was', async () => {
    h.post.mockRejectedValue(new ApiError({ status: 400, code: 'LAST_FOUNDER_CEO', message: 'Cannot remove the last Founder' }));
    show();
    await userEvent.click(await screen.findByRole('switch', { name: 'Finance' }));
    expect(await screen.findByText('Cannot remove the last Founder')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Finance' })).not.toBeChecked();
  });
});
