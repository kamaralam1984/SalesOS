'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Star } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, ErrorState, PageHeader, Panel, Skeleton, Textarea, FormField, Input, Select, Timeline, Pagination, type TimelineItem } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useList, useOne, type RelationshipView, type WatchRow } from './api';
import { LeadPicker, type PickedLead } from './lead-picker';
import { ListShell, useFmt, usePaginationLabels } from './shared';

export function RelationshipsPage() {
  return (
    <RequirePermission permission="relationships:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('cx');
  const router = useRouter();
  const fmt = useFmt();
  const labels = usePaginationLabels();
  const [page, setPage] = React.useState(1);
  const [lead, setLead] = React.useState<PickedLead | null>(null);
  const query = useList<WatchRow>(ck('watchlist'), '/cx/relationships/watchlist', { page, limit: 12 });
  const unwatch = useAction<{ leadId: string }>('delete', (i) => `/cx/relationships/watchlist/${i.leadId}`);
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('relationships.title')} description={t('relationships.description')} />
      <Panel accent="gold" title={t('relationships.find')} description={t('relationships.findHint')} className="enter-up mb-6">
        <LeadPicker value={lead} onChange={(l) => { setLead(l); if (l) router.push(`/cx/relationships/${l.id}`); }} label={t('relationships.learner')} />
      </Panel>
      <h2 className="mb-3 font-display text-xl font-semibold text-ink">{t('relationships.watchlist')}</h2>
      <p className="mb-4 max-w-2xl text-sm text-muted">{t('relationships.watchlistHint')}</p>
      <ListShell query={query} skeletons={3}>
        {query.data && query.data.items.length === 0 ? (
          <EmptyState icon={<Star className="size-6" aria-hidden="true" />} title={t('relationships.watchEmpty')} description={t('relationships.watchEmptyHint')} />
        ) : (
          <>
            <ul className="stagger grid gap-3 md:grid-cols-2" aria-label={t('relationships.watchlist')}>
              {query.data?.items.map((r) => (
                <li key={r.id} className="hover-lift accent-top rounded-lg border border-line bg-surface p-4 shadow-xs">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    {r.isKeyProspect && <Badge tone="gold" icon={<Star />}>{t('relationships.keyProspect')}</Badge>}
                    {r.watching && <Badge tone="blue" icon={<Eye />}>{t('relationships.watching')}</Badge>}
                    {r.stale && <Badge tone="red">{t('relationships.stale')}</Badge>}
                  </div>
                  <Link href={`/cx/relationships/${r.id}`} className="link-underline break-words font-medium text-blue-700">{r.fullName}</Link>
                  <p className="mt-0.5 text-sm text-muted">{r.status} · {t('complaints.owner')}: {r.ownerName ?? '—'}</p>
                  <p className="mt-1 text-xs text-muted">{t('relationships.lastActivity')}: {fmt.dateTime(r.lastActivityAt)}{r.nextActionAt ? ` · ${t('relationships.nextAction')}: ${fmt.dateTime(r.nextActionAt)}` : ''}</p>
                  {r.watchReason && <p className="mt-1 text-sm text-ink-700">{r.watchReason}</p>}
                  {r.watching && (
                    <Can permission="relationships:update">
                      <Button size="sm" variant="ghost" className="mt-2" loading={unwatch.isPending} onClick={() => unwatch.mutate({ leadId: r.id })}><EyeOff className="size-4" aria-hidden="true" />{t('relationships.unwatch')}</Button>
                    </Can>
                  )}
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

export function RelationshipViewPage({ leadId }: { leadId: string }) {
  return (
    <RequirePermission permission="relationships:view">
      <View leadId={leadId} />
    </RequirePermission>
  );
}

const TYPE_TONE: Record<string, TimelineItem['tone']> = { COMPLAINT: 'red', ESCALATION: 'red', SATISFACTION: 'gold', HANDOVER: 'blue', CALL: 'blue', RELATIONSHIP_NOTE: 'gold' };

function View({ leadId }: { leadId: string }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const query = useOne<RelationshipView>(ck('relationship', leadId), `/cx/relationships/${leadId}`);
  const watch = useAction<{ leadId: string; reason?: string }>('post', '/cx/relationships/watchlist');
  const unwatch = useAction<{ leadId: string }>('delete', (i) => `/cx/relationships/watchlist/${i.leadId}`);
  const addNote = useAction<{ kind: string; body: string }>('post', `/cx/relationships/${leadId}/notes`);
  const setEarnings = useAction<{ earnedRevenue: string; note?: string }>('post', `/cx/relationships/${leadId}/learner-earnings`);
  const [earned, setEarned] = React.useState('');
  const [kind, setKind] = React.useState('NOTE');
  const [body, setBody] = React.useState('');

  if (query.isPending) return <div className="space-y-3" aria-busy="true" aria-label={tc('loading')}><Skeleton className="h-10 w-1/2" /><Skeleton className="h-64" /></div>;
  if (query.isError) return <ErrorState description={apiErr(query.error).message} requestId={apiErr(query.error).requestId} onRetry={() => query.refetch()} retryLabel={tc('retry')} />;
  const v = query.data;
  const items: TimelineItem[] = v.timeline.map((e, i) => ({
    id: `${e.type}-${e.ref?.id ?? i}-${i}`,
    title: e.title,
    description: e.detail ?? undefined,
    time: fmt.dateTime(e.at),
    dateTime: e.at,
    tone: TYPE_TONE[e.type] ?? 'neutral',
    meta: e.actorName ? <span className="text-xs text-muted">{e.actorName}</span> : undefined,
  }));

  return (
    <>
      <PageHeader
        eyebrow={t('relationships.eyebrow')}
        title={v.lead.fullName}
        breadcrumbs={[{ label: t('relationships.title'), href: '/cx/relationships' }, { label: v.lead.fullName }]}
        breadcrumbLabel={tc('breadcrumb')}
        actions={
          v.mode === 'full' ? (
            <Can permission="relationships:update">
              {v.lead.watching
                ? <Button variant="secondary" loading={unwatch.isPending} onClick={() => unwatch.mutate({ leadId })}><EyeOff className="size-4" aria-hidden="true" />{t('relationships.unwatch')}</Button>
                : <Button variant="secondary" loading={watch.isPending} onClick={() => watch.mutate({ leadId })}><Eye className="size-4" aria-hidden="true" />{t('relationships.watch')}</Button>}
            </Can>
          ) : undefined
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {v.lead.isKeyProspect && <Badge tone="gold" icon={<Star />}>{t('relationships.keyProspect')}</Badge>}
        <Badge>{v.lead.status}</Badge>
        {v.lead.programName && <Badge tone="blue">{v.lead.programName}</Badge>}
        {v.lead.preferredLanguage && <Badge>{v.lead.preferredLanguage.toUpperCase()}</Badge>}
        {v.lead.learnerRank && <Badge tone="gold" icon={<Star />}>{t('relationships.rank', { rank: v.lead.learnerRank.label })}</Badge>}
      </div>
      {v.mode === 'summary' ? (
        <Alert tone="info" title={t('relationships.minimumData')}>{v.notice ?? t('relationships.minimumDataHint')}{v.handover ? ` ${t('relationships.handoverStatus', { status: v.handover.status })}` : ''}</Alert>
      ) : (
        <div className="stagger grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Panel accent="blue" title={t('relationships.timeline')} description={t('relationships.timelineHint')}>
            {items.length === 0 ? <p className="text-sm text-muted">{t('relationships.timelineEmpty')}</p> : <Timeline items={items} label={t('relationships.timeline')} />}
          </Panel>
          <div className="stagger space-y-4">
            <Panel accent="green" title={t('relationships.summary')}>
              <dl className="space-y-2 text-sm">
                <Row label={t('complaints.owner')}>{v.lead.ownerName ?? '—'}</Row>
                <Row label={t('relationships.lastActivity')}>{fmt.dateTime(v.lead.lastActivityAt)}</Row>
                <Row label={t('relationships.nextAction')}>{fmt.dateTime(v.lead.nextActionAt)}</Row>
                <Row label={t('relationships.openComplaints')}><Link className="text-blue-700 underline" href="/cx/complaints">{v.counts?.openComplaints ?? 0}</Link></Row>
                <Row label={t('relationships.openEscalations')}>{v.counts?.openEscalations ?? 0}</Row>
                <Row label={t('relationships.openTasks')}>{v.counts?.openTasks ?? 0}</Row>
                <Row label={t('relationships.deal')}>{v.deals?.summary ? `${fmt.money(v.deals.summary.wonValue, v.deals.summary.currency)} · ${fmt.date(v.deals.summary.wonAt)}` : v.deals?.note ?? '—'}</Row>
              </dl>
            </Panel>
            <Can permission="relationships:update">
              <Panel accent="gold" title={t('relationships.rankTitle')} description={t('relationships.rankHint')}>
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (/^\d{1,12}(\.\d{1,2})?$/.test(earned.trim())) setEarnings.mutate({ earnedRevenue: earned.trim() }, { onSuccess: () => setEarned('') }); }}>
                  {setEarnings.isError && <Alert tone="danger">{apiErr(setEarnings.error).message}</Alert>}
                  <p className="text-sm text-muted">
                    {v.lead.learnerEarnedRevenue ? t('relationships.rankCurrent', { amount: fmt.money(v.lead.learnerEarnedRevenue, 'INR'), rank: v.lead.learnerRank?.label ?? '—' }) : t('relationships.rankNone')}
                    {v.lead.nextRank ? ` ${t('relationships.rankNext', { rank: v.lead.nextRank.label, amount: fmt.money(v.lead.nextRank.remaining, 'INR') })}` : ''}
                  </p>
                  <FormField label={t('relationships.rankEarned')} required><Input inputMode="decimal" value={earned} onChange={(e) => setEarned(e.target.value)} placeholder="125000" /></FormField>
                  <Button type="submit" loading={setEarnings.isPending} disabled={!/^\d{1,12}(\.\d{1,2})?$/.test(earned.trim())}>{t('relationships.rankSave')}</Button>
                </form>
              </Panel>
            </Can>
            <Can permission="relationships:update">
              <Panel accent="gold" title={t('relationships.addNote')}>
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (body.trim().length > 0) addNote.mutate({ kind, body: body.trim() }, { onSuccess: () => setBody('') }); }}>
                  {addNote.isError && <Alert tone="danger">{apiErr(addNote.error).message}</Alert>}
                  <FormField label={t('relationships.noteKind')}>
                    <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                      {['NOTE', 'PROMISE', 'PREFERENCE', 'MILESTONE'].map((k) => <option key={k} value={k}>{t(`relationships.kind.${k}`)}</option>)}
                    </Select>
                  </FormField>
                  <FormField label={t('relationships.noteBody')} required><Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></FormField>
                  <Button type="submit" loading={addNote.isPending} disabled={body.trim().length === 0}>{t('relationships.saveNote')}</Button>
                </form>
              </Panel>
            </Can>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words text-right font-medium text-ink">{children}</dd></div>;
}
