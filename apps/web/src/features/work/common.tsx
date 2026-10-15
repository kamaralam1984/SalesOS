'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, type Tone } from '@salesos/ui';
import type { DirectoryStatus } from '@/lib/api/hooks/work-people';

/** Shared bits of the Workforce directory / HR / reports screens (area D). */

/** Date helpers in the org timezone. Accepts YYYY-MM-DD or ISO timestamps. */
export function useDates(timeZone = 'Asia/Kolkata') {
  const locale = useLocale();
  return React.useMemo(() => {
    const loc = locale === 'en' ? 'en-IN' : locale;
    const day = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone: 'UTC' });
    const dayMonth = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const stamp = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short', timeZone });
    const time = new Intl.DateTimeFormat(loc, { timeStyle: 'short', timeZone });
    const asDate = (v: string) => new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
    return {
      date: (v?: string | null) => (v ? day.format(asDate(v)) : '—'),
      dayMonth: (v?: string | null) => (v ? dayMonth.format(asDate(v)) : '—'),
      dateTime: (v?: string | null) => (v ? stamp.format(new Date(v)) : '—'),
      time: (v?: string | null) => (v ? time.format(new Date(v)) : '—'),
    };
  }, [locale, timeZone]);
}

export const statusTone = (s: DirectoryStatus): Tone => (s === 'ACTIVE' ? 'green' : s === 'PROBATION' ? 'gold' : 'neutral');

export function EmploymentStatus({ status }: { status: DirectoryStatus }) {
  const t = useTranslations('workPeople');
  return <Badge tone={statusTone(status)}>{t(`status.${status}` as never)}</Badge>;
}

/** Small honest note for a section the viewer is not allowed to see (the server returned `available: false`). */
export function NotVisible({ label }: { label?: string }) {
  const t = useTranslations('workPeople');
  return <p className="text-sm text-muted">{label ?? t('notVisible')}</p>;
}

export const riskTone = (r: string): Tone => (r === 'ON_TRACK' || r === 'COMPLETED' ? 'green' : r === 'AT_RISK' ? 'gold' : r === 'OVERDUE' ? 'red' : 'neutral');
export const attendanceTone = (s: string): Tone =>
  s === 'PRESENT' || s === 'WFH' ? 'green' : s === 'LATE' || s === 'HALF_DAY' ? 'gold' : s === 'ABSENT' || s === 'UNPAID_LEAVE' ? 'red' : s === 'ON_LEAVE' ? 'blue' : 'neutral';

/** Label for an enum-like value from workPeople.<group>.<VALUE>; falls back to the raw value for unknown ones. */
export function useEnumLabel(group: 'attendanceStatus' | 'risk' | 'taskStatus' | 'leaveStatus' | 'dayKind') {
  const t = useTranslations('workPeople');
  return (v: string) => (t.has(`${group}.${v}` as never) ? t(`${group}.${v}` as never) : v);
}

export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

export function ProgressBar({ pct, label }: { pct: number; label: string }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-ivory-300">
      <div className="h-full rounded-full bg-blue-600 transition-[width] duration-700 ease-out" style={{ width: `${v}%` }} />
    </div>
  );
}
