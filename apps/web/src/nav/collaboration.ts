import { MessagesSquare } from 'lucide-react';
import type { NavDomain } from './types';

/** Cross-functional collaboration (Phase 7 owns this file). */
export const collaborationNav: NavDomain = {
  sectionKey: 'organisation',
  items: [
    {
      id: 'collaboration',
      labelKey: 'collaboration',
      href: '/collaboration',
      icon: MessagesSquare,
      permission: 'xf-tasks:view',
      mobilePriority: null,
      order: 41,
      children: [
        { id: 'collaboration.plans', labelKey: 'collabPlans', href: '/collaboration/plans', permission: 'xf-tasks:view' },
        { id: 'collaboration.insights', labelKey: 'collabInsights', href: '/collaboration/insights', permission: 'insights:share' },
      ],
    },
  ],
};
