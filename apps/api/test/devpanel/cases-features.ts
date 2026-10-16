import type { NegativeCase } from '../workforce/cases';

/** Negative-authz cases for Developer Panel / Feature access. Use deniedUser 'admin'. */
export const FEATURES_CASES: NegativeCase[] = [
  { route: 'GET /dev-panel/features', deniedUser: 'admin' },
  { route: 'GET /dev-panel/features/summary', deniedUser: 'admin' },
  { route: 'PUT /dev-panel/features', deniedUser: 'admin', body: { subjectType: 'ROLE', subject: 'FINANCE', changes: [{ permissionKey: 'leads:view', state: 'ON' }] } },
  { route: 'POST /dev-panel/features/reset', deniedUser: 'admin', body: { subjectType: 'ROLE', subject: 'FINANCE' } },
];
