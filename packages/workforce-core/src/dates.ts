/**
 * Calendar-day helpers. A "day" is a plain `YYYY-MM-DD` string in the BUSINESS timezone (never a Date), so the engines are
 * timezone-neutral and trivially testable. Convert instants with `localDay`.
 */
export type Day = string;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s: unknown): s is Day => typeof s === 'string' && DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const toUtc = (d: Day) => new Date(`${d}T00:00:00Z`);
const fromUtc = (d: Date): Day => d.toISOString().slice(0, 10);

export function localDay(instant: Date, timeZone: string): Day {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** minutes since local midnight for an instant in a timezone */
export function localMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  return Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value);
}

export const hhmmToMinutes = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

export const addDays = (d: Day, n: number): Day => fromUtc(new Date(toUtc(d).getTime() + n * 86_400_000));
/** ISO weekday: 1 = Monday ... 7 = Sunday */
export const isoWeekday = (d: Day): number => ((toUtc(d).getUTCDay() + 6) % 7) + 1;
export const compareDays = (a: Day, b: Day): number => (a < b ? -1 : a > b ? 1 : 0);
export const daysBetweenInclusive = (from: Day, to: Day): number => Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000) + 1;

export function eachDay(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const monthOf = (d: Day): string => d.slice(0, 7);
export const monthStart = (month: string): Day => `${month}-01`;
export function monthEnd(month: string): Day {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return fromUtc(new Date(Date.UTC(y, m, 0)));
}

/** add calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). Used for probation end dates. */
export function addMonths(d: Day, months: number): Day {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return fromUtc(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last))));
}
