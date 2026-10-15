'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge } from '@salesos/ui';
import { ApiError } from '@/lib/api/client';
import { MutationAlert } from '@/features/people/hub/shared';
import type { PayrollRunStatus } from '@/lib/api/hooks/work-payroll';

export const RUN_STATUSES: PayrollRunStatus[] = ['DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED'];
const TONE: Record<PayrollRunStatus, 'neutral' | 'gold' | 'red' | 'blue' | 'green'> = { DRAFT: 'neutral', CALCULATED: 'blue', APPROVED: 'gold', PAID: 'green', CANCELLED: 'red' };

/** Status is always text (never colour alone). */
export function RunStatusBadge({ status }: { status: PayrollRunStatus }) {
  const t = useTranslations('workPayroll.status');
  return <Badge tone={TONE[status]}>{t(status)}</Badge>;
}

export function StatutoryNotice({ className }: { className?: string }) {
  const t = useTranslations('workPayroll');
  return (
    <Alert tone="info" title={t('statutoryTitle')} className={className}>
      {t('statutoryBody')}
    </Alert>
  );
}

interface NotClosedDetails {
  reason?: 'MONTH_NOT_ENDED' | 'DAYS_NOT_CLOSED';
  monthEnd?: string;
  employees?: Array<{ userId: string; name: string; days: string[] }>;
  truncated?: boolean;
}

/** Failed mutation, with the payroll-specific business errors explained (MONTH_NOT_CLOSED lists who and which days). */
export function PayrollError({ error }: { error: unknown }) {
  const t = useTranslations('workPayroll.run');
  if (!error) return null;
  if (error instanceof ApiError && error.code === 'MONTH_NOT_CLOSED') {
    const d = (error.details ?? {}) as NotClosedDetails;
    return (
      <Alert tone="warning" title={t('notClosedTitle')}>
        {d.reason === 'MONTH_NOT_ENDED' ? <p>{t('notEnded', { monthEnd: d.monthEnd ?? '' })}</p> : <p>{t('daysNotClosed')}</p>}
        {d.employees && d.employees.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
            {d.employees.map((e) => (
              <li key={e.userId}>
                <span className="font-medium">{e.name}</span>: {t('daysCount', { n: e.days.length })} ({e.days.slice(0, 6).join(', ')}
                {e.days.length > 6 ? ', …' : ''})
              </li>
            ))}
          </ul>
        )}
        {d.truncated && <p className="mt-1 text-sm">{t('moreEmployees')}</p>}
      </Alert>
    );
  }
  if (error instanceof ApiError && error.code === 'SEPARATION_OF_DUTIES') return <Alert tone="warning">{t('separation')}</Alert>;
  return <MutationAlert error={error} />;
}

/** Money cell: tabular numerals, right aligned by the caller. */
export function Amount({ value, className }: { value: string; className?: string }) {
  return <span className={`tabular-nums ${className ?? ''}`}>{value}</span>;
}
