'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { UseQueryResult } from '@tanstack/react-query';
import { Badge, EmptyState, ErrorState, Skeleton, StatusBadge, cn } from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import type { DealStage, PaymentStatus, RefundStatus } from '@/lib/api/hooks/revenue';
import { Reveal } from '@/features/crm/motion';
import { formatMoney, paymentStatusTone, refundStatusTone, stageStatus } from './lib';

export function useRevFormat() {
  const locale = useLocale();
  return React.useMemo(() => {
    const lc = locale === 'en' ? 'en-IN' : locale;
    const dt = new Intl.DateTimeFormat(lc, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    const d = new Intl.DateTimeFormat(lc, { dateStyle: 'medium', timeZone: 'UTC' });
    return {
      money: (v: string | null | undefined, display: 'code' | 'symbol' = 'code') => formatMoney(v, lc, { display }),
      dateTime: (iso?: string | null) => (iso ? dt.format(new Date(iso)) : '—'),
      /** date-only values (YYYY-MM-DD) are calendar dates: render in UTC so they never shift a day */
      date: (day?: string | null) => (day ? d.format(new Date(`${day.slice(0, 10)}T00:00:00Z`)) : '—'),
    };
  }, [locale]);
}

/** Money with explicit currency; tabular figures; optional emphasis. Never colours by sign alone. */
export function Money({ value, className, strong, display }: { value: string | null | undefined; className?: string; strong?: boolean; display?: 'code' | 'symbol' }) {
  const f = useRevFormat();
  return <span className={cn('tabular whitespace-nowrap', strong && 'font-semibold text-ink', className)}>{f.money(value, display)}</span>;
}

export function StageBadge({ stage }: { stage: DealStage }) {
  const t = useTranslations('revenue.stage');
  return <StatusBadge status={stageStatus(stage)}>{t(stage)}</StatusBadge>;
}
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const t = useTranslations('revenue.paymentStatus');
  return <StatusBadge status={paymentStatusTone(status)}>{t(status)}</StatusBadge>;
}
export function RefundBadge({ status }: { status: RefundStatus }) {
  const t = useTranslations('revenue.refundStatus');
  return <StatusBadge status={refundStatusTone(status)}>{t(status)}</StatusBadge>;
}
export function HighValueBadge({ level }: { level?: number }) {
  const t = useTranslations('revenue.deal');
  return <Badge tone="gold">{level && level >= 2 ? t('highValueFounder') : t('highValue')}</Badge>;
}

/** Five-state boundary: loading, error (with retry), empty, success. Permission-denied is handled by <RequirePermission>. */
export function DataState<T>({
  q,
  isEmpty,
  empty,
  children,
  skeleton,
}: {
  q: Pick<UseQueryResult<T>, 'isPending' | 'isError' | 'error' | 'data' | 'refetch'>;
  isEmpty?: (d: T) => boolean;
  empty: { title: string; description?: string; action?: React.ReactNode };
  children: (d: T) => React.ReactNode;
  skeleton?: React.ReactNode;
}) {
  const tc = useTranslations('common');
  const err = useApiErrorMessage();
  if (q.isPending) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">{tc('loading')}</span>
        {skeleton ?? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}
      </div>
    );
  }
  if (q.isError) return <ErrorState description={err(q.error).message} onRetry={() => void q.refetch()} />;
  const data = q.data as T;
  if (isEmpty?.(data)) return <EmptyState title={empty.title} description={empty.description} action={empty.action} />;
  return <Reveal>{children(data)}</Reveal>;
}

/** The sale / due / collected / refunded / net facts, always labelled separately (Closed-Won is NOT paid). */
export function MoneyFacts({ items, columns = 5 }: { items: Array<{ label: string; value: string | null | undefined; hint?: string; tone?: 'default' | 'warn' | 'good' }>; columns?: 3 | 5 }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-3', columns === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-3')}>
      {items.map((it) => (
        <div key={it.label} className={cn('rounded-lg border bg-surface p-3.5', it.tone === 'warn' ? 'border-gold-300' : 'border-line')}>
          <dt className="text-[0.8125rem] font-medium text-muted">{it.label}</dt>
          <dd className="mt-1">
            <span className="block text-lg font-semibold tabular text-ink">
              <Money value={it.value} />
            </span>
            {it.hint && <span className="mt-1 block text-xs text-muted">{it.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Labels for the shared <Pagination> (API list endpoints give hasMore + page, not totals). */
export function usePagerLabels() {
  const tc = useTranslations('common');
  return {
    nav: tc('pagination'),
    previous: tc('previous'),
    next: tc('next'),
    summary: () => '',
    page: () => '',
    pageOnly: (p: number) => tc('paginationPageOnly', { page: p }),
  };
}

/** Segmented single-choice control (a button group, not tabs: nothing is swapped in a tab panel). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-ivory-100 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} className={cn('min-h-9 rounded-md px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus', o.value === value ? 'bg-surface text-ink shadow-xs ring-1 ring-gold-400' : 'text-ink-600 hover:bg-ivory-200')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
