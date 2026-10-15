'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { StatusBadge, type PaginationProps } from '@salesos/ui';
import type { VersionStatus } from './api';

export function useFmt() {
  const locale = useLocale();
  return React.useMemo(() => {
    const loc = locale === 'en' ? 'en-IN' : locale;
    const d = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
    const dt = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    return {
      date: (v?: string | null) => (v ? d.format(new Date(v.length === 10 ? `${v}T00:00:00Z` : v)) : '—'),
      dateTime: (v?: string | null) => (v ? dt.format(new Date(v)) : '—'),
    };
  }, [locale]);
}

const statusTone: Record<VersionStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'pending'> = {
  DRAFT: 'neutral', PENDING_APPROVAL: 'pending', APPROVED: 'success', REJECTED: 'danger', SUPERSEDED: 'neutral', RETIRED: 'neutral',
};

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  const t = useTranslations('sop.versionStatus');
  return <StatusBadge status={statusTone[status]}>{t(status)}</StatusBadge>;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function usePaginationLabels(): NonNullable<PaginationProps['labels']> {
  const tc = useTranslations('common');
  return {
    nav: tc('pagination'),
    previous: tc('previous'),
    next: tc('next'),
    summary: (from, to, total) => tc('paginationSummary', { from, to, total }),
    page: (p, c) => tc('paginationPage', { page: p, count: c }),
    pageOnly: (p) => tc('paginationPageOnly', { page: p }),
  };
}

/** "72.5%" or the localized "no required users" text when the rate is null (never 0% or 100% by default). */
export function RateText({ pct }: { pct: number | null }) {
  const t = useTranslations('sop.adoption');
  return pct === null ? <span className="text-muted">{t('noRequired')}</span> : <span>{`${pct}%`}</span>;
}

export function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  const reduce = useReducedMotion();
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className="h-2 w-full overflow-hidden rounded-full bg-ivory-300"
    >
      <motion.div
        className="h-full rounded-full bg-blue-600 shadow-[0_0_8px_var(--tone-glow-blue,transparent)]"
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${pct ?? 0}%` }}
        transition={{ duration: reduce ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
