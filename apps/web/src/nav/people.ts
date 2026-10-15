import { HeartHandshake } from 'lucide-react';
import type { NavDomain } from './types';

/** People domain (Phase 6 owns this file): people management, coaching, reviews, incentives, skills. */
export const peopleNav: NavDomain = {
  sectionKey: 'organisation',
  items: [
    {
      id: 'people',
      labelKey: 'people',
      href: '/people',
      icon: HeartHandshake,
      // everyone holds resources:view (skills library); the hub only shows the sections each role may open
      permission: ['coaching:view', 'reviews:view', 'hr:records:view', 'resources:view'],
      mobilePriority: null,
      order: 30,
      children: [
        { id: 'people.coaching', labelKey: 'peopleCoaching', href: '/people/coaching', permission: 'coaching:view' },
        { id: 'people.one-on-ones', labelKey: 'peopleOneOnOnes', href: '/people/one-on-ones', permission: 'coaching:view' },
        { id: 'people.kpis', labelKey: 'peopleKpis', href: '/people/kpis', permission: 'kpi-assignments:view' },
        { id: 'people.reviews', labelKey: 'peopleReviews', href: '/people/reviews', permission: 'reviews:view' },
        { id: 'people.pips', labelKey: 'peoplePips', href: '/people/pips', permission: 'pip:view' },
        { id: 'people.recognition', labelKey: 'peopleRecognition', href: '/people/recognition', permission: 'recognition:view' },
        { id: 'people.incentives', labelKey: 'peopleIncentives', href: '/people/incentives', permission: 'incentives:recommendation:view' },
        { id: 'people.hiring', labelKey: 'peopleHiring', href: '/people/hiring', permission: 'hiring:view' },
        { id: 'people.onboarding', labelKey: 'peopleOnboarding', href: '/people/onboarding', permission: 'onboarding:view' },
        { id: 'people.succession', labelKey: 'peopleSuccession', href: '/people/succession', permission: 'succession:view' },
        { id: 'people.skills', labelKey: 'peopleSkills', href: '/people/skills', permission: 'resources:view' },
        { id: 'people.engagement', labelKey: 'peopleEngagement', href: '/people/engagement', permission: ['engagement:respond', 'engagement:view'] },
        { id: 'people.employees', labelKey: 'peopleEmployees', href: '/people/employees', permission: 'hr:records:view' },
      ],
    },
  ],
};
