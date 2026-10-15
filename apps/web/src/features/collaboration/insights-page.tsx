'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Lightbulb, Plus } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Pagination, Select, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ListShell, useFmt, usePaginationLabels } from '@/features/cx/shared';
import { cb, DEPARTMENTS, useAction, useList, type Insight } from './api';

const KINDS = ['LEARNER', 'MARKET', 'OBJECTION', 'COMPETITOR'] as const;

export function InsightsPage() {
  return (
    <RequirePermission permission="insights:share">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('collab');
  const fmt = useFmt();
  const labels = usePaginationLabels();
  const [kind, setKind] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const query = useList<Insight>(cb('insights'), '/cx/insights', { page, limit: 12, kind: kind || undefined });
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('insights.title')} description={t('insights.description')} actions={<Can permission="insights:share"><Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />{t('insights.new')}</Button></Can>} />
      <Alert tone="info" className="mb-5">{t('insights.minimumData')}</Alert>
      <div className="enter-up mb-4 w-full sm:w-56"><FormField label={t('insights.kind')} hideLabel><Select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">{t('insights.allKinds')}</option>{KINDS.map((k) => <option key={k} value={k}>{t(`insights.kindValue.${k}`)}</option>)}</Select></FormField></div>
      <ListShell query={query} skeletons={3}>
        {query.data && query.data.items.length === 0 ? (
          <EmptyState icon={<Lightbulb className="size-6" aria-hidden="true" />} title={kind ? t('tasks.noMatches') : t('insights.empty')} description={t('insights.emptyHint')} />
        ) : (
          <>
            <ul className="stagger grid gap-3 md:grid-cols-2" aria-label={t('insights.listLabel')}>
              {query.data?.items.map((i) => (
                <li key={i.id} className="hover-lift accent-top min-w-0 rounded-lg border border-line bg-surface p-4 shadow-xs break-words">
                  <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone="blue">{t(`insights.kindValue.${i.kind}` as never)}</Badge>{i.audience.map((a) => <Badge key={a}>{t(`department.${a}` as never)}</Badge>)}</div>
                  <p className="font-medium text-ink">{i.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{i.body}</p>
                  {i.tags.length > 0 && <p className="mt-2 text-xs text-muted">{i.tags.map((x) => `#${x}`).join(' ')}</p>}
                  <p className="mt-2 text-xs text-muted">{i.authorName ?? '—'} · {fmt.dateTime(i.createdAt)}</p>
                </li>
              ))}
            </ul>
            <Pagination className="mt-5" page={page} hasNext={Boolean(query.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
          </>
        )}
      </ListShell>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={t('insights.newTitle')} description={t('insights.newDescription')} closeLabel={t('common.close')} size="lg">{creating && <CreateForm onDone={() => setCreating(false)} />}</DialogContent>
      </Dialog>
    </>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('collab');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const create = useAction<Record<string, unknown>, Insight>('post', '/cx/insights');
  const [f, setF] = React.useState({ kind: 'LEARNER', title: '', body: '', tags: '' });
  const [audience, setAudience] = React.useState<string[]>([]);
  const invalid = f.title.trim().length < 3 || f.body.trim().length < 3;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!invalid) create.mutate({ kind: f.kind, title: f.title.trim(), body: f.body.trim(), audience, tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10) }, { onSuccess: onDone }); }}>
      {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('insights.kind')} required><Select value={f.kind} onChange={(e) => setF((p) => ({ ...p, kind: e.target.value }))}>{KINDS.map((k) => <option key={k} value={k}>{t(`insights.kindValue.${k}`)}</option>)}</Select></FormField>
        <FormField label={t('insights.fieldTitle')} required><Input value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} maxLength={200} /></FormField>
      </div>
      <FormField label={t('insights.body')} required hint={t('insights.bodyHint')}><Textarea rows={5} value={f.body} onChange={(e) => setF((p) => ({ ...p, body: e.target.value }))} maxLength={5000} /></FormField>
      <FormField label={t('insights.tags')} hint={t('insights.tagsHint')}><Input value={f.tags} onChange={(e) => setF((p) => ({ ...p, tags: e.target.value }))} maxLength={200} /></FormField>
      <fieldset className="rounded-lg border border-line p-3">
        <legend className="px-1 text-sm font-semibold text-ink">{t('insights.audience')}</legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">{DEPARTMENTS.map((d) => <label key={d} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-gold-600" checked={audience.includes(d)} onChange={(e) => setAudience((p) => (e.target.checked ? [...p, d] : p.filter((x) => x !== d)))} />{t(`department.${d}`)}</label>)}</div>
        <p className="mt-1 text-xs text-muted">{t('insights.audienceHint')}</p>
      </fieldset>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={create.isPending} disabled={invalid}>{t('insights.share')}</Button>
      </div>
    </form>
  );
}
