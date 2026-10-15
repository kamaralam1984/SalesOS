'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, FormField, Input, PageHeader, Panel, Textarea, Timeline, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ConfirmDialog, MutationAlert, QueryState } from '@/features/people/hub/shared';
import {
  useAddMilestone, useCommentGoal, useGoal, useGoalAction, usePostGoalProgress, useUpdateMilestone, type GoalDetail,
} from '@/lib/api/hooks/work-goals';
import { ProgressBar, useWorkDates } from '../common/shared';
import { EditGoalDialog } from './goal-forms';
import { goalStatusTone, primaryGoalAction, riskTone, showRisk } from './goal-logic';

export function GoalDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="goals:view">
      <Inner id={id} />
    </RequirePermission>
  );
}

type ActionKey = 'submit' | 'complete' | 'verify' | 'return' | 'cancel';

function Inner({ id }: { id: string }) {
  const t = useTranslations('workGoals');
  const d = useWorkDates();
  const q = useGoal(id);
  const [edit, setEdit] = React.useState(false);
  const [action, setAction] = React.useState<ActionKey | null>(null);
  const g = q.data;
  const primary = g ? primaryGoalAction(g) : null;
  return (
    <QueryState query={q} isEmpty={!g} emptyTitle={t('detail.notFound')} emptyDescription={t('detail.notFoundBody')}>
      {g && (
        <>
          <PageHeader
            eyebrow={t('eyebrow')}
            title={g.title}
            description={g.description ?? undefined}
            breadcrumbs={[{ label: t('title'), href: '/work/goals' }, { label: g.title }]}
            breadcrumbLabel={t('detail.breadcrumb')}
            actions={
              <>
                {g.can.edit && <Button variant="secondary" onClick={() => setEdit(true)}>{t('detail.edit')}</Button>}
                {g.can.submit && <Button variant={primary === 'submit' ? 'gold' : 'secondary'} onClick={() => setAction('submit')}>{t('actions.submit')}</Button>}
                {g.can.completeDirect && <Button variant={primary === 'complete' ? 'gold' : 'secondary'} onClick={() => setAction('complete')}>{t('actions.complete')}</Button>}
                {g.can.verify && <Button variant="gold" onClick={() => setAction('verify')}>{t('actions.verify')}</Button>}
                {g.can.return && <Button variant="secondary" onClick={() => setAction('return')}>{t('actions.return')}</Button>}
                {g.can.cancel && <Button variant="ghost" onClick={() => setAction('cancel')}>{t('actions.cancel')}</Button>}
              </>
            }
          />
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone={goalStatusTone(g.status)}>{t(`status.${g.status}` as never)}</Badge>
            {showRisk(g) && <Badge tone={riskTone(g.risk)}>{t(`risk.${g.risk}` as never)}</Badge>}
            <span className="text-sm text-muted">{t('detail.cycleValue', { start: d.day(g.startDate), end: d.day(g.targetDate), n: g.cycleDays })}</span>
          </div>
          <Banners g={g} />
          <div className="stagger grid gap-4 lg:grid-cols-2">
            <ProgressPanel g={g} />
            <Panel accent="gold" title={t('detail.cycle')}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">{t('detail.owner')}</dt><dd className="text-ink">{g.ownerName ?? '—'}</dd>
                <dt className="text-muted">{t('detail.reviewer')}</dt><dd className="text-ink">{g.reviewerName ?? t('noReviewer')}</dd>
              </dl>
              <p className="mt-2 text-sm text-muted">{t('detail.createdBy', { name: g.createdByName ?? '—' })}</p>
              {g.verifiedAt && <p className="text-sm text-muted">{t('detail.verifiedBy', { name: g.verifiedByName ?? '—' })} · {d.dateTime(g.verifiedAt)}</p>}
              <div className="mt-4">
                <p className="mb-1 text-sm text-muted">{t('elapsed', { n: g.elapsedPct })}</p>
                <ProgressBar value={g.elapsedPct} label={t('elapsed', { n: g.elapsedPct })} tone="neutral" />
              </div>
            </Panel>
          </div>
          <div className="stagger mt-4 grid gap-4 lg:grid-cols-2">
            <MilestonesPanel g={g} />
            <LinkedTasksPanel g={g} />
          </div>
          <ActivityPanel g={g} />
          {edit && <EditGoalDialog goal={g} open={edit} onOpenChange={setEdit} />}
          {action && <ActionDialog g={g} action={action} onClose={() => setAction(null)} />}
        </>
      )}
    </QueryState>
  );
}

function Banners({ g }: { g: GoalDetail }) {
  const t = useTranslations('workGoals');
  const { user } = useAuth();
  return (
    <div className="mb-4 space-y-3">
      {g.status === 'PENDING_VERIFICATION' && (
        <Alert tone="info" title={t('detail.pendingTitle')}>{g.ownerId === user?.id ? t('detail.pendingMine', { name: g.reviewerName ?? '—' }) : t('detail.pendingBody')}</Alert>
      )}
      {g.status === 'ACTIVE' && g.risk === 'OVERDUE' && <Alert tone="danger" title={t('detail.overdueTitle')}>{t('detail.riskBody', { progress: g.progressPct, elapsed: g.elapsedPct })}</Alert>}
      {g.status === 'ACTIVE' && g.risk === 'AT_RISK' && <Alert tone="warning" title={t('detail.atRiskTitle')}>{t('detail.riskBody', { progress: g.progressPct, elapsed: g.elapsedPct })}</Alert>}
      {g.status === 'ACTIVE' && g.progressPct >= 100 && (g.can.submit || g.can.completeDirect) && <Alert tone="info">{t('detail.needsSubmit')}</Alert>}
      {g.status === 'COMPLETED' && <Alert tone="success">{t('detail.verified')}</Alert>}
      {g.status === 'CANCELLED' && <Alert tone="warning">{t('detail.cancelled')}</Alert>}
    </div>
  );
}

function ProgressPanel({ g }: { g: GoalDetail }) {
  const t = useTranslations('workGoals');
  const { toast } = useToast();
  const post = usePostGoalProgress(g.id);
  const measurable = g.targetValue != null && Number(g.targetValue) > 0;
  const [value, setValue] = React.useState(measurable ? g.currentValue : String(g.progressPct));
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const v = value.trim();
    if (measurable ? !/^\d{1,12}(\.\d{1,2})?$/.test(v) : !/^\d{1,3}$/.test(v) || Number(v) > 100) {
      setErr(measurable ? 'badNumber' : 'required');
      return;
    }
    try {
      await post.mutateAsync({ version: g.version, ...(measurable ? { currentValue: v } : { progressPct: Number(v) }), ...(note.trim() ? { note: note.trim() } : {}) });
      toast({ tone: 'success', title: t('detail.posted') });
      setNote('');
    } catch {
      /* shown below */
    }
  };
  return (
    <Panel accent="blue" title={t('detail.progress')}>
      <div className="flex items-center gap-3">
        <ProgressBar value={g.progressPct} label={t('progressBar')} tone={showRisk(g) ? riskTone(g.risk) : 'neutral'} />
        <span className="w-14 shrink-0 text-right text-lg font-semibold tabular-nums text-ink">{g.progressPct}%</span>
      </div>
      {measurable && <p className="mt-2 text-sm text-muted">{t('detail.currentValueHint', { value: g.currentValue, target: g.targetValue ?? '', unit: g.unit ?? '' })}</p>}
      {g.can.progress ? (
        <form onSubmit={submit} noValidate className="mt-4 space-y-3" aria-label={t('detail.postProgress')}>
          <FormField label={measurable ? t('detail.currentValue') : t('detail.manualPct')} error={err ? t(`errors.${err}` as never) : undefined} required>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </FormField>
          <FormField label={t('detail.note')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <MutationAlert error={post.error} />
          <Button type="submit" loading={post.isPending}>{t('detail.postButton')}</Button>
        </form>
      ) : (
        g.status === 'ACTIVE' && <p className="mt-3 text-sm text-muted">{t('detail.onlyOwner')}</p>
      )}
    </Panel>
  );
}

function MilestonesPanel({ g }: { g: GoalDetail }) {
  const t = useTranslations('workGoals');
  const d = useWorkDates();
  const { toast } = useToast();
  const toggle = useUpdateMilestone(g.id);
  const add = useAddMilestone(g.id);
  const [title, setTitle] = React.useState('');
  const [due, setDue] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2) { setErr('titleShort'); return; }
    setErr(null);
    try {
      await add.mutateAsync({ title: title.trim(), ...(due ? { dueDate: due } : {}) });
      toast({ tone: 'success', title: t('detail.milestoneAdded') });
      setTitle('');
      setDue('');
    } catch {
      /* shown below */
    }
  };
  return (
    <Panel accent="green" title={t('detail.milestones')}>
      {g.milestones.length === 0 ? (
        <p className="text-sm text-muted">{t('detail.noMilestones')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {g.milestones.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 items-center gap-3">
                {g.can.milestones ? (
                  <Checkbox checked={m.done} disabled={toggle.isPending} aria-label={t('detail.milestoneDone', { title: m.title })} onCheckedChange={(c) => toggle.mutate({ milestoneId: m.id, done: c === true })} />
                ) : m.done ? (
                  <Check aria-hidden="true" className="size-4 text-green-700" />
                ) : null}
                <span className={m.done ? 'text-muted line-through' : 'text-ink'}>{m.title}</span>
              </span>
              <span className="shrink-0 text-sm text-muted">{m.dueDate ? d.day(m.dueDate) : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <MutationAlert error={toggle.error} />
      {g.can.milestones && (
        <form onSubmit={submit} noValidate className="mt-4 grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end" aria-label={t('detail.addMilestone')}>
          <FormField label={t('detail.milestoneTitle')} error={err ? t(`errors.${err}` as never) : undefined}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
          <FormField label={t('detail.milestoneDue')}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
          <Button type="submit" variant="secondary" loading={add.isPending}>{t('detail.addMilestone')}</Button>
        </form>
      )}
      <MutationAlert error={add.error} />
    </Panel>
  );
}

function LinkedTasksPanel({ g }: { g: GoalDetail }) {
  const t = useTranslations('workGoals');
  const tt = useTranslations('workTasks');
  return (
    <Panel accent="blue" title={t('detail.tasks')}>
      {!g.tasksAvailable ? (
        <p className="text-sm text-muted">{t('detail.tasksHidden')}</p>
      ) : g.tasks.length === 0 ? (
        <p className="text-sm text-muted">{t('detail.noTasks')}</p>
      ) : (
        <ul className="divide-y divide-line" aria-label={t('detail.tasks')}>
          {g.tasks.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 py-2.5">
              <Link href={`/work/tasks/${x.id}`} className="min-w-0 font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                {x.title}
                <span className="block text-sm font-normal text-muted">{x.assigneeName ?? '—'}</span>
              </Link>
              <Badge tone="neutral">{tt(`status.${x.status}` as never)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ActivityPanel({ g }: { g: GoalDetail }) {
  const t = useTranslations('workGoals');
  const d = useWorkDates();
  const { toast } = useToast();
  const comment = useCommentGoal(g.id);
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
  const items = [...g.updates].reverse().map((u) => ({
    id: u.id,
    title: `${t(`detail.kind.${u.kind}` as never)}${u.kind === 'PROGRESS' && u.progressPct != null ? ` (${u.progressPct}%)` : ''}`,
    description: u.note ?? undefined,
    time: d.dateTime(u.createdAt),
    dateTime: u.createdAt,
    meta: u.authorName ?? undefined,
    tone: (u.kind === 'VERIFIED' ? 'green' : u.kind === 'RETURNED' ? 'gold' : u.kind === 'PROGRESS' ? 'blue' : 'neutral') as 'green' | 'gold' | 'blue' | 'neutral',
  }));
  return (
    <Panel className="mt-4" title={t('detail.activity')}>
      {items.length === 0 ? <p className="text-sm text-muted">{t('detail.noActivity')}</p> : <Timeline items={items} label={t('detail.activity')} />}
      {g.can.comment && (
        <form onSubmit={submit} noValidate className="mt-5 space-y-3" aria-label={t('detail.comment')}>
          <FormField label={t('detail.comment')} error={err ? t('errors.required') : undefined}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <MutationAlert error={comment.error} />
          <Button type="submit" variant="secondary" loading={comment.isPending}>{t('detail.commentButton')}</Button>
        </form>
      )}
    </Panel>
  );
}

function ActionDialog({ g, action, onClose }: { g: GoalDetail; action: ActionKey; onClose: () => void }) {
  const t = useTranslations('workGoals');
  const { toast } = useToast();
  const run = useGoalAction(g.id, action === 'complete' ? 'submit' : action);
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState(false);
  const needsNote = action === 'return' || action === 'cancel';
  const confirm = async () => {
    if (needsNote && note.trim().length < 3) { setErr(true); return; }
    setErr(false);
    try {
      await run.mutateAsync({ version: g.version, ...(action === 'cancel' ? { reason: note.trim() } : note.trim() ? { note: note.trim() } : {}) });
      toast({ tone: 'success', title: t(`actions.done.${action}` as never) });
      onClose();
    } catch {
      /* shown in the dialog */
    }
  };
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`actions.${action}Title` as never)}
      description={t(`actions.${action}Body` as never)}
      confirmLabel={t('actions.confirm')}
      danger={action === 'cancel'}
      pending={run.isPending}
      error={run.error}
      onConfirm={() => void confirm()}
    >
      {(needsNote || action === 'submit' || action === 'verify') && (
        <FormField label={action === 'cancel' ? t('actions.reason') : needsNote ? t('actions.noteRequired') : t('actions.noteOptional')} error={err ? t('errors.noteShort') : undefined} required={needsNote}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      )}
    </ConfirmDialog>
  );
}
