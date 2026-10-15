import { Smile } from 'lucide-react';
import type { NavDomain } from './types';

/** Customer care, handover and Founder reporting (Phase 7 owns this file). */
export const cxNav: NavDomain = {
  sectionKey: 'organisation',
  items: [
    {
      id: 'cx',
      labelKey: 'cx',
      href: '/cx',
      icon: Smile,
      permission: ['complaints:view', 'handover:view', 'founder-reports:view', 'action-items:view', 'satisfaction:view', 'relationships:view'],
      mobilePriority: null,
      order: 40,
      children: [
        { id: 'cx.complaints', labelKey: 'cxComplaints', href: '/cx/complaints', permission: 'complaints:view' },
        { id: 'cx.escalations', labelKey: 'cxEscalations', href: '/cx/escalations', permission: 'complaints:view' },
        { id: 'cx.relationships', labelKey: 'cxRelationships', href: '/cx/relationships', permission: 'relationships:view' },
        { id: 'cx.satisfaction', labelKey: 'cxSatisfaction', href: '/cx/satisfaction', permission: 'satisfaction:view' },
        { id: 'cx.refunds', labelKey: 'cxRefunds', href: '/cx/refunds', permission: 'refunds:view' },
        { id: 'cx.handovers', labelKey: 'cxHandovers', href: '/cx/handovers', permission: 'handover:view' },
        { id: 'cx.reports', labelKey: 'cxReports', href: '/cx/founder-reports', permission: 'founder-reports:view' },
        { id: 'cx.actionItems', labelKey: 'cxActionItems', href: '/cx/action-items', permission: 'action-items:view' },
        { id: 'cx.risks', labelKey: 'cxRisks', href: '/cx/risks', permission: 'founder-reports:view' },
      ],
    },
  ],
};
