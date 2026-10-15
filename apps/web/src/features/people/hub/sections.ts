import { Award, BadgeIndianRupee, BookMarked, ClipboardCheck, GraduationCap, HeartPulse, ListChecks, MessagesSquare, Network, Target, TrendingUp, UserRoundSearch, UsersRound, type LucideIcon } from 'lucide-react';

export interface HubSection {
  id: string;
  href: string;
  /** any-of permission keys (UI hiding only; the API enforces) */
  permission: string | string[];
  icon: LucideIcon;
}

/** Keep in sync with nav/people.ts children. */
export const HUB_SECTIONS: HubSection[] = [
  { id: 'coaching', href: '/people/coaching', permission: 'coaching:view', icon: MessagesSquare },
  { id: 'oneOnOnes', href: '/people/one-on-ones', permission: 'coaching:view', icon: UsersRound },
  { id: 'kpis', href: '/people/kpis', permission: 'kpi-assignments:view', icon: Target },
  { id: 'reviews', href: '/people/reviews', permission: 'reviews:view', icon: ClipboardCheck },
  { id: 'pips', href: '/people/pips', permission: 'pip:view', icon: TrendingUp },
  { id: 'recognition', href: '/people/recognition', permission: 'recognition:view', icon: Award },
  { id: 'incentives', href: '/people/incentives', permission: 'incentives:recommendation:view', icon: BadgeIndianRupee },
  { id: 'hiring', href: '/people/hiring', permission: 'hiring:view', icon: UserRoundSearch },
  { id: 'onboarding', href: '/people/onboarding', permission: 'onboarding:view', icon: ListChecks },
  { id: 'succession', href: '/people/succession', permission: 'succession:view', icon: Network },
  { id: 'skills', href: '/people/skills', permission: 'resources:view', icon: GraduationCap },
  { id: 'engagement', href: '/people/engagement', permission: ['engagement:respond', 'engagement:view'], icon: HeartPulse },
  { id: 'employees', href: '/people/employees', permission: 'hr:records:view', icon: BookMarked },
];

export const visibleSections = (can: (p: string | readonly string[]) => boolean) => HUB_SECTIONS.filter((s) => can(s.permission));
