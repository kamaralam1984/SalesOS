'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { RotateCcw } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, PageHeader, Pagination, Panel, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useList, useOne, type RefundAnalytics, type RefundRow } from './api';
import { BarList, ROOT_CAUSES } from './complaints-page';
import { ListShell, useFmt, usePaginationLabels } from './shared';

export function RefundsPage() {
  return (
    <RequirePermission permission="refunds:view">
      <Inner />
    </RequirePermission>
  );
}

const STATUSES = ['REQUESTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'PROCESSED', 'RECONCILED', 'CANCELLED'];

function Inner() {
  const t = useTranslations('cx');
  const [tab, setTab] = React.useState('tracking');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('refunds.title')} description={t('refunds.description')} />
      <Alert tone="info" className="mb-5">{t('refunds.separate')}</Alert>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('refunds.tabs')}>
          <TabsTrigger value="tracking">{t('refunds.tabTracking')}</TabsTrigger>
          <TabsTrigger value="analytics">{t('refunds.tabAnalytics')}</TabsTrigger>
        </TabsList>
        <TabsContent value="tracking"><Tracking /></TabsContent>
        <TabsContent value="analytics"><Analytics /></TabsContent>
      </Tabs>
    </>
  );
}

function Tracking() {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const labels = usePaginationLabels();
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [tag, setTag] = React.useState<RefundRow | null>(null);
  const query = useList<RefundRow>(ck('refunds'), '/cx/refunds', { page, limit: 10, status: status || undefined });
  return (
    <>
      <div className="mb-4 w-full max-w-60"><FormField label={t('refunds.status')} hideLabel><Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">{t('refunds.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`refundStatus.${s}` as never)}</option>)}</Select></FormField></div>
      <ListShell query={query} skeletons={3}>
        {query.data && query.data.items.length === 0 ? (
          <EmptyState icon={<RotateCcw className="size-6" aria-hidden="true" />} title={status ? tc('noMatches') : t('refunds.empty')} description={t('refunds.emptyHint')} />
        ) : (
          <>
            <ul className="stagger grid gap-3" aria-label={t('refunds.listLabel')}>
              {query.data?.items.map((r) => (
                <li key={r.id} className="hover-lift rounded-lg border border-line bg-surface p-4 shadow-xs">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone={r.status === 'PROCESSED' || r.status === 'RECONCILED' ? 'green' : r.status === 'REJECTED' || r.status === 'CANCELLED' || r.status === 'WITHDRAWN' ? 'neutral' : 'gold'}>{t(`refundStatus.${r.status}` as never)}</Badge>
                    <span className="text-sm text-muted">{r.learnerName ?? '—'} · {r.programName ?? '—'}</span>
                    <span className="text-sm text-muted">{t(`refundReason.${r.reasonCategory}` as never)}</span>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <Fact label={t('refunds.requested')} at={r.requested.at} amount={r.minimumData ? undefined : r.requested.amount} by={r.requested.byName} currency={r.currency} fmt={fmt} />
                    <Fact label={t('refunds.approved')} at={r.approved.at} amount={r.minimumData ? undefined : r.approved.amount} by={r.approved.byName} currency={r.currency} fmt={fmt} none={t('refunds.notApproved')} />
                    <Fact label={t('refunds.processed')} at={r.processed.at} amount={r.minimumData ? undefined : r.processed.amount} by={r.processed.byName} currency={r.currency} fmt={fmt} none={t('refunds.notProcessed')} />
                  </dl>
                  {r.minimumData && <p className="mt-2 text-xs text-muted">{t('refunds.minimumData')}</p>}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">{r.rootCause ? <><span className="font-medium text-ink">{t('refunds.rootCause')}: </span>{t(`rootCause.${r.rootCause.category}` as never)}{r.rootCause.note ? ` · ${r.rootCause.note}` : ''}</> : <span className="text-muted">{t('refunds.untagged')}</span>}</p>
                    <Can permission="complaints:update"><Button size="sm" variant="secondary" onClick={() => setTag(r)}>{r.rootCause ? t('refunds.retag') : t('refunds.tag')}</Button></Can>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination className="mt-5" page={page} hasNext={Boolean(query.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
          </>
        )}
      </ListShell>
      <TagDialog row={tag} onClose={() => setTag(null)} />
    </>
  );
}

function Fact({ label, at, amount, by, currency, fmt, none }: { label: string; at: string | null; amount?: string | null; by?: string | null; currency?: string; fmt: ReturnType<typeof useFmt>; none?: string }) {
  return (
    <div className="rounded-md bg-ivory-100 p-2.5">
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">
        {at ? <>{amount != null && <span className="block font-medium">{fmt.money(amount, currency)}</span>}<span className="block text-muted">{fmt.dateTime(at)}</span>{by && <span className="block text-muted">{by}</span>}</> : <span className="text-muted">{none ?? '—'}</span>}
      </dd>
    </div>
  );
}

function TagDialog({ row, onClose }: { row: RefundRow | null; onClose: () => void }) {
  const t = useTranslations('cx');
  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('refunds.tag')} description={t('refunds.tagHint')} closeLabel={t('common.close')}>
        {row && <TagForm row={row} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function TagForm({ row, onDone }: { row: RefundRow; onDone: () => void }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const tag = useAction<{ category: string; note?: string }>('post', `/cx/refunds/${row.id}/root-cause`);
  const [category, setCategory] = React.useState(row.rootCause?.category ?? '');
  const [note, setNote] = React.useState(row.rootCause?.note ?? '');
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (category) tag.mutate({ category, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: onDone }); }}>
      {tag.isError && <Alert tone="danger">{apiErr(tag.error).message}</Alert>}
      <FormField label={t('refunds.rootCause')} required>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">{t('complaints.chooseRootCause')}</option>{ROOT_CAUSES.map((r) => <option key={r} value={r}>{t(`rootCause.${r}`)}</option>)}</Select>
      </FormField>
      <FormField label={t('refunds.note')}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={tag.isPending} disabled={!category}>{t('refunds.saveTag')}</Button>
      </div>
    </form>
  );
}

function Analytics() {
  const t = useTranslations('cx');
  const query = useOne<RefundAnalytics>(ck('refunds', 'analytics'), '/cx/refunds/analytics', {});
  return (
    <ListShell query={query} skeletons={2}>
      {query.data && (
        <div className="enter-up space-y-5">
          <Alert tone="info" title={t('refunds.method')}>{query.data.method}</Alert>
          {query.data.cells.length === 0 ? <EmptyState title={t('refunds.analyticsEmpty')} description={t('refunds.analyticsEmptyHint')} /> : (
            <Panel accent="gold" title={t('refunds.likeForLike')} description={t('refunds.likeForLikeHint')}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <caption className="sr-only">{t('refunds.likeForLike')}</caption>
                  <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="py-2 pr-3 font-medium">{t('trends.period')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('refunds.wonEnrolments')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('refunds.requestedCount')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('refunds.approvedCount')}</th><th scope="col" className="py-2 pr-3 font-medium">{t('refunds.rate')}</th><th scope="col" className="py-2 font-medium">{t('refunds.cohortRate')}</th></tr></thead>
                  <tbody>
                    {query.data.cells.map((c) => (
                      <tr key={`${c.programId}-${c.month}`} className="border-b border-line/60 last:border-0">
                        <th scope="row" className="py-2 pr-3 text-left font-medium">{c.month}</th><td className="py-2 pr-3">{c.wonEnrolments}</td><td className="py-2 pr-3">{c.refundsRequested}</td><td className="py-2 pr-3">{c.refundsApproved}</td>
                        <td className="py-2 pr-3">{c.rate === null ? t('common.dash') : `${(c.rate * 100).toFixed(1)}%`}</td><td className="py-2">{c.cohortRate === null ? t('common.dash') : `${(c.cohortRate * 100).toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          <Panel accent="blue" title={t('refunds.rootCauses')} description={t('refunds.untaggedApproved', { n: query.data.untaggedApproved })}>
            <BarList rows={query.data.rootCauses.map((r) => ({ key: r.category, label: t(`rootCause.${r.category}` as never), count: r.count }))} empty={t('trends.noRootCauses')} />
          </Panel>
        </div>
      )}
    </ListShell>
  );
}
