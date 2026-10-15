'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, FormField, PageHeader, Select } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState } from '@/features/people/hub/shared';
import { useHrBirthdays } from '@/lib/api/hooks/work-hr';
import { useDates } from '../common';

export function BirthdaysPage() {
  return (
    <RequirePermission permission="birthdays:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('workHr');
  const dates = useDates();
  const [days, setDays] = React.useState('30');
  const q = useHrBirthdays(Number(days));
  return (
    <>
      <PageHeader eyebrow={t('birthdays.eyebrow')} title={t('birthdays.title')} description={t('birthdays.description')} />
      <Alert tone="info" className="mb-4">{t('birthdays.privacy')}</Alert>
      <FormField label={t('birthdays.window')} className="mb-4 w-60">
        <Select value={days} onChange={(e) => setDays(e.target.value)}>
          {['7', '14', '30', '60', '90'].map((d) => <option key={d} value={d}>{t('probation.nDays', { n: Number(d) })}</option>)}
        </Select>
      </FormField>
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('birthdays.empty')} emptyDescription={t('birthdays.emptyBody')}>
        <ul className="stagger space-y-2" aria-label={t('birthdays.title')}>
          {(q.data?.items ?? []).map((b) => (
            <li key={b.userId} className="hover-lift flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3.5">
              <span>
                <span className="block font-medium text-ink">{b.name}</span>
                <span className="text-sm text-muted">{[b.department, dates.dayMonth(b.nextDate)].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={b.shared ? 'green' : 'neutral'}>{b.shared ? t('birthdays.shared') : t('birthdays.notShared')}</Badge>
                <Badge tone={b.daysUntil === 0 ? 'gold' : 'blue'}>{b.daysUntil === 0 ? t('birthdays.today') : t('birthdays.inDays', { n: b.daysUntil })}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </QueryState>
    </>
  );
}
