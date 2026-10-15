'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Panel } from '@salesos/ui';
import { QueryState } from '@/features/people/hub/shared';
import { useEarnedLeaveProgress, useEarnedLeaveTransactions, type ElDayOutcome } from '@/lib/api/hooks/work-leave';
import { ProgressBar } from '../common/shared';
import { useWhen } from '../attendance/format';
import { trimDays } from './leave-logic';

/** Per-day explanation: every day is listed with what it counted for and why (never a bare number). */
export function DayLog({ days }: { days: ElDayOutcome[] }) {
  const t = useTranslations('workLeave');
  const w = useWhen();
  return (
    <ul className="divide-y divide-line rounded-md border border-line text-sm" aria-label={t('el.dayLog')}>
      {days.map((d, i) => (
        <li key={`${d.date}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
          <span className="text-ink">{w.day(d.date)}</span>
          <span className="text-muted">{t.has(`el.reason.${d.reason}` as never) ? t(`el.reason.${d.reason}` as never) : d.reason}</span>
          <Badge tone={d.eligible >= 1 ? 'green' : d.eligible > 0 ? 'gold' : 'neutral'}>{t('el.counts', { n: trimDays(d.eligible) })}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** Earned Leave progress: eligible days so far, days to the next credit and how the open period is being counted. */
export function EarnedLeaveCard({ userId }: { userId?: string }) {
  const t = useTranslations('workLeave');
  const w = useWhen();
  const q = useEarnedLeaveProgress(userId);
  const [open, setOpen] = React.useState(false);
  return (
    <Panel title={t('el.title')} description={t('el.description')}>
      <QueryState query={q} isEmpty={!q.data} emptyTitle={t('el.title')}>
        {q.data && (
          <div className="space-y-3">
            {!q.data.enabled && <Alert tone="info">{t('el.disabled')}</Alert>}
            <p className="text-sm text-ink">{t('el.progress', { n: trimDays(q.data.eligibleDays), total: q.data.requiredEligibleDays })}</p>
            <ProgressBar value={(q.data.eligibleDays / q.data.requiredEligibleDays) * 100} label={t('el.progressBar')} />
            <p className="text-sm text-muted">
              {t('el.toNext', { n: trimDays(q.data.daysToNextCredit), credit: trimDays(q.data.creditDays) })}
              {q.data.processedThrough ? ` · ${t('el.processed', { date: w.day(q.data.processedThrough) })}` : ` · ${t('el.notProcessed')}`}
            </p>
            {q.data.dayLog.length > 0 && (
              <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer text-sm font-medium text-blue-700">{t('el.how')}</summary>
                <div className="mt-2 max-h-72 overflow-auto"><DayLog days={q.data.dayLog} /></div>
              </details>
            )}
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

/** Credits written by the Earned Leave engine, each with the calculation that produced it. */
export function EarnedLeaveHistory({ userId }: { userId?: string }) {
  const t = useTranslations('workLeave');
  const w = useWhen();
  const q = useEarnedLeaveTransactions(userId);
  return (
    <QueryState query={q} isEmpty={(q.data?.length ?? 0) === 0} emptyTitle={t('el.noCredits')} emptyDescription={t('el.noCreditsBody')}>
      <ul className="space-y-3" aria-label={t('el.history')}>
        {(q.data ?? []).map((x) => (
          <li key={x.id} className="rounded-lg border border-line bg-surface p-3.5">
            <p className="font-medium text-ink">
              {x.kind === 'CREDIT_EARNED' ? t('el.credited', { n: trimDays(x.amount) }) : t('el.expired', { n: trimDays(Math.abs(Number(x.amount))) })}
              <span className="ml-2 text-sm font-normal text-muted">{w.dateTime(x.createdAt)}</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {x.periodStart && x.periodEnd ? t('el.period', { from: w.day(x.periodStart), to: w.day(x.periodEnd), eligible: trimDays(x.eligibleDays ?? 0) }) : x.note}
              {` · ${t('el.balanceAfter', { n: trimDays(x.balanceAfter) })}`}
            </p>
            {x.calculation?.days && x.calculation.days.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-blue-700">{t('el.showCalc')}</summary>
                <div className="mt-2 max-h-72 overflow-auto"><DayLog days={x.calculation.days} /></div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </QueryState>
  );
}
