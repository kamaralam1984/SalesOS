'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Search, Star } from 'lucide-react';
import { Button, DataTable, FilterBar, Input, Pagination, Select, Stat, Tabs, TabsContent, TabsList, TabsTrigger, type Column } from '@salesos/ui';
import { CountUp } from '@/components/motion';
import { PageHeader } from '@/features/crm/motion';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useDeals, usePipeline, type Deal, type DealStage } from '@/lib/api/hooks/revenue';
import { HighValueBadge, Money, StageBadge, usePagerLabels, useRevFormat } from './common';
import { NewDealDialog } from './deal-dialogs';
import { DEAL_STAGES } from './lib';

export function DealsPage() {
  const t = useTranslations('revenue.deals');
  const [open, setOpen] = React.useState(false);
  return (
    <RequirePermission permission="deals:view">
      <PageHeader
        eyebrow={useTranslations('nav')('revenue')}
        title={t('title')}
        description={t('description')}
        actions={
          <Can permission="deals:create">
            <Button variant="gold" onClick={() => setOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('new')}
            </Button>
          </Can>
        }
      />
      <PipelineStrip />
      <Tabs defaultValue="board" className="mt-6">
        <TabsList aria-label={t('view')}>
          <TabsTrigger value="board">{t('board')}</TabsTrigger>
          <TabsTrigger value="list">{t('list')}</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="pt-4">
          <Board />
        </TabsContent>
        <TabsContent value="list" className="pt-4">
          <DealList />
        </TabsContent>
      </Tabs>
      <NewDealDialog open={open} onOpenChange={setOpen} />
    </RequirePermission>
  );
}

export function PipelineStrip() {
  const t = useTranslations('revenue.stage');
  const q = usePipeline();
  const f = useRevFormat();
  return (
    <section aria-label={useTranslations('revenue.deals')('pipeline')} className="stagger grid grid-cols-2 gap-3 md:grid-cols-5">
      {DEAL_STAGES.map((s) => {
        const row = q.data?.find((x) => x.stage === s);
        return (
          <Stat
            key={s}
            label={t(s)}
            loading={q.isPending}
            value={q.isError ? '—' : <CountUp value={row?.count ?? 0} />}
            hint={row?.amount ? f.money(row.amount, 'code') : undefined}
            accent={s === 'WON' ? 'gold' : 'blue'}
          />
        );
      })}
    </section>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const t = useTranslations('revenue.deals');
  const f = useRevFormat();
  return (
    <li>
      <Link href={`/revenue/deals/${deal.id}`} className="group glow-hover relative block overflow-hidden rounded-lg border border-line bg-surface p-3 pl-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-focus motion-reduce:transform-none">
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] origin-top scale-y-50 transition-transform duration-300 group-hover:scale-y-100 ${deal.stage === 'WON' ? 'bg-green-600' : deal.isHighValue ? 'bg-gold-500' : 'bg-blue-600'}`} />
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-ink">{deal.leadName ?? t('learner')}</p>
          {deal.isHighValue && <HighValueBadge level={deal.escalationLevel} />}
        </div>
        <p className="mt-0.5 text-sm text-muted">{deal.programName}</p>
        <p className="mt-2 text-base font-semibold text-ink"><Money value={deal.amount} /></p>
        <p className="mt-1 text-xs text-muted">
          {deal.ownerName}
          {deal.expectedCloseOn ? ` · ${t('expectedOn', { date: f.date(deal.expectedCloseOn) })}` : ''}
        </p>
        {deal.stage === 'WON' && deal.money && (
          <p className="mt-2 text-xs text-muted">
            {t('collectedOf', { collected: f.money(deal.money.collected), sale: f.money(deal.money.saleValue) })}
          </p>
        )}
      </Link>
    </li>
  );
}

function Column1({ stage }: { stage: DealStage }) {
  const t = useTranslations('revenue.deals');
  const tc = useTranslations('common');
  const q = useDeals({ stage, limit: 25 });
  const items = q.data?.items ?? [];
  const more = Boolean(q.data?.pagination?.hasMore);
  return (
    <section aria-labelledby={`col-${stage}`} className="enter-up w-72 shrink-0 snap-start rounded-xl border border-line bg-ivory-100 p-3 md:w-auto md:min-w-0">
      <h2 id={`col-${stage}`} className="mb-3 flex items-center justify-between text-sm font-semibold text-ink">
        <StageBadge stage={stage} />
        <span className="tabular text-xs text-muted">{q.data ? `${items.length}${more ? '+' : ''}` : '\u2026'}</span>
      </h2>
      {q.isPending ? (
        <p role="status" className="text-sm text-muted">{tc('loading')}</p>
      ) : q.isError ? (
        <div className="space-y-2 text-sm">
          <p className="text-red-700">{t('columnError')}</p>
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{tc('retry')}</Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-3 text-sm text-muted">{t('columnEmpty')}</p>
      ) : (
        <ul className="stagger-fast space-y-2">{items.map((d) => <DealCard key={d.id} deal={d} />)}</ul>
      )}
      {more && <p className="mt-2 text-xs text-muted">{t('columnMore')}</p>}
    </section>
  );
}

function Board() {
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
      {DEAL_STAGES.map((s) => <Column1 key={s} stage={s} />)}
    </div>
  );
}

function DealList() {
  const t = useTranslations('revenue.deals');
  const ts = useTranslations('revenue.stage');
  const tc = useTranslations('common');
  const f = useRevFormat();
  const router = useRouter();
  const pager = usePagerLabels();
  const canMoney = usePermission(['collections:view', 'deals:update']);
  const [stage, setStage] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [hv, setHv] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const q = useDeals({ page, limit: 20, ...(stage ? { stage } : {}), ...(search.trim().length >= 2 ? { q: search.trim() } : {}), ...(hv ? { highValue: 'true' } : {}) });
  const columns: Column<Deal>[] = [
    { id: 'lead', header: t('colLearner'), primary: true, cell: (d) => <Link className="font-medium text-blue-700 underline-offset-2 hover:underline" href={`/revenue/deals/${d.id}`}>{d.leadName ?? t('learner')}</Link> },
    { id: 'program', header: t('colProgram'), cell: (d) => d.programName },
    { id: 'stage', header: t('colStage'), cell: (d) => <span className="inline-flex flex-wrap items-center gap-1.5"><StageBadge stage={d.stage} />{d.isHighValue && <HighValueBadge level={d.escalationLevel} />}</span> },
    { id: 'amount', header: t('colAmount'), align: 'right', cell: (d) => <Money value={d.amount} /> },
    ...(canMoney ? [{ id: 'collected', header: t('colCollected'), align: 'right' as const, hideOnMobile: true, cell: (d: Deal) => (d.money ? <Money value={d.money.collected} /> : <span className="text-muted">{'—'}</span>) }] : []),
    { id: 'owner', header: t('colOwner'), hideOnMobile: true, cell: (d) => d.ownerName },
    { id: 'expected', header: t('colExpected'), hideOnMobile: true, cell: (d) => f.date(d.expectedCloseOn) },
  ];
  return (
    <div className="space-y-4">
      <FilterBar>
        <div className="relative min-w-52 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
          <Input type="search" aria-label={t('search')} placeholder={t('search')} className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select aria-label={t('filterStage')} value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }} className="w-44">
          <option value="">{t('allStages')}</option>
          {[...DEAL_STAGES, 'CANCELLED' as const].map((s) => (<option key={s} value={s}>{ts(s)}</option>))}
        </Select>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4"checked={hv} onChange={(e) => { setHv(e.target.checked); setPage(1); }} />
          <Star className="size-4 text-gold-700" aria-hidden="true" />
          {t('highValueOnly')}
        </label>
      </FilterBar>
      <DataTable
        caption={t('tableCaption')}
        columns={columns}
        rows={q.data?.items}
        getRowId={(d) => d.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={q.isError ? { message: t('loadError'), onRetry: () => void q.refetch() } : null}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        onRowClick={(d) => router.push(`/revenue/deals/${d.id}`)}
      />
      <Pagination page={page} hasNext={Boolean(q.data?.pagination?.hasMore)} onPageChange={setPage} labels={pager} />
    </div>
  );
}
