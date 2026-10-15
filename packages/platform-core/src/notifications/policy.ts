export interface QuietConfig {
  /** "HH:mm" local */
  quietStart: string;
  quietEnd: string;
  timezone: string;
  /** ISO weekdays 1..7 (Mon=1) that count as working days */
  workingDays: number[];
}

export const DEFAULT_QUIET: QuietConfig = { quietStart: '21:00', quietEnd: '08:00', timezone: 'Asia/Kolkata', workingDays: [1, 2, 3, 4, 5, 6] };

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Local minute-of-day and ISO weekday for an instant in an IANA timezone. */
export function localParts(at: Date, timezone: string): { minutes: number; isoWeekday: number } {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wk = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { minutes: Number(get('hour')) * 60 + Number(get('minute')), isoWeekday: wk || 1 };
}

/** True when external (non in-app) delivery should be held: inside quiet hours or on a non-working day. */
export function isQuietNow(at: Date, cfg: QuietConfig): boolean {
  const { minutes, isoWeekday } = localParts(at, cfg.timezone);
  if (!cfg.workingDays.includes(isoWeekday)) return true;
  const s = toMinutes(cfg.quietStart);
  const e = toMinutes(cfg.quietEnd);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** Earliest instant >= at that is outside quiet hours (15-minute resolution, searches up to 8 days). */
export function nextAllowedAt(at: Date, cfg: QuietConfig): Date {
  if (!isQuietNow(at, cfg)) return at;
  const step = 15 * 60_000;
  let t = new Date(Math.ceil(at.getTime() / step) * step);
  for (let i = 0; i < (8 * 24 * 60) / 15; i++) {
    if (!isQuietNow(t, cfg)) return t;
    t = new Date(t.getTime() + step);
  }
  return t;
}
