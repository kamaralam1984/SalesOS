import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWork } from '@/features/work/test-utils';
import { allNavItems } from '@/nav/registry';
import { ROLE_KEYS } from '@/lib/api/types';
import { ROLE_NAV_SCOPE } from '../role-guide-access';
import { GUIDE_MODULES, GUIDE_ROLES } from '../role-guide-content';

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'u1' } }),
}));

import { RolesTab } from './roles-tab';

const navIds = new Set(allNavItems().flatMap((i) => [i.id, ...(i.children ?? []).map((c) => c.id)]));

describe('Developer Panel role guide', () => {
  it('describes every role and only pages that exist in the nav registry', () => {
    expect(GUIDE_ROLES.map((r) => r.role).sort()).toEqual([...ROLE_KEYS].sort());
    for (const mod of GUIDE_MODULES) expect(navIds.has(mod.id), `${mod.id} is not in the nav registry`).toBe(true);
  });

  it('has a description for every page any role can see', () => {
    const described = new Set(GUIDE_MODULES.map((m) => m.id));
    for (const [role, pages] of Object.entries(ROLE_NAV_SCOPE)) {
      for (const id of Object.keys(pages)) expect(described.has(id), `${role}: no guide text for ${id}`).toBe(true);
    }
  });

  it('shows the pages of the selected role, with scope, and switches role', () => {
    renderWork(<RolesTab />);
    // default role: Sales Executive. Own scope, no payroll, no imports
    expect(screen.getByText('Follow-up calendar')).toBeInTheDocument();
    expect(screen.queryByText('Payroll')).not.toBeInTheDocument();
    expect(screen.queryByText('Imports')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'FOUNDER_CEO' } });
    expect(screen.getByText('Payroll')).toBeInTheDocument();
    expect(screen.getByText('Imports')).toBeInTheDocument();
    // the three workflows asked about are always shown
    const flows = screen.getByRole('region', { name: 'Key workflows' });
    for (const title of ['Attendance', 'Goals (45-day cycle)', 'Sales plan (campaign plans)']) expect(within(flows).getByText(title)).toBeInTheDocument();
  });
});
