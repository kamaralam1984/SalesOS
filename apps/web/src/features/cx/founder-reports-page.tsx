'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FileText, Plus } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Pagination, Select, Stat, StatusBadge } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useList, useOne, type FounderReport, type ReportMetrics } from './api';
import { ListShell, useFmt, usePaginationLabels } from './shared';
import { CountUp } from '@/components/motion';

export function FounderReportsPage() {
  return (
    <RequirePermission permission="founder-reports:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('cx');
  const fmt = useFmt();
  const labels = usePaginationLabels();
  const [type, setType] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const query = useList<FounderReport>(ck('reports', 'list'), '/founder-reports', { page, limit: 12, type: type || undefined, status: status || undefined });
  const metrics = useOne<ReportMetrics>(ck('reports', 'metrics'), '/founder-reports/metrics', {});
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('reports.title')} description={t('reports.description')} actions={<Can permission="founder-reports:create"><Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />{t('reports.new')}</Button></Can>} />
      {metrics.data && (
        <div className="stagger mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('reports.timeliness')} value={metrics.data.timeliness.pct === null ? t('common.dash') : `${metrics.data.timeliness.pct}%`} hint={t('reports.timelinessHint', { onTime: metrics.data.timeliness.onTime, due: metrics.data.timeliness.due })} />
          <Stat label={t('reports.late')} value={<CountUp value={metrics.data.timeliness.late} />} />
          <Stat label={t('reports.missing')} value={<CountUp value={metrics.data.timeliness.missing} />} />
          <Stat label={t('reports.quality')} value={metrics.data.quality.meanCompletenessPct === null ? t('common.dash') : `${metrics.data.quality.meanCompletenessPct}%`} hint={metrics.data.quality.meanRating === null ? t('reports.notRated') : t('reports.meanRating', { r: metrics.data.quality.meanRating })} />
        </div>
      )}
      <div className="enter-fade mb-4 grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label={t('reports.type')} hideLabel><Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">{t('reports.allTypes')}</option><option value="WEEKLY">{t('reports.typeWEEKLY')}</option><option value="MONTHLY">{t('reports.typeMONTHLY')}</option></Select></FormField>
        <FormField label={t('reports.status')} hideLabel><Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">{t('reports.allStatuses')}</option><option value="DRAFT">{t('reports.statusDRAFT')}</option><option value="PUBLISHED">{t('reports.statusPUBLISHED')}</option></Select></FormField>
      </div>
      <ListShell query={query} skeletons={3}>
        {query.data && query.data.items.length === 0 ? (
          <EmptyState icon={<FileText className="size-6" aria-hidden="true" />} title={t('reports.empty')} description={t('reports.emptyHint')} />
        ) : (
          <>
            <ul className="stagger grid gap-3 md:grid-cols-2" aria-label={t('reports.listLabel')}>
              {query.data?.items.map((r) => (
                <li key={r.id}>
                  <Link href={`/cx/founder-reports/${r.id}`} className="hover-lift glow-hover accent-top block rounded-lg border border-line bg-surface p-4 shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge tone="blue">{t(`reports.type${r.type}` as never)}</Badge>
                      <StatusBadge status={r.status === 'PUBLISHED' ? 'success' : r.overdue ? 'overdue' : 'pending'}>{r.status === 'DRAFT' && r.overdue ? t('reports.overdue') : t(`reports.status${r.status}` as never)}</StatusBadge>
                      {r.versionNumber > 1 && <Badge tone="gold">{t('reports.version', { n: r.versionNumber })}</Badge>}
                      {r.status === 'PUBLISHED' && r.onTime !== null && <Badge tone={r.onTime ? 'green' : 'red'}>{r.onTime ? t('reports.onTime') : t('reports.lateBadge')}</Badge>}
                    </div>
                    <p className="break-words font-medium text-ink">{r.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{fmt.date(r.periodStart)} – {fmt.date(r.periodEnd)}</p>
                    <p className="mt-2 text-xs text-muted">{t('reports.due')}: {fmt.dateTime(r.dueAt)}{r.publishedAt ? ` · ${t('reports.publishedOn', { when: fmt.dateTime(r.publishedAt) })}` : ''}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination className="mt-5" page={page} hasNext={Boolean(query.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
          </>
        )}
      </ListShell>
      <CreateDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('cx');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('reports.newTitle')} description={t('reports.newDescription')} closeLabel={t('common.close')}>
        {open && <CreateForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErr = useApiErrorMessage();
  const create = useAction<Record<string, unknown>, FounderReport>('post', '/founder-reports');
  const [type, setType] = React.useState('WEEKLY');
  const [date, setDate] = React.useState('');
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ type, ...(date ? { periodDate: date } : {}) }, { onSuccess: (r) => { onDone(); router.push(`/cx/founder-reports/${r.id}`); } }); }}>
      {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
      <FormField label={t('reports.type')} required><Select value={type} onChange={(e) => setType(e.target.value)}><option value="WEEKLY">{t('reports.typeWEEKLY')}</option><option value="MONTHLY">{t('reports.typeMONTHLY')}</option></Select></FormField>
      <FormField label={t('reports.periodDate')} hint={t('reports.periodDateHint')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={create.isPending}>{t('reports.create')}</Button>
      </div>
    </form>
  );
}
