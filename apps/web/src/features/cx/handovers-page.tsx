'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ClipboardCheck, Inbox, Plus } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, Pagination, Select, FormField, Tabs, TabsContent, TabsList, TabsTrigger } from '@salesos/ui';
import { Can, useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ck, useList, type Handover } from './api';
import { HandoverStatusBadge, ListShell, SlaCountdown, useFmt, usePaginationLabels } from './shared';

const STATUSES = ['DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'ACKNOWLEDGED', 'OVERDUE', 'COMPLETED'] as const;

export function HandoversPage() {
  return (
    <RequirePermission permission="handover:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('cx');
  const { can } = useAuth();
  const isReceiver = can('handover:acknowledge');
  const [tab, setTab] = React.useState(isReceiver ? 'pending' : 'all');
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={isReceiver ? t('handover.inboxTitle') : t('handover.title')}
        description={isReceiver ? t('handover.inboxDescription') : t('handover.description')}
        actions={<Can permission="handover:create"><Button asChild><Link href="/cx/handovers/new"><Plus className="size-4" aria-hidden="true" />{t('handover.new')}</Link></Button></Can>}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('handover.tabs')}>
          <TabsTrigger value="pending">{t('handover.tabPending')}</TabsTrigger>
          <TabsTrigger value="all">{t('handover.tabAll')}</TabsTrigger>
        </TabsList>
        <TabsContent value="pending"><HandoverList pending /></TabsContent>
        <TabsContent value="all"><HandoverList /></TabsContent>
      </Tabs>
    </>
  );
}

function HandoverList({ pending }: { pending?: boolean }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const labels = usePaginationLabels();
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const query = useList<Handover>(ck('handovers', pending ? 'pending' : 'all'), '/handovers', { page, limit: 12, ...(pending ? { pending: true } : { status: status || undefined }) });
  return (
    <>
      {!pending && (
        <div className="enter-fade mb-4 w-full sm:w-60"><FormField label={t('handover.status')} hideLabel><Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">{t('handover.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`handoverStatus.${s}`)}</option>)}</Select></FormField></div>
      )}
      <ListShell query={query} skeletons={3}>
        {query.data && query.data.items.length === 0 ? (
          <EmptyState icon={pending ? <Inbox className="size-6" aria-hidden="true" /> : <ClipboardCheck className="size-6" aria-hidden="true" />} title={pending ? t('handover.pendingEmpty') : status ? tc('noMatches') : t('handover.empty')} description={pending ? t('handover.pendingEmptyHint') : t('handover.emptyHint')} />
        ) : (
          <>
            <ul className="stagger grid gap-3 md:grid-cols-2" aria-label={t('handover.listLabel')}>
              {query.data?.items.map((h) => (
                <li key={h.id}>
                  <Link href={`/cx/handovers/${h.id}`} className="hover-lift glow-hover accent-top block rounded-lg border border-line bg-surface p-4 shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <HandoverStatusBadge status={h.status} />
                      {h.minimumData ? <Badge>{t('handover.minimumData')}</Badge> : h.complete === false && h.status === 'DRAFT' && <Badge tone="gold">{t('handover.incomplete', { n: h.missing?.length ?? 0 })}</Badge>}
                    </div>
                    <p className="break-words font-medium text-ink">{h.learnerName ?? t('handover.unnamed')}</p>
                    <p className="mt-0.5 text-sm text-muted">{h.programName ?? '—'} · {t('handover.salesOwner')}: {h.ownerName ?? '—'}</p>
                    {h.pending && h.ackDueAt && <div className="mt-2"><SlaCountdown label={t('handover.acknowledgeBy')} dueAt={h.ackDueAt} breachedAt={h.overdueAt} /></div>}
                    <p className="mt-2 text-xs text-muted">{h.submittedAt ? `${t('handover.submittedAt')}: ${fmt.dateTime(h.submittedAt)}` : fmt.dateTime(h.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination className="mt-5" page={page} hasNext={Boolean(query.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
          </>
        )}
      </ListShell>
    </>
  );
}
