/**
 * Target / forecast period helpers (DEC-001). Dates are date-only ISO strings (YYYY-MM-DD) in the org calendar (IST).
 * Month = calendar month, quarter = calendar quarter, year = fiscal year starting in `fiscalYearStartMonth` (default 4 = April).
 */
export type PeriodType = 'MONTH' | 'QUARTER' | 'YEAR';
export type ForecastPeriod = 'WEEK' | 'MONTH';

export interface PeriodBounds {
  startsOn: string;
  endsOn: string;
  label: string;
}

const IST_OFFSET_MS = 5.5 * 3_600_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m1: number, d: number) => `${y}-${pad(m1)}-${pad(d)}`;
const utc = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (dt: Date) => iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
export const addDays = (s: string, n: number): string => fmt(new Date(utc(s).getTime() + n * 86_400_000));
const lastDayOfMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(utc(s)) === s;

/** The IST calendar date (YYYY-MM-DD) of an instant. */
export const istDate = (d: Date): string => fmt(new Date(d.getTime() + IST_OFFSET_MS));

/** [start, end) instants for the inclusive IST date range. */
export function istRange(startsOn: string, endsOn: string): { from: Date; to: Date } {
  return { from: new Date(utc(startsOn).getTime() - IST_OFFSET_MS), to: new Date(utc(addDays(endsOn, 1)).getTime() - IST_OFFSET_MS) };
}

export function periodBounds(type: PeriodType, anchor: string, fiscalYearStartMonth = 4): PeriodBounds {
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  if (type === 'MONTH') {
    return { startsOn: iso(y, m, 1), endsOn: iso(y, m, lastDayOfMonth(y, m)), label: `${MONTHS[m - 1]} ${y}` };
  }
  if (type === 'QUARTER') {
    const q = Math.floor((m - 1) / 3);
    const sm = q * 3 + 1;
    return { startsOn: iso(y, sm, 1), endsOn: iso(y, sm + 2, lastDayOfMonth(y, sm + 2)), label: `Q${q + 1} ${y}` };
  }
  const startYear = m >= fiscalYearStartMonth ? y : y - 1;
  const startsOn = iso(startYear, fiscalYearStartMonth, 1);
  const endsOn = addDays(iso(startYear + 1, fiscalYearStartMonth, 1), -1);
  const label = fiscalYearStartMonth === 1 ? `${startYear}` : `FY ${startYear}-${String(startYear + 1).slice(2)}`;
  return { startsOn, endsOn, label };
}

/** Forecast periods: WEEK = Monday..Sunday (ISO), MONTH = calendar month. */
export function forecastBounds(type: ForecastPeriod, anchor: string): PeriodBounds {
  if (type === 'MONTH') return periodBounds('MONTH', anchor);
  const dow = utc(anchor).getUTCDay(); // 0 Sunday
  const back = dow === 0 ? 6 : dow - 1;
  const startsOn = addDays(anchor, -back);
  return { startsOn, endsOn: addDays(startsOn, 6), label: `Week of ${startsOn}` };
}

/** Number of working days (Mon-Sat; Sunday is the weekly off) in the inclusive range. */
export function workingDays(startsOn: string, endsOn: string): number {
  let n = 0;
  for (let t = utc(startsOn).getTime(), end = utc(endsOn).getTime(); t <= end; t += 86_400_000) {
    if (new Date(t).getUTCDay() !== 0) n += 1;
  }
  return n;
}

export const daysBetweenInclusive = (a: string, b: string): number => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000) + 1;

export interface ProrationBasis {
  workingDaysPeriod: number;
  workingDaysActive: number;
  joinOn: string | null;
  leaveOn: string | null;
}

/** DEC-001 mid-period joiner / leaver: working days (Mon-Sat) the person is active vs the whole period. Stored explicitly. */
export function prorationBasis(periodStart: string, periodEnd: string, joinOn?: string | null, leaveOn?: string | null): ProrationBasis {
  const from = joinOn && joinOn > periodStart ? joinOn : periodStart;
  const to = leaveOn && leaveOn < periodEnd ? leaveOn : periodEnd;
  const active = from > to ? 0 : workingDays(from, to);
  return { workingDaysPeriod: workingDays(periodStart, periodEnd), workingDaysActive: active, joinOn: joinOn ?? null, leaveOn: leaveOn ?? null };
}

/** Linear day-count pacing: fraction of the period elapsed at the end of `asOf` (0..1, as a ratio of integers). */
export function elapsedDays(periodStart: string, periodEnd: string, asOf: string): { elapsed: number; total: number } {
  const total = daysBetweenInclusive(periodStart, periodEnd);
  if (asOf < periodStart) return { elapsed: 0, total };
  if (asOf >= periodEnd) return { elapsed: total, total };
  return { elapsed: daysBetweenInclusive(periodStart, asOf), total };
}
