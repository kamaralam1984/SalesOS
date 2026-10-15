'use client';
import { safeHref } from '@/lib/safe-url';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import {
  Alert, Badge, Button, Checkbox, DataTable, Dialog, DialogContent, EmptyState, ErrorState, FormField, Input, PageHeader, Pagination, Panel, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, type Column,
} from '@salesos/ui';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useTeamMemberOptions } from '../common/api';
import { useDebounced, useDone, useFmt } from '../hrkit/kit';
import {
  SKILL_TAGS, useAssignResource, useAssignments, useCreateResource, useResources, useUpdateAssignment, type Assignment, type AssignmentStatus, type Resource,
} from './api';

export function SkillsPage() {
  return (
    <RequirePermission permission="resources:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('skills');
  const canManage = usePermission('resources:manage');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Tabs defaultValue="library">
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="library">{t('tabs.library')}</TabsTrigger>
          <TabsTrigger value="mine">{t('tabs.mine')}</TabsTrigger>
          {canManage && <TabsTrigger value="manage">{t('tabs.manage')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="library"><LibraryTab /></TabsContent>
        <TabsContent value="mine"><MineTab /></TabsContent>
        {canManage && <TabsContent value="manage"><ManageTab /></TabsContent>}
      </Tabs>
    </>
  );
}

export function TagChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('skills');
  return (
    <div role="group" aria-label={t('filterTags')} className="flex flex-wrap gap-1.5">
      <button type="button" aria-pressed={value === ''} onClick={() => onChange('')} className={chip(value === '')}>{t('allTags')}</button>
      {SKILL_TAGS.map((tag) => (
        <button key={tag} type="button" aria-pressed={value === tag} onClick={() => onChange(value === tag ? '' : tag)} className={chip(value === tag)}>{t(`tag.${tag}` as never)}</button>
      ))}
    </div>
  );
}
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm transition motion-reduce:transition-none ${on ? 'glow-gold border-gold-400 bg-gold-50 text-gold-700' : 'border-line text-ink-600 hover:border-gold-300'}`;

function LibraryTab() {
  const t = useTranslations('skills');
  const apiErr = useApiErrorMessage();
  const [tag, setTag] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useResources({ tag: tag || undefined, q: useDebounced(search) || undefined, page });
  const update = useUpdateAssignment();
  const [assigning, setAssigning] = React.useState<Resource | null>(null);
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="space-y-4">
      <h2 className="sr-only">{t('tabs.library')}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500" />
          <Input type="search" aria-label={t('search')} placeholder={t('search')} className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Can permission="resources:manage"><Button className="glow-gold" onClick={() => setAdding(true)}>{t('add')}</Button></Can>
      </div>
      <TagChips value={tag} onChange={(v) => { setTag(v); setPage(1); }} />
      {q.isPending ? <Skeleton className="shimmer h-32 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : q.data.items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.items.map((r) => (
            <li key={r.id} className="accent-top hover-lift flex flex-col rounded-lg border border-line bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2"><h3 className="font-semibold text-ink">{r.title}</h3><Badge tone="blue">{t(`type.${r.type}` as never)}</Badge></div>
              {r.description && <p className="mt-1 text-sm text-ink-600">{r.description}</p>}
              <p className="mt-2 flex flex-wrap gap-1">{r.skillTags.map((x) => <Badge key={x} tone="neutral">{t.has(`tag.${x}` as never) ? t(`tag.${x}` as never) : x}</Badge>)}</p>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                {safeHref(r.url) && <a href={safeHref(r.url)} target="_blank" rel="noopener noreferrer" className="link-underline text-sm font-medium text-blue-700">{t('open')}</a>}
                {r.myAssignment && (
                  <Select aria-label={t('myStatus')} className="h-9 w-40" value={r.myAssignment.status} onChange={(e) => update.mutate({ id: r.myAssignment!.id, status: e.target.value as AssignmentStatus })}>
                    {(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] as const).map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
                  </Select>
                )}
                <Can permission="resources:manage"><Button size="sm" variant="secondary" onClick={() => setAssigning(r)}>{t('assign')}</Button></Can>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} hasPrev={page > 1} hasNext={Boolean(q.data?.pagination?.hasMore)} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
      <Dialog open={assigning !== null} onOpenChange={(o) => !o && setAssigning(null)}>{assigning && <AssignForm resource={assigning} onClose={() => setAssigning(null)} />}</Dialog>
      <Dialog open={adding} onOpenChange={setAdding}>{adding && <ResourceForm onClose={() => setAdding(false)} />}</Dialog>
    </div>
  );
}

function MineTab() {
  const t = useTranslations('skills');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const q = useAssignments();
  const update = useUpdateAssignment();
  const { data } = q;
  const mine = data;
  return (
    <Panel accent="gold" title={t('tabs.mine')} description={t('mineHint')}>
      {q.isPending ? <Skeleton className="shimmer h-24 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : mine!.length === 0 ? (
        <EmptyState title={t('mineEmptyTitle')} description={t('mineEmptyBody')} />
      ) : (
        <ul className="space-y-2">
          {mine!.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
              <div><p className="font-medium text-ink">{safeHref(a.url) ? <a className="underline" href={safeHref(a.url)} target="_blank" rel="noopener noreferrer">{a.title}</a> : a.title}</p><p className="text-xs text-muted">{a.dueDate ? t('due', { date: fmt.date(a.dueDate) }) : t('noDue')}{a.completedAt ? ` · ${t('completedOn', { date: fmt.date(a.completedAt) })}` : ''}</p></div>
              <Select aria-label={t('myStatus')} className="h-9 w-40" value={a.status} onChange={(e) => update.mutate({ id: a.id, status: e.target.value as AssignmentStatus })}>
                {(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] as const).map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
              </Select>
            </li>
          ))}
        </ul>
      )}
      {update.isError && <Alert tone="danger" className="mt-3">{apiErr(update.error).message}</Alert>}
    </Panel>
  );
}

function ManageTab() {
  const t = useTranslations('skills');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const q = useAssignments();
  const cols: Column<Assignment>[] = [
    { id: 'user', header: t('col.person'), primary: true, cell: (a) => a.userName ?? '—' },
    { id: 'res', header: t('col.resource'), cell: (a) => a.title },
    { id: 'status', header: t('col.status'), cell: (a) => <Badge tone={a.status === 'COMPLETED' ? 'green' : a.status === 'IN_PROGRESS' ? 'blue' : 'gold'}>{t(`status.${a.status}` as never)}</Badge> },
    { id: 'due', header: t('col.due'), hideOnMobile: true, cell: (a) => fmt.date(a.dueDate) },
    { id: 'done', header: t('col.completed'), hideOnMobile: true, cell: (a) => fmt.date(a.completedAt) },
  ];
  const completed = q.data?.filter((a) => a.status === 'COMPLETED').length ?? 0;
  return (
    <Panel accent="blue" title={t('tabs.manage')} description={q.data ? t('trackingSummary', { done: completed, total: q.data.length }) : t('trackingHint')}>
      <DataTable caption={t('tabs.manage')} columns={cols} rows={q.data} getRowId={(a) => a.id} loading={q.isPending} error={q.isError ? { message: apiErr(q.error).message, onRetry: () => void q.refetch() } : null} emptyTitle={t('trackEmptyTitle')} emptyDescription={t('trackEmptyBody')} />
    </Panel>
  );
}

function AssignForm({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  const t = useTranslations('skills');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const people = useTeamMemberOptions();
  const assign = useAssignResource(resource.id);
  const [ids, setIds] = React.useState<string[]>([]);
  const [due, setDue] = React.useState('');
  return (
    <DialogContent title={t('assignTitle', { title: resource.title })} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button disabled={ids.length === 0} loading={assign.isPending} onClick={() => assign.mutate({ userIds: ids, ...(due ? { dueDate: due } : {}) }, { onSuccess: () => { done(t('assigned')); onClose(); } })}>{t('assign')}</Button></>}>
      {assign.isError && <Alert tone="danger" className="mb-3">{apiErr(assign.error).message}</Alert>}
      <FormField label={t('dueOptional')}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
      <fieldset className="mt-3">
        <legend className="mb-1 text-sm font-medium text-ink">{t('people')}</legend>
        {people.isPending ? <Skeleton className="shimmer h-20 w-full" /> : (
          <ul className="max-h-60 space-y-1 overflow-auto">
            {(people.data ?? []).map((p) => (
              <li key={p.id}><Checkbox label={p.name} checked={ids.includes(p.id)} onCheckedChange={(c) => setIds(c === true ? [...ids, p.id] : ids.filter((x) => x !== p.id))} /></li>
            ))}
          </ul>
        )}
      </fieldset>
    </DialogContent>
  );
}

function ResourceForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('skills');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const create = useCreateResource();
  const [v, setV] = React.useState({ title: '', description: '', type: 'ARTICLE', url: '', tags: [] as string[] });
  const urlOk = v.url === '' || /^https?:\/\/\S+$/.test(v.url);
  const valid = v.title.trim().length >= 3 && v.tags.length > 0 && urlOk;
  return (
    <DialogContent title={t('add')} description={t('addBody')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate({ title: v.title, type: v.type, skillTags: v.tags, ...(v.description ? { description: v.description } : {}), ...(v.url ? { url: v.url } : {}) }, { onSuccess: () => { done(t('saved')); onClose(); } })}>{t('save')}</Button></>}>
      {create.isError && <Alert tone="danger" className="mb-3">{apiErr(create.error).message}</Alert>}
      <div className="grid gap-3">
        <FormField label={t('form.title')} required><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></FormField>
        <FormField label={t('form.type')}><Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{['ARTICLE', 'VIDEO', 'DOCUMENT', 'TEMPLATE', 'LINK', 'COURSE'].map((x) => <option key={x} value={x}>{t(`type.${x}` as never)}</option>)}</Select></FormField>
        <FormField label={t('form.url')} error={urlOk ? undefined : t('form.urlInvalid')} hint={t('form.urlHint')}><Input value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} /></FormField>
        <FormField label={t('form.description')}><Textarea rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></FormField>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink">{t('form.tags')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {SKILL_TAGS.map((tag) => (
              <button key={tag} type="button" aria-pressed={v.tags.includes(tag)} onClick={() => setV({ ...v, tags: v.tags.includes(tag) ? v.tags.filter((x) => x !== tag) : [...v.tags, tag] })} className={chip(v.tags.includes(tag))}>{t(`tag.${tag}` as never)}</button>
            ))}
          </div>
        </fieldset>
      </div>
    </DialogContent>
  );
}
