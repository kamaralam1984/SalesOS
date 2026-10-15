'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card, FormField, Select, Skeleton, Stat } from '@salesos/ui';
import { MutationAlert } from '../hub/shared';
import { useCoachingHours } from './api';
import { periodRange, type HoursPeriod } from './schemas';
import { CountUp } from '@/components/motion';

/** Coaching hours = facts (minutes recorded), the data behind the "coaching hours conducted" KPI. */
export function HoursCard() {
  const t = useTranslations('coaching');
  const [period, setPeriod] = React.useState<HoursPeriod>('month');
  const range = React.useMemo(() => periodRange(period), [period]);
  // keep the key stable within a minute so the query is not refetched on every render
  const from = range.from.slice(0, 16) + ':00.000Z';
  const q = useCoachingHours(from, range.to.slice(0, 16) + ':59.999Z');
  return (
    <Card aria-label={t('hours.title')}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">{t('hours.title')}</h2>
          <p className="text-sm text-muted">{t('hours.factsOnly')}</p>
        </div>
        <FormField label={t('hours.period')} className="w-48">
          <Select value={period} onChange={(e) => setPeriod(e.target.value as HoursPeriod)}>
            <option value="week">{t('hours.week')}</option>
            <option value="month">{t('hours.month')}</option>
            <option value="last30">{t('hours.last30')}</option>
          </Select>
        </FormField>
      </div>
      <div className="mt-4">
        {q.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : q.isError ? (
          <MutationAlert error={q.error} />
        ) : q.data ? (
          <>
            <div className="stagger grid gap-3 sm:grid-cols-3">
              <Stat label={t('hours.total')} value={t('hours.hoursValue', { hours: q.data.totalHours })} />
              <Stat label={t('hours.sessions')} value={<CountUp value={q.data.coaches.reduce((s, c) => s + c.sessions, 0)} />} />
              <Stat label={t('hours.oneOnOnes')} value={<CountUp value={q.data.coaches.reduce((s, c) => s + c.oneOnOnes, 0)} />} />
            </div>
            {q.data.coaches.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t('hours.none')}</p>
            ) : (
              <ul className="mt-3 divide-y divide-line text-sm">
                {q.data.coaches.map((c) => (
                  <li key={c.coachId} className="flex items-center justify-between py-2">
                    <span className="font-medium text-ink">{c.coachName ?? '—'}</span>
                    <span className="text-muted">{t('hours.coachLine', { hours: c.totalHours, sessions: c.sessions })}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </Card>
  );
}
