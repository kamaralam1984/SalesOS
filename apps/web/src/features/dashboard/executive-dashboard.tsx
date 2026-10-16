'use client';
import * as React from 'react';
import { TodayRow } from './today-row';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, PageHeader } from '@salesos/ui';
import { useDashboard } from '@/lib/api/hooks/analytics';
import { AnalyticsFilterBar, useAnalyticsFilters } from './filters';
import { formatDay, formatTime } from './format';
import { KpiTile, TileGrid } from './kpi-tile';
import { PanelBoundary, PipelineCard, type PipelineStage, TargetTiles } from './panels';
import { QueryBoundary, Section } from './query-boundary';
import { Hint } from '@/features/hints/hint-views';

const ids = (...x: string[]) => x;

/** Executive (telecaller) workspace summary: always the caller's own targets, activity and performance. */
export function ExecutiveDashboard() {
  const t = useTranslations('analytics.executive');
  const lc = useLocale();
  const filters = useAnalyticsFilters({ period: 'MONTH' });
  const q = useDashboard('salesperson', filters.query);
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <TodayRow />
      <AnalyticsFilterBar filters={filters} target="executive" show={{ team: false, program: true, source: true, owner: false }} />
      <QueryBoundary q={q}>
        {(d, fetching) => {
          const k = d.kpis;
          return (
            <div aria-busy={fetching}>
              <p className="mb-4 text-xs text-muted" data-testid="dashboard-meta">{t('meta', { from: formatDay(d.dateRange.from, lc), to: formatDay(d.dateRange.to, lc), time: formatTime(d.generatedAt, lc) })}</p>
              <Section title={t('targets')}>
                <div className="space-y-6">
                  <div><h3 className="mb-2 text-sm font-semibold text-ink-700">{t('revenue')}</h3><TargetTiles tiles={d.targets.revenue} /></div>
                  <div><h3 className="mb-2 text-sm font-semibold text-ink-700">{t('collections')}</h3><TargetTiles tiles={d.targets.collections} /></div>
                </div>
              </Section>
              <Section title={t('activity')} description={t('activityHint')} info={<Hint id="attemptsVsClients" />}>
                <TileGrid>{ids('KPI-PRD-006', 'KPI-PRD-008', 'KPI-PRD-001', 'KPI-PRD-002', 'KPI-EXC-005', 'KPI-EXC-003', 'KPI-EXC-002', 'KPI-PRD-005').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid>
              </Section>
              <Section title={t('performance')}>
                <TileGrid>{ids('KPI-TEA-002', 'KPI-SAL-001', 'KPI-SAL-004', 'KPI-PRD-003', 'KPI-PRD-004').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid>
              </Section>
              <Section title={t('pipeline')}>
                <PanelBoundary title={t('myPipeline')} state={d.panels.pipeline as never}>{(p: { stages: PipelineStage[] }) => <PipelineCard stages={p.stages} />}</PanelBoundary>
              </Section>
              <Section title={t('incentive')} description={t('incentiveHint')}>
                <PanelBoundary title={t('incentiveStatus')} state={d.panels.incentive as never}>
                  {(p: { items: Array<{ periodStart: string; periodEnd: string; status: string; paidAt: string | null }>; note: string }) => p.items.length === 0 ? <p className="text-sm text-muted">{t('noIncentive')}</p> : (
                    <ul className="space-y-2">{p.items.map((i) => <li key={i.periodStart} className="flex items-center justify-between gap-3 text-sm"><span>{formatDay(i.periodStart, lc)} – {formatDay(i.periodEnd, lc)}</span><Badge tone={i.status === 'PAID' ? 'green' : 'gold'}>{i.status}</Badge></li>)}<li className="text-xs text-muted">{p.note}</li></ul>
                  )}
                </PanelBoundary>
              </Section>
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
