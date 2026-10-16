'use client';
import * as React from 'react';
import { TodayRow } from './today-row';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, PageHeader, Stat } from '@salesos/ui';
import { useDashboard } from '@/lib/api/hooks/analytics';
import { ExportButtons } from '@/features/reporting/export-buttons';
import { AnalyticsFilterBar, useAnalyticsFilters } from './filters';
import { formatDay, formatTime } from './format';
import { KpiTile, TileGrid } from './kpi-tile';
import { PanelBoundary, PipelineCard, type PipelineStage, type RiskItems, RiskGrid, type Scorecard, ScorecardTable, TargetTiles } from './panels';
import { QueryBoundary, Section } from './query-boundary';
import { Hint } from '@/features/hints/hint-views';

const ids = (...x: string[]) => x;
const statusEntries = (o: Record<string, number> | undefined) => Object.entries(o ?? {});

/** Sales Team Lead: targets breakdown, manager scorecards, today's activity, exceptions, ageing, people status. */
export function TeamLeadDashboard() {
  const t = useTranslations('analytics.teamLead');
  const tm = useTranslations('analytics.manager');
  const lc = useLocale();
  const filters = useAnalyticsFilters({ period: 'MONTH' });
  const q = useDashboard('team-lead', filters.query);
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} actions={<ExportButtons report="team-performance" params={filters.query} />} />
      <TodayRow />
      <AnalyticsFilterBar filters={filters} target="team-lead" />
      <QueryBoundary q={q}>
        {(d, fetching) => {
          const k = d.kpis;
          const today = d.today ?? {};
          return (
            <div aria-busy={fetching}>
              <p className="mb-4 text-xs text-muted" data-testid="dashboard-meta">
                {t('meta', { from: formatDay(d.dateRange.from, lc), to: formatDay(d.dateRange.to, lc), time: formatTime(d.generatedAt, lc) })}
              </p>
              <Section title={t('targets')} description={t('targetsHint')}>
                <div className="space-y-6">
                  <div><h3 className="mb-2 text-sm font-semibold text-ink-700">{t('revenueVsTarget')}</h3><TargetTiles tiles={d.targets.revenue} /></div>
                  <div><h3 className="mb-2 text-sm font-semibold text-ink-700">{t('collectionsVsTarget')}</h3><TargetTiles tiles={d.targets.collections} /></div>
                </div>
                <div className="mt-4"><TileGrid>{ids('KPI-REV-003', 'KPI-TEA-001', 'KPI-TEA-002', 'KPI-SAL-001').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
              </Section>

              <Section title={t('today')} description={t('todayHint', { day: formatDay(d.dateRange.asOf, lc) })}>
                <TileGrid>
                  {ids('KPI-PRD-006', 'KPI-PRD-008', 'KPI-PRD-007', 'KPI-PRD-002', 'KPI-EXC-004', 'KPI-REV-002').map((id) => <KpiTile key={id} kpi={today[id]} />)}
                  <KpiTile kpi={d.today?.revenue} />
                </TileGrid>
                <div className="mt-3">
                  <PanelBoundary title={t('pipelineChanges')} state={d.panels.pipelineChanges as never}>
                    {(p: { stageChanges: number; wins: number; losses: number }) => (
                      <div className="grid gap-3 sm:grid-cols-3"><Stat label={t('stageChanges')} value={p.stageChanges} /><Stat label={t('closuresWon')} value={p.wins} /><Stat label={t('closuresLost')} value={p.losses} /></div>
                    )}
                  </PanelBoundary>
                </div>
              </Section>

              <Section title={t('scorecards')} description={t('scorecardsHint')} info={<Hint id="attemptsVsClients" />}>
                <PanelBoundary title={t('managerScorecards')} state={d.panels.scorecards as never}>
                  {(p: { managers: Scorecard[]; executives: Scorecard[] }) => (
                    <div className="space-y-5">
                      <ScorecardTable rows={p.managers} caption={t('managerScorecards')} />
                      <h4 className="font-display text-base font-semibold text-ink">{t('executiveScorecards')}</h4>
                      <ScorecardTable rows={p.executives} caption={t('executiveScorecards')} />
                    </div>
                  )}
                </PanelBoundary>
                <div className="mt-4"><TileGrid>{ids('KPI-TEA-003', 'KPI-PRD-001', 'KPI-PRD-003', 'KPI-PRD-004').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
              </Section>

              <Section title={t('funnel')}>
                <div className="grid gap-4 lg:grid-cols-2">
                  <PanelBoundary title={t('funnelHealth')} state={d.panels.funnelHealth as never}>
                    {(p: { stages: Array<{ stage: string; label: string; leads: number }> }) => (
                      <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('funnelHealth')}>
                        {p.stages.length === 0 && <li className="text-sm text-muted">{t('noLeads')}</li>}
                        {p.stages.map((s) => <li key={s.stage}><Stat label={s.label} value={s.leads} /></li>)}
                      </ul>
                    )}
                  </PanelBoundary>
                  <PanelBoundary title={t('pipeline')} state={d.panels.pipeline as never}>{(p: { stages: PipelineStage[] }) => <PipelineCard stages={p.stages} />}</PanelBoundary>
                </div>
              </Section>

              <Section title={t('exceptions')} description={t('exceptionsHint')}>
                <PanelBoundary title={t('exceptionQueue')} state={d.panels.exceptions as never}>{(p: { items: RiskItems }) => <RiskGrid items={p.items} />}</PanelBoundary>
                <div className="mt-4"><TileGrid>{ids('KPI-PRD-005', 'KPI-EXC-001', 'KPI-EXC-002', 'KPI-EXC-003').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <PanelBoundary title={t('reactivation')} state={d.panels.reactivation as never}>
                    {(p: { queue: Array<{ status: string; entries: number; eligibleNow: number }> }) => p.queue.length === 0 ? <p className="text-sm text-muted">{t('noReactivation')}</p> : (
                      <ul className="space-y-1 text-sm">{p.queue.map((r) => <li key={r.status} className="flex justify-between"><span>{r.status.replaceAll('_', ' ').toLowerCase()}</span><span className="tabular">{r.entries} · {t('eligibleNow', { n: r.eligibleNow })}</span></li>)}</ul>
                    )}
                  </PanelBoundary>
                  <PanelBoundary title={t('forecastRisks')} state={d.panels.forecastRisk as never}>
                    {(p: { unscheduledDeals: number; slippedDeals: number; note: string }) => (
                      <div className="space-y-2"><div className="grid gap-3 sm:grid-cols-2"><Stat label={t('unscheduled')} value={p.unscheduledDeals} /><Stat label={t('slipped')} value={p.slippedDeals} accent={p.slippedDeals > 0 ? 'red' : 'none'} /></div><p className="text-xs text-muted">{p.note}</p></div>
                    )}
                  </PanelBoundary>
                </div>
                <div className="mt-4"><TileGrid cols={3}>{ids('KPI-SAL-005', 'KPI-SAL-006').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
              </Section>

              <Section title={t('people')} description={t('peopleHint')}>
                <PanelBoundary title={t('coachingReviews')} state={d.panels.people as never}>
                  {(p: { coaching?: Record<string, number>; reviews?: Record<string, number>; pip?: Record<string, number>; succession?: Record<string, number> }) => (
                    <div className="grid gap-4 md:grid-cols-2">
                      {p.coaching && <CountList title={t('coaching')} entries={[[tm('oneOnOnesHeld'), p.coaching.oneOnOnesHeld ?? 0], [tm('oneOnOnesUpcoming'), p.coaching.oneOnOnesUpcoming ?? 0], [tm('coachingSessions'), p.coaching.coachingSessions ?? 0], [tm('openActions'), p.coaching.openCoachingActions ?? 0]]} />}
                      {p.reviews && <CountList title={t('reviews')} entries={statusEntries(p.reviews)} humanize />}
                      {p.pip && <CountList title={t('pip')} entries={statusEntries(p.pip)} humanize />}
                      {p.succession && <CountList title={t('succession')} entries={statusEntries(p.succession)} humanize />}
                    </div>
                  )}
                </PanelBoundary>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div><TileGrid cols={2}>{ids('KPI-TEA-006', 'KPI-PRO-001').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
                  <PanelBoundary title={t('incentives')} description={t('incentivesHint')} state={d.panels.incentives as never}>
                    {(p: { statusCounts: Record<string, number> }) => <CountList title="" entries={statusEntries(p.statusCounts)} empty={t('noIncentives')} humanize />}
                  </PanelBoundary>
                </div>
              </Section>

              <Section title={t('founderReporting')}>
                <TileGrid cols={3}>{ids('KPI-FND-001', 'KPI-FND-003').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid>
                <div className="mt-4">
                  <PanelBoundary title={t('reportStatus')} state={d.panels.founderReport as never}>
                    {(p: { latest: { id: string; type: string; status: string; periodStart: string; periodEnd: string; dueAt: string } | null }) => p.latest ? (
                      <p className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={p.latest.status === 'PUBLISHED' ? 'green' : 'gold'}>{p.latest.status}</Badge><span>{t('reportLine', { type: p.latest.type, due: formatTime(p.latest.dueAt, lc) })}</span><Link href={`/cx/founder-reports/${p.latest.id}`} className="font-medium text-blue-700 underline-offset-2 hover:underline">{t('openReport')}</Link></p>
                    ) : <p className="text-sm text-muted">{t('noReport')}</p>}
                  </PanelBoundary>
                </div>
              </Section>
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}

function CountList({ title, entries, empty, humanize }: { title: string; entries: Array<[string, number]>; empty?: string; humanize?: boolean }) {
  return (
    <div>
      {title && <h4 className="mb-1 text-sm font-semibold text-ink-700">{title}</h4>}
      {entries.length === 0 ? <p className="text-sm text-muted">{empty ?? '—'}</p> : (
        <ul className="space-y-1 text-sm">{entries.map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span className="text-ink-700">{humanize ? k.replaceAll('_', ' ').toLowerCase() : k}</span><span className="tabular font-medium">{v}</span></li>)}</ul>
      )}
    </div>
  );
}
