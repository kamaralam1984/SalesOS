import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWork } from '@/features/work/test-utils';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), perms: new Set<string>() }));
vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, put: h.put, post: h.post, delete: vi.fn(), patch: vi.fn() },
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ can: (p: string) => h.perms.has(p), user: { id: 'dev1' } }),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { ApiError } from '@/lib/api/client';
import { FeaturesPage } from './features-page';

const row = (key: string, o: Record<string, unknown> = {}) => ({ key, domain: key.split(':')[0], description: `Desc ${key}`, sensitive: false, locked: false, default: null, override: null, effective: null, ...o });
const view = (rows: unknown[], overrides = 0) => ({ data: { subject: { type: 'ROLE', key: 'SALES_EXECUTIVE', label: 'SALES_EXECUTIVE', roles: ['SALES_EXECUTIVE'] }, overrides, total: rows.length, enabled: 1, permissions: rows } });
const rows = [
  row('leads:view', { default: 'own', effective: 'own' }),
  row('payroll:run:view', { sensitive: true }),
  row('devpanel:access', { locked: true, sensitive: true }),
];

beforeEach(() => {
  h.get.mockReset(); h.put.mockReset(); h.post.mockReset();
  h.perms = new Set(['devpanel:access', 'devpanel:features:view', 'devpanel:features:manage']);
  h.get.mockImplementation(async (path: string) => (path.endsWith('/summary') ? { data: { subjects: [] } } : view(rows)));
});

describe('Developer Panel / Feature access page', () => {
  it('shows each screen switched by what the role has, and turning one off sends one OFF change', async () => {
    h.put.mockResolvedValue(view([row('leads:view', { default: 'own', effective: null, override: { effect: 'DENY', scope: null } }), rows[1], rows[2]], 1));
    renderWork(<FeaturesPage />);
    const leads = (await screen.findAllByRole('switch', { name: 'Leads' }))[0]!;
    expect(leads).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Payroll' })).not.toBeChecked();
    await userEvent.click(leads);
    await waitFor(() => expect(h.put).toHaveBeenCalledWith('/dev-panel/features', { subjectType: 'ROLE', subject: 'SALES_EXECUTIVE', changes: [{ permissionKey: 'leads:view', state: 'OFF' }] }));
    expect((await screen.findAllByText('Customised')).length).toBeGreaterThan(0);
  });

  it('a sensitive grant asks for confirmation before it is sent again with confirmSensitive', async () => {
    h.put.mockRejectedValueOnce(new ApiError({ status: 409, code: 'CONFIRM_SENSITIVE', message: 'confirm', details: [{ path: 'payroll:run:view', message: 'sensitive' }] }));
    h.put.mockResolvedValueOnce(view([rows[0], row('payroll:run:view', { sensitive: true, effective: 'own', override: { effect: 'GRANT', scope: 'own' } }), rows[2]], 1));
    renderWork(<FeaturesPage />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Payroll' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('payroll:run:view')).toBeInTheDocument();
    expect(h.put).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, grant' }));
    await waitFor(() => expect(h.put).toHaveBeenLastCalledWith('/dev-panel/features', expect.objectContaining({ confirmSensitive: true, changes: [{ permissionKey: 'payroll:run:view', state: 'ON', scope: 'own' }] })));
  });

  it('is read-only without the manage permission, and hides locked developer features', async () => {
    h.perms = new Set(['devpanel:access', 'devpanel:features:view']);
    renderWork(<FeaturesPage />);
    expect((await screen.findAllByRole('switch', { name: 'Leads' }))[0]).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'All features' }));
    expect(screen.queryByText('Desc devpanel:access')).not.toBeInTheDocument();
    expect(screen.getByText('Desc leads:view')).toBeInTheDocument();
  });

  it('blocks the page without the view permission', () => {
    h.perms = new Set(['devpanel:access']);
    renderWork(<FeaturesPage />);
    expect(h.get).not.toHaveBeenCalled();
  });
});
