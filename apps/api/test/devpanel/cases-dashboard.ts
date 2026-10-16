import type { NegativeCase } from '../workforce/cases';

/** Negative-authz cases for the dev-panel dashboard routes (owned by one agent). Use deniedUser 'admin'. */
export const DASHBOARD_CASES: NegativeCase[] = [
  { route: 'GET /dev-panel/dashboard', deniedUser: 'admin' },
  { route: 'GET /dev-panel/dashboard/integrations', deniedUser: 'admin' },
  { route: 'GET /dev-panel/dashboard/backup', deniedUser: 'admin' },
];
