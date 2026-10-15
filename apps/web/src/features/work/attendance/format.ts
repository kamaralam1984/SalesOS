'use client';
import * as React from 'react';
import { useLocale } from 'next-intl';

/** Date/time formatting in the business timezone for the attendance and leave screens. Days (YYYY-MM-DD) render without a timezone shift. */
export function useWhen(timeZone = 'Asia/Kolkata') {
  const locale = useLocale();
  return React.useMemo(() => {
    const loc = locale === 'en' ? 'en-IN' : locale;
    const day = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone: 'UTC' });
    const weekday = new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' });
    const month = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const dt = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short', timeZone });
    const time = new Intl.DateTimeFormat(loc, { timeStyle: 'short', timeZone });
    const asDay = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00Z`);
    return {
      day: (v?: string | null) => (v ? day.format(asDay(v)) : '—'),
      weekday: (v: string) => weekday.format(asDay(v)),
      month: (v: string) => month.format(new Date(`${v}-01T00:00:00Z`)),
      dateTime: (v?: string | null) => (v ? dt.format(new Date(v)) : '—'),
      time: (v?: string | null) => (v ? time.format(new Date(v)) : '—'),
    };
  }, [locale, timeZone]);
}
