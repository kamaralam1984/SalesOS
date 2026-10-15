import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';

const h = vi.hoisted(() => ({ path: '/crm/tasks', perms: new Set<string>() }));
vi.mock('next/navigation', () => ({ usePathname: () => h.path }));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ can: (p: string | string[] | null) => p === null || (Array.isArray(p) ? p : [p]).some((k) => h.perms.has(k)) }),
}));

import { Sidebar } from './sidebar';

describe('Sidebar sub-navigation', () => {
  it('renders the permitted sub-pages of the section the user is in, marks the current one, hides the rest', () => {
    h.path = '/crm/tasks';
    h.perms = new Set(['leads:view', 'tasks:view', 'settings:view']);
    renderWithProviders(<Sidebar />);
    const sub = screen.getByTestId('subnav-crm');
    expect(within(sub).getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    expect(within(sub).getByRole('link', { name: 'Leads' })).toBeInTheDocument();
    expect(within(sub).getByRole('link', { name: 'Follow-up calendar' })).toBeInTheDocument();
    expect(within(sub).queryByRole('link', { name: /reassignment/i })).toBeNull(); // no leads:reassignment-queue:resolve
    // the parent item is not marked current while a child is
    const parent = screen.getByRole('link', { name: 'Leads and CRM' });
    expect(parent).not.toHaveAttribute('aria-current');
  });

  it('does not expand sections the user is not in', () => {
    h.path = '/dashboard/executive';
    h.perms = new Set(['leads:view', 'tasks:view']);
    renderWithProviders(<Sidebar />);
    expect(screen.queryByTestId('subnav-crm')).toBeNull();
  });
});
