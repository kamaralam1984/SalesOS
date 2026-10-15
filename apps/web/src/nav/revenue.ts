import { IndianRupee } from 'lucide-react';
import type { NavDomain } from './types';

/** Revenue domain (Phase 4): targets, deals, collections, refunds, forecasts, pricing, market intelligence. */
export const revenueNav: NavDomain = {
  sectionKey: 'workspace',
  items: [
    {
      id: 'revenue',
      labelKey: 'revenue',
      href: '/revenue',
      icon: IndianRupee,
      permission: ['deals:view', 'targets:view', 'collections:view', 'forecasts:view', 'market-intel:view'],
      mobilePriority: 3,
      order: 20,
      children: [
        { id: 'revenue.deals', labelKey: 'revenueDeals', href: '/revenue/deals', permission: 'deals:view' },
        { id: 'revenue.targets', labelKey: 'revenueTargets', href: '/revenue/targets', permission: 'targets:view' },
        { id: 'revenue.collections', labelKey: 'revenueCollections', href: '/revenue/collections', permission: 'collections:view' },
        { id: 'revenue.refunds', labelKey: 'revenueRefunds', href: '/revenue/refunds', permission: 'refunds:view' },
        { id: 'revenue.forecasts', labelKey: 'revenueForecasts', href: '/revenue/forecasts', permission: 'forecasts:view' },
        { id: 'revenue.pricing', labelKey: 'revenuePricing', href: '/revenue/pricing', permission: 'proposals:view' },
        { id: 'revenue.strategy', labelKey: 'revenueStrategy', href: '/revenue/strategy', permission: 'targets:view', minScope: 'team' },
        { id: 'revenue.intel', labelKey: 'revenueIntel', href: '/revenue/intel', permission: 'market-intel:view' },
      ],
    },
  ],
};
