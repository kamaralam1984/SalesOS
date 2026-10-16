import { resolveWorkforceConfig, type AttendanceStatusKey, type WorkforceConfig } from '@salesos/validation';
import { hhmmToMinutes, localDay, localMinutes, type Day } from './dates';
import type { WorkCalendar } from './calendar';

/** Statuses a person can have by their own check-in. */
export type CheckInStatus = 'PRESENT' | 'LATE' | 'WFH';

/**
 * Status of a self check-in. WFH wins over lateness (no commute window to measure); an office check-in after `lateAfter` (local time,
 * strictly after) is LATE, at or before it PRESENT.
 */
export function classifyCheckIn(config: Pick<WorkforceConfig, 'timezone' | 'attendance'>, at: Date, mode: 'OFFICE' | 'WFH'): CheckInStatus {
  if (mode === 'WFH') return 'WFH';
  return localMinutes(at, config.timezone) > hhmmToMinutes(config.attendance.lateAfter) ? 'LATE' : 'PRESENT';
}

/** Self check-in is open up to and including `attendance.checkInCutoff` (local time). */
export function isCheckInOpen(config: Pick<WorkforceConfig, 'timezone' | 'attendance'>, at: Date): boolean {
  return localMinutes(at, config.timezone) <= hhmmToMinutes(config.attendance.checkInCutoff);
}

/** Minutes after `lateAfter` (local time) at which the person checked in; 0 when on time. Null for WFH (no commute window to measure). */
export function lateMinutesOf(config: Pick<WorkforceConfig, 'timezone' | 'attendance'>, checkInAt: Date, mode: 'OFFICE' | 'WFH' = 'OFFICE'): number | null {
  if (mode === 'WFH') return null;
  return Math.max(0, localMinutes(checkInAt, config.timezone) - hhmmToMinutes(config.attendance.lateAfter));
}

/** How late it is right now (minutes since `lateAfter`, local time) for someone who has not checked in yet; 0 before then. */
export const lateSoFarMinutes = (config: Pick<WorkforceConfig, 'timezone' | 'attendance'>, now: Date): number =>
  Math.max(0, localMinutes(now, config.timezone) - hhmmToMinutes(config.attendance.lateAfter));

/** Minutes worked beyond `workdayEnd` on the record's day (check-out after e.g. 19:00); 0 when out on or before it. */
export function overtimeMinutesOf(config: Pick<WorkforceConfig, 'timezone' | 'attendance'>, day: Day, checkOutAt: Date): number {
  const end = new Date(startOfLocalDay(day, config.timezone).getTime() + hhmmToMinutes(config.attendance.workdayEnd) * 60_000);
  return minutesBetween(end, checkOutAt);
}

/** Statuses that count as "marked present" for showing the meeting link. */
export const MEETING_STATUSES: readonly AttendanceStatusKey[] = ['PRESENT', 'LATE', 'WFH', 'HALF_DAY'];
export const canSeeMeeting = (status: AttendanceStatusKey): boolean => MEETING_STATUSES.includes(status);

export interface CheckOutResult {
  workMinutes: number;
  status: AttendanceStatusKey;
  /** worked less than halfDayMinutes: stays HALF_DAY (never silently ABSENT) but is flagged for manager review */
  needsReview: boolean;
}

/** Whole minutes between two instants (never negative). */
export const minutesBetween = (from: Date, to: Date): number => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));

/** Check-out: sets work minutes; below `fullDayMinutes` the day becomes HALF_DAY (below `halfDayMinutes` it is also flagged). */
export function classifyCheckOut(config: Pick<WorkforceConfig, 'attendance'>, current: AttendanceStatusKey, checkInAt: Date, checkOutAt: Date): CheckOutResult {
  const workMinutes = minutesBetween(checkInAt, checkOutAt);
  const { fullDayMinutes, halfDayMinutes } = config.attendance;
  if (workMinutes >= fullDayMinutes) return { workMinutes, status: current, needsReview: false };
  return { workMinutes, status: 'HALF_DAY', needsReview: workMinutes < halfDayMinutes };
}

/** An approved leave covering a day, reduced to what the day-close needs. */
export interface LeaveCover {
  /** full-day paid -> ON_LEAVE, unpaid -> UNPAID_LEAVE; HALF = half-day request */
  kind: 'ON_LEAVE' | 'UNPAID_LEAVE' | 'HALF';
}

/**
 * Status the nightly day-close writes for a CLOSED day that has no attendance record (never used when a record exists):
 * weekly off / approved holiday first, then approved leave, else ABSENT when `autoMarkAbsent` (null = leave the day unmarked).
 * A half-day leave with no record is HALF_DAY (the other half has no attendance either).
 */
export function deriveClosedDayStatus(input: { day: Day; calendar: WorkCalendar; cover: LeaveCover | null; autoMarkAbsent: boolean }): AttendanceStatusKey | null {
  const kind = input.calendar.kindOf(input.day);
  if (kind === 'WEEKLY_OFF') return 'WEEKLY_OFF';
  if (kind === 'HOLIDAY') return 'HOLIDAY';
  if (input.cover) return input.cover.kind === 'HALF' ? 'HALF_DAY' : input.cover.kind;
  return input.autoMarkAbsent ? 'ABSENT' : null;
}

/** A day is closed once the business-timezone date has moved past it. */
export const isClosedDay = (day: Day, now: Date, timeZone: string): boolean => day < localDay(now, timeZone);

export type AttendanceSummary = Record<AttendanceStatusKey, number> & { workMinutes: number };

export function emptySummary(): AttendanceSummary {
  return { PRESENT: 0, ABSENT: 0, HALF_DAY: 0, WFH: 0, LATE: 0, HOLIDAY: 0, WEEKLY_OFF: 0, ON_LEAVE: 0, UNPAID_LEAVE: 0, workMinutes: 0 };
}

export function summarise(records: Array<{ status: AttendanceStatusKey; workMinutes?: number | null }>): AttendanceSummary {
  const s = emptySummary();
  for (const r of records) {
    s[r.status] += 1;
    s.workMinutes += r.workMinutes ?? 0;
  }
  return s;
}

/** UTC instant of local midnight of `day` in `timeZone` (DST-safe: re-checks after the first offset estimate). */
export function startOfLocalDay(day: Day, timeZone: string): Date {
  let guess = new Date(`${day}T00:00:00Z`).getTime();
  for (let i = 0; i < 3; i++) {
    const at = new Date(guess);
    const shown = new Date(`${localDay(at, timeZone)}T00:00:00Z`).getTime() + localMinutes(at, timeZone) * 60_000;
    const delta = shown - new Date(`${day}T00:00:00Z`).getTime();
    if (delta === 0) break;
    guess -= delta;
  }
  return new Date(guess);
}

/** The organisation's full workforce policy from the stored JSON (defaults merged in). For callers (the worker) that do not depend on @salesos/validation. */
export const resolveWorkConfig = (stored: unknown): WorkforceConfig => resolveWorkforceConfig(stored);
