import type { NegativeCase } from '../workforce/cases';

/** Negative-authz cases for the dev-panel access routes (owned by one agent). Use deniedUser 'admin'. */
export const ACCESS_CASES: NegativeCase[] = [
  { route: 'GET /dev-panel/access/matrix', deniedUser: 'admin' },
  { route: 'GET /dev-panel/access/matrix/user/:id', deniedUser: 'admin' },
  { route: 'GET /dev-panel/access/flags', deniedUser: 'admin' },
  { route: 'GET /dev-panel/access/runbook', deniedUser: 'admin' },
];
