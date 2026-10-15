import { resolveWorkforceConfig } from '@salesos/validation';
import { addMonths, daysBetweenInclusive, type Day } from './dates';

/**
 * HR automation helpers (DEC-048 area D2): probation dates, birthdays and the status derived from them. Pure and timezone-neutral.
 * `dateOfBirth` is HR data: callers that expose a birthday to the team must pass only `{ month, day }` (never the year).
 */

/** whole days from `from` to `to` (negative when `to` is earlier) */
export const dayDiff = (from: Day, to: Day): number => (to === from ? 0 : to > from ? daysBetweenInclusive(from, to) - 1 : -(daysBetweenInclusive(to, from) - 1));

/** Probation end = joinDate + months (calendar months, day clamped). A stored override wins (set by an EXTEND decision or HR). */
export function probationEnd(joinDate: Day, months: number, override?: Day | null): Day {
  return override ?? addMonths(joinDate, months);
}

export type ProbationDecisionKind = 'CONFIRM' | 'EXTEND' | 'MARK_FOR_REVIEW';
export type ProbationState = 'IN_PROBATION' | 'ENDING_SOON' | 'DECISION_DUE' | 'UNDER_REVIEW' | 'CONFIRMED';

/**
 * State of an employee's probation on `today`.
 * CONFIRMED / UNDER_REVIEW come from the latest decision; otherwise the end date decides:
 * past end without a confirmation = DECISION_DUE, within `soonDays` = ENDING_SOON, else IN_PROBATION. An EXTEND decision simply moves the end date.
 */
export function probationState(endDate: Day, today: Day, soonDays: number, latestDecision?: ProbationDecisionKind | null): { state: ProbationState; daysLeft: number } {
  const daysLeft = dayDiff(today, endDate);
  if (latestDecision === 'CONFIRM') return { state: 'CONFIRMED', daysLeft };
  if (latestDecision === 'MARK_FOR_REVIEW') return { state: 'UNDER_REVIEW', daysLeft };
  if (daysLeft < 0) return { state: 'DECISION_DUE', daysLeft };
  if (daysLeft <= soonDays) return { state: 'ENDING_SOON', daysLeft };
  return { state: 'IN_PROBATION', daysLeft };
}

/** `MM-DD` of a date of birth. Never includes the year. */
export const monthDay = (dob: Day): { month: number; day: number } => ({ month: Number(dob.slice(5, 7)), day: Number(dob.slice(8, 10)) });

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Next occurrence (on or after `today`) of a birthday. A 29 February birthday is observed on 28 February in non-leap years. */
export function nextBirthday(dob: Day, today: Day): { date: Day; daysUntil: number } {
  const { month, day } = monthDay(dob);
  const year = Number(today.slice(0, 4));
  const on = (y: number): Day => {
    const d = month === 2 && day === 29 && !isLeap(y) ? 28 : day;
    return `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let date = on(year);
  if (date < today) date = on(year + 1);
  return { date, daysUntil: dayDiff(today, date) };
}

/** True when a reminder with `reminderDays` (e.g. [7,3,1]) is due today for something that happens in `daysUntil` days. */
export const reminderDueToday = (daysUntil: number, reminderDays: readonly number[]): boolean => reminderDays.includes(daysUntil);

export interface HrPolicy {
  timezone: string;
  probationDefaultMonths: number;
  probationReminderDays: number[];
  birthdayReminderDays: number[];
}
/** Resolve the HR automation policy from a stored `workforce_settings.config` value (defaults fill the gaps). */
export function hrPolicy(raw: unknown): HrPolicy {
  const c = resolveWorkforceConfig(raw);
  return { timezone: c.timezone, probationDefaultMonths: c.hr.probationDefaultMonths, probationReminderDays: c.hr.probationReminderDays, birthdayReminderDays: c.hr.birthdayReminderDays };
}

/** `probation_reviews.checkpointDay` values >= this are workforce probation DECISION rows (checkpoint reviews use 7..365). */
export const PROBATION_DECISION_BASE = 1000;
