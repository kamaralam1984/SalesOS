/** Working-hours aware scheduling (DEC-020: Mon-Sat, 09:00-19:00 Asia/Kolkata by default, configurable). */
export interface WorkingHours {
  timezone: string;
  /** ISO weekday numbers, 1 = Monday ... 7 = Sunday */
  days: number[];
  /** HH:MM local */
  start: string;
  end: string;
  /** YYYY-MM-DD local dates excluded from working time */
  holidays: string[];
}

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  timezone: 'Asia/Kolkata',
  days: [1, 2, 3, 4, 5, 6],
  start: '09:00',
  end: '19:00',
  holidays: [],
};

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  /** ISO weekday 1..7 */
  dow: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string): Parts {
  const map: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(date)) if (p.type !== 'literal') map[p.type] = Number(p.value);
  const utcDow = new Date(Date.UTC(map.year!, map.month! - 1, map.day!)).getUTCDay();
  return { y: map.year!, m: map.month!, d: map.day!, h: map.hour!, min: map.minute!, dow: utcDow === 0 ? 7 : utcDow };
}

function offsetMs(date: Date, tz: string): number {
  const map: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(date)) if (p.type !== 'literal') map[p.type] = Number(p.value);
  const asUtc = Date.UTC(map.year!, map.month! - 1, map.day!, map.hour!, map.minute!, map.second!);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Local wall-clock time in tz -> UTC instant. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

const hm = (s: string): number => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const ymd = (p: Pick<Parts, 'y' | 'm' | 'd'>) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;

export function isWorkingDay(p: Pick<Parts, 'y' | 'm' | 'd' | 'dow'>, wh: WorkingHours): boolean {
  return wh.days.includes(p.dow) && !wh.holidays.includes(ymd(p));
}

export function workingMinutesPerDay(wh: WorkingHours): number {
  return Math.max(0, hm(wh.end) - hm(wh.start));
}

/** Local midnight of the day after (y,m,d) in UTC. */
function nextDayParts(p: Pick<Parts, 'y' | 'm' | 'd'>, tz: string): Parts {
  const noon = zonedToUtc(p.y, p.m, p.d, 12, 0, tz);
  return zonedParts(new Date(noon.getTime() + DAY), tz);
}

/** The opening time of the first working day strictly after the day of `p`. */
function nextOpening(p: Parts, wh: WorkingHours): Date {
  let cur = p;
  for (let i = 0; i < 400; i++) {
    cur = nextDayParts(cur, wh.timezone);
    if (isWorkingDay(cur, wh)) {
      const s = hm(wh.start);
      return zonedToUtc(cur.y, cur.m, cur.d, Math.floor(s / 60), s % 60, wh.timezone);
    }
  }
  throw new Error('No working day found within 400 days: check the working-hours configuration');
}

/** `date` if inside working time, otherwise the next opening. */
export function nextWorkingTime(date: Date, wh: WorkingHours): Date {
  const p = zonedParts(date, wh.timezone);
  const mins = p.h * 60 + p.min;
  if (isWorkingDay(p, wh)) {
    if (mins >= hm(wh.start) && mins < hm(wh.end)) return date;
    if (mins < hm(wh.start)) return zonedToUtc(p.y, p.m, p.d, Math.floor(hm(wh.start) / 60), hm(wh.start) % 60, wh.timezone);
  }
  return nextOpening(p, wh);
}

export function isWithinWorkingHours(date: Date, wh: WorkingHours): boolean {
  return nextWorkingTime(date, wh).getTime() === date.getTime();
}

/** Add working minutes (skips nights, non-working days, holidays). */
export function addWorkingMinutes(from: Date, minutes: number, wh: WorkingHours): Date {
  if (minutes < 0) throw new Error('minutes must be >= 0');
  let cur = nextWorkingTime(from, wh);
  let remaining = minutes;
  for (let guard = 0; guard < 5000; guard++) {
    const p = zonedParts(cur, wh.timezone);
    const endUtc = zonedToUtc(p.y, p.m, p.d, Math.floor(hm(wh.end) / 60), hm(wh.end) % 60, wh.timezone);
    const left = Math.floor((endUtc.getTime() - cur.getTime()) / MIN);
    if (remaining < left) return new Date(cur.getTime() + remaining * MIN);
    remaining -= left;
    cur = nextOpening(p, wh);
    if (remaining === 0) return cur;
  }
  throw new Error('addWorkingMinutes did not converge');
}

/** Same local time-of-day, `days` working days later (clamped into working hours). */
export function addWorkingDays(from: Date, days: number, wh: WorkingHours): Date {
  let cur = nextWorkingTime(from, wh);
  const tod = zonedParts(cur, wh.timezone);
  let p: Parts = tod;
  for (let i = 0; i < days; i++) {
    for (let g = 0; g < 400; g++) {
      p = nextDayParts(p, wh.timezone);
      if (isWorkingDay(p, wh)) break;
    }
  }
  cur = zonedToUtc(p.y, p.m, p.d, tod.h, tod.min, wh.timezone);
  return nextWorkingTime(cur, wh);
}

/** Working minutes elapsed between a and b (0 if b <= a). */
export function workingMinutesBetween(a: Date, b: Date, wh: WorkingHours): number {
  if (b.getTime() <= a.getTime()) return 0;
  let total = 0;
  let cur = a;
  for (let guard = 0; guard < 5000 && cur.getTime() < b.getTime(); guard++) {
    const open = nextWorkingTime(cur, wh);
    if (open.getTime() >= b.getTime()) break;
    const p = zonedParts(open, wh.timezone);
    const endUtc = zonedToUtc(p.y, p.m, p.d, Math.floor(hm(wh.end) / 60), hm(wh.end) % 60, wh.timezone);
    const stop = Math.min(endUtc.getTime(), b.getTime());
    total += Math.floor((stop - open.getTime()) / MIN);
    cur = new Date(endUtc.getTime());
  }
  return total;
}

/** Start (UTC instant) of the local calendar day containing `date`. */
export function startOfLocalDay(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return zonedToUtc(p.y, p.m, p.d, 0, 0, tz);
}
