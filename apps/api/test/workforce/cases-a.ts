import type { NegativeCase } from './cases';

const U = '11111111-1111-4111-8111-111111111111';

/**
 * Area A (attendance, holidays, leave, Earned Leave). Every employee holds the "own" keys (attendance:self, leave:apply, ...), so those
 * routes only get the 401 case here; scope (own / team / org), cross-team, cross-org and Admin behaviour are proven in
 * test/workforce/attendance-leave.spec.ts and holidays-earned-leave.spec.ts.
 */
export const A_CASES: NegativeCase[] = [
  { route: 'POST /workforce/attendance/check-in', body: { mode: 'OFFICE' } },
  { route: 'POST /workforce/attendance/check-out', body: {} },
  { route: 'GET /workforce/attendance/today' },
  { route: 'GET /workforce/attendance/month' },
  { route: 'GET /workforce/attendance/team-summary' },
  { route: 'POST /workforce/attendance/meeting-join', body: {} },
  { route: 'GET /workforce/attendance/day' },
  { route: 'PUT /workforce/attendance/records', deniedUser: 'execA1', body: { userId: U, date: '2026-10-01', status: 'PRESENT', reason: 'negative test' } },
  { route: 'GET /workforce/attendance/corrections' },
  { route: 'GET /workforce/holidays' },
  { route: 'POST /workforce/holidays', deniedUser: 'managerA', body: { date: '2026-12-25', name: 'Negative test', kind: 'COMPANY' } },
  { route: 'POST /workforce/holidays/suggest', deniedUser: 'managerA', body: { year: 2027 } },
  { route: 'PATCH /workforce/holidays/:id', deniedUser: 'managerA', body: { name: 'Negative test' } },
  { route: 'DELETE /workforce/holidays/:id', deniedUser: 'managerA' },
  { route: 'POST /workforce/holidays/:id/approve', deniedUser: 'managerA', body: {} },
  { route: 'GET /workforce/leave/types' },
  { route: 'GET /workforce/leave/balances' },
  { route: 'POST /workforce/leave/balances/adjust', deniedUser: 'managerA', body: { userId: U, typeKey: 'CASUAL', amount: '1', reason: 'negative test' } },
  { route: 'GET /workforce/leave/ledger' },
  { route: 'GET /workforce/leave/calendar' },
  { route: 'POST /workforce/leave/requests', body: { typeKey: 'CASUAL', startDate: '2026-12-01', endDate: '2026-12-01', reason: 'negative test' } },
  { route: 'GET /workforce/leave/requests' },
  { route: 'GET /workforce/leave/requests/:id' },
  { route: 'POST /workforce/leave/requests/:id/decision', deniedUser: 'execA1', body: { decision: 'APPROVE' } },
  { route: 'POST /workforce/leave/requests/:id/cancel', body: { reason: 'negative test' } },
  { route: 'GET /workforce/earned-leave/progress' },
  { route: 'GET /workforce/earned-leave/transactions' },
  { route: 'POST /workforce/earned-leave/run', deniedUser: 'managerA', body: {} },
];
