/**
 * Payroll register engine (DEC-048, area C). PURE: no I/O, no clock, no floats for money.
 *
 * Money is held as integer PAISE in `bigint` (exact) and exchanged as 2-dp decimal strings. Paid / loss-of-pay days are held as
 * integer HUNDREDTHS of a day. The one division (component x paidDays / monthWorkingDays) is done on integers and rounded half-up
 * to the paisa, so every persisted line is an exact paisa amount and gross / deductions / net are sums of those lines.
 *
 * Statutory deductions (PF / ESI / PT / TDS) are NOT computed here and no rate is hard-coded: HR / Finance add them as manual
 * DEDUCTION components or adjustment lines.
 */
import { compareDays, eachDay, monthEnd, monthStart, type Day } from './dates';
import type { WorkCalendar } from './calendar';

export type PayComponentKind = 'EARNING' | 'DEDUCTION';
export type PayAttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'WFH' | 'LATE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'ON_LEAVE' | 'UNPAID_LEAVE';
export type HalfDayPart = 'NONE' | 'FIRST_HALF' | 'SECOND_HALF';

export interface PayComponent {
  key: string;
  name: string;
  kind: PayComponentKind;
  /** monthly amount, positive decimal string with at most 2 dp */
  amount: string;
}
export interface PayAdjustment {
  id?: string;
  label: string;
  kind: PayComponentKind;
  amount: string;
  reason?: string;
}
export interface PayrollRecordFact {
  date: Day;
  status: PayAttendanceStatus;
}
export interface PayrollLeaveFact {
  startDate: Day;
  endDate: Day;
  halfDay: HalfDayPart;
  /** the leave type is paid (false = unpaid type, every day is loss of pay) */
  paid: boolean;
  /** part of a PAID-type request that exceeded the balance (loss of pay); attributed to the LAST working days of the request */
  unpaidDays?: number;
}
export interface PayrollPolicy {
  absentIsLossOfPay: boolean;
  halfDayLossOfPay: number;
}

// ---------------------------------------------------------------------------------------------------------------- money
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
export const isMoneyString = (s: unknown): s is string => typeof s === 'string' && MONEY_RE.test(s);

export function parseMoneyToPaise(s: string): bigint {
  if (!isMoneyString(s)) throw new Error(`Invalid money amount: ${String(s)}`);
  const [whole = '0', frac = ''] = s.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}
export function formatPaise(p: bigint): string {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
/** hundredths of a day -> "12.50" */
export function formatDays(h: number): string {
  return (h / 100).toFixed(2);
}
const sumPaise = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** round-half-up integer division for non-negative numerators and positive denominators */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

/** component paise x paidDays100 / (monthWorkingDays x 100), half-up to the paisa. Zero working days = zero (flagged by the caller). */
export function prorate(amountPaise: bigint, paidDays100: number, monthWorkingDays: number): bigint {
  if (monthWorkingDays <= 0 || paidDays100 <= 0) return 0n;
  const capped = Math.min(paidDays100, monthWorkingDays * 100);
  if (capped === monthWorkingDays * 100) return amountPaise;
  return divRoundHalfUp(amountPaise * BigInt(capped), BigInt(monthWorkingDays) * 100n);
}

// ---------------------------------------------------------------------------------------------------------------- employment window
export interface EmploymentWindow {
  from: Day;
  to: Day;
}
/** [max(joinDate, monthStart), min(exitDate, monthEnd)], or null when the employee was not employed in the month. */
export function employmentWindow(month: string, joinDate: Day | null, exitDate: Day | null): EmploymentWindow | null {
  const ms = monthStart(month);
  const me = monthEnd(month);
  const from = joinDate && joinDate > ms ? joinDate : ms;
  const to = exitDate && exitDate < me ? exitDate : me;
  return compareDays(from, to) > 0 ? null : { from, to };
}

/** A month can be calculated only after it has ended in the business timezone (`today` is the local day). */
export const monthHasEnded = (month: string, today: Day): boolean => monthEnd(month) < today;

// ---------------------------------------------------------------------------------------------------------------- leave facts per day
interface DayLeave {
  /** loss-of-pay fraction in hundredths from leave facts (0..100) */
  lop100: number;
  covered: boolean;
  halfDayLeave: boolean;
}

function leaveByDay(leaves: PayrollLeaveFact[], cal: WorkCalendar, from: Day, to: Day): Map<Day, DayLeave> {
  const out = new Map<Day, DayLeave>();
  const add = (d: Day, lop100: number, half: boolean) => {
    const cur = out.get(d) ?? { lop100: 0, covered: false, halfDayLeave: false };
    out.set(d, { lop100: Math.min(100, cur.lop100 + lop100), covered: true, halfDayLeave: cur.halfDayLeave || half });
  };
  for (const l of leaves) {
    const days = cal.workingDays(l.startDate, l.endDate);
    const half = l.halfDay !== 'NONE';
    const per = half ? 50 : 100;
    // unpaid share of a paid-type request: the last `unpaidDays` working days (hundredths), counted from the end
    let unpaidLeft = l.paid ? Math.round((l.unpaidDays ?? 0) * 100) : days.length * per;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i]!;
      const lop = l.paid ? Math.min(per, unpaidLeft) : per;
      if (l.paid) unpaidLeft -= lop;
      if (d >= from && d <= to) add(d, lop, half);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- closed days
export interface ClosureInput {
  month: string;
  today: Day;
  calendar: WorkCalendar;
  window: EmploymentWindow | null;
  records: PayrollRecordFact[];
  leaves: PayrollLeaveFact[];
}
/**
 * Employed working days that are neither closed by an attendance record nor covered by an approved leave request.
 * Non-working days need no record (the calendar is the truth). Empty = the employee's month is fully closed.
 */
export function findMissingClosedDays(i: ClosureInput): Day[] {
  if (!i.window) return [];
  const have = new Set(i.records.map((r) => r.date));
  const leave = leaveByDay(i.leaves, i.calendar, i.window.from, i.window.to);
  return i.calendar.workingDays(i.window.from, i.window.to).filter((d) => (d >= i.today ? true : !have.has(d) && !leave.has(d)));
}

// ---------------------------------------------------------------------------------------------------------------- calculation
export interface PayslipLine {
  key: string;
  name: string;
  kind: PayComponentKind;
  /** full monthly amount from the structure */
  fullAmount: string;
  /** prorated amount for the paid days */
  amount: string;
}
export interface LopDay {
  date: Day;
  /** 0.50 / 1.00 */
  fraction: string;
  reason: string;
}
export interface PayslipBasis {
  month: string;
  employedFrom: Day | null;
  employedTo: Day | null;
  monthWorkingDays: number;
  employedWorkingDays: number;
  counts: Record<'present' | 'wfh' | 'late' | 'halfDay' | 'absent' | 'unpaidLeave' | 'paidLeave' | 'holiday' | 'weeklyOff' | 'notRecorded', number>;
  lossOfPay: { unpaidLeave: string; absent: string; halfDay: string; leaveFacts: string; total: string };
  lossOfPayDays: string;
  paidDays: string;
  policy: PayrollPolicy;
  lopDays: LopDay[];
  warnings: string[];
}
export interface PayslipCalc {
  employedWorkingDays: number;
  monthWorkingDays: number;
  lossOfPayDays: string;
  paidDays: string;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  gross: string;
  totalDeductions: string;
  /** gross - deductions (adjustments are added by `computeNet`) */
  netBeforeAdjustments: string;
  basis: PayslipBasis;
}
export interface CalcInput {
  month: string;
  calendar: WorkCalendar;
  joinDate: Day | null;
  exitDate: Day | null;
  policy: PayrollPolicy;
  /** attendance rows of CLOSED days only */
  records: PayrollRecordFact[];
  /** APPROVED leave requests overlapping the month */
  leaves: PayrollLeaveFact[];
  components: PayComponent[];
}

const hundredths = (fraction: number) => Math.max(0, Math.min(100, Math.round(fraction * 100)));

export function calculatePayslip(i: CalcInput): PayslipCalc {
  const window = employmentWindow(i.month, i.joinDate, i.exitDate);
  const monthWd = i.calendar.workingDaysBetween(monthStart(i.month), monthEnd(i.month));
  const warnings: string[] = [];
  const counts = { present: 0, wfh: 0, late: 0, halfDay: 0, absent: 0, unpaidLeave: 0, paidLeave: 0, holiday: 0, weeklyOff: 0, notRecorded: 0 };
  const lopDays: LopDay[] = [];
  let lopUnpaid = 0;
  let lopAbsent = 0;
  let lopHalf = 0;
  let lopLeave = 0;
  let employedWd = 0;

  if (window) {
    const workDays = i.calendar.workingDays(window.from, window.to);
    employedWd = workDays.length;
    const rec = new Map(i.records.map((r) => [r.date, r.status] as const));
    const leave = leaveByDay(i.leaves, i.calendar, window.from, window.to);
    const hd = hundredths(i.policy.halfDayLossOfPay);
    for (const d of workDays) {
      const status = rec.get(d);
      const lv = leave.get(d);
      let recLop = 0;
      let reason = '';
      switch (status) {
        case 'UNPAID_LEAVE': recLop = 100; counts.unpaidLeave++; reason = 'UNPAID_LEAVE'; break;
        case 'ABSENT': recLop = i.policy.absentIsLossOfPay ? 100 : 0; counts.absent++; reason = 'ABSENT'; break;
        case 'HALF_DAY': recLop = hd; counts.halfDay++; reason = 'HALF_DAY'; break;
        case 'ON_LEAVE': counts.paidLeave++; break;
        case 'PRESENT': counts.present++; break;
        case 'WFH': counts.wfh++; break;
        case 'LATE': counts.late++; break;
        case 'HOLIDAY': counts.holiday++; break;
        case 'WEEKLY_OFF': counts.weeklyOff++; break;
        default: counts.notRecorded++; if (!lv) warnings.push(`NOT_RECORDED:${d}`);
      }
      let lop = recLop;
      if (lv) {
        if (!lv.halfDayLeave) {
          // an approved full-day leave is the truth for the day (the day-close job may have run before the approval)
          lop = lv.lop100;
          reason = lv.lop100 > 0 ? 'UNPAID_LEAVE_APPROVED' : '';
        } else {
          // half-day leave: the leave half costs its own loss of pay; a missing other half (absent / short day) still counts
          const base = status === 'UNPAID_LEAVE' || status === 'ON_LEAVE' ? 0 : recLop;
          lop = Math.min(100, lv.lop100 + Math.max(0, base - 50));
          reason = lop > 0 ? (base > 50 ? `${reason}+HALF_DAY_LEAVE` : 'UNPAID_HALF_DAY_LEAVE') : '';
        }
      }
      if (lop > 0) {
        lopDays.push({ date: d, fraction: formatDays(lop), reason });
        if (lv) lopLeave += lop;
        else if (status === 'UNPAID_LEAVE') lopUnpaid += lop;
        else if (status === 'ABSENT') lopAbsent += lop;
        else if (status === 'HALF_DAY') lopHalf += lop;
      }
    }
  } else {
    warnings.push('NOT_EMPLOYED_IN_MONTH');
  }
  if (monthWd === 0) warnings.push('ZERO_WORKING_DAYS_IN_MONTH');

  const lop100 = lopUnpaid + lopAbsent + lopHalf + lopLeave;
  const paid100 = Math.max(0, employedWd * 100 - lop100);
  const line = (c: PayComponent): PayslipLine => ({ key: c.key, name: c.name, kind: c.kind, fullAmount: formatPaise(parseMoneyToPaise(c.amount)), amount: formatPaise(prorate(parseMoneyToPaise(c.amount), paid100, monthWd)) });
  const lines = i.components.map(line);
  const earnings = lines.filter((l) => l.kind === 'EARNING');
  const deductions = lines.filter((l) => l.kind === 'DEDUCTION');
  const gross = sumPaise(earnings.map((l) => parseMoneyToPaise(l.amount)));
  const ded = sumPaise(deductions.map((l) => parseMoneyToPaise(l.amount)));
  if (ded > gross) warnings.push('DEDUCTIONS_EXCEED_GROSS');

  return {
    employedWorkingDays: employedWd,
    monthWorkingDays: monthWd,
    lossOfPayDays: formatDays(lop100),
    paidDays: formatDays(paid100),
    earnings,
    deductions,
    gross: formatPaise(gross),
    totalDeductions: formatPaise(ded),
    netBeforeAdjustments: formatPaise(gross - ded),
    basis: {
      month: i.month,
      employedFrom: window?.from ?? null,
      employedTo: window?.to ?? null,
      monthWorkingDays: monthWd,
      employedWorkingDays: employedWd,
      counts,
      lossOfPay: { unpaidLeave: formatDays(lopUnpaid), absent: formatDays(lopAbsent), halfDay: formatDays(lopHalf), leaveFacts: formatDays(lopLeave), total: formatDays(lop100) },
      lossOfPayDays: formatDays(lop100),
      paidDays: formatDays(paid100),
      policy: i.policy,
      lopDays,
      warnings,
    },
  };
}

/** Net = gross earnings - deductions + (earning adjustments - deduction adjustments). All exact paise. */
export function computeNet(grossStr: string, totalDeductionsStr: string, adjustments: Array<Pick<PayAdjustment, 'kind' | 'amount'>>): { adjustmentsNet: string; net: string } {
  const adj = sumPaise(adjustments.map((a) => (a.kind === 'EARNING' ? 1n : -1n) * parseMoneyToPaise(a.amount)));
  return { adjustmentsNet: formatPaise(adj), net: formatPaise(parseMoneyToPaise(grossStr) - parseMoneyToPaise(totalDeductionsStr) + adj) };
}

/** All days of a month (helper for UIs / tests) */
export const daysOfMonth = (month: string): Day[] => eachDay(monthStart(month), monthEnd(month));

// ---------------------------------------------------------------------------------------------------------------- run state machine
export type PayrollRunStatus = 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'PAID' | 'CANCELLED';
/** DRAFT -> CALCULATED (recalculable) -> APPROVED -> PAID; send-back CALCULATED/APPROVED -> DRAFT; cancel before PAID; CANCELLED re-opens to DRAFT. */
export const PAYROLL_TRANSITIONS: Record<PayrollRunStatus, PayrollRunStatus[]> = {
  DRAFT: ['CALCULATED', 'CANCELLED'],
  CALCULATED: ['CALCULATED', 'APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['PAID', 'DRAFT', 'CANCELLED'],
  PAID: [],
  CANCELLED: ['DRAFT'],
};
export const canPayrollTransition = (from: PayrollRunStatus, to: PayrollRunStatus): boolean => PAYROLL_TRANSITIONS[from].includes(to);
/** Employees may open their payslip only once the run is approved. */
export const payslipVisibleToEmployee = (status: PayrollRunStatus): boolean => status === 'APPROVED' || status === 'PAID';
