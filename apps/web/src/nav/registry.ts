/**
 * NAV REGISTRY. Aggregates one file per domain (src/nav/<domain>.ts).
 * Later agents edit ONLY their own domain file; this file just lists the domains.
 * Order here = section order in the sidebar; item order comes from `order` inside each domain file.
 */
import type { NavDomain, NavItem } from './types';

type CanFn = (permission: string | string[] | null, minScope?: NavItem['minScope']) => boolean;
import { dashboardNav } from './dashboard';
import { crmNav } from './crm';
import { revenueNav } from './revenue';
import { peopleNav } from './people';
import { sopNav } from './sop';
import { cxNav } from './cx';
import { collaborationNav } from './collaboration';
import { reportingNav } from './reporting';
import { filesNav, notificationsNav, platformAdminNav } from './notifications';
import { adminNav } from './admin';
import { workNav } from './work';

export const NAV_DOMAINS: NavDomain[] = [
  dashboardNav,
  crmNav,
  revenueNav,
  peopleNav,
  workNav,
  sopNav,
  cxNav,
  collaborationNav,
  reportingNav,
  notificationsNav,
  adminNav,
  platformAdminNav,
  filesNav,
];

export interface NavSection {
  sectionKey: string;
  items: NavItem[];
}

/** All items flattened in display order. */
export function allNavItems(domains: NavDomain[] = NAV_DOMAINS): NavItem[] {
  return domains.flatMap((d) => d.items).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** Group visible items by section, keeping section first-appearance order. */
export function visibleNavSections(can: CanFn, domains: NavDomain[] = NAV_DOMAINS): NavSection[] {
  const sections = new Map<string, NavItem[]>();
  for (const d of domains) {
    for (const item of d.items) {
      if (!can(item.permission, item.minScope)) continue;
      const list = sections.get(d.sectionKey) ?? [];
      list.push(item);
      sections.set(d.sectionKey, list);
    }
  }
  return [...sections.entries()].map(([sectionKey, items]) => ({
    sectionKey,
    items: items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
  }));
}

/** Items for the mobile bottom bar (max 4) plus everything else for the "More" sheet. */
export function mobileNav(can: CanFn, domains: NavDomain[] = NAV_DOMAINS) {
  const visible = allNavItems(domains).filter((i) => can(i.permission, i.minScope));
  const primary = visible
    .filter((i) => i.mobilePriority !== null)
    .sort((a, b) => (a.mobilePriority ?? 99) - (b.mobilePriority ?? 99))
    .slice(0, 4);
  const ids = new Set(primary.map((i) => i.id));
  return { primary, more: visible.filter((i) => !ids.has(i.id)) };
}

export type NavChild = NonNullable<NavItem['children']>[number];

/** Sub-pages of an item the user may open (permission-filtered). Server still enforces; this only avoids dead links. */
export function visibleChildren(item: NavItem, can: CanFn): NavChild[] {
  return (item.children ?? []).filter((c) => can(c.permission, c.minScope));
}

/** The nav item (top level) that owns the current path: the one whose href or one of whose children matches best. */
export function activeNavItem(pathname: string, items: NavItem[]): NavItem | null {
  const match = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'));
  let best: { item: NavItem; len: number } | null = null;
  for (const item of items) {
    const hrefs = [item.href, ...(item.children ?? []).map((c) => c.href)];
    for (const h of hrefs) if (match(h) && (!best || h.length > best.len)) best = { item, len: h.length };
  }
  return best?.item ?? null;
}
