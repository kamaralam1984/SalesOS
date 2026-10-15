'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCheck, MessagesSquare, Plus } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Select, Sheet, SheetContent, Textarea } from '@salesos/ui';
import { Can, useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ListShell, NoteDialog, WorkStatusBadge, inputToIso, toInputDateTime, useFmt } from '@/features/cx/shared';
import { cb, DEPARTMENTS, useAction, useList, useOne, type Department, type XfTask } from './api';

const COLUMNS: Array<{ id: string; statuses: string[] }> = [
  { id: 'open', statuses: ['OPEN'] },
  { id: 'inProgress', statuses: ['IN_PROGRESS'] },
  { id: 'attention', statuses: ['OVERDUE', 'ESCALATED'] },
  { id: 'done', statuses: ['COMPLETED'] },
];

export function TasksPage({ focus }: { focus?: string }) {
  return (
    <RequirePermission permission="xf-tasks:view">
      <Inner focus={focus} />
    </RequirePermission>
  );
}

function Inner({ focus }: { focus?: string }) {
  const t = useTranslations('collab');
  const [dept, setDept] = React.useState('');
  const [mine, setMine] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(focus ?? null);
  const query = useList<XfTask>(cb('tasks'), '/xf-tasks', { limit: 100, department: dept || undefined, mine: mine || undefined });
  const items = query.data?.items ?? [];
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('tasks.title')} description={t('tasks.description')} actions={<Can permission="xf-tasks:create"><Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />{t('tasks.new')}</Button></Can>} />
      <div className="enter-up mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-56"><FormField label={t('tasks.department')} hideLabel><Select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">{t('tasks.allDepartments')}</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`department.${d}`)}</option>)}</Select></FormField></div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink md:min-h-10"><input type="checkbox" className="size-4 accent-gold-600" checked={mine} onChange={(e) => setMine(e.target.checked)} />{t('tasks.mine')}</label>
      </div>
      <ListShell query={query} skeletons={3}>
        {query.data && items.length === 0 ? (
          <EmptyState icon={<MessagesSquare className="size-6" aria-hidden="true" />} title={dept || mine ? t('tasks.noMatches') : t('tasks.empty')} description={t('tasks.emptyHint')} />
        ) : (
          <div className="stagger grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {COLUMNS.map((col) => {
              const rows = items.filter((x) => col.statuses.includes(x.status));
              return (
                <section key={col.id} aria-labelledby={`xf-${col.id}`} className="accent-top min-w-0 rounded-lg border border-line bg-ivory-100/60 p-3">
                  <h2 id={`xf-${col.id}`} className="mb-3 flex items-center justify-between font-display text-base font-semibold text-ink">{t(`tasks.col.${col.id}`)}<Badge>{rows.length}</Badge></h2>
                  {rows.length === 0 ? <p className="px-1 py-5 text-center text-sm text-muted">{t('tasks.columnEmpty')}</p> : (
                    <ul className="stagger-fast space-y-2.5">{rows.map((x) => <li key={x.id}><TaskCard task={x} onOpen={() => setOpenId(x.id)} /></li>)}</ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </ListShell>
      <CreateDialog open={creating} onOpenChange={setCreating} />
      <Sheet open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        {openId && <TaskSheet id={openId} onClose={() => setOpenId(null)} />}
      </Sheet>
    </>
  );
}

function TaskCard({ task: x, onOpen }: { task: XfTask; onOpen: () => void }) {
  const t = useTranslations('collab');
  const fmt = useFmt();
  return (
    <button type="button" onClick={onOpen} className="hover-lift glow-hover block w-full min-w-0 rounded-lg border border-line bg-surface p-3 text-left shadow-xs break-words focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={x.title}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone="blue">{t(`department.${x.department}`)}</Badge>
        {x.kind !== 'TASK' && <Badge>{t(`kind.${x.kind}` as never)}</Badge>}
        {x.overdue && <Badge tone="red" icon={<AlertTriangle />}>{t('tasks.overdue')}</Badge>}
        {x.status === 'COMPLETED' && (x.confirmedAt ? <Badge tone="green" icon={<CheckCheck />}>{t('tasks.confirmed')}</Badge> : <Badge tone="gold">{t('tasks.awaitingConfirm')}</Badge>)}
      </div>
      <p className="font-medium text-ink">{x.title}</p>
      <p className="mt-0.5 text-xs text-muted">{x.ownerName ?? '—'} · {fmt.dateTime(x.dueAt)}</p>
      {(x.blockedBy ?? 0) > 0 && <p className="mt-1 text-xs text-gold-700">{t('tasks.blocked', { n: x.blockedBy ?? 0 })}</p>}
    </button>
  );
}

function TaskSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('collab');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const { can, user } = useAuth();
  const q = useOne<XfTask>(cb('task', id), `/xf-tasks/${id}`);
  const patch = useAction<Record<string, unknown>, XfTask>('patch', `/xf-tasks/${id}`);
  const confirm = useAction<Record<string, never>, XfTask>('post', `/xf-tasks/${id}/confirm`);
  const comment = useAction<{ body: string }>('post', `/xf-tasks/${id}/comments`);
  const escalate = useAction<{ reason: string }>('post', `/xf-tasks/${id}/escalate`);
  const [dlg, setDlg] = React.useState<'complete' | 'cancel' | 'escalate' | null>(null);
  const [text, setText] = React.useState('');
  const x = q.data;
  const mineOwner = x?.ownerId === user?.id;
  const mineRequester = x?.requesterId === user?.id;
  const open = x && ['OPEN', 'IN_PROGRESS', 'OVERDUE', 'ESCALATED'].includes(x.status);
  return (
    <SheetContent title={x?.title ?? t('tasks.title')} description={x ? `${t(`department.${x.department}`)} · ${fmt.dateTime(x.dueAt)}` : undefined} closeLabel={tc('close')}>
      {q.isPending ? <p className="text-sm text-muted" role="status">{tc('loading')}</p> : q.isError ? <Alert tone="danger">{apiErr(q.error).message}</Alert> : x && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><WorkStatusBadge status={x.status} /><Badge tone="blue">{t(`department.${x.department}`)}</Badge>{x.confirmedAt && <Badge tone="green">{t('tasks.confirmedBy', { name: x.confirmedByName ?? '—' })}</Badge>}</div>
          {x.description && <p className="whitespace-pre-wrap text-sm text-ink">{x.description}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('tasks.owner')}</dt><dd>{x.ownerName}</dd></div>
            <div><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('tasks.requester')}</dt><dd>{x.requesterName}</dd></div>
            {x.completionNote && <div className="col-span-2"><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('tasks.completionNote')}</dt><dd>{x.completionNote}</dd></div>}
            {x.cancelReason && <div className="col-span-2"><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('tasks.cancelReason')}</dt><dd>{x.cancelReason}</dd></div>}
          </dl>
          {Object.keys(x.payload ?? {}).length > 0 && (
            <div><p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{t('tasks.sharedData')}</p><ul className="rounded-md bg-ivory-100 p-2 text-sm">{Object.entries(x.payload).map(([k, v]) => <li key={k}><span className="text-muted">{k}: </span>{String(v)}</li>)}</ul></div>
          )}
          {(x.dependencies?.length ?? 0) > 0 && (
            <div><p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{t('tasks.dependencies')}</p><ul className="space-y-1 text-sm">{x.dependencies?.map((d) => <li key={d.id} className="flex items-center justify-between gap-2"><span>{d.title}</span><WorkStatusBadge status={d.status} /></li>)}</ul></div>
          )}
          {(patch.isError || confirm.isError || escalate.isError) && <Alert tone="danger">{apiErr(patch.error ?? confirm.error ?? escalate.error).message}</Alert>}
          <div className="flex flex-wrap gap-2">
            {x.status === 'OPEN' && can('xf-tasks:update') && (mineOwner || can('xf-tasks:update', 'team')) && <Button size="sm" variant="secondary" loading={patch.isPending} onClick={() => patch.mutate({ status: 'IN_PROGRESS' })}>{t('tasks.start')}</Button>}
            {open && can('xf-tasks:update') && (mineOwner || can('xf-tasks:update', 'team')) && <Button size="sm" onClick={() => { patch.reset(); setDlg('complete'); }}>{t('tasks.complete')}</Button>}
            {x.status === 'COMPLETED' && !x.confirmedAt && (mineRequester || can('founder-reports:view')) && <Button size="sm" loading={confirm.isPending} onClick={() => confirm.mutate({})}>{t('tasks.confirm')}</Button>}
            {open && can('xf-tasks:update') && (mineOwner || mineRequester || can('xf-tasks:update', 'team')) && <Button size="sm" variant="secondary" onClick={() => { escalate.reset(); setDlg('escalate'); }}>{t('tasks.escalate')}</Button>}
            {['OPEN', 'OVERDUE'].includes(x.status) && can('xf-tasks:update') && (mineRequester || can('xf-tasks:update', 'team')) && <Button size="sm" variant="ghost" onClick={() => { patch.reset(); setDlg('cancel'); }}>{t('tasks.cancel')}</Button>}
          </div>
          <section aria-label={t('tasks.comments')}>
            <h3 className="mb-2 font-display text-base font-semibold text-ink">{t('tasks.comments')}</h3>
            {(x.comments?.length ?? 0) === 0 ? <p className="text-sm text-muted">{t('tasks.noComments')}</p> : <ul className="space-y-2">{x.comments?.map((c) => <li key={c.id} className="rounded-md bg-ivory-100 p-2.5 text-sm"><p className="text-ink">{c.body}</p><p className="mt-0.5 text-xs text-muted">{c.authorName} · {fmt.dateTime(c.createdAt)}</p></li>)}</ul>}
            <Can permission="xf-tasks:update">
              <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) comment.mutate({ body: text.trim() }, { onSuccess: () => setText('') }); }}>
                {comment.isError && <Alert tone="danger">{apiErr(comment.error).message}</Alert>}
                <FormField label={t('tasks.addComment')} hideLabel><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('tasks.addComment')} maxLength={4000} /></FormField>
                <Button type="submit" size="sm" variant="secondary" loading={comment.isPending} disabled={!text.trim()}>{t('tasks.postComment')}</Button>
              </form>
            </Can>
          </section>
          {dlg === 'complete' && <NoteDialog open onOpenChange={(o) => !o && setDlg(null)} title={t('tasks.complete')} description={t('tasks.completeHint')} label={t('tasks.completionNote')} submitLabel={t('tasks.complete')} pending={patch.isPending} error={patch.error} onSubmit={(completionNote) => patch.mutate({ status: 'COMPLETED', completionNote }, { onSuccess: () => setDlg(null) })} />}
          {dlg === 'cancel' && <NoteDialog open onOpenChange={(o) => !o && setDlg(null)} title={t('tasks.cancel')} description={t('tasks.cancelHint')} label={t('tasks.cancelReason')} submitLabel={t('tasks.cancel')} pending={patch.isPending} error={patch.error} onSubmit={(cancelReason) => patch.mutate({ status: 'CANCELLED', cancelReason }, { onSuccess: () => { setDlg(null); onClose(); } })} />}
          {dlg === 'escalate' && <NoteDialog open onOpenChange={(o) => !o && setDlg(null)} title={t('tasks.escalate')} description={t('tasks.escalateHint')} label={t('tasks.escalateReason')} submitLabel={t('tasks.escalate')} pending={escalate.isPending} error={escalate.error} onSubmit={(reason) => escalate.mutate({ reason }, { onSuccess: () => setDlg(null) })} />}
        </div>
      )}
    </SheetContent>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('collab');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('tasks.newTitle')} description={t('tasks.newDescription')} closeLabel={t('common.close')} size="lg">
        {open && <CreateForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('collab');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const create = useAction<Record<string, unknown>, XfTask>('post', '/xf-tasks');
  const [f, setF] = React.useState({ title: '', description: '', department: 'MARKETING' as Department, kind: 'TASK', ownerId: '', dueAt: toInputDateTime(72), priority: '3' });
  const assignees = useOne<Array<{ id: string; name: string }>>(cb('assignees', f.department), '/xf-tasks/assignees', { department: f.department });
  const others = useList<XfTask>(cb('tasks', 'deps'), '/xf-tasks', { open: true, limit: 50 });
  const [deps, setDeps] = React.useState<string[]>([]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value, ...(k === 'department' ? { ownerId: '' } : {}) }));
  const invalid = f.title.trim().length < 3 || !f.ownerId || !f.dueAt;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!invalid) create.mutate({ title: f.title.trim(), ...(f.description.trim() ? { description: f.description.trim() } : {}), department: f.department, kind: f.kind, ownerId: f.ownerId, dueAt: inputToIso(f.dueAt), priority: Number(f.priority), dependsOnIds: deps }, { onSuccess: onDone }); }}>
      {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
      <Alert tone="info">{t('tasks.minimumData')}</Alert>
      <FormField label={t('tasks.fieldTitle')} required><Input value={f.title} onChange={set('title')} maxLength={200} /></FormField>
      <FormField label={t('tasks.fieldDescription')}><Textarea rows={3} value={f.description} onChange={set('description')} maxLength={4000} /></FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('tasks.department')} required><Select value={f.department} onChange={set('department')}>{DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`department.${d}`)}</option>)}</Select></FormField>
        <FormField label={t('tasks.owner')} required><Select value={f.ownerId} onChange={set('ownerId')}><option value="">{assignees.isPending ? tc('loading') : t('tasks.chooseOwner')}</option>{assignees.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
        <FormField label={t('tasks.kind')}><Select value={f.kind} onChange={set('kind')}>{['TASK', 'HANDOFF', 'CAMPAIGN_ALIGNMENT', 'WEBINAR_PLANNING', 'INSIGHT_REQUEST'].map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}</Select></FormField>
        <FormField label={t('tasks.due')} required><Input type="datetime-local" value={f.dueAt} onChange={set('dueAt')} /></FormField>
      </div>
      {(others.data?.items.length ?? 0) > 0 && (
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">{t('tasks.dependsOn')}</legend>
          <ul className="max-h-40 space-y-1 overflow-y-auto">{others.data?.items.map((o) => <li key={o.id}><label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-gold-600" checked={deps.includes(o.id)} onChange={(e) => setDeps((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))} />{o.title}</label></li>)}</ul>
        </fieldset>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={create.isPending} disabled={invalid}>{t('tasks.create')}</Button>
      </div>
    </form>
  );
}
