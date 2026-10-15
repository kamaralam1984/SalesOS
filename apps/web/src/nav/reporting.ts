import { BarChart3 } from 'lucide-react';
import type { NavDomain } from './types';

/** Reporting (Phase 5): reports, KPI dictionary, reconciliation, exports. Founder reporting (Phase 7) lives under the CX nav. */
export const reportingNav: NavDomain = {
  sectionKey: 'insights',
  items: [
    {
      id: 'reporting',
      labelKey: 'reporting',
      href: '/reporting',
      icon: BarChart3,
      permission: ['reports:view', 'kpi:view', 'kpi:definitions:view'],
      mobilePriority: 4,
      order: 50,
      children: [
        { id: 'reporting.follow-ups', labelKey: 'reportingFollowUps', href: '/reporting/follow-ups', permission: 'reports:view' },
        { id: 'reporting.conversions', labelKey: 'reportingConversions', href: '/reporting/conversions', permission: 'reports:view' },
        { id: 'reporting.funnel', labelKey: 'reportingFunnel', href: '/reporting/funnel', permission: 'reports:view' },
        { id: 'reporting.revenue', labelKey: 'reportingRevenue', href: '/reporting/revenue', permission: 'kpi:view' },
        { id: 'reporting.team', labelKey: 'reportingTeam', href: '/reporting/team-performance', permission: 'reports:view' },
        { id: 'reporting.founder', labelKey: 'reportingFounder', href: '/reporting/monthly-founder', permission: 'reports:view' },
        { id: 'reporting.reconciliation', labelKey: 'reportingReconciliation', href: '/reporting/reconciliation', permission: 'reports:view' },
        { id: 'reporting.kpis', labelKey: 'reportingKpis', href: '/reporting/kpis', permission: 'kpi:definitions:view' },
        { id: 'reporting.exports', labelKey: 'reportingExports', href: '/reporting/exports', permission: 'reports:export' },
      ],
    },
  ],
};
