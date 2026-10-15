'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Badge, Button, FormField, PageHeader, Pagination, Select, Stat, Tabs, TabsContent, TabsList, TabsTrigger } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState } from '@/features/people/hub/shared';
import { GOAL_RISKS, GOAL_STATUSES, useGoalSummary, useGoals, type Goal, type GoalListQuery } from '@/lib/api/hooks/work-goals';
import { ProgressBar, useWorkDates } from '../common/shared';
import { CreateGoalDialog } from './goal-forms';
import { goalStatusTone, goalViews, riskTone, showRisk } from './goal-logic';

export function GoalsPage() {
  return (
    <RequirePermission permission="goals:view">
      <Inner />
    </RequirePermission>
  );
}

const PAGE_SIZE = 10;

function Inner() {
  const t = useTranslations('workGoals');
  const tc = useTranslations('common');
  const router = useRouter();
  const { can } = useAuth();
  const views = goalViews(can);
  const [view, setView] = React.useState<GoalListQuery['view']>('mine');
  const [status, setStatus] = React.useState('');
  const [risk, setRisk] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState(false);
  const list = useGoals({ view, status: status || undefined, risk: risk || undefined, page, limit: PAGE_SIZE });
  const summary = useGoalSummary();
  const filtered = Boolean(status || risk);
  const reset = () => setPage(1);
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={can('goals:create') ? <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('new')}</Button> : undefined}
      />
      <section aria-label={t('stats.title')} className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('stats.total')} value={summary.data?.total ?? '—'} loading={summary.isLoading} accent="blue" />
        <Stat label={t('stats.atRisk')} value={summary.data?.byRisk.AT_RISK ?? 0} loading={summary.isLoading} accent="gold" />
        <Stat label={t('stats.overdue')} value={summary.data?.byRisk.OVERDUE ?? 0} loading={summary.isLoading} accent="red" />
        {can('goals:review') && <Stat label={t('stats.awaiting')} value={summary.data?.awaitingMyVerification ?? 0} loading={summary.isLoading} accent="green" />}
      </section>
      <Tabs value={view} onValueChange={(v) => { setView(v as GoalListQuery['view']); reset(); }}>
        <TabsList aria-label={t('viewsLabel')}>
          {views.map((v) => <TabsTrigger key={v} value={v}>{t(`views.${v}` as never)}</TabsTrigger>)}
        </TabsList>
      <TabsContent value={view}>
        <div className="my-4 flex flex-wrap gap-3 [&>*]:w-full sm:[&>*]:w-56">
          <FormField label={t('filterStatus')} className="w-56">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
              <option value="">{t('any')}</option>
              {GOAL_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('filterRisk')} className="w-56">
            <Select value={risk} onChange={(e) => { setRisk(e.target.value); reset(); }}>
              <option value="">{t('any')}</option>
              {GOAL_RISKS.map((s) => <option key={s} value={s}>{t(`risk.${s}` as never)}</option>)}
            </Select>
          </FormField>
        </div>
        <QueryState query={list} isEmpty={(list.data?.items.length ?? 0) === 0} emptyTitle={filtered ? t('emptyFiltered') : t('empty')} emptyDescription={filtered ? undefined : t('emptyBody')}>
          <ul className="stagger-fast space-y-2" aria-label={t('pageSummary')}>
            {(list.data?.items ?? []).map((g) => <GoalRow key={g.id} goal={g} showOwner={view !== 'mine'} />)}
          </ul>
          {(list.data?.hasMore || page > 1) && (
            <Pagination
              className="mt-4"
              page={page}
              hasNext={Boolean(list.data?.hasMore)}
              onPageChange={setPage}
              labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
            />
          )}
        </QueryState>
      </TabsContent>
      </Tabs>
      {open && <CreateGoalDialog open={open} onOpenChange={setOpen} onCreated={(id) => router.push(`/work/goals/${id}`)} />}
    </>
  );
}

function GoalRow({ goal: g, showOwner }: { goal: Goal; showOwner: boolean }) {
  const t = useTranslations('workGoals');
  const d = useWorkDates();
  const left = g.status === 'ACTIVE' ? (g.daysToTarget > 0 ? t('daysLeft', { n: g.daysToTarget }) : g.daysToTarget === 0 ? t('dueToday') : t('daysPast', { n: -g.daysToTarget })) : null;
  return (
    <li>
      <Link href={`/work/goals/${g.id}`} className="hover-lift block rounded-lg border border-line bg-surface p-3.5 hover:border-gold-300 focus-visible:outline-2 focus-visible:outline-focus">
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block font-medium text-ink">{g.title}</span>
            <span className="text-sm text-muted">
              {showOwner && g.ownerName ? `${g.ownerName} · ` : ''}
              {t('target', { date: d.day(g.targetDate) })}
              {left ? ` · ${left}` : ''}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {showRisk(g) && <Badge tone={riskTone(g.risk)}>{t(`risk.${g.risk}` as never)}</Badge>}
            <Badge tone={goalStatusTone(g.status)}>{t(`status.${g.status}` as never)}</Badge>
          </span>
        </span>
        <span className="mt-3 flex items-center gap-3">
          <ProgressBar value={g.progressPct} label={t('progressBar')} tone={showRisk(g) ? (riskTone(g.risk) === 'blue' ? 'blue' : riskTone(g.risk)) : 'neutral'} />
          <span className="w-12 shrink-0 text-right text-sm tabular-nums text-ink">{g.progressPct}%</span>
        </span>
      </Link>
    </li>
  );
}
