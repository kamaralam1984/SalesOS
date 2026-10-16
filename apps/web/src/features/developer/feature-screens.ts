import { NAV_DOMAINS } from '@/nav/registry';
import type { NavDomain, NavItem } from '@/nav/types';
import type { FeatureChange, FeatureRow, FeatureScope } from '@/lib/api/hooks/devpanel-features';

const RANK: Record<FeatureScope, number> = { summary: 0, own: 1, team: 2, org: 3 };

/** A screen (page) in the sidebar. Switching it changes the permission key(s) that gate it; the server enforces them. */
export interface Screen {
  id: string;
  labelKey: string;
  href: string;
  /** keys that open the page (any of them). The first one is granted when the screen is switched on. */
  perms: string[];
  minScope: FeatureScope;
  /** nav item id of the top-level entry this screen belongs to */
  group: string;
  groupLabelKey: string;
}

/** Every permission-gated sidebar page, one entry per page and sub-page. Pages open to everyone (permission null) are not switchable. */
export function buildScreens(domains: NavDomain[] = NAV_DOMAINS): Screen[] {
  const out: Screen[] = [];
  const add = (item: Pick<NavItem, 'id' | 'labelKey' | 'href' | 'permission' | 'minScope'>, group: NavItem) => {
    if (item.permission === null) return;
    const perms = Array.isArray(item.permission) ? item.permission : [item.permission];
    // the same page can appear twice (e.g. a hub link and its sub-page); keep the first
    if (out.some((s) => s.href === item.href && s.group === group.id)) return;
    out.push({ id: item.id, labelKey: item.labelKey, href: item.href, perms, minScope: item.minScope ?? 'own', group: group.id, groupLabelKey: group.labelKey });
  };
  for (const d of domains) {
    for (const item of d.items) {
      add(item, item);
      for (const c of item.children ?? []) add(c, item);
    }
  }
  return out;
}

export interface ScreenState {
  on: boolean;
  customised: boolean;
  /** devpanel:* pages cannot be switched */
  locked: boolean;
}

export function screenState(screen: Screen, rows: ReadonlyMap<string, FeatureRow>): ScreenState {
  let on = false;
  let customised = false;
  let locked = false;
  for (const k of screen.perms) {
    const r = rows.get(k);
    if (!r) continue;
    if (r.locked) locked = true;
    if (r.override) customised = true;
    if (r.effective && RANK[r.effective] >= RANK[screen.minScope]) on = true;
  }
  return { on, customised, locked };
}

/** The switches to send when a screen is turned on or off. */
export function screenChanges(screen: Screen, rows: ReadonlyMap<string, FeatureRow>, on: boolean): FeatureChange[] {
  if (!on) {
    return screen.perms.filter((k) => rows.get(k)?.effective).map((k) => ({ permissionKey: k, state: 'OFF' as const }));
  }
  // already held, just too narrow to show the page (e.g. own where the page needs team): widen that key
  const held = screen.perms.find((k) => rows.get(k)?.effective);
  const key = held ?? screen.perms[0]!;
  const cur = rows.get(key)?.effective ?? rows.get(key)?.default ?? 'own';
  const scope = RANK[cur] >= RANK[screen.minScope] ? cur : screen.minScope;
  return [{ permissionKey: key, state: 'ON', scope }];
}

export function screenReset(screen: Screen): FeatureChange[] {
  return screen.perms.map((k) => ({ permissionKey: k, state: 'DEFAULT' as const }));
}
