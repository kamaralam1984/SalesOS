'use client';
import * as React from 'react';
import { TodayRow } from './today-row';
import { useLocale, useTranslations } from 'next-intl';
import { PageHeader, Stat } from '@salesos/ui';
import { useDashboard } from '@/lib/api/hooks/analytics';
import { ExportButtons } from '@/features/reporting/export-buttons';
import { AnalyticsFilterBar, useAnalyticsFilters } from './filters';
import { formatDay, formatTime } from './format';
import { KpiTile, TileGrid } from './kpi-tile';
import { PanelBoundary, type RiskItems, RiskGrid, type Scorecard, ScorecardTable, TargetTiles } from './panels';
import { QueryBoundary, Section } from './query-boundary';

const ids = (...x: string[]) => x;

/** Sales Manager: the team roster with per-member target, calls, follow-ups, conversion; workload; overdue/ageing; weekly KRAs. */
export function ManagerDashboard() {
  const t = useTranslations('analytics.manager');
  const lc = useLocale();
  const filters = useAnalyticsFilters({ period: 'MONTH' });
  const q = useDashboard('manager', filters.query);
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} actions={<ExportButtons report="team-performance" params={filters.query} />} />
      <TodayRow />
      <AnalyticsFilterBar filters={filters} target="manager" show={{ team: true, program: true, source: true, owner: true }} />
      <QueryBoundary q={q}>
        {(d, fetching) => {
          const k = d.kpis;
          return (
            <div aria-busy={fetching}>
              <p className="mb-4 text-xs text-muted" data-testid="dashboard-meta">{t('meta', { from: formatDay(d.dateRange.from, lc), to: formatDay(d.dateRange.to, lc), time: formatTime(d.generatedAt, lc), scope: d.filters.scopeLevel })}</p>
              <Section title={t('target')}>
                <TargetTiles tiles={d.targets.revenue} />
                <div className="mt-4"><TileGrid>{ids('KPI-REV-003', 'KPI-TEA-002', 'KPI-SAL-001', 'KPI-SAL-004').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
              </Section>
              <Section title={t('roster')} description={t('rosterHint')}>
                <PanelBoundary title={t('team')} state={d.panels.roster as never}>
                  {(p: { members: Scorecard[] }) => (
                    <div className="space-y-3">
                      <ScorecardTable rows={p.members} caption={t('team')} />
                      <p className="text-xs text-muted">{t('callsLegend')}</p>
                    </div>
                  )}
                </PanelBoundary>
              </Section>
              <Section title={t('activity')}>
                <TileGrid>{ids('KPI-PRD-001', 'KPI-PRD-006', 'KPI-PRD-008', 'KPI-PRD-002', 'KPI-EXC-005', 'KPI-TEA-003', 'KPI-PRD-003', 'KPI-TEA-006').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid>
              </Section>
              <Section title={t('workload')} description={t('workloadHint')}>
                <PanelBoundary title={t('teamRisks')} state={d.panels.risks as never}>{(p: { items: RiskItems }) => <RiskGrid items={p.items} />}</PanelBoundary>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <PanelBoundary title={t('callbacks')} state={d.panels.callbacks as never}>
                    {(p: { callbacksPending: number; callbacksOverdue: number }) => (
                      <div className="grid gap-3 sm:grid-cols-2"><Stat label={t('callbacksPending')} value={p.callbacksPending} /><Stat label={t('callbacksOverdue')} value={p.callbacksOverdue} accent={p.callbacksOverdue > 0 ? 'red' : 'none'} /></div>
                    )}
                  </PanelBoundary>
                  <PanelBoundary title={t('ageing')} state={d.panels.funnelHealth as never}>
                    {(p: { stages: Array<{ stage: string; label: string; leads: number }> }) => (
                      <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('ageing')}>{p.stages.length === 0 ? <li className="text-sm text-muted">{t('noLeads')}</li> : p.stages.map((s) => <li key={s.stage}><Stat label={s.label} value={s.leads} /></li>)}</ul>
                    )}
                  </PanelBoundary>
                </div>
                <div className="mt-4"><TileGrid>{ids('KPI-PRD-005', 'KPI-EXC-001', 'KPI-EXC-002', 'KPI-EXC-003').map((id) => <KpiTile key={id} kpi={k[id]} />)}</TileGrid></div>
              </Section>
              <Section title={t('weekly')} description={t('weeklyHint')}>
                <PanelBoundary title={t('kra')} state={d.panels.kra as never}>
                  {(p: { weekStart: string; assignments: Array<{ assigneeId: string; name: string | null; items: Array<{ key: string; name: string; target?: number | string; unit?: string }> }> }) => p.assignments.length === 0 ? <p className="text-sm text-muted">{t('noKra', { week: formatDay(p.weekStart, lc) })}</p> : (
                    <ul className="space-y-3">{p.assignments.map((a) => (
                      <li key={a.assigneeId}><p className="text-sm font-semibold text-ink">{a.name}</p><ul className="mt-1 grid gap-1 text-sm text-ink-700 sm:grid-cols-2">{a.items.map((i) => <li key={i.key} className="flex justify-between gap-3"><span>{i.name}</span><span className="tabular">{i.target ?? '—'} {i.unit ?? ''}</span></li>)}</ul></li>
                    ))}</ul>
                  )}
                </PanelBoundary>
              </Section>
              <Section title={t('coaching')}>
                <PanelBoundary title={t('coachingStatus')} state={d.panels.people as never}>
                  {(p: { coaching?: { oneOnOnesHeld: number; oneOnOnesUpcoming: number; coachingSessions: number; openCoachingActions: number }; reviews?: Record<string, number>; pip?: Record<string, number> }) => (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {p.coaching && (<>
                        <Stat label={t('oneOnOnesHeld')} value={p.coaching.oneOnOnesHeld} />
                        <Stat label={t('oneOnOnesUpcoming')} value={p.coaching.oneOnOnesUpcoming} />
                        <Stat label={t('coachingSessions')} value={p.coaching.coachingSessions} />
                        <Stat label={t('openActions')} value={p.coaching.openCoachingActions} />
                      </>)}
                      {p.reviews && <Stat label={t('reviewsPending')} value={(p.reviews.DRAFT ?? 0) + (p.reviews.SUBMITTED ?? 0)} />}
                      {p.pip && <Stat label={t('pipActive')} value={(p.pip.ACTIVE ?? 0) + (p.pip.EXTENDED ?? 0) + (p.pip.PENDING_APPROVAL ?? 0)} />}
                    </div>
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
