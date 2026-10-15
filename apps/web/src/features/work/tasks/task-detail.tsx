'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, FormField, PageHeader, Panel, Textarea, Timeline, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { ConfirmDialog, MutationAlert, QueryState } from '@/features/people/hub/shared';
import { useCommentTask, useTransitionTask, useWorkTask, type WorkTaskDetail } from '@/lib/api/hooks/work-tasks';
import { useWorkDates } from '../common/shared';
import { EditTaskDialog } from './task-forms';
import { priorityTone, taskActions, taskStatusTone, type TaskAction } from './task-logic';

export function TaskDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="work-tasks:view">
      <Inner id={id} />
    </RequirePermission>
  );
}

function Inner({ id }: { id: string }) {
  const t = useTranslations('workTasks');
  const d = useWorkDates();
  const q = useWorkTask(id);
  const [edit, setEdit] = React.useState(false);
  const [action, setAction] = React.useState<TaskAction | null>(null);
  const x = q.data;
  const actions = x ? taskActions(x) : [];
  return (
    <QueryState query={q} isEmpty={!x} emptyTitle={t('detail.notFound')} emptyDescription={t('detail.notFoundBody')}>
      {x && (
        <>
          <PageHeader
            eyebrow={t('eyebrow')}
            title={x.title}
            description={x.description ?? undefined}
            breadcrumbs={[{ label: t('title'), href: '/work/tasks' }, { label: x.title }]}
            breadcrumbLabel={t('detail.breadcrumb')}
            actions={
              <>
                {x.can.edit && <Button variant="secondary" onClick={() => setEdit(true)}>{t('detail.edit')}</Button>}
                {actions.map((a) => (
                  <Button key={a.key} variant={a.primary ? 'gold' : a.key === 'CANCELLED' || a.key === 'REJECTED' ? 'ghost' : 'secondary'} onClick={() => setAction(a)}>{t(`actions.${a.key}` as never)}</Button>
                ))}
              </>
            }
          />
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone={taskStatusTone(x.status)}>{t(`status.${x.status}` as never)}</Badge>
            <Badge tone={priorityTone(x.priority)}>{t(`priority.${x.priority}` as never)}</Badge>
            {x.overdue && <Badge tone="red">{t('overdue')}</Badge>}
          </div>
          {x.overdue && x.dueAt && <Alert tone="danger" className="mb-4" title={t('detail.overdueTitle')}>{t('detail.overdueBody', { date: d.dateTime(x.dueAt) })}</Alert>}
          <div className="stagger grid gap-4 lg:grid-cols-2">
            <Panel accent="blue" title={t('title')}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">{t('detail.assignee')}</dt><dd className="text-ink">{x.assigneeName ?? '—'}</dd>
                <dt className="text-muted">{t('detail.assigner')}</dt><dd className="text-ink">{x.assignerName ?? '—'}</dd>
                <dt className="text-muted">{t('detail.due')}</dt><dd className="text-ink">{x.dueAt ? d.dateTime(x.dueAt) : t('noDue')}</dd>
                {x.goalId && (<><dt className="text-muted">{t('detail.goal')}</dt><dd><Link className="text-blue-700 underline focus-visible:outline-2 focus-visible:outline-focus" href={`/work/goals/${x.goalId}`}>{x.goalTitle ?? '—'}</Link></dd></>)}
                {x.project && (<><dt className="text-muted">{t('detail.project')}</dt><dd className="text-ink">{x.project}</dd></>)}
                {x.completedAt && (<><dt className="text-muted">{t('status.COMPLETED')}</dt><dd className="text-ink">{d.dateTime(x.completedAt)}</dd></>)}
              </dl>
              {x.evidence && (<><h3 className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">{t('detail.evidence')}</h3><p className="mt-1 text-sm whitespace-pre-wrap break-words text-ink">{x.evidence}</p></>)}
              {x.reviewNote && (<><h3 className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">{t('detail.reviewNote')}</h3><p className="mt-1 text-sm whitespace-pre-wrap break-words text-ink">{x.reviewNote}</p></>)}
            </Panel>
            <HistoryPanel x={x} />
          </div>
          {edit && <EditTaskDialog task={x} open={edit} onOpenChange={setEdit} />}
          {action && <ActionDialog x={x} action={action} onClose={() => setAction(null)} />}
        </>
      )}
    </QueryState>
  );
}

function HistoryPanel({ x }: { x: WorkTaskDetail }) {
  const t = useTranslations('workTasks');
  const d = useWorkDates();
  const { toast } = useToast();
  const comment = useCommentTask(x.id);
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) { setErr(true); return; }
    setErr(false);
    try {
      await comment.mutateAsync({ note: note.trim() });
      toast({ tone: 'success', title: t('detail.commented') });
      setNote('');
    } catch {
      /* shown below */
    }
  };
  const items = [...x.events].reverse().map((e) => ({
    id: e.id,
    title: e.kind === 'STATUS' && e.fromStatus && e.toStatus ? `${t('detail.kind.STATUS')}: ${t('detail.statusChange', { from: t(`status.${e.fromStatus}` as never), to: t(`status.${e.toStatus}` as never) })}` : t(`detail.kind.${e.kind}` as never),
    description: e.note ?? undefined,
    time: d.dateTime(e.createdAt),
    dateTime: e.createdAt,
    meta: e.actorName ?? undefined,
    tone: (e.kind === 'STATUS' && e.toStatus === 'COMPLETED' ? 'green' : e.kind === 'COMMENT' ? 'blue' : 'neutral') as 'green' | 'blue' | 'neutral',
  }));
  return (
    <Panel accent="gold" title={t('detail.history')}>
      {items.length === 0 ? <p className="text-sm text-muted">{t('detail.noHistory')}</p> : <Timeline items={items} label={t('detail.history')} />}
      {x.can.comment ? (
        <form onSubmit={submit} noValidate className="mt-5 space-y-3" aria-label={t('detail.comment')}>
          <FormField label={t('detail.comment')} error={err ? t('errors.required') : undefined}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <MutationAlert error={comment.error} />
          <Button type="submit" variant="secondary" loading={comment.isPending}>{t('detail.commentButton')}</Button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-muted">{t('detail.commentLocked')}</p>
      )}
    </Panel>
  );
}

function ActionDialog({ x, action, onClose }: { x: WorkTaskDetail; action: TaskAction; onClose: () => void }) {
  const t = useTranslations('workTasks');
  const { toast } = useToast();
  const run = useTransitionTask(x.id);
  const [note, setNote] = React.useState('');
  const [evidence, setEvidence] = React.useState('');
  const [err, setErr] = React.useState(false);
  const confirm = async () => {
    if (action.noteRequired && note.trim().length < 3) { setErr(true); return; }
    setErr(false);
    try {
      await run.mutateAsync({ to: action.to, version: x.version, ...(note.trim() ? { note: note.trim() } : {}), ...(evidence.trim() ? { evidence: evidence.trim() } : {}) });
      toast({ tone: 'success', title: t(`actions.done.${action.key}` as never) });
      onClose();
    } catch {
      /* shown in the dialog */
    }
  };
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`actions.title.${action.key}` as never)}
      description={x.title}
      confirmLabel={t('actions.confirm')}
      danger={action.key === 'CANCELLED' || action.key === 'REJECTED'}
      pending={run.isPending}
      error={run.error}
      onConfirm={() => void confirm()}
    >
      <FormField label={action.noteRequired ? t('actions.noteRequired') : t('actions.note')} error={err ? t('errors.noteShort') : undefined} required={action.noteRequired}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      {action.evidence && (
        <FormField label={t('actions.evidence')}><Textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></FormField>
      )}
    </ConfirmDialog>
  );
}
