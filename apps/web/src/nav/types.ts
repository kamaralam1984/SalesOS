import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  /** Stable id, unique across the registry (e.g. `crm.leads`). */
  id: string;
  /** Key in messages/*.json under the `nav` namespace. */
  labelKey: string;
  href: string;
  icon: LucideIcon;
  /**
   * Permission key(s) (`resource:action`). The item is shown if the user has ANY of them.
   * `null` = any signed-in user. UI hiding only; the server enforces.
   */
  permission: string | string[] | null;
  /** Minimum scope of the grant needed to show the item (e.g. `team` hides it from own-scope roles). */
  minScope?: 'own' | 'team' | 'org';
  /** 1-4 = candidate for the mobile bottom bar (lower first). `null` = only in the "More" sheet / sidebar. */
  mobilePriority: number | null;
  /** Sidebar ordering within the domain, then domain order from the registry. */
  order?: number;
  /** Optional sub-navigation shown under the item in the sidebar when its section is active. */
  children?: Array<Pick<NavItem, 'id' | 'labelKey' | 'href' | 'permission' | 'minScope'>>;
  /** Phase in which the module becomes real; used for the "coming soon" badge. Remove when shipped. */
  comingInPhase?: number;
}

export interface NavDomain {
  /** Key in messages `nav.sections`. */
  sectionKey: string;
  items: NavItem[];
}
