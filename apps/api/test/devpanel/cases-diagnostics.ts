import type { NegativeCase } from '../workforce/cases';


/** Negative-authz cases for the dev-panel diagnostics routes (owned by one agent). Use deniedUser 'admin'. */
export const DIAGNOSTICS_CASES: NegativeCase[] = [
  { route: 'GET /dev-panel/diagnostics/health', deniedUser: 'admin' },
  { route: 'GET /dev-panel/diagnostics/jobs', deniedUser: 'admin' },
  { route: 'POST /dev-panel/diagnostics/jobs/retry-all', deniedUser: 'admin', body: {} },
  { route: 'POST /dev-panel/diagnostics/jobs/:id/retry', deniedUser: 'admin', body: {} },
  { route: 'POST /dev-panel/diagnostics/jobs/:id/discard', deniedUser: 'admin', body: { reason: 'negative test' } },
  { route: 'GET /dev-panel/diagnostics/errors', deniedUser: 'admin' },
  { route: 'GET /dev-panel/diagnostics/migrations', deniedUser: 'admin' },
  { route: 'GET /dev-panel/diagnostics/build', deniedUser: 'admin' },
];
