import { describe, expect, it } from 'vitest';
import { NAV_DOMAINS, activeNavItem, allNavItems, mobileNav, visibleChildren, visibleNavSections } from './registry';

const canFor = (perms: Record<string, 'own' | 'team' | 'org'>) => {
  const rank = { own: 1, team: 2, org: 3 };
  return (p: string | string[] | null, min?: 'own' | 'team' | 'org') => {
    if (p === null) return true;
    return (Array.isArray(p) ? p : [p]).some(
      (k) => k in perms && (!min || rank[perms[k]!] >= rank[min]),
    );
  };
};

describe('nav registry', () => {
  it('has one domain file per planned domain with unique ids and hrefs', () => {
    const items = allNavItems();
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
    expect(NAV_DOMAINS.length).toBeGreaterThanOrEqual(10);
  });

  it('hides items the user lacks permission for (and any scope below minScope)', () => {
    const sections = visibleNavSections(canFor({ 'users:view': 'own' }));
    const ids = sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain('dashboard');
    expect(ids).not.toContain('admin.users'); // own scope < team
    expect(ids).not.toContain('crm');
    const admin = visibleNavSections(canFor({ 'users:view': 'org', 'audit:view': 'org' })).flatMap(
      (s) => s.items.map((i) => i.id),
    );
    expect(admin).toEqual(expect.arrayContaining(['admin.users', 'admin.audit']));
  });

  it('limits the mobile bottom bar to 4 and keeps the rest for More', () => {
    const all = canFor({
      'leads:view': 'org',
      'deals:view': 'org',
      'reports:view': 'org',
      'users:view': 'org',
      'sop:view': 'org',
    });
    const { primary, more } = mobileNav(all);
    expect(primary.length).toBeLessThanOrEqual(4);
    expect(primary.map((i) => i.id)).toContain('dashboard');
    expect(more.some((i) => i.id === 'admin.users')).toBe(true);
  });
});

describe('sub-navigation', () => {
  const crm = allNavItems().find((i) => i.id === 'crm')!;
  it('shows only the permitted children of an item', () => {
    const kids = visibleChildren(crm, canFor({ 'leads:view': 'own', 'tasks:view': 'own' })).map((c) => c.id);
    expect(kids).toEqual(expect.arrayContaining(['crm.leads', 'crm.tasks', 'crm.calendar']));
    expect(kids).not.toContain('crm.settings');
    expect(kids).not.toContain('crm.reassignment');
    expect(visibleChildren(crm, canFor({ 'leads:view': 'org', 'settings:view': 'org' })).map((c) => c.id)).toContain('crm.settings');
  });
  it('every child of every item has a unique href and a nav label', () => {
    const hrefs = allNavItems().flatMap((i) => (i.children ?? []).map((c) => c.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it('maps a sub-page path to its owning item (longest match)', () => {
    const items = allNavItems();
    expect(activeNavItem('/crm/tasks', items)?.id).toBe('crm');
    expect(activeNavItem('/crm/leads/123', items)?.id).toBe('crm');
    expect(activeNavItem('/people/pips', items)?.id).toBe('people');
    expect(activeNavItem('/nowhere', items)).toBeNull();
  });
});
