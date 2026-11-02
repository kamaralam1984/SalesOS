import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWork } from '@/features/work/test-utils';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), perms: new Set<string>(['devpanel:access', 'devpanel:features:view', 'devpanel:features:manage']) }));
vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: vi.fn(), delete: vi.fn(), patch: vi.fn(), put: h.put },
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ can: (p: string) => h.perms.has(p), user: { id: 'u1' } }),
}));

import { ModulesTab } from './modules-tab';

const list = (attendance: boolean) => ({
  data: {
    modules: [
      { key: 'attendance', label: 'Attendance', description: 'Check in/out and day sheets', enabled: attendance, defaultEnabled: false, permissions: 3 },
      { key: 'payroll', label: 'Payroll', description: 'Payroll runs', enabled: true, defaultEnabled: true, permissions: 7 },
    ],
  },
  meta: {},
});

beforeEach(() => {
  h.get.mockReset();
  h.put.mockReset();
  h.perms = new Set(['devpanel:access', 'devpanel:features:view', 'devpanel:features:manage']);
});

describe('Developer Panel modules tab', () => {
  it('shows Attendance hidden by default and switches it on through the API', async () => {
    h.get.mockResolvedValue(list(false));
    h.put.mockResolvedValue(list(true));
    renderWork(<ModulesTab />);
    const sw = await screen.findByRole('switch', { name: 'Turn Attendance on or off' });
    expect(sw).not.toBeChecked();
    expect(screen.getByText('Hidden by default')).toBeInTheDocument();
    expect(screen.getByText('Sales and CRM always stay on')).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(h.put).toHaveBeenCalledWith('/dev-panel/features/modules/attendance', { enabled: true }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Turn Attendance on or off' })).toBeChecked());
  });

  it('is read-only without devpanel:features:manage', async () => {
    h.perms = new Set(['devpanel:access', 'devpanel:features:view']);
    h.get.mockResolvedValue(list(false));
    renderWork(<ModulesTab />);
    expect(await screen.findByRole('switch', { name: 'Turn Attendance on or off' })).toBeDisabled();
    expect(h.put).not.toHaveBeenCalled();
  });
});
