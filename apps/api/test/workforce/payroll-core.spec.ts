import { DEFAULT_WORKFORCE_CONFIG } from '@salesos/validation';
import {
  buildCalendar,
  calculatePayslip,
  canPayrollTransition,
  computeNet,
  employmentWindow,
  findMissingClosedDays,
  formatPaise,
  isMoneyString,
  monthHasEnded,
  parseMoneyToPaise,
  payslipVisibleToEmployee,
  prorate,
  type CalcInput,
  type PayAttendanceStatus,
  type PayComponent,
  type PayrollRecordFact,
  type PayrollRunStatus,
} from '@salesos/workforce-core';
import { describe, expect, it } from 'vitest';

// August 2026: 1 Aug is a Saturday; Sundays (weekly off) are 2, 9, 16, 23, 30 -> 26 working days.
const MONTH = '2026-08';
const cal = (holidays: Array<{ date: string; status?: 'APPROVED' | 'SUGGESTED' }> = []) =>
  buildCalendar(DEFAULT_WORKFORCE_CONFIG, holidays.map((h) => ({ date: h.date, name: 'h', kind: 'NATIONAL' as const, status: h.status ?? 'APPROVED' })));
const policy = { absentIsLossOfPay: true, halfDayLossOfPay: 0.5 };
const comps = (basic = '26000.00'): PayComponent[] => [{ key: 'BASIC', name: 'Basic', kind: 'EARNING', amount: basic }];

function all(status: PayAttendanceStatus, except: Record<string, PayAttendanceStatus> = {}, calendar = cal()): PayrollRecordFact[] {
  return calendar.workingDays(`${MONTH}-01`, `${MONTH}-31`).map((date) => ({ date, status: except[date] ?? status }));
}
const base = (over: Partial<CalcInput> = {}): CalcInput => ({ month: MONTH, calendar: cal(), joinDate: '2020-01-01', exitDate: null, policy, records: all('PRESENT'), leaves: [], components: comps(), ...over });

describe('money helpers', () => {
  it('parses and formats exact paise', () => {
    expect(parseMoneyToPaise('12500.5')).toBe(1250050n);
    expect(formatPaise(1250050n)).toBe('12500.50');
    expect(formatPaise(5n)).toBe('0.05');
    expect(formatPaise(-1050n)).toBe('-10.50');
  });
  it('rejects floats with 3 dp, negatives, exponents and junk', () => {
    for (const bad of ['1.234', '-5', '1e3', '', 'abc', '1,000', ' 5', '1234567890123']) expect(isMoneyString(bad)).toBe(false);
    expect(() => parseMoneyToPaise('1.234')).toThrow();
  });
  it('prorates half-up to the paisa and never beyond the full amount', () => {
    expect(prorate(1000000n, 2500, 26)).toBe(961538n); // 10000.00 x 25/26 = 9615.3846 -> 9615.38
    expect(prorate(5n, 100, 2)).toBe(3n); // 0.05 x 1/2 = 0.025 -> exactly half rounds up
    expect(prorate(1001n, 100, 2)).toBe(501n); // 10.01 / 2 = 5.005 -> 5.01
    expect(prorate(1000n, 9999, 26)).toBe(1000n); // capped at the month
    expect(prorate(1000n, 0, 26)).toBe(0n);
    expect(prorate(1000n, 100, 0)).toBe(0n); // zero working days never divides by zero
  });
});

describe('calculatePayslip', () => {
  it('full attendance pays the full month; every line is an exact paisa amount', () => {
    const r = calculatePayslip(base());
    expect(r.monthWorkingDays).toBe(26);
    expect(r.employedWorkingDays).toBe(26);
    expect(r.paidDays).toBe('26.00');
    expect(r.lossOfPayDays).toBe('0.00');
    expect(r.gross).toBe('26000.00');
    expect(r.netBeforeAdjustments).toBe('26000.00');
    expect(r.basis.warnings).toEqual([]);
  });

  it('one absent day (absentIsLossOfPay) reduces pay by 1/26 and sums of lines equal gross', () => {
    const c = [...comps('10000.00'), { key: 'HRA', name: 'HRA', kind: 'EARNING' as const, amount: '5000.00' }, { key: 'PF', name: 'Provident', kind: 'DEDUCTION' as const, amount: '1200.00' }];
    const r = calculatePayslip(base({ components: c, records: all('PRESENT', { '2026-08-05': 'ABSENT' }) }));
    expect(r.paidDays).toBe('25.00');
    expect(r.lossOfPayDays).toBe('1.00');
    expect(r.earnings.map((l) => l.amount)).toEqual(['9615.38', '4807.69']);
    expect(r.gross).toBe('14423.07');
    expect(r.deductions[0]!.amount).toBe('1153.85');
    expect(r.totalDeductions).toBe('1153.85');
    expect(r.netBeforeAdjustments).toBe('13269.22');
    expect(r.basis.lopDays).toEqual([{ date: '2026-08-05', fraction: '1.00', reason: 'ABSENT' }]);
  });

  it('absent is paid when the policy says so (configurable), unpaid leave is always loss of pay', () => {
    const rec = all('PRESENT', { '2026-08-05': 'ABSENT', '2026-08-06': 'UNPAID_LEAVE' });
    const r = calculatePayslip(base({ records: rec, policy: { absentIsLossOfPay: false, halfDayLossOfPay: 0.5 } }));
    expect(r.lossOfPayDays).toBe('1.00');
    expect(r.basis.counts.absent).toBe(1);
    expect(r.basis.counts.unpaidLeave).toBe(1);
  });

  it('half day costs halfDayLossOfPay (0.5 default, 0 = fully paid, 1 = a full day)', () => {
    const rec = all('PRESENT', { '2026-08-05': 'HALF_DAY', '2026-08-06': 'HALF_DAY' });
    expect(calculatePayslip(base({ records: rec })).lossOfPayDays).toBe('1.00');
    expect(calculatePayslip(base({ records: rec, policy: { absentIsLossOfPay: true, halfDayLossOfPay: 0 } })).lossOfPayDays).toBe('0.00');
    expect(calculatePayslip(base({ records: rec, policy: { absentIsLossOfPay: true, halfDayLossOfPay: 1 } })).lossOfPayDays).toBe('2.00');
  });

  it('paid leave, WFH, LATE and recorded holidays are fully paid', () => {
    const r = calculatePayslip(base({ records: all('PRESENT', { '2026-08-03': 'ON_LEAVE', '2026-08-04': 'WFH', '2026-08-05': 'LATE' }) }));
    expect(r.paidDays).toBe('26.00');
    expect(r.basis.counts).toMatchObject({ paidLeave: 1, wfh: 1, late: 1 });
  });

  it('an approved holiday shrinks the month divisor; a SUGGESTED holiday does not count', () => {
    const withHoliday = cal([{ date: '2026-08-15' }]); // Saturday
    const r = calculatePayslip(base({ calendar: withHoliday, records: all('PRESENT', {}, withHoliday) }));
    expect(r.monthWorkingDays).toBe(25);
    expect(r.paidDays).toBe('25.00');
    expect(r.gross).toBe('26000.00');
    const suggested = cal([{ date: '2026-08-15', status: 'SUGGESTED' }]);
    expect(calculatePayslip(base({ calendar: suggested })).monthWorkingDays).toBe(26);
  });

  it('mid-month joiner is paid only for employed working days (13 of 26)', () => {
    const rec = all('PRESENT').filter((r) => r.date >= '2026-08-17');
    const r = calculatePayslip(base({ joinDate: '2026-08-17', records: rec }));
    expect(r.employedWorkingDays).toBe(13);
    expect(r.paidDays).toBe('13.00');
    expect(r.lossOfPayDays).toBe('0.00');
    expect(r.gross).toBe('13000.00');
    expect(r.basis.employedFrom).toBe('2026-08-17');
  });

  it('joining on a Sunday starts at the next working day', () => {
    const j = calculatePayslip(base({ joinDate: '2026-08-23', records: all('PRESENT').filter((r) => r.date > '2026-08-23') }));
    expect(j.employedWorkingDays).toBe(7); // 24..29 (6) + 31 (1)
  });

  it('exit mid-month', () => {
    const r = calculatePayslip(base({ exitDate: '2026-08-14', records: all('PRESENT').filter((r) => r.date <= '2026-08-14') }));
    expect(r.employedWorkingDays).toBe(12); // 3-8 (6) + 10-14 (5) + 1 (1)
    expect(r.gross).toBe('12000.00');
  });

  it('not employed in the month = zero payslip with a warning, never a crash', () => {
    const r = calculatePayslip(base({ joinDate: '2026-09-01', records: [] }));
    expect(r.employedWorkingDays).toBe(0);
    expect(r.gross).toBe('0.00');
    expect(r.basis.warnings).toContain('NOT_EMPLOYED_IN_MONTH');
    const left = calculatePayslip(base({ exitDate: '2026-07-31', records: [] }));
    expect(left.gross).toBe('0.00');
  });

  it('a month with no working days never divides by zero', () => {
    const everyDayHoliday = buildCalendar({ ...DEFAULT_WORKFORCE_CONFIG, weeklyOffDays: [7] }, Array.from({ length: 31 }, (_, i) => ({ date: `${MONTH}-${String(i + 1).padStart(2, '0')}`, name: 'h', kind: 'COMPANY' as const, status: 'APPROVED' as const })));
    const r = calculatePayslip(base({ calendar: everyDayHoliday, records: [] }));
    expect(r.monthWorkingDays).toBe(0);
    expect(r.gross).toBe('0.00');
    expect(r.basis.warnings).toContain('ZERO_WORKING_DAYS_IN_MONTH');
  });

  it('approved unpaid-type leave is loss of pay even if the day-close job ran earlier and wrote PRESENT/ABSENT', () => {
    const r = calculatePayslip(base({ records: all('PRESENT', { '2026-08-10': 'ABSENT' }), leaves: [{ startDate: '2026-08-10', endDate: '2026-08-11', halfDay: 'NONE', paid: false }] }));
    expect(r.lossOfPayDays).toBe('2.00');
    expect(r.basis.lossOfPay.leaveFacts).toBe('2.00');
  });

  it('paid-type leave with an unpaid shortfall: the LAST working days of the request are loss of pay', () => {
    const r = calculatePayslip(base({ records: all('ON_LEAVE'), leaves: [{ startDate: '2026-08-03', endDate: '2026-08-05', halfDay: 'NONE', paid: true, unpaidDays: 1.5 }] }));
    expect(r.lossOfPayDays).toBe('1.50');
    expect(r.basis.lopDays.map((d) => [d.date, d.fraction])).toEqual([['2026-08-04', '0.50'], ['2026-08-05', '1.00']]);
  });

  it('a Sunday inside a leave range is not counted as leave or loss of pay', () => {
    const r = calculatePayslip(base({ records: all('PRESENT'), leaves: [{ startDate: '2026-08-07', endDate: '2026-08-11', halfDay: 'NONE', paid: false }] }));
    expect(r.lossOfPayDays).toBe('4.00'); // Fri, Sat, Mon, Tue (Sun 9 skipped)
  });

  it('half-day unpaid leave costs 0.5; paid half-day leave on a day with a short record keeps the missing half', () => {
    const unpaid = calculatePayslip(base({ leaves: [{ startDate: '2026-08-12', endDate: '2026-08-12', halfDay: 'FIRST_HALF', paid: false }] }));
    expect(unpaid.lossOfPayDays).toBe('0.50');
    const paidHalf = calculatePayslip(base({ leaves: [{ startDate: '2026-08-12', endDate: '2026-08-12', halfDay: 'FIRST_HALF', paid: true }] }));
    expect(paidHalf.lossOfPayDays).toBe('0.00');
    const absentOtherHalf = calculatePayslip(base({ records: all('PRESENT', { '2026-08-12': 'ABSENT' }), leaves: [{ startDate: '2026-08-12', endDate: '2026-08-12', halfDay: 'FIRST_HALF', paid: true }] }));
    expect(absentOtherHalf.lossOfPayDays).toBe('0.50');
  });

  it('loss of pay never exceeds employed days (paid days floor at zero) and deductions > gross is flagged', () => {
    const rec = all('ABSENT');
    const r = calculatePayslip(base({ records: rec, components: [...comps('1000.00'), { key: 'ADV', name: 'Advance', kind: 'DEDUCTION', amount: '500.00' }] }));
    expect(r.paidDays).toBe('0.00');
    expect(r.gross).toBe('0.00');
    expect(r.basis.warnings).not.toContain('DEDUCTIONS_EXCEED_GROSS'); // 0 deductions too: prorated to zero
    const big = calculatePayslip(base({ components: [...comps('1000.00'), { key: 'ADV', name: 'Advance', kind: 'DEDUCTION', amount: '5000.00' }] }));
    expect(big.basis.warnings).toContain('DEDUCTIONS_EXCEED_GROSS');
    expect(big.netBeforeAdjustments).toBe('-4000.00');
  });

  it('an unrecorded closed working day is surfaced as a warning and pays as present (closure is enforced separately)', () => {
    const r = calculatePayslip(base({ records: all('PRESENT').filter((x) => x.date !== '2026-08-05') }));
    expect(r.basis.warnings).toContain('NOT_RECORDED:2026-08-05');
    expect(r.basis.counts.notRecorded).toBe(1);
  });

  it('the basis stores the policy and facts used; no statutory deduction is invented', () => {
    const r = calculatePayslip(base());
    expect(r.basis.policy).toEqual(policy);
    expect(r.deductions).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/PF|ESI|TDS/);
  });
});

describe('computeNet', () => {
  it('adds earning adjustments and subtracts deduction adjustments exactly', () => {
    expect(computeNet('1000.00', '100.00', [{ kind: 'EARNING', amount: '50.25' }, { kind: 'DEDUCTION', amount: '20.10' }])).toEqual({ adjustmentsNet: '30.15', net: '930.15' });
    expect(computeNet('0.10', '0.00', [{ kind: 'EARNING', amount: '0.20' }]).net).toBe('0.30'); // no float drift
    expect(computeNet('100.00', '0.00', [])).toEqual({ adjustmentsNet: '0.00', net: '100.00' });
  });
});

describe('closure + windows', () => {
  const calendar = cal();
  it('employment window clips to join and exit', () => {
    expect(employmentWindow(MONTH, '2026-08-10', '2026-08-20')).toEqual({ from: '2026-08-10', to: '2026-08-20' });
    expect(employmentWindow(MONTH, null, null)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(employmentWindow(MONTH, '2026-09-01', null)).toBeNull();
    expect(employmentWindow(MONTH, '2020-01-01', '2026-07-31')).toBeNull();
  });
  it('month ends only after its last day (business-timezone local day)', () => {
    expect(monthHasEnded(MONTH, '2026-08-31')).toBe(false);
    expect(monthHasEnded(MONTH, '2026-09-01')).toBe(true);
  });
  it('lists employed working days with neither a record nor an approved leave; non-working days need no record', () => {
    const window = employmentWindow(MONTH, null, null);
    const records = all('PRESENT').filter((r) => r.date !== '2026-08-05' && r.date !== '2026-08-06');
    const gaps = findMissingClosedDays({ month: MONTH, today: '2026-09-02', calendar, window, records, leaves: [{ startDate: '2026-08-06', endDate: '2026-08-06', halfDay: 'NONE', paid: true }] });
    expect(gaps).toEqual(['2026-08-05']);
    expect(findMissingClosedDays({ month: MONTH, today: '2026-09-02', calendar, window: null, records: [], leaves: [] })).toEqual([]);
    expect(findMissingClosedDays({ month: MONTH, today: '2026-09-02', calendar, window, records: all('PRESENT'), leaves: [] })).toEqual([]);
  });
  it('days that are not yet past are never closed', () => {
    const window = employmentWindow(MONTH, null, null);
    expect(findMissingClosedDays({ month: MONTH, today: '2026-08-20', calendar, window, records: all('PRESENT'), leaves: [] }).length).toBeGreaterThan(0);
  });
});

describe('run state machine', () => {
  const ok: Array<[PayrollRunStatus, PayrollRunStatus]> = [['DRAFT', 'CALCULATED'], ['CALCULATED', 'CALCULATED'], ['CALCULATED', 'APPROVED'], ['APPROVED', 'PAID'], ['APPROVED', 'DRAFT'], ['CALCULATED', 'DRAFT'], ['DRAFT', 'CANCELLED'], ['APPROVED', 'CANCELLED'], ['CANCELLED', 'DRAFT']];
  const bad: Array<[PayrollRunStatus, PayrollRunStatus]> = [['DRAFT', 'APPROVED'], ['DRAFT', 'PAID'], ['CALCULATED', 'PAID'], ['PAID', 'DRAFT'], ['PAID', 'CANCELLED'], ['PAID', 'APPROVED'], ['CANCELLED', 'APPROVED']];
  it.each(ok)('%s -> %s allowed', (a, b) => expect(canPayrollTransition(a, b)).toBe(true));
  it.each(bad)('%s -> %s refused', (a, b) => expect(canPayrollTransition(a, b)).toBe(false));
  it('employees see payslips only for approved or paid runs', () => {
    expect((['DRAFT', 'CALCULATED', 'CANCELLED'] as const).map(payslipVisibleToEmployee)).toEqual([false, false, false]);
    expect((['APPROVED', 'PAID'] as const).map(payslipVisibleToEmployee)).toEqual([true, true]);
  });
});
