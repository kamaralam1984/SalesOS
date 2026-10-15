'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BellRing, Users } from 'lucide-react';
import { Alert, Button, DataTable, EmptyState, ErrorState, PageHeader, Panel, Skeleton, Stat, useToast, type Column } from '@salesos/ui';
import { Reveal } from '@/components/motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { usePermission } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useAdoption, useRemind, type Adoption } from './api';
import { ProgressBar, RateText } from './shared';

export function AdoptionPage() {
  return (
    <RequirePermission permission="sop:adoption:view">
      <AdoptionInner />
    </RequirePermission>
  );
}

type DocRow = Adoption['byDocument'][number];
type UserRow = Adoption['byUser'][number];

function AdoptionInner() {
  const t = useTranslations('sop.adoption');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const canRemind = usePermission('sop:create');
  const remind = useRemind();
  const q = useAdoption();

  const sendReminder = async (versionId: string) => {
    try {
      const r = await remind.mutateAsync(versionId);
      toast({ tone: 'success', title: t('reminded', { count: r.queued }) });
    } catch (e) {
      toast({ tone: 'danger', title: t('remindFailed'), description: apiErr(e).message });
    }
  };

  const docCols: Column<DocRow>[] = [
    { id: 'doc', header: t('document'), primary: true, cell: (r) => <Link className="font-medium hover:underline" href={`/sop/${r.documentId}`}>{r.documentTitle}</Link> },
    { id: 'ver', header: t('version'), hideOnMobile: true, cell: (r) => `v${r.versionNumber}` },
    { id: 'rate', header: t('rate'), cell: (r) => (
      <div className="min-w-32 space-y-1">
        <div className="text-sm"><RateText pct={r.ratePct} /> {r.required > 0 && <span className="text-muted">({t('counts', { done: r.acknowledged, total: r.required })})</span>}</div>
        <ProgressBar pct={r.ratePct} label={t('progressFor', { name: r.documentTitle })} />
      </div>
    ) },
    { id: 'pending', header: t('pending'), hideOnMobile: true, cell: (r) => r.pending.length === 0 ? <span className="text-muted">{t('nonePending')}</span> : <span className="text-sm">{r.pending.slice(0, 4).map((p) => p.name ?? '—').join(', ')}{r.pending.length > 4 ? ` ${t('more', { count: r.pending.length - 4 })}` : ''}</span> },
  ];
  const userCols: Column<UserRow>[] = [
    { id: 'name', header: t('person'), primary: true, cell: (r) => r.name ?? '—' },
    { id: 'rate', header: t('rate'), cell: (r) => <><RateText pct={r.ratePct} /> {r.required > 0 && <span className="text-muted">({t('counts', { done: r.acknowledged, total: r.required })})</span>}</> },
    { id: 'pending', header: t('pendingDocs'), hideOnMobile: true, cell: (r) => r.pendingDocumentIds.length },
  ];

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} breadcrumbs={[{ label: t('library'), href: '/sop' }, { label: t('title') }]} breadcrumbLabel={tc('breadcrumb')} />
      {q.isPending ? (
        <div role="status" aria-busy="true" aria-label={tc('loading')} className="space-y-4"><Skeleton className="h-28 rounded-lg" /><Skeleton className="h-64 rounded-lg" /></div>
      ) : q.isError ? (
        <ErrorState description={apiErr(q.error).message} requestId={apiErr(q.error).requestId} onRetry={() => q.refetch()} retryLabel={tc('retry')} />
      ) : (
        <div className="space-y-6">
          <Alert tone="info" className="enter-fade" title={t(`scope.${q.data.scope === 'org' || q.data.scope === 'team' || q.data.scope === 'own' ? q.data.scope : 'org'}`)}>{t('scopeHint')}</Alert>
          <div className="grid gap-4 sm:grid-cols-3">
            <Reveal><Stat accent="gold" label={t('overall')} value={q.data.overall.ratePct === null ? t('noRequired') : `${q.data.overall.ratePct}%`} icon={<Users className="size-5" aria-hidden="true" />} /></Reveal>
            <Reveal delay={0.06}><Stat accent="blue" label={t('acknowledged')} value={q.data.overall.acknowledged} /></Reveal>
            <Reveal delay={0.12}><Stat label={t('required')} value={q.data.overall.required} /></Reveal>
          </div>
          {q.data.byDocument.length === 0 ? (
            <EmptyState title={t('empty')} description={t('emptyHint')} />
          ) : (
            <>
              <Reveal delay={0.16}><Panel accent="gold" title={t('byDocument')}>
                <DataTable
                  caption={t('byDocument')}
                  columns={docCols}
                  rows={q.data.byDocument}
                  getRowId={(r) => r.documentId}
                  actionsHeader={tc('actions')}
                  rowActions={canRemind ? (r) => (
                    <Button size="sm" variant="secondary" leadingIcon={<BellRing className="size-4" aria-hidden="true" />} disabled={r.pending.length === 0} loading={remind.isPending && remind.variables === r.versionId} onClick={() => sendReminder(r.versionId)}>{t('remind')}</Button>
                  ) : undefined}
                />
              </Panel></Reveal>
              <Reveal delay={0.22}><Panel accent="blue" title={t('byPerson')} description={t('byPersonHint')}>
                <DataTable caption={t('byPerson')} columns={userCols} rows={q.data.byUser} getRowId={(r) => r.userId} emptyTitle={t('empty')} />
              </Panel></Reveal>
            </>
          )}
        </div>
      )}
    </>
  );
}
