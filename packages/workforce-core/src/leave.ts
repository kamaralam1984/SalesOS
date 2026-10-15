import type { WorkforceConfig } from '@salesos/validation';
import type { WorkCalendar } from './calendar';
import { eachDay, type Day } from './dates';
import type { LeaveCover } from './attendance';

export type LeaveHalfDay = 'NONE' | 'FIRST_HALF' | 'SECOND_HALF';
export type LeaveRequestStatusKey = 'PENDING_MANAGER' | 'PENDING_HR' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type LeaveStepKey = 'MANAGER' | 'HR';
export type LeaveStepStatusKey = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';

/** Round to 2 dp (leave days are multiples of 0.5; guards against float noise from sums). */
export const roundDays = (n: number): number => Math.round(n * 100) / 100;

/** Working days of a request: weekly offs and approved holidays never count; a half day is 0.5 (single day only) and 0 on a non-working day. */
export function countLeaveDays(cal: WorkCalendar, start: Day, end: Day, halfDay: LeaveHalfDay = 'NONE'): number {
  if (end < start) return 0;
  if (halfDay !== 'NONE') return start === end && cal.isWorkingDay(start) ? 0.5 : 0;
  return cal.workingDaysBetween(start, end);
}

export interface RequestSpan {
  startDate: Day;
  endDate: Day;
  halfDay: LeaveHalfDay;
}

/** Two requests clash when their date ranges intersect, except two single-day half days on opposite halves of the same day. */
export function leaveOverlaps(a: RequestSpan, b: RequestSpan): boolean {
  if (a.endDate < b.startDate || b.endDate < a.startDate) return false;
  const singleHalf = (r: RequestSpan) => r.startDate === r.endDate && r.halfDay !== 'NONE';
  if (singleHalf(a) && singleHalf(b) && a.startDate === b.startDate && a.halfDay !== b.halfDay) return false;
  return true;
}

export type BalanceVerdict =
  | { ok: true; unpaidDays: number }
  | { ok: false; code: 'INSUFFICIENT_BALANCE' | 'UNPAID_CONFIRMATION_REQUIRED'; shortfall: number; available: number };

/**
 * Balance rule: `available` already excludes days reserved by other pending requests. A shortfall is blocked, or (policy
 * UNPAID_WITH_CONFIRMATION) allowed as unpaid days only when the employee explicitly confirmed.
 */
export function evaluateBalance(input: { days: number; available: number; needsBalance: boolean; balanceExceeded: WorkforceConfig['leave']['balanceExceeded']; confirmUnpaid: boolean }): BalanceVerdict {
  if (!input.needsBalance) return { ok: true, unpaidDays: 0 };
  const available = Math.max(0, roundDays(input.available));
  const shortfall = roundDays(input.days - available);
  if (shortfall <= 0) return { ok: true, unpaidDays: 0 };
  if (input.balanceExceeded === 'BLOCK') return { ok: false, code: 'INSUFFICIENT_BALANCE', shortfall, available };
  if (!input.confirmUnpaid) return { ok: false, code: 'UNPAID_CONFIRMATION_REQUIRED', shortfall, available };
  return { ok: true, unpaidDays: shortfall };
}

export interface PlannedStep {
  step: LeaveStepKey;
  status: LeaveStepStatusKey;
}

/**
 * Approval steps for a new request. The MANAGER step is SKIPPED when the applicant has no manager. If that would leave no step
 * waiting (e.g. chain = [MANAGER] and no manager), an HR step is added so nobody can approve their own leave by omission.
 */
export function planApprovalSteps(chain: WorkforceConfig['leave']['approvalChain'], hasManager: boolean): { steps: PlannedStep[]; status: LeaveRequestStatusKey } {
  const steps: PlannedStep[] = chain.map((step) => ({ step, status: step === 'MANAGER' && !hasManager ? 'SKIPPED' : 'PENDING' }));
  if (!steps.some((s) => s.status === 'PENDING')) steps.push({ step: 'HR', status: 'PENDING' });
  return { steps, status: statusFromSteps(steps) };
}

/** Request status implied by its steps: the first PENDING step waits, any REJECTED rejects, else APPROVED. */
export function statusFromSteps(steps: PlannedStep[]): LeaveRequestStatusKey {
  if (steps.some((s) => s.status === 'REJECTED')) return 'REJECTED';
  const waiting = steps.find((s) => s.status === 'PENDING');
  if (!waiting) return 'APPROVED';
  return waiting.step === 'MANAGER' ? 'PENDING_MANAGER' : 'PENDING_HR';
}

/** The step that is currently waiting for a decision, from the request status. */
export const currentStep = (status: LeaveRequestStatusKey): LeaveStepKey | null => (status === 'PENDING_MANAGER' ? 'MANAGER' : status === 'PENDING_HR' ? 'HR' : null);

/** Apply a decision to the waiting step and return the new steps + request status (pure; the service persists it). */
export function applyDecision(steps: PlannedStep[], step: LeaveStepKey, decision: 'APPROVE' | 'REJECT'): { steps: PlannedStep[]; status: LeaveRequestStatusKey } {
  const next = steps.map((s) => (s.step === step && s.status === 'PENDING' ? { ...s, status: decision === 'APPROVE' ? ('APPROVED' as const) : ('REJECTED' as const) } : s));
  return { steps: next, status: statusFromSteps(next) };
}

/**
 * Day-by-day cover of an APPROVED request over working days: the first `days - unpaidDays` days are paid leave (ON_LEAVE), the
 * remainder UNPAID_LEAVE; unpaid types are UNPAID_LEAVE throughout; a half-day request is a single HALF day.
 */
export function leaveCoverage(req: RequestSpan & { days: number; unpaidDays: number }, paidType: boolean, cal: WorkCalendar): Map<Day, LeaveCover> {
  const out = new Map<Day, LeaveCover>();
  if (req.halfDay !== 'NONE') {
    if (cal.isWorkingDay(req.startDate)) out.set(req.startDate, { kind: 'HALF' });
    return out;
  }
  const working = eachDay(req.startDate, req.endDate).filter((d) => cal.isWorkingDay(d));
  const paidDays = paidType ? Math.max(0, Math.round(req.days - req.unpaidDays)) : 0;
  working.forEach((d, i) => out.set(d, { kind: i < paidDays ? 'ON_LEAVE' : 'UNPAID_LEAVE' }));
  return out;
}
