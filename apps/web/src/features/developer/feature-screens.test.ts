import { describe, expect, it } from 'vitest';
import type { FeatureRow } from '@/lib/api/hooks/devpanel-features';
import { buildScreens, screenChanges, screenReset, screenState } from './feature-screens';

const row = (key: string, o: Partial<FeatureRow> = {}): FeatureRow => ({ key, domain: key.split(':')[0]!, description: '', sensitive: false, locked: false, default: null, override: null, effective: null, ...o });
const rows = (...r: FeatureRow[]) => new Map(r.map((x) => [x.key, x]));

describe('feature screens', () => {
  const screens = buildScreens();
  const by = (id: string) => screens.find((s) => s.id === id)!;

  it('lists permission-gated pages and sub-pages, never pages open to everyone', () => {
    expect(by('crm.leads')).toMatchObject({ href: '/crm/leads', perms: ['leads:view'], group: 'crm' });
    expect(by('work.payroll').perms).toEqual(['payroll:run:view']);
    expect(by('revenue.strategy').minScope).toBe('team');
    expect(screens.some((s) => s.perms.length === 0)).toBe(false);
  });

  it('a screen is on when a key opens it at enough scope', () => {
    const s = by('revenue.strategy'); // needs team scope
    expect(screenState(s, rows(row('targets:view', { effective: 'own' }))).on).toBe(false);
    expect(screenState(s, rows(row('targets:view', { effective: 'team' }))).on).toBe(true);
    expect(screenState(by('crm.imports'), rows(row('imports:view', { effective: 'own' }))).on).toBe(true); // any-of
  });

  it('switching on grants the first key at the page minimum scope; widening a held key when too narrow', () => {
    expect(screenChanges(by('work.payroll'), rows(row('payroll:run:view')), true)).toEqual([{ permissionKey: 'payroll:run:view', state: 'ON', scope: 'own' }]);
    expect(screenChanges(by('revenue.strategy'), rows(row('targets:view', { effective: 'own', default: 'own' })), true)).toEqual([{ permissionKey: 'targets:view', state: 'ON', scope: 'team' }]);
  });

  it('switching off denies every key that currently opens the page; reset clears them all', () => {
    const s = by('crm.imports');
    expect(screenChanges(s, rows(row('leads:import', { effective: 'team' }), row('imports:view', { effective: 'team' })), false).map((c) => c.permissionKey).sort()).toEqual(['imports:view', 'leads:import']);
    expect(screenReset(s).every((c) => c.state === 'DEFAULT')).toBe(true);
    expect(screenState(s, rows(row('leads:import', { override: { effect: 'DENY', scope: null } }))).customised).toBe(true);
  });
});
