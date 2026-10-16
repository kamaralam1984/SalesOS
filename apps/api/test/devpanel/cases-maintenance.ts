import type { NegativeCase } from '../workforce/cases';

/** Negative-authz cases for the dev-panel maintenance routes (owned by one agent). Use deniedUser 'admin'. */
export const MAINTENANCE_CASES: NegativeCase[] = [
  { route: 'GET /dev-panel/maintenance', deniedUser: 'admin' },
  { route: 'POST /dev-panel/maintenance/enable', deniedUser: 'admin', body: { message: 'Upgrade in progress' } },
  { route: 'POST /dev-panel/maintenance/disable', deniedUser: 'admin', body: {} },
];
