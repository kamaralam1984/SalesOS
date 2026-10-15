'use client';
import * as React from 'react';
import { useLocale } from 'next-intl';
import { cn } from '@salesos/ui';

export type Tone = 'neutral' | 'gold' | 'red' | 'blue' | 'green';

const BAR: Record<Tone, string> = { neutral: 'bg-ink-400', gold: 'bg-gold-600', red: 'bg-red-600', blue: 'bg-blue-600', green: 'bg-green-600' };

/** Accessible progress bar: the numeric value is always available as text (role=progressbar + visible label), never colour only. */
export function ProgressBar({ value, label, tone = 'blue', className }: { value: number; label: string; tone?: Tone; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} className={cn('h-2 w-full overflow-hidden rounded-full bg-ivory-200', className)}>
      <div className={cn('h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300', BAR[tone])} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Date + time in the organisation timezone (Asia/Kolkata); plain days (YYYY-MM-DD) render as dates. */
export function useWorkDates(timeZone = 'Asia/Kolkata') {
  const locale = useLocale();
  return React.useMemo(() => {
    const loc = locale === 'en' ? 'en-IN' : locale;
    const day = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone: 'UTC' });
    const dayTz = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone });
    const dt = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short', timeZone });
    return {
      day: (v?: string | null) => (v ? day.format(new Date(`${v.slice(0, 10)}T00:00:00Z`)) : '—'),
      date: (v?: string | null) => (v ? dayTz.format(new Date(v)) : '—'),
      dateTime: (v?: string | null) => (v ? dt.format(new Date(v)) : '—'),
    };
  }, [locale, timeZone]);
}

/** ISO instant for an <input type="datetime-local"> value (browser local time). */
export const localInputToIso = (v: string): string | undefined => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
/** <input type="datetime-local"> value for an ISO instant (browser local time). */
export const isoToLocalInput = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
