'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { Alert, EmptyState, ErrorState, FormField, PageHeader, Panel, Select, Skeleton } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useSopDoc, useSopVersion } from './api';
import { diffStats, lineDiff } from './diff';

export function DiffPage() {
  return (
    <RequirePermission permission="sop:view">
      <DiffInner />
    </RequirePermission>
  );
}

function DiffInner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const t = useTranslations('sop.diff');
  const tv = useTranslations('sop.reader');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const doc = useSopDoc(id);
  const versions = doc.data?.versions ?? [];
  const to = sp.get('to') ?? versions[0]?.id ?? null;
  const from = sp.get('from') ?? versions[1]?.id ?? null;
  const a = useSopVersion(from);
  const b = useSopVersion(to);
  const lines = React.useMemo(() => (a.data && b.data ? lineDiff(a.data.body, b.data.body) : null), [a.data, b.data]);
  const stats = lines ? diffStats(lines) : null;
  const set = (k: 'from' | 'to', v: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set(k, v);
    router.replace(`/sop/${id}/diff?${p.toString()}`);
  };

  if (doc.isPending) return <div role="status" aria-busy="true" aria-label={tc('loading')}><Skeleton className="h-64 rounded-lg" /></div>;
  if (doc.isError) return <ErrorState description={apiErr(doc.error).message} onRetry={() => doc.refetch()} retryLabel={tc('retry')} />;

  const opts = versions.map((v) => <option key={v.id} value={v.id}>{tv('versionHeading', { version: v.versionNumber })}</option>);
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title', { name: doc.data.title })}
        breadcrumbs={[{ label: tv('libraryCrumb'), href: '/sop' }, { label: doc.data.title, href: `/sop/${id}` }, { label: t('crumb') }]}
        breadcrumbLabel={tc('breadcrumb')}
      />
      <div className="enter-up mb-5 grid gap-3 sm:grid-cols-2">
        <FormField label={t('from')}><Select value={from ?? ''} onChange={(e) => set('from', e.target.value)}>{opts}</Select></FormField>
        <FormField label={t('to')}><Select value={to ?? ''} onChange={(e) => set('to', e.target.value)}>{opts}</Select></FormField>
      </div>
      {versions.length < 2 ? (
        <EmptyState title={t('needTwo')} description={t('needTwoHint')} />
      ) : a.isPending || b.isPending ? (
        <Skeleton className="h-64 rounded-lg" aria-busy="true" />
      ) : a.isError || b.isError ? (
        <ErrorState description={apiErr(a.error ?? b.error).message} onRetry={() => { void a.refetch(); void b.refetch(); }} retryLabel={tc('retry')} />
      ) : lines && stats ? (
        <Panel accent="gold" title={t('changes')} description={t('stats', { added: stats.added, removed: stats.removed })}>
          {stats.added + stats.removed === 0 && <Alert tone="info" className="mb-3">{t('identical')}</Alert>}
          <div role="table" aria-label={t('tableLabel')} className="enter-fade overflow-x-auto rounded-md border border-line font-mono text-[0.8125rem]">
            {lines.map((l, i) => (
              <div
                role="row"
                key={i}
                className={`flex gap-2 px-2 py-0.5 ${l.op === 'add' ? 'bg-green-50' : l.op === 'del' ? 'bg-red-50' : ''}`}
              >
                <span role="cell" className="w-5 shrink-0 text-center" aria-label={t(l.op)}>
                  {l.op === 'add' ? <Plus className="inline size-3" aria-hidden="true" /> : l.op === 'del' ? <Minus className="inline size-3" aria-hidden="true" /> : ' '}
                </span>
                <span role="cell" className={`whitespace-pre-wrap break-words ${l.op === 'del' ? 'line-through decoration-red-600/50' : ''}`}>{l.text || ' '}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm"><Link className="text-blue-700 hover:underline" href={`/sop/${id}`}>{t('back')}</Link></p>
        </Panel>
      ) : null}
    </>
  );
}
