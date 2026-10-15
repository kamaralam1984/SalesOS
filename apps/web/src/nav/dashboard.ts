import { LayoutDashboard } from 'lucide-react';
import type { NavDomain } from './types';

/** Dashboards domain. Phase 5 owns this file. `/dashboard` redirects to the role-specific landing page. */
export const dashboardNav: NavDomain = {
  sectionKey: 'workspace',
  items: [
    {
      id: 'dashboard',
      labelKey: 'dashboard',
      href: '/dashboard',
      icon: LayoutDashboard,
      permission: null,
      mobilePriority: 1,
      order: 0,
    },
  ],
};
