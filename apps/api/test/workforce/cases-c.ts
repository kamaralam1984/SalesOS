import type { NegativeCase } from './cases';

/** Area C (payroll register): every route, with a user who is authenticated but lacks the key. Admin holds no payroll key (DEC-032). */
export const C_CASES: NegativeCase[] = [
  { route: 'GET /workforce/payroll/structures', deniedUser: 'admin' },
  { route: 'GET /workforce/payroll/structures/:userId', deniedUser: 'managerA' },
  {
    route: 'POST /workforce/payroll/structures',
    deniedUser: 'managerA',
    body: { userId: '00000000-0000-4000-8000-000000000001', effectiveFrom: '2026-01-01', currency: 'INR', components: [{ key: 'BASIC', name: 'Basic', kind: 'EARNING', amount: '1000.00' }] },
  },
  { route: 'POST /workforce/payroll/runs', deniedUser: 'admin', body: { month: '2026-08' } },
  { route: 'GET /workforce/payroll/runs', deniedUser: 'execA1' },
  { route: 'GET /workforce/payroll/runs/:id', deniedUser: 'managerA' },
  { route: 'POST /workforce/payroll/runs/:id/calculate', deniedUser: 'admin', body: {} },
  { route: 'POST /workforce/payroll/runs/:id/payslips/:slipId/adjustments', deniedUser: 'managerA', body: { label: 'Bonus', kind: 'EARNING', amount: '10.00', reason: 'negative test' } },
  { route: 'DELETE /workforce/payroll/runs/:id/payslips/:slipId/adjustments/:adjustmentId', deniedUser: 'managerA' },
  { route: 'POST /workforce/payroll/runs/:id/approve', deniedUser: 'hr', body: {} },
  { route: 'POST /workforce/payroll/runs/:id/send-back', deniedUser: 'finance', body: { reason: 'negative test' } },
  { route: 'POST /workforce/payroll/runs/:id/mark-paid', deniedUser: 'hr', body: { reference: 'UTR-NEGATIVE' } },
  { route: 'POST /workforce/payroll/runs/:id/cancel', deniedUser: 'admin', body: { reason: 'negative test' } },
  { route: 'GET /workforce/payroll/runs/:id/export', deniedUser: 'execA1' },
  // the payslip routes are open to every employee for their OWN slips; a foreign / unknown id is a 404 (tested in payroll.spec.ts)
  { route: 'GET /workforce/payroll/payslips/mine' },
  { route: 'GET /workforce/payroll/payslips/:id' },
];
