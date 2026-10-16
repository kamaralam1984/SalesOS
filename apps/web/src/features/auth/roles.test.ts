import { describe, expect, it } from 'vitest';
import { landingPathFor, safeNextPath } from './roles';

describe('landingPathFor', () => {
  it('sends Developer Panel users to their panel', () => {
    expect(landingPathFor(['DEVELOPER'])).toBe('/admin/developer');
    expect(landingPathFor(['DEVELOPER'], [{ key: 'devpanel:access', scope: 'org' }])).toBe('/admin/developer');
    expect(landingPathFor(['FINANCE'], [])).toBe('/dashboard');
  });
  it('maps each primary role to its dashboard', () => {
    expect(landingPathFor(['FOUNDER_CEO'])).toBe('/dashboard/founder');
    expect(landingPathFor(['SALES_TEAM_LEAD'])).toBe('/dashboard/team-lead');
    expect(landingPathFor(['SALES_MANAGER'])).toBe('/dashboard/manager');
    expect(landingPathFor(['SALES_EXECUTIVE'])).toBe('/dashboard/executive');
    expect(landingPathFor(['ADMIN'])).toBe('/dashboard/admin');
  });
  it('picks the highest-privilege role when several are held', () => {
    expect(landingPathFor(['MARKETING', 'SALES_MANAGER', 'ADMIN'])).toBe('/dashboard/manager');
  });
  it('keeps roles without a dashboard on the workspace home at /dashboard', () => {
    const path = landingPathFor(['FINANCE'], [{ key: 'deals:view', scope: 'org' }]);
    expect(path).toBe('/dashboard');
  });
  it('never lands a secondary role on another role dashboard', () => {
    expect(landingPathFor(['HR'], [])).not.toMatch(/^\/dashboard\//);
  });
});

describe('safeNextPath (open-redirect guard)', () => {
  it('accepts same-origin relative paths', () => {
    expect(safeNextPath('/admin/users?x=1')).toBe('/admin/users?x=1');
  });
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil',
    'javascript:alert(1)',
    '',
    null,
    undefined,
    '/login?next=/x',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/%09/evil.example',
    '/%5Cevil.example',
    '/ok\u0000',
    ' //evil.example',
  ])('rejects %j', (v) => {
    expect(safeNextPath(v as string | null | undefined)).toBeNull();
  });
});
