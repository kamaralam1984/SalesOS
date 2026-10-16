import type { NegativeCase } from '../workforce/cases';

/** Negative-authz cases for the dev-panel security routes (owned by one agent). Use deniedUser 'admin'. */
export const SECURITY_CASES: NegativeCase[] = [
  { route: 'GET /dev-panel/security/sessions', deniedUser: 'admin' },
  { route: 'POST /dev-panel/security/sessions/:id/revoke', deniedUser: 'admin', body: {} },
  { route: 'GET /dev-panel/security/login-history', deniedUser: 'admin' },
  { route: 'GET /dev-panel/security/locked-accounts', deniedUser: 'admin' },
  { route: 'POST /dev-panel/security/users/:id/unlock', deniedUser: 'admin', body: {} },
  { route: 'POST /dev-panel/security/users/:id/reset-link', deniedUser: 'admin', body: {} },
  { route: 'GET /dev-panel/security/audit', deniedUser: 'admin' },
];
