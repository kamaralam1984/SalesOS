'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Info, Lock, TriangleAlert } from 'lucide-react';
import { Badge, Card, Popover, PopoverContent, PopoverTrigger, cn } from '@salesos/ui';
import type { KpiResult } from '@/lib/api/hooks/analytics';
import { AccentRail, CountUp } from '@/components/shell/motion';
import { NULL_REASON_KEYS, formatFraction, formatKpiValue, formatRange, formatTime, progressPct } from './format';

/**
 * One KPI number with everything that must travel with it: value, definition (popover), date range, currency, applied filters,
 * data source for calls, freshness, caution / estimate labels. A null value is an em dash with the reason, never 0.
 */
export function KpiTile({ kpi, className, emphasis = false, hideFraction = false }: { kpi: KpiResult | undefined; className?: string; emphasis?: boolean; hideFraction?: boolean }) {
  const t = useTranslations('analytics.tile');
  const tr = useTranslations('analytics.reasons');
  const lc = useLocale();
  const headingId = React.useId();
  if (!kpi) return null;
  const blocked = kpi.status === 'FORBIDDEN' || kpi.status === 'RESTRICTED' || kpi.status === 'ERROR';
  const pct = progressPct(kpi);
  const fraction = hideFraction ? null : formatFraction(kpi, lc);
  const filters = Object.keys(kpi.filters.applied);
  const reason = kpi.value === null && kpi.nullReason ? tr(NULL_REASON_KEYS[kpi.nullReason]) : null;
  return (
    <Card as="article" aria-labelledby={headingId} accent="none" className={cn('group/kpi enter-up glow-hover relative flex h-full flex-col gap-2 overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:[box-shadow:var(--elev-3)]', emphasis && 'glow-gold', className)} data-kpi={kpi.id} data-status={kpi.status}>
      <AccentRail tone={blocked ? 'blue' : emphasis ? 'gold' : kpi.value !== null && pct !== null && pct >= 100 ? 'green' : 'blue'} className="absolute inset-x-0 top-0" />
      <div className="flex items-start justify-between gap-2">
        <h3 id={headingId} className="text-[0.8125rem] font-medium text-muted">
          {kpi.name}
        </h3>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label={t('definitionOf', { name: kpi.name })} className="-m-1.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-ivory-200 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
              <Info aria-hidden="true" className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] text-sm">
            <p className="font-semibold text-ink">{kpi.name}</p>
            <p className="mt-1 text-ink-700">{kpi.definition.summary}</p>
            <dl className="mt-3 space-y-1.5 text-[0.8125rem] text-muted">
              <div>
                <dt className="font-medium text-ink-700">{t('formula')}</dt>
                <dd>{kpi.definition.formula}</dd>
              </div>
              <div>
                <dt className="font-medium text-ink-700">{t('zeroRule')}</dt>
                <dd>{kpi.definition.zeroDenominator}</dd>
              </div>
              <div>
                <dt className="font-medium text-ink-700">{t('status')}</dt>
                <dd>{kpi.definition.approvalStatus === 'PROPOSED_DEFAULT_AWAITING_OWNER_APPROVAL' ? t('proposedDefault') : kpi.definition.approvalStatus}</dd>
              </div>
            </dl>
            <Link href={`/reporting/kpis#${kpi.id}`} className="mt-3 inline-block text-[0.8125rem] font-medium text-blue-700 underline-offset-2 hover:underline">
              {t('fullDefinition')}
            </Link>
          </PopoverContent>
        </Popover>
      </div>

      {blocked ? (
        <div className="flex min-h-14 items-center gap-2 text-sm text-muted">
          {kpi.status === 'ERROR' ? <TriangleAlert aria-hidden="true" className="size-4 text-red-700" /> : <Lock aria-hidden="true" className="size-4" />}
          <span>{kpi.status === 'FORBIDDEN' ? t('forbidden') : kpi.status === 'RESTRICTED' ? t('restricted') : t('error')}</span>
        </div>
      ) : (
        <>
          <p className="kpi-number enter-fade tabular font-display text-[1.875rem] leading-none font-semibold tracking-tight text-ink" aria-label={kpi.value === null ? t('noValue') : undefined}>
            <CountUp text={formatKpiValue(kpi, lc)} locale={lc} />
          </p>
          <div className="min-h-5 text-[0.8125rem] text-muted">
            {reason ? <span>{reason}</span> : fraction ? <span className="tabular">{fraction}</span> : null}
          </div>
          {pct !== null && (
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={t('progress', { name: kpi.name })} className="h-1.5 w-full overflow-hidden rounded-full bg-ivory-300">
              <div className={cn('h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out', pct >= 100 ? 'from-green-600 to-green-400' : 'from-blue-600 to-blue-500')} style={{ width: `${pct}%` }} />
            </div>
          )}
          {kpi.caution && <p className="flex items-start gap-1.5 text-[0.8125rem] text-gold-800"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{kpi.caution}</p>}
        </>
      )}

      <div className="mt-auto space-y-1 pt-2 text-xs text-muted">
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span>{formatRange(kpi.dateRange.from, kpi.dateRange.to, lc)}</span>
          {kpi.currency && <span aria-label={t('currency')}>· {kpi.currency}</span>}
          {kpi.isEstimate && <Badge tone="gold">{t('estimate')}</Badge>}
        </p>
        <p>
          <span>{kpi.freshness.kind === 'CACHED' ? t('cached', { time: formatTime(kpi.computedAt, lc) }) : t('live', { time: formatTime(kpi.computedAt, lc) })}</span>
          {kpi.dataSource && <span> · {t('source', { source: kpi.dataSource })}</span>}
          {filters.length > 0 && <span> · {t('filtered', { filters: filters.map((f) => t(`filter.${f}` as 'filter.teamId')).join(', ') })}</span>}
          {kpi.filters.ignored.length > 0 && <span> · {t('ignored', { filters: kpi.filters.ignored.map((f) => t(`filter.${f}` as 'filter.teamId')).join(', ') })}</span>}
        </p>
      </div>
    </Card>
  );
}

/** Responsive grid for a row of tiles. */
export function TileGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  return <div className={cn('stagger grid grid-cols-1 gap-3 sm:grid-cols-2', cols === 3 && 'xl:grid-cols-3', cols === 4 && 'lg:grid-cols-3 xl:grid-cols-4')}>{children}</div>;
}
