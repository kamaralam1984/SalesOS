'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ListChecks, Plus } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Pagination, Select, Stat, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useList, useOne, type ActionItem, type ActionItemMetrics } from './api';
import { useAssignable } from './complaints-page';
import { HistoryList, ListShell, NoteDialog, toInputDateTime, inputToIso, useFmt, usePaginationLabels, WorkStatusBadge } from './shared';
import { CountUp } from '@/components/motion';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'ESCALATED', 'CANCELLED'] as const;

export function ActionItemsPage() {
  return (
    <RequirePermission permission="action-items:view">
      <Inner />
    </RequirePermission>
  );
}

type Dlg = { kind: 'complete' | 'cancel'; item: ActionItem } | null;

function Inner() {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const labels = usePaginationLabels();
  const [scope, setScope] = React.useState<'mine' | 'all'>('mine');
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const query = useList<ActionItem>(ck('action-items', 'list'), '/action-items', { page, limit: 12, mine: scope === 'mine' || undefined, status: status || undefined });
  const metrics = useOne<ActionItemMetrics>(ck('action-items', 'metrics'), '/action-items/metrics', {});
  const update = useAction<{ id: string; [k: string]: unknown }, ActionItem>('patch', (i) => `/action-items/${i.id}`);
  const run = (item: ActionItem, body: Record<string, unknown>) => update.mutate({ id: item.id, ...body }, { onSuccess: () => setDlg(null) });
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('actionItems.title')} description={t('actionItems.description')} actions={<Can permission="action-items:create"><Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />{t('actionItems.new')}</Button></Can>} />
      {metrics.data && (
        <div className="stagger mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label={t('actionItems.completionRate')} value={metrics.data.pct === null ? t('common.dash') : `${metrics.data.pct}%`} hint={t('actionItems.completionHint', { onTime: metrics.data.onTime, due: metrics.data.due })} />
          <Stat label={t('actionItems.open')} value={<CountUp value={metrics.data.open} />} />
          <Stat label={t('actionItems.overdue')} value={<CountUp value={metrics.data.overdue} />} accent={metrics.data.overdue > 0 ? 'none' : 'none'} />
        </div>
      )}
      <div className="enter-fade mb-4 grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label={t('actionItems.scope')} hideLabel><Select value={scope} onChange={(e) => { setScope(e.target.value as 'mine' | 'all'); setPage(1); }}><option value="mine">{t('actionItems.mine')}</option><option value="all">{t('actionItems.all')}</option></Select></FormField>
        <FormField label={t('actionItems.status')} hideLabel><Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">{t('actionItems.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`workStatus.${s}`)}</option>)}</Select></FormField>
      </div>
      <ListShell query={query} skeletons={3}>
        {query.data && query.data.items.length === 0 ? (
          <EmptyState icon={<ListChecks className="size-6" aria-hidden="true" />} title={status || scope === 'mine' ? tc('noMatches') : t('actionItems.empty')} description={t('actionItems.emptyHint')} />
        ) : (
          <>
            <ul className="stagger grid gap-3" aria-label={t('actionItems.listLabel')}>
              {query.data?.items.map((a) => (
                <li key={a.id} className="hover-lift accent-top rounded-lg border border-line bg-surface p-4 shadow-xs">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <WorkStatusBadge status={a.status} />
                    {a.overdue && a.status !== 'OVERDUE' && a.status !== 'ESCALATED' && <Badge tone="red">{t('actionItems.pastDue')}</Badge>}
                    {a.status === 'COMPLETED' && a.completedOnTime !== null && <Badge tone={a.completedOnTime ? 'green' : 'red'}>{a.completedOnTime ? t('actionItems.onTime') : t('actionItems.late')}</Badge>}
                  </div>
                  <p className="break-words font-medium text-ink">{a.title}</p>
                  {a.description && <p className="mt-0.5 text-sm text-ink-700">{a.description}</p>}
                  <p className="mt-1 break-words text-sm text-muted">{t('complaints.owner')}: {a.ownerName ?? '—'} · {t('actionItems.due')}: {fmt.dateTime(a.dueAt)}</p>
                  {a.status === 'COMPLETED' && <p className="mt-2 text-sm text-ink-700"><span className="font-medium text-ink">{t('actionItems.evidence')}: </span>{a.evidence || t('common.dash')} · {a.completionNote}</p>}
                  {a.status === 'CANCELLED' && a.cancelReason && <p className="mt-2 text-sm text-ink-700">{a.cancelReason}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.status === 'OPEN' && <Button size="sm" variant="secondary" loading={update.isPending && update.variables?.id === a.id} onClick={() => run(a, { status: 'IN_PROGRESS' })}>{t('actionItems.start')}</Button>}
                    {['OPEN', 'IN_PROGRESS', 'OVERDUE', 'ESCALATED'].includes(a.status) && <Button size="sm" onClick={() => { update.reset(); setDlg({ kind: 'complete', item: a }); }}>{t('actionItems.complete')}</Button>}
                    {['OPEN', 'OVERDUE'].includes(a.status) && <Button size="sm" variant="ghost" onClick={() => { update.reset(); setDlg({ kind: 'cancel', item: a }); }}>{t('actionItems.cancel')}</Button>}
                    <Details id={a.id} />
                  </div>
                </li>
              ))}
            </ul>
            {update.isError && !dlg && <Alert tone="danger" className="mt-3">{apiErr(update.error).message}</Alert>}
            <Pagination className="mt-5" page={page} hasNext={Boolean(query.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
          </>
        )}
      </ListShell>
      <CreateDialog open={creating} onOpenChange={setCreating} />
      {dlg?.kind === 'complete' && <CompleteDialog item={dlg.item} pending={update.isPending} error={update.error} onClose={() => setDlg(null)} onSubmit={(body) => run(dlg.item, { status: 'COMPLETED', ...body })} />}
      {dlg?.kind === 'cancel' && <NoteDialog open onOpenChange={(o) => !o && setDlg(null)} title={t('actionItems.cancel')} description={t('actionItems.cancelHint')} label={t('complaints.reason')} submitLabel={t('actionItems.cancel')} pending={update.isPending} error={update.error} onSubmit={(cancelReason) => run(dlg.item, { status: 'CANCELLED', cancelReason })} />}
    </>
  );
}

function Details({ id }: { id: string }) {
  const t = useTranslations('cx');
  const [open, setOpen] = React.useState(false);
  const q = useOne<ActionItem>(ck('action-items', id), `/action-items/${id}`, {}, open);
  return (
    <div className="w-full">
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? t('actionItems.hideHistory') : t('actionItems.showHistory')}</Button>
      {open && <div className="mt-2 rounded-md bg-ivory-100 p-3">{q.isPending ? <p className="text-sm text-muted">…</p> : q.isError ? <p className="text-sm text-red-700">{t('common.loadFailed')}</p> : <HistoryList items={q.data.history ?? []} />}</div>}
    </div>
  );
}

function CompleteDialog({ item, onClose, onSubmit, pending, error }: { item: ActionItem; onClose: () => void; onSubmit: (b: { completionNote: string; evidence: string }) => void; pending?: boolean; error?: unknown }) {
  const t = useTranslations('cx');
  const [evidence, setEvidence] = React.useState(item.evidence ?? '');
  return (
    <NoteDialog open onOpenChange={(o) => !o && onClose()} title={t('actionItems.complete')} description={t('actionItems.completeHint')} label={t('actionItems.completionNote')} submitLabel={t('actionItems.complete')} pending={pending} error={error}
      onSubmit={(completionNote) => evidence.trim() && onSubmit({ completionNote, evidence: evidence.trim() })}>
      <FormField label={t('actionItems.evidence')} required hint={t('actionItems.evidenceHint')}><Input value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={4000} /></FormField>
    </NoteDialog>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('cx');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('actionItems.newTitle')} description={t('actionItems.newDescription')} closeLabel={t('common.close')}>
        {open && <CreateForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const people = useAssignable('action-item', true);
  const create = useAction<Record<string, unknown>, ActionItem>('post', '/action-items');
  const [f, setF] = React.useState({ title: '', description: '', ownerId: '', dueAt: toInputDateTime(72) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const invalid = f.title.trim().length < 3 || !f.ownerId || !f.dueAt;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!invalid) create.mutate({ title: f.title.trim(), ...(f.description.trim() ? { description: f.description.trim() } : {}), ownerId: f.ownerId, dueAt: inputToIso(f.dueAt) }, { onSuccess: onDone }); }}>
      {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
      <FormField label={t('actionItems.fieldTitle')} required><Input value={f.title} onChange={set('title')} maxLength={200} /></FormField>
      <FormField label={t('actionItems.fieldDescription')}><Textarea rows={3} value={f.description} onChange={set('description')} maxLength={4000} /></FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('complaints.fieldOwner')} required><Select value={f.ownerId} onChange={set('ownerId')}><option value="">{t('actionItems.chooseOwner')}</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
        <FormField label={t('actionItems.due')} required><Input type="datetime-local" value={f.dueAt} onChange={set('dueAt')} /></FormField>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={create.isPending} disabled={invalid}>{t('actionItems.create')}</Button>
      </div>
    </form>
  );
}
