/**
 * Paths (relative to /api/v1, no query) that stay reachable while maintenance is ON for non-developers.
 * Explicit on purpose: anything not listed is blocked. Webhooks stay open because blocking inbound provider callbacks would lose events
 * (they are signature-verified and idempotent, and do not read business screens).
 */
export const MAINTENANCE_ALLOW_EXACT: readonly string[] = [
  '/health', '/health/ready', '/ready', '/metrics',
  '/auth/login', '/auth/logout', '/auth/me', '/auth/csrf', '/auth/sessions/revoke',
  '/auth/password/forgot', '/auth/password/reset', '/auth/invite/accept',
  '/maintenance/status',
  '/integrations/telephony/webhook',
];
export const MAINTENANCE_ALLOW_PREFIX: readonly string[] = ['/integrations/webhooks/'];

export function normalisePath(url: string): string {
  const q = url.indexOf('?');
  let p = q >= 0 ? url.slice(0, q) : url;
  p = p.replace(/^\/api\/v1(?=\/|$)/, '');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p.toLowerCase() || '/';
}

export function isMaintenanceExempt(url: string): boolean {
  const p = normalisePath(url);
  return MAINTENANCE_ALLOW_EXACT.includes(p) || MAINTENANCE_ALLOW_PREFIX.some((x) => p.startsWith(x));
}
