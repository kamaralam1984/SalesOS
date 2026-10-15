import { BookOpenCheck } from 'lucide-react';
import type { NavDomain } from './types';

/** SOP centre (Phase 6 owns this file). */
export const sopNav: NavDomain = {
  sectionKey: 'organisation',
  items: [
    {
      id: 'sop',
      labelKey: 'sop',
      href: '/sop',
      icon: BookOpenCheck,
      permission: 'sop:view',
      mobilePriority: null,
      order: 31,
      children: [
        { id: 'sop.adoption', labelKey: 'sopAdoption', href: '/sop/adoption', permission: 'sop:adoption:view' },
        { id: 'sop.gaps', labelKey: 'sopGaps', href: '/sop/gaps', permission: 'sop:gaps:view' },
        { id: 'sop.approvals', labelKey: 'sopApprovals', href: '/sop/approvals', permission: 'sop:approve' },
      ],
    },
  ],
};
