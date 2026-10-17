import type { AttendanceStatus } from '@/lib/api/hooks/work-attendance';

export type Tone = 'neutral' | 'gold' | 'red' | 'blue' | 'green';

export const statusTone = (s: AttendanceStatus): Tone =>
  s === 'PRESENT' || s === 'WFH' ? 'green' : s === 'LATE' || s === 'HALF_DAY' ? 'gold' : s === 'ABSENT' || s === 'UNPAID_LEAVE' ? 'red' : s === 'ON_LEAVE' ? 'blue' : 'neutral';

/** "7h 30m" from whole minutes; null for no data. */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Current month as YYYY-MM in the business timezone. */
export function currentMonth(now = new Date(), timeZone = 'Asia/Kolkata'): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(now);
  return p.slice(0, 7);
}
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export function today(now = new Date(), timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Why a day has no record, in words: future / not closed yet / nothing to record. */
export function emptyDayReason(date: string, todayDay: string): 'future' | 'pending' | 'none' {
  if (date > todayDay) return 'future';
  if (date === todayDay) return 'pending';
  return 'none';
}

/** ISO instant for a <input type="datetime-local"> value interpreted as Asia/Kolkata wall time (UTC+05:30, no DST). */
export function istLocalToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** <input type="datetime-local"> value (IST wall time) for an ISO instant. */
export function isoToIstLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
}

/** YYYY-MM-DD plus n calendar days (pure date arithmetic, no timezone). */
export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** ISO instant of an HH:MM wall time on a YYYY-MM-DD day in Asia/Kolkata (UTC+05:30, no DST). */
export function istTimeToIso(day: string, hhmm: string): string | null {
  const d = new Date(`${day}T${hhmm}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Only https links are rendered; returns the href and host to show, or null. */
export function safeMeetingLink(url: string | null | undefined): { href: string; host: string } | null {
  if (!url || !url.startsWith('https://')) return null;
  try {
    return { href: url, host: new URL(url).host };
  } catch {
    return null;
  }
}

/** How long the Zoom button stays after the person pressed it. */
export const MEETING_VISIBLE_MINUTES = 30;
export const DEFAULT_CHECK_OUT_FROM = '18:30';

export type DayPhase = 'CHECK_IN' | 'MEETING' | 'WORKING' | 'CHECK_OUT' | 'DONE';

/**
 * Which part of the day the attendance card is in, so the Zoom, Check-out and the widgets around them can adjust:
 * CHECK_IN (not marked) → MEETING (marked, Zoom shown until 30 min after the press) → WORKING (compact) → CHECK_OUT (from 18:30) → DONE.
 */
export function dayPhase(a: { checkedIn: boolean; checkedOut: boolean; canCheckOut: boolean; hasMeeting: boolean; meetingJoinedAt?: string | null; checkOutFrom?: string; day: string; now: Date }): DayPhase {
  if (a.checkedOut) return 'DONE';
  if (!a.checkedIn) return 'CHECK_IN';
  const from = istTimeToIso(a.day, a.checkOutFrom ?? DEFAULT_CHECK_OUT_FROM);
  if (a.canCheckOut && from && a.now.getTime() >= new Date(from).getTime()) return 'CHECK_OUT';
  const pressed = a.meetingJoinedAt ? new Date(a.meetingJoinedAt).getTime() : null;
  const expired = pressed !== null && a.now.getTime() >= pressed + MEETING_VISIBLE_MINUTES * 60_000;
  return a.hasMeeting && !expired ? 'MEETING' : 'WORKING';
}
