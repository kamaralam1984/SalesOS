'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, FormField, Input, PageHeader, Panel, Select, Textarea, Timeline, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ApiError } from '@/lib/api/client';
import { ConfirmDialog, MutationAlert, QueryState, RestrictedBanner, toneFor, useFormatDate } from '../hub/shared';
import { useCheckpoint, usePip, usePipAcknowledge, usePipApprove, type Pip } from './api';
import { DraftEditor } from './draft-editor';
import { allowedPipActions, PIP_STEPS, stepIndex, type TransitionKind } from './pip-logic';
import { TransitionDialog } from './transition-dialog';

export function PipDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="pip:view">
      <Inner id={id} />
    </RequirePermission>
  );
}

type ApproveMode = null | { decision: 'APPROVE' | 'RETURN'; extension: boolean };

function Inner({ id }: { id: string }) {
  const t = useTranslations('pips');
  const fmt = useFormatDate();
  const { user, can } = useAuth();
  const { toast } = useToast();
  const q = usePip(id);
  const ack = usePipAcknowledge(id);
  const approve = usePipApprove(id);
  const cp = useCheckpoint(id);
  const [edit, setEdit] = React.useState(false);
  const [tr, setTr] = React.useState<TransitionKind | null>(null);
  const [ap, setAp] = React.useState<ApproveMode>(null);
  const [note, setNote] = React.useState('');
  const [start, setStart] = React.useState('');
  const p: Pip | undefined = q.data;
  const a = p ? allowedPipActions(p, { meId: user?.id, roles: user?.roles ?? [], can: (k) => can(k) }) : null;

  const runApprove = async () => {
    if (!ap) return;
    try {
      await approve.mutateAsync({ decision: ap.decision, ...(start ? { startDate: start } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      toast({ tone: 'success', title: t(ap.extension ? (ap.decision === 'APPROVE' ? 'approve.extApproved' : 'approve.extDeclined') : ap.decision === 'APPROVE' ? 'approve.started' : 'approve.returned') });
      setAp(null);
      setNote('');
      setStart('');
    } catch {
      /* shown in dialog */
    }
  };
  const ackRequired = approve.error instanceof ApiError && approve.error.code === 'PIP_ACK_REQUIRED';

  return (
    <QueryState query={q} isEmpty={!p} emptyTitle={t('notFound')}>
      {p && a && (
        <>
          <PageHeader
            eyebrow={t('eyebrow')}
            title={t('detailTitle', { name: p.employeeName ?? '—' })}
            description={p.startDate ? `${fmt.date(p.startDate)} – ${fmt.date(p.endDate)}` : t('notStarted')}
            breadcrumbs={[{ label: t('title'), href: '/people/pips' }, { label: p.employeeName ?? '—' }]}
            breadcrumbLabel={t('breadcrumb')}
            actions={
              <>
                {a.editDraft && <Button variant="secondary" onClick={() => setEdit(true)}>{t('draft.edit')}</Button>}
                {a.submit && <Button disabled={!a.submitReady} onClick={() => setTr('PENDING_APPROVAL')}>{t('tr.submit.action')}</Button>}
                {a.acknowledge && <Button loading={ack.isPending} onClick={() => ack.mutate(undefined, { onSuccess: () => toast({ tone: 'success', title: t('ack.done') }) })}>{t('ack.action')}</Button>}
                {a.approveStart && <Button variant="gold" onClick={() => setAp({ decision: 'APPROVE', extension: false })}>{t('approve.start')}</Button>}
                {a.returnToDraft && <Button variant="secondary" onClick={() => setAp({ decision: 'RETURN', extension: false })}>{t('approve.return')}</Button>}
                {a.decideExtension && <Button variant="gold" onClick={() => setAp({ decision: 'APPROVE', extension: true })}>{t('approve.extApprove')}</Button>}
                {a.decideExtension && <Button variant="secondary" onClick={() => setAp({ decision: 'RETURN', extension: true })}>{t('approve.extDecline')}</Button>}
              </>
            }
          />
          <RestrictedBanner />
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ol className="flex flex-wrap gap-2" aria-label={t('stepper')}>
              {PIP_STEPS.map((s, i) => {
                const idx = stepIndex(p.status);
                const current = idx === i;
                return (
                  <li key={s} aria-current={current ? 'step' : undefined}>
                    <Badge tone={current ? toneFor(p.status) : idx > i ? 'green' : 'neutral'} icon={idx > i ? <Check aria-hidden="true" className="size-3.5" /> : undefined}>
                      {i + 1}. {t(`steps.${s}` as never)}
                    </Badge>
                  </li>
                );
              })}
            </ol>
            <Badge tone={toneFor(p.status)}>{t(`status.${p.status}` as never)}</Badge>
          </div>
          {p.status === 'PENDING_APPROVAL' && !p.employeeAcknowledgedAt && <Alert tone="warning" className="mb-4" title={t('ack.pendingTitle')}>{t('ack.pendingBody')}</Alert>}
          {p.status === 'EXTENDED' && <Alert tone="info" className="mb-4" title={t('ext.title')}>{t('ext.body', { date: fmt.date(p.proposedEndDate), reason: p.extensionReason ?? '—' })}</Alert>}
          {a.submit && !a.submitReady && <Alert tone="info" className="mb-4">{t('draft.notReady')}</Alert>}
          <MutationAlert error={ack.error ?? cp.error} />
          <div className="enter-up grid gap-4 lg:grid-cols-2">
            <Panel accent="gold" title={t('sections.summary')}>
              <p className="text-sm whitespace-pre-wrap text-ink">{p.reason}</p>
              {p.evidence && <p className="mt-2 text-sm whitespace-pre-wrap text-muted">{p.evidence}</p>}
              <h3 className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">{t('gaps')}</h3>
              <ul className="divide-y divide-line text-sm">
                {p.kpiGaps.map((g) => (
                  <li key={g.key} className="flex justify-between py-1.5"><span>{g.name}</span><span className="text-muted">{g.actual ?? '—'} / {g.target ?? '—'}</span></li>
                ))}
              </ul>
            </Panel>
            <Panel accent="blue" title={t('sections.plan')}>
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{t('draft.goals')}</h3>
              {p.goals.length === 0 ? <p className="text-sm text-muted">{t('draft.none')}</p> : <ul className="list-disc pl-5 text-sm">{p.goals.map((g, i) => <li key={i}>{g.title}{g.measure ? ` — ${g.measure}` : ''}</li>)}</ul>}
              <h3 className="mt-3 text-xs font-semibold tracking-wide text-muted uppercase">{t('draft.measures')}</h3>
              {p.measures.length === 0 ? <p className="text-sm text-muted">{t('draft.none')}</p> : <ul className="list-disc pl-5 text-sm">{p.measures.map((m, i) => <li key={i}>{m}</li>)}</ul>}
              <p className="mt-3 text-sm text-muted">{t('plan.duration', { n: p.durationDays })} · {t('plan.extensions', { n: p.extensionCount })}</p>
              {p.approvedAt && <p className="text-sm text-muted">{t('plan.approvedBy', { name: p.approvedByName ?? '—', date: fmt.dateTime(p.approvedAt) })}</p>}
              <p className="text-sm text-muted">{p.employeeAcknowledgedAt ? t('ack.at', { date: fmt.dateTime(p.employeeAcknowledgedAt) }) : t('ack.not')}</p>
            </Panel>
          </div>
          <Panel accent="green" className="mt-4" title={t('sections.checkpoints')}>
            {p.checkpoints.length === 0 ? (
              <p className="text-sm text-muted">{t('draft.none')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {p.checkpoints.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span><span className="font-medium text-ink">{c.title}</span><span className="block text-sm text-muted">{fmt.date(c.dueDate)}{c.notes ? ` · ${c.notes}` : ''}</span></span>
                    {a.updateCheckpoints ? (
                      <FormField label={t('cpStatus')} hideLabel className="w-40">
                        <Select value={c.status} disabled={cp.isPending} onChange={(e) => cp.mutate({ cid: c.id, status: e.target.value as 'PENDING' | 'DONE' | 'MISSED' })}>
                          {(['PENDING', 'DONE', 'MISSED'] as const).map((s) => <option key={s} value={s}>{t(`cp.${s}` as never)}</option>)}
                        </Select>
                      </FormField>
                    ) : (
                      <Badge tone={toneFor(c.status)}>{t(`cp.${c.status}` as never)}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {(a.requestExtension || a.completeSuccess || a.completeNotImproved || a.cancel) && (
            <Panel accent="gold" className="mt-4" title={t('sections.actions')}>
              <div className="flex flex-wrap gap-2">
                {a.requestExtension && <Button variant="secondary" onClick={() => setTr('EXTENDED')}>{t('tr.extend.action')}</Button>}
                {a.completeSuccess && <Button variant="secondary" onClick={() => setTr('COMPLETED_SUCCESS')}>{t('tr.success.action')}</Button>}
                {a.completeNotImproved && <Button variant="secondary" onClick={() => setTr('COMPLETED_NOT_IMPROVED')}>{t('tr.notImproved.action')}</Button>}
                {a.cancel && <Button variant="danger" onClick={() => setTr('CANCELLED')}>{t('tr.cancel.action')}</Button>}
              </div>
              {p.status === 'ACTIVE' && p.extensionCount >= 1 && <p className="mt-2 text-xs text-muted">{t('ext.limit')}</p>}
            </Panel>
          )}
          {(p.finalReview || p.cancelReason) && (
            <Panel accent="blue" className="mt-4" title={t('sections.outcome')}>
              {p.finalReview && <p className="text-sm whitespace-pre-wrap">{p.finalReview}</p>}
              {p.recommendedAction && <p className="mt-2 text-sm"><span className="font-medium">{t('f.recommendedAction')}: </span>{p.recommendedAction}</p>}
              {p.cancelReason && <p className="text-sm">{p.cancelReason}</p>}
              {p.status === 'COMPLETED_NOT_IMPROVED' && <Alert tone="info" className="mt-3">{t('outsideNote')}</Alert>}
            </Panel>
          )}
          <Panel accent="green" className="mt-4" title={t('sections.history')}>
            {(p.history?.length ?? 0) === 0 ? <p className="text-sm text-muted">{t('draft.none')}</p> : (
              <Timeline
                label={t('sections.history')}
                items={(p.history ?? []).map((h, i) => ({ id: String(i), title: t(`status.${h.to}` as never), description: [h.actorName, h.note].filter(Boolean).join(' — ') || undefined, time: fmt.dateTime(h.at), dateTime: h.at }))}
              />
            )}
          </Panel>

          <Dialog open={edit} onOpenChange={setEdit}>
            <DialogContent title={t('draft.title')} description={t('draft.description')} size="lg" closeLabel={t('close')}>
              {edit && <DraftEditor pip={p} onDone={() => setEdit(false)} />}
            </DialogContent>
          </Dialog>
          <TransitionDialog pipId={id} kind={tr} onClose={() => setTr(null)} />
          <ConfirmDialog
            open={ap !== null}
            onOpenChange={(o) => { if (!o) { setAp(null); approve.reset(); } }}
            title={ap ? t(`approve.dlg.${ap.extension ? 'ext' : 'start'}${ap.decision}.title` as never) : ''}
            description={ap ? t(`approve.dlg.${ap.extension ? 'ext' : 'start'}${ap.decision}.body` as never) : ''}
            confirmLabel={ap ? t(`approve.dlg.${ap.extension ? 'ext' : 'start'}${ap.decision}.action` as never) : ''}
            pending={approve.isPending}
            error={ackRequired ? null : approve.error}
            onConfirm={() => void runApprove()}
          >
            {ackRequired && (
              <Alert tone="warning" title={t('approve.ackRequiredTitle')}>{t('approve.ackRequiredBody')}</Alert>
            )}
            {ap && ap.decision === 'APPROVE' && !ap.extension && (
              <FormField label={t('approve.startDate')} hint={t('approve.startHint')}><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
            )}
            <FormField label={t('approve.note')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          </ConfirmDialog>
        </>
      )}
    </QueryState>
  );
}
