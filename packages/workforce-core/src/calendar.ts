import type { WorkforceConfig } from '@salesos/validation';
import { addDays, eachDay, isoWeekday, type Day } from './dates';

export interface HolidayInput {
  date: Day;
  name: string;
  kind: 'NATIONAL' | 'REGIONAL' | 'COMPANY' | 'OPTIONAL' | 'RESTRICTED';
  status: 'SUGGESTED' | 'APPROVED';
}

export type DayKind = 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY';

export interface WorkCalendar {
  kindOf(day: Day): DayKind;
  holidayOn(day: Day): HolidayInput | null;
  isWorkingDay(day: Day): boolean;
  /** number of working days in [from, to] inclusive */
  workingDaysBetween(from: Day, to: Day): number;
  workingDays(from: Day, to: Day): Day[];
}

/**
 * The organisation's working calendar: weekly offs from policy + APPROVED holidays only (suggestions never count).
 * OPTIONAL / RESTRICTED holidays are not days off unless `holidays.optionalCountAsOff`.
 */
export function buildCalendar(config: Pick<WorkforceConfig, 'weeklyOffDays' | 'holidays'>, holidays: HolidayInput[]): WorkCalendar {
  const off = new Set(config.weeklyOffDays);
  const byDay = new Map<Day, HolidayInput>();
  for (const h of holidays) {
    if (h.status !== 'APPROVED') continue;
    if ((h.kind === 'OPTIONAL' || h.kind === 'RESTRICTED') && !config.holidays.optionalCountAsOff) continue;
    if (!byDay.has(h.date)) byDay.set(h.date, h);
  }
  const kindOf = (day: Day): DayKind => (off.has(isoWeekday(day)) ? 'WEEKLY_OFF' : byDay.has(day) ? 'HOLIDAY' : 'WORKING');
  const workingDays = (from: Day, to: Day) => eachDay(from, to).filter((d) => kindOf(d) === 'WORKING');
  return {
    kindOf,
    holidayOn: (d) => byDay.get(d) ?? null,
    isWorkingDay: (d) => kindOf(d) === 'WORKING',
    workingDaysBetween: (from, to) => (from > to ? 0 : workingDays(from, to).length),
    workingDays: (from, to) => (from > to ? [] : workingDays(from, to)),
  };
}

/** next working day strictly after `day` (bounded search, 366 days) */
export function nextWorkingDay(cal: WorkCalendar, day: Day): Day | null {
  let d = day;
  for (let i = 0; i < 366; i++) {
    d = addDays(d, 1);
    if (cal.isWorkingDay(d)) return d;
  }
  return null;
}
