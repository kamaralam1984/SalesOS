import type { NegativeCase } from './cases';

export const D_CASES: NegativeCase[] = [
  // D1
  { route: 'GET /workforce/directory' },
  { route: 'GET /workforce/directory/departments' },
  { route: 'GET /workforce/directory/:userId' },
  { route: 'GET /workforce/org-chart' },
  { route: 'GET /workforce/dashboard' },
  { route: 'GET /workforce/announcements' },
  { route: 'POST /workforce/announcements', deniedUser: 'execA1', body: { title: 'negative test', body: 'negative test' } },
  { route: 'DELETE /workforce/announcements/:id', deniedUser: 'managerA' },
  // D2
  { route: 'GET /workforce/hr/profiles/:userId', deniedUser: 'managerA' },
  { route: 'PATCH /workforce/hr/profiles/:userId', deniedUser: 'managerA', body: { shareBirthday: true } },
  { route: 'GET /workforce/hr/birthdays', deniedUser: 'managerA' },
  { route: 'GET /workforce/birthdays/upcoming' },
  { route: 'GET /workforce/hr/probation', deniedUser: 'execA1' },
  { route: 'GET /workforce/hr/probation/:userId/history', deniedUser: 'execA1' },
  { route: 'POST /workforce/hr/probation/:userId/decision', deniedUser: 'execA1', body: { decision: 'CONFIRM' } },
  { route: 'GET /workforce/reports/:report', deniedUser: 'execA1' },
  { route: 'GET /workforce/reports/:report/export', deniedUser: 'managerA' },
];
