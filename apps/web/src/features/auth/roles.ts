import type { EffectivePermission, RoleKey } from '@/lib/api/types';

/** Landing path per primary role. Highest-privilege primary role wins when a user holds several. */
const LANDING: Array<[RoleKey, string]> = [
  ['FOUNDER_CEO', '/dashboard/founder'],
  ['SALES_TEAM_LEAD', '/dashboard/team-lead'],
  ['SALES_MANAGER', '/dashboard/manager'],
  ['SALES_EXECUTIVE', '/dashboard/executive'],
  ['ADMIN', '/dashboard/admin'],
];

/** Landing page of Developer Panel users. `/dashboard?workspace=1` still opens the normal workspace home. */
export const DEVELOPER_HOME = '/admin/developer';

/**
 * Roles without a dashboard of their own (FINANCE, HR, MARKETING, ...) stay on `/dashboard`, which shows a workspace
 * home with shortcuts to the pages their role may open (no sales KPIs). Without `permissions` (legacy callers) the old
 * fallback is kept.
 */
export function landingPathFor(roles: readonly RoleKey[], permissions?: readonly EffectivePermission[]): string {
  for (const [role, path] of LANDING) if (roles.includes(role)) return path;
  // Developer Panel users (super admin) land on their panel; every other role is unchanged.
  if (roles.includes('DEVELOPER') || permissions?.some((x) => x.key === 'devpanel:access')) return DEVELOPER_HOME;
  if (!permissions) return '/dashboard/executive';
  return '/dashboard';
}

/** Only same-origin relative paths are accepted as post-login redirects (prevents open redirects). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  // Browsers strip TAB/CR/LF (and treat backslash as slash) while parsing URLs, so "/\t/evil.com" would become "//evil.com".
  // Reject every control character, backslash, and percent-encoded variants before looking at the shape.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(next) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(next)) return null;
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  if (next.startsWith('/login')) return null;
  return next;
}
