'use client';
import * as React from 'react';
import { TodayRow } from './today-row';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, PageHeader, Stat } from '@salesos/ui';
import { useDashboard } from '@/lib/api/hooks/analytics';
import { ExportButtons } from '@/features/reporting/export-buttons';
import { AnalyticsFilterBar, useAnalyticsFilters } from './filters';
import { formatDay, formatMoney, formatTime } from './format';
import { KpiTile, TileGrid } from './kpi-tile';
import { DailyCard, PanelBoundary, PipelineCard, type PipelineStage, type RiskItems, RiskGrid, RevenueTrendCard, type Scorecard, ScorecardTable, TargetTiles, type TrendMonth } from './panels';
import { QueryBoundary, Section } from './query-boundary';

const ids = (...x: string[]) => x;

/** Founder: company-level performance. Every number comes from the shared KPI layer (`GET /dashboard/ceo`). */
export function FounderDashboard() {
  const t = useTranslations('analytics.founder');
  const lc = useLocale();
  const filters = useAnalyticsFilters({ period: 'MONTH' });
  const q = useDashboard('ceo', filters.query);
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Link href="/reporting/weekly-founder" className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline">{t('weeklyView')}</Link>
            <Link href="/reporting/monthly-founder" className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline">{t('monthlyView')}</Link>
            <ExportButtons report={filters.choice === 'WEEK' ? 'weekly-founder' : 'monthly-founder'} params={filters.query} />
          </>
        }
      />
      <TodayRow />
      <AnalyticsFilterBar filters={filters} target="founder" />
      <QueryBoundary q={q}>
        {(d, fetching) => {
          const k = d.kpis;
          return (
            <div aria-busy={fetching} className={fetching ? 'opacity-90' : undefined}>
              <p className="mb-4 text-xs text-muted" data-testid="dashboard-meta">
                {t('meta', { from: formatDay(d.dateRange.from, lc), to: formatDay(d.dateRange.to, lc), time: formatTime(d.generatedAt, lc), scope: d.filters.scopeLevel })}
              </p>
              <Section title={t('targets')} description={t('targetsHint')}>
                <div className="space-y-6">
                  <div><h3 className="mb-2 text-sm font-semibold text-ink-700">{t('revenueVsTarget')}</h3><TargetTiles tiles={d.targets.revenue} /></div>
                  <div><h3 className="mb-2 text-sm font-semibold text-ink-700">{t('collectionsVsTarget')}</h3><TargetTiles tiles={d.targets.collections} /></div>
                  <div><h3 className="mb-2 text-sm font-semibold text-ink-700">{t('enrolmentsVsTarget')}</h3><TargetTiles tiles={d.targets.enrolments} /></div>
                </div>
              </Section>

              <Section title={t('trends')}>
                <div className="grid gap-4 lg:grid-cols-2">
                  <PanelBoundary title={t('monthlyTrend')} state={d.panels.revenueTrend as never}>{(p: { months: TrendMonth[] }) => <RevenueTrendCard months={p.months} />}</PanelBoundary>
                  <PanelBoundary title={t('dailyTrend')} state={d.panels.revenueDaily as never}>{(p: { series: Array<{ date: string; amount: string; cumulative: string }> }) => <DailyCard series={p.series} />}</PanelBoundary>
                </div>
              </Section>

              <Section title={t('conversions')}>
                <TileGrid>{ids('KPI-SAL-001', 'KPI-SAL-002', 'KPI-SAL-003', 'KPI-SAL-004').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid>
              </Section>

              <Section title={t('pipeline')}>
                <div className="grid gap-4 lg:grid-cols-2">
                  <PanelBoundary title={t('pipelineValue')} state={d.panels.pipeline as never}>{(p: { stages: PipelineStage[] }) => <PipelineCard stages={p.stages} />}</PanelBoundary>
                  <PanelBoundary title={t('forecastRisk')} description={t('forecastRiskHint')} state={d.panels.forecastRisk as never}>
                    {(p: { unscheduledDeals: number; unscheduledAmount: string; slippedDeals: number; slippedAmount: string; note: string }) => (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Stat label={t('unscheduled')} value={p.unscheduledDeals} hint={formatMoney(p.unscheduledAmount, lc)} />
                          <Stat label={t('slipped')} value={p.slippedDeals} hint={formatMoney(p.slippedAmount, lc)} accent={p.slippedDeals > 0 ? 'red' : 'none'} />
                        </div>
                        <p className="text-xs text-muted">{p.note}</p>
                      </div>
                    )}
                  </PanelBoundary>
                </div>
                <div className="mt-4"><TileGrid cols={3}>{ids('KPI-SAL-005', 'KPI-SAL-006').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
              </Section>

              <Section title={t('teams')} description={t('teamsHint')}>
                <PanelBoundary title={t('managerPerformance')} state={d.panels.teamPerformance as never}>{(p: { members: Scorecard[] }) => <ScorecardTable rows={p.members} caption={t('managerPerformance')} />}</PanelBoundary>
                <div className="mt-4"><TileGrid>{ids('KPI-TEA-001', 'KPI-TEA-003', 'KPI-PRD-003', 'KPI-EXC-005').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
              </Section>

              <Section title={t('risks')} description={t('risksHint')}>
                <PanelBoundary title={t('risksTitle')} state={d.panels.risks as never}>{(p: { items: RiskItems }) => <RiskGrid items={p.items} />}</PanelBoundary>
                <div className="mt-4"><TileGrid>{ids('KPI-EXC-001', 'KPI-EXC-002', 'KPI-EXC-003', 'KPI-EXC-004').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
              </Section>

              <Section title={t('customer')}>
                <TileGrid>{ids('KPI-CX-001', 'KPI-CX-002', 'KPI-CX-003', 'KPI-CX-004').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid>
              </Section>

              <Section title={t('founderSupport')}>
                <TileGrid>{ids('KPI-FND-001', 'KPI-FND-002', 'KPI-FND-003').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid>
                <div className="mt-4">
                  <PanelBoundary title={t('reportStatus')} state={d.panels.founderReport as never}>
                    {(p: { latest: { id: string; type: string; status: string; periodStart: string; periodEnd: string; dueAt: string; publishedAt: string | null } | null }) =>
                      p.latest ? (
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone={p.latest.status === 'PUBLISHED' ? 'green' : 'gold'}>{p.latest.status}</Badge>
                          <span>{t('reportLine', { type: p.latest.type, from: formatDay(p.latest.periodStart, lc), to: formatDay(p.latest.periodEnd, lc), due: formatTime(p.latest.dueAt, lc) })}</span>
                          <Link href={`/cx/founder-reports/${p.latest.id}`} className="font-medium text-blue-700 underline-offset-2 hover:underline">{t('openReport')}</Link>
                        </p>
                      ) : <p className="text-sm text-muted">{t('noReport')}</p>
                    }
                  </PanelBoundary>
                </div>
              </Section>

              <Section title={t('process')} description={t('processHint')}>
                <TileGrid>{ids('KPI-PRO-001', 'KPI-PRO-002', 'KPI-TEA-004', 'KPI-TEA-005').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid>
                <p className="mt-3 text-sm"><Link href="/reporting/reconciliation" className="font-medium text-blue-700 underline-offset-2 hover:underline">{t('seeReconciliation')}</Link></p>
              </Section>
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
