'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowUpRight, Lock } from 'lucide-react';
import { Badge, ChartCard, type Column, DataTable, EmptyState, Panel, Stat, cn } from '@salesos/ui';
import type { KpiResult, PanelState } from '@/lib/api/hooks/analytics';
import { chartNumber, compactMoney, formatMoney, formatNumber } from './format';
import { KpiTile, TileGrid } from './kpi-tile';

/** Wraps a dashboard panel: permission-denied and error states inside the panel, never a blank page. */
export function PanelBoundary<T>({ title, description, state, children, actions, id }: { title: string; description?: string; state: PanelState<T> | undefined; children: (p: T) => React.ReactNode; actions?: React.ReactNode; id?: string }) {
  const t = useTranslations('analytics.panel');
  return (
    <Panel title={title} description={description} actions={actions} headingLevel={3} id={id}>
      {!state ? (
        <EmptyState title={t('noData')} />
      ) : state.status === 'FORBIDDEN' ? (
        <p className="flex items-center gap-2 text-sm text-muted" role="note">
          <Lock aria-hidden="true" className="size-4" />
          {t('forbidden')}
        </p>
      ) : state.status === 'ERROR' ? (
        <p className="flex items-center gap-2 text-sm text-red-700" role="alert">
          <AlertTriangle aria-hidden="true" className="size-4" />
          {t('error')}
        </p>
      ) : (
        children(state)
      )}
    </Panel>
  );
}

/** Month / quarter / fiscal-year target tiles for one metric (revenue, collections, enrolments). */
export function TargetTiles({ tiles }: { tiles: { month: KpiResult; quarter: KpiResult; year: KpiResult } | undefined }) {
  const t = useTranslations('analytics.target');
  if (!tiles) return null;
  return (
    <div className="stagger grid grid-cols-1 gap-3 md:grid-cols-3">
      {(['month', 'quarter', 'year'] as const).map((k) => (
        <div key={k}>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{t(k)}</p>
          <KpiTile kpi={tiles[k]} emphasis={k === 'month'} />
        </div>
      ))}
    </div>
  );
}

export interface PipelineStage { stage: string; deals: number; amount: string; weightedAmount: string; probability: string }

export function PipelineCard({ stages }: { stages: PipelineStage[] }) {
  const t = useTranslations('analytics.pipeline');
  const lc = useLocale();
  const total = stages.reduce((a, s) => a + s.deals, 0);
  if (total === 0) return <EmptyState title={t('empty')} />;
  const data = stages.map((s) => ({ [t('stage')]: t(`stages.${s.stage}` as 'stages.OPEN'), [t('amount')]: chartNumber(s.amount), [t('weighted')]: chartNumber(s.weightedAmount) }));
  const sum = stages.reduce((a, s) => a + chartNumber(s.amount), 0);
  const columns: Column<PipelineStage>[] = [
    { id: 'stage', header: t('stage'), primary: true, cell: (r) => t(`stages.${r.stage}` as 'stages.OPEN') },
    { id: 'deals', header: t('deals'), align: 'right', cell: (r) => <span className="tabular">{r.deals}</span> },
    { id: 'amount', header: t('amount'), align: 'right', cell: (r) => <span className="tabular">{formatMoney(r.amount, lc)}</span> },
    { id: 'weighted', header: t('weighted'), align: 'right', cell: (r) => <span className="tabular">{formatMoney(r.weightedAmount, lc)}</span> },
  ];
  return (
    <div className="enter-fade space-y-4">
      <ChartCard
        title={t('chartTitle')}
        summary={t('chartSummary', { deals: total, amount: formatMoney(String(sum), lc) })}
        data={data}
        xKey={t('stage')}
        series={[{ key: t('amount'), label: t('amount'), tone: 'blue' }, { key: t('weighted'), label: t('weighted'), tone: 'gold' }]}
        formatValue={compactMoney}
        labels={{ chart: t('chart'), table: t('table'), view: t('view') }}
      />
      <DataTable columns={columns} rows={stages} getRowId={(r) => r.stage} caption={t('caption')} />
      <p className="text-xs text-muted">{t('estimateNote')}</p>
    </div>
  );
}

export interface TrendMonth { month: string; startsOn: string; net: string; booked: string; refundsApproved: string; enrolments: number; wonDeals: number }

export function RevenueTrendCard({ months }: { months: TrendMonth[] }) {
  const t = useTranslations('analytics.trend');
  const lc = useLocale();
  if (months.every((m) => chartNumber(m.net) === 0)) return <EmptyState title={t('empty')} />;
  const last = months[months.length - 1]!;
  return (
    <div className="enter-fade">
    <ChartCard
      title={t('monthlyTitle')}
      summary={t('monthlySummary', { month: last.month, amount: formatMoney(last.net, lc) })}
      data={months.map((m) => ({ [t('month')]: m.month, [t('net')]: chartNumber(m.net) }))}
      xKey={t('month')}
      series={[{ key: t('net'), label: t('net'), tone: 'blue' }]}
      formatValue={compactMoney}
      labels={{ chart: t('chart'), table: t('table'), view: t('view') }}
    />
    </div>
  );
}

export function DailyCard({ series }: { series: Array<{ date: string; amount: string; cumulative: string }> }) {
  const t = useTranslations('analytics.trend');
  const lc = useLocale();
  if (series.every((p) => chartNumber(p.amount) === 0)) return <EmptyState title={t('emptyDaily')} />;
  const last = series[series.length - 1]!;
  return (
    <div className="enter-fade">
    <ChartCard
      title={t('dailyTitle')}
      summary={t('dailySummary', { amount: formatMoney(last.cumulative, lc) })}
      data={series.map((p) => ({ [t('day')]: p.date.slice(5), [t('cumulative')]: chartNumber(p.cumulative) }))}
      xKey={t('day')}
      series={[{ key: t('cumulative'), label: t('cumulative'), tone: 'blue' }]}
      kind="area"
      formatValue={compactMoney}
      labels={{ chart: t('chart'), table: t('table'), view: t('view') }}
    />
    </div>
  );
}

export interface Scorecard {
  userId: string;
  name: string;
  role: string;
  revenueTarget: string | null;
  revenueActual: string;
  achievementPct: string | null;
  callAttempts: number;
  uniqueClients: number;
  followUpsCompleted: number;
  onTimePct: string | null;
  overdueOpen: number;
  activeLeads: number;
  leadsWon: number;
  conversionPct: string | null;
  openTasks?: number;
  followUpsDue?: number;
  wonDeals?: number;
}

const dash = '—';

export function ScorecardTable({ rows, caption }: { rows: Scorecard[]; caption: string }) {
  const t = useTranslations('analytics.scorecard');
  const lc = useLocale();
  const pct = (v: string | null) => (v === null ? dash : `${formatNumber(v, lc)}%`);
  const columns: Column<Scorecard>[] = [
    { id: 'name', header: t('name'), primary: true, cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { id: 'target', header: t('target'), align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular">{r.revenueTarget ? formatMoney(r.revenueTarget, lc) : dash}</span> },
    { id: 'actual', header: t('revenue'), align: 'right', cell: (r) => <span className="tabular">{formatMoney(r.revenueActual, lc)}</span> },
    { id: 'ach', header: t('achievement'), align: 'right', cell: (r) => <AchievementCell value={r.achievementPct} noTarget={t('noTarget')} /> },
    { id: 'calls', header: t('calls'), align: 'right', cell: (r) => <span className="tabular" title={t('callsHint')}>{r.callAttempts} / {r.uniqueClients}</span> },
    { id: 'fu', header: t('followUps'), align: 'right', cell: (r) => <span className="tabular">{r.followUpsCompleted} · {pct(r.onTimePct)}</span> },
    { id: 'overdue', header: t('overdue'), align: 'right', cell: (r) => (r.overdueOpen > 0 ? <Badge tone="red">{r.overdueOpen}</Badge> : <span className="tabular">0</span>) },
    { id: 'leads', header: t('activeLeads'), align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular">{r.activeLeads}</span> },
    { id: 'won', header: t('won'), align: 'right', cell: (r) => <span className="tabular">{r.leadsWon} · {pct(r.conversionPct)}</span> },
  ];
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.userId} caption={caption} emptyTitle={t('empty')} />;
}

function AchievementCell({ value, noTarget }: { value: string | null; noTarget: string }) {
  const lc = useLocale();
  if (value === null) return <span className="text-muted" title={noTarget}>{dash}<span className="sr-only"> {noTarget}</span></span>;
  const n = Number(value);
  return (
    <span className="tabular inline-flex items-center gap-1.5 font-medium">
      {formatNumber(value, lc)}%
      <span aria-hidden="true" className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-ivory-300"><span className="block h-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, n))}%` }} /></span>
    </span>
  );
}

export interface RiskItems {
  overdueTasks?: number;
  unassignedLeads?: number;
  noNextActionLeads?: number;
  staleLeads?: number;
  openComplaints?: number;
  p1Complaints?: number;
  breachedComplaints?: number;
  openEscalations?: number;
  paymentsAwaitingVerification?: number;
  refundsAwaitingDecision?: number;
  dealsPastExpectedClose?: number;
  highValueOpenDeals?: number;
}

const RISK_LINKS: Record<keyof RiskItems, string> = {
  overdueTasks: '/crm/tasks',
  unassignedLeads: '/crm/exceptions',
  noNextActionLeads: '/crm/exceptions',
  staleLeads: '/crm/leads',
  openComplaints: '/cx/complaints',
  p1Complaints: '/cx/complaints',
  breachedComplaints: '/cx/complaints',
  openEscalations: '/cx/escalations',
  paymentsAwaitingVerification: '/revenue/collections',
  refundsAwaitingDecision: '/revenue/refunds',
  dealsPastExpectedClose: '/revenue/deals',
  highValueOpenDeals: '/revenue/deals',
};

export function RiskGrid({ items }: { items: RiskItems }) {
  const t = useTranslations('analytics.risks');
  const entries = (Object.keys(RISK_LINKS) as Array<keyof RiskItems>).filter((k) => items[k] !== undefined);
  return (
    <ul className="stagger-fast grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('title')}>
      {entries.map((k) => {
        const n = items[k] ?? 0;
        return (
          <li key={k}>
            <Link href={RISK_LINKS[k]} className={cn('hover-lift glow-hover flex min-h-14 items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 hover:bg-ivory-100 focus-visible:outline-2 focus-visible:outline-focus', n > 0 && 'border-red-200')}>
              <span className="text-sm text-ink-700">{t(k)}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('tabular font-display text-xl font-semibold', n > 0 ? 'text-red-700' : 'text-ink')}>{n}</span>
                {n > 0 && <span className="sr-only">{t('needsAttention')}</span>}
                <ArrowUpRight aria-hidden="true" className="size-4 text-ink-400" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function CountStats({ entries, labelPrefix }: { entries: Array<[string, number | string]>; labelPrefix: string }) {
  const t = useTranslations(labelPrefix as 'analytics.people');
  return (
    <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {entries.map(([k, v]) => (
        <Stat key={k} label={t(k as never)} value={v} />
      ))}
    </div>
  );
}

export { KpiTile, TileGrid };
