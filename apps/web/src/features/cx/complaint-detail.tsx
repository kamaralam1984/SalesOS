'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Alert, Button, Dialog, DialogContent, FormField, PageHeader, Panel, Select, Skeleton, Textarea, ErrorState } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useOne, type Complaint, type Person } from './api';
import { ROOT_CAUSES } from './complaints-page';
import { ComplaintStatusBadge, HistoryList, NoteDialog, PriorityBadge, SlaCountdown, useFmt } from './shared';

type Step = 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED' | 'REOPENED' | 'CLOSE_INVALID';

/** Which next steps make sense from each status (state-machine section 7). The server enforces roles and fields. */
const STEPS: Record<string, Step[]> = {
  OPEN: ['ACKNOWLEDGED', 'CLOSE_INVALID'],
  ACKNOWLEDGED: ['IN_PROGRESS'],
  IN_PROGRESS: ['ESCALATED', 'RESOLVED'],
  ESCALATED: ['IN_PROGRESS'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  REOPENED: ['IN_PROGRESS'],
  CLOSED: [],
};

export function ComplaintDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="complaints:view">
      <Inner id={id} />
    </RequirePermission>
  );
}

function Inner({ id }: { id: string }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const query = useOne<Complaint>(ck('complaints', 'detail', id), `/cx/complaints/${id}`);
  const [step, setStep] = React.useState<Step | null>(null);
  const move = useAction<Record<string, unknown>, Complaint>('post', `/cx/complaints/${id}/transition`);

  if (query.isPending) return <div className="space-y-3" aria-busy="true" aria-label={tc('loading')}><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40" /></div>;
  if (query.isError) return <ErrorState description={apiErr(query.error).message} requestId={apiErr(query.error).requestId} onRetry={() => query.refetch()} retryLabel={tc('retry')} />;
  const c = query.data;
  const open = !['RESOLVED', 'CLOSED'].includes(c.status);
  const submit = (extra: Record<string, unknown>, to: string) => move.mutate({ to, ...extra }, { onSuccess: () => setStep(null) });

  return (
    <>
      <PageHeader
        eyebrow={t('complaints.eyebrow')}
        title={c.title}
        breadcrumbs={[{ label: t('complaints.title'), href: '/cx/complaints' }, { label: c.title }]}
        breadcrumbLabel={tc('breadcrumb')}
        actions={
          <Can permission="complaints:update">
            {STEPS[c.status]?.map((s) => (
              <Button key={s} variant={s === 'RESOLVED' || s === 'ACKNOWLEDGED' ? 'primary' : 'secondary'} onClick={() => { move.reset(); setStep(s); }}>{t(`complaints.step.${s}`)}</Button>
            ))}
          </Can>
        }
      />
      <div className="enter-fade mb-5 flex flex-wrap items-center gap-2">
        <PriorityBadge priority={c.priority} />
        <ComplaintStatusBadge status={c.status} />
        {c.isHighValue && <span className="inline-flex items-center gap-1 text-xs font-medium text-gold-700"><AlertTriangle className="size-3.5" aria-hidden="true" />{t('complaints.highValue')}</span>}
        {c.reopenCount > 0 && <span className="text-xs text-muted">{t('complaints.reopened', { n: c.reopenCount })}</span>}
      </div>
      <div className="stagger grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Panel accent="gold" title={t('complaints.details')}>
            <p className="whitespace-pre-wrap text-ink">{c.description}</p>
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label={t('complaints.learner')}>{c.learner ? <Link className="link-underline text-blue-700" href={`/cx/relationships/${c.learner.id}`}>{c.learner.name}</Link> : t('complaints.noLearner')}</Item>
              <Item label={t('complaints.fieldCategory')}>{t(`category.${c.category}` as never)}</Item>
              <Item label={t('complaints.owner')}>{c.ownerName ?? '—'}{c.autoAssigned && <span className="ml-1 text-xs text-muted">({t('complaints.autoAssigned')})</span>}</Item>
              <Item label={t('complaints.loggedBy')}>{c.createdByName ?? '—'} · {fmt.dateTime(c.createdAt)}</Item>
              {c.firstResponseNote && <Item label={t('complaints.firstResponse')}>{c.firstResponseNote}</Item>}
              {c.escalatedAt && <Item label={t('complaints.escalatedTo')}>{c.escalatedToName ?? '—'} · {c.escalationReason}</Item>}
              {c.resolution && <Item label={t('complaints.resolution')}>{c.resolution}</Item>}
              {c.rootCauseCategory && <Item label={t('complaints.rootCause')}>{t(`rootCause.${c.rootCauseCategory}` as never)}</Item>}
              {c.closeReason && <Item label={t('complaints.closeReason')}>{c.closeReason}{c.closedAsInvalid ? ` (${t('complaints.invalid')})` : ''}</Item>}
            </dl>
          </Panel>
          <Panel accent="blue" title={t('common.history')}><HistoryList items={c.history ?? []} /></Panel>
        </div>
        <div className="space-y-4">
          <Panel accent="green" title={t('sla.title')} description={t('sla.description')}>
            <div className="space-y-3">
              {open && !c.acknowledgedAt && <div><SlaCountdown label={t('sla.firstResponse')} dueAt={c.sla.firstResponseDueAt} breachedAt={c.sla.firstResponseBreachedAt} /><p className="text-xs text-muted">{t('sla.due')}: {fmt.dateTime(c.sla.firstResponseDueAt)}</p></div>}
              {c.acknowledgedAt && <p className="text-sm text-ink-700">{t('sla.firstResponseDone', { time: fmt.dateTime(c.acknowledgedAt) })}</p>}
              {open ? <div><SlaCountdown label={t('sla.resolution')} dueAt={c.sla.resolutionDueAt} breachedAt={c.sla.resolutionBreachedAt} /><p className="text-xs text-muted">{t('sla.due')}: {fmt.dateTime(c.sla.resolutionDueAt)}</p></div> : <p className="text-sm text-ink-700">{c.sla.resolvedWithinSla === null ? '—' : c.sla.resolvedWithinSla ? t('sla.met') : t('sla.missed')}</p>}
              {c.sla.breachLevel > 0 && <Alert tone="warning">{t('sla.breachLevel', { level: c.sla.breachLevel })}</Alert>}
              <p className="text-xs text-muted">{t('sla.businessHours')}</p>
            </div>
          </Panel>
        </div>
      </div>
      {step === 'ACKNOWLEDGED' && <NoteDialog open onOpenChange={(o) => !o && setStep(null)} title={t('complaints.step.ACKNOWLEDGED')} description={t('complaints.ackHint')} label={t('complaints.firstResponse')} submitLabel={t('complaints.step.ACKNOWLEDGED')} pending={move.isPending} error={move.error} onSubmit={(note) => submit({ note }, 'ACKNOWLEDGED')} />}
      {step === 'IN_PROGRESS' && <NoteDialog open onOpenChange={(o) => !o && setStep(null)} title={t('complaints.step.IN_PROGRESS')} description={t('complaints.planHint')} label={t('complaints.planNote')} submitLabel={t('complaints.step.IN_PROGRESS')} pending={move.isPending} error={move.error} onSubmit={(note) => submit({ note }, 'IN_PROGRESS')} />}
      {step === 'REOPENED' && <NoteDialog open onOpenChange={(o) => !o && setStep(null)} title={t('complaints.step.REOPENED')} description={t('complaints.reopenHint')} label={t('complaints.reason')} submitLabel={t('complaints.step.REOPENED')} pending={move.isPending} error={move.error} onSubmit={(reason) => submit({ reason }, 'REOPENED')} />}
      {step === 'CLOSE_INVALID' && <NoteDialog open onOpenChange={(o) => !o && setStep(null)} title={t('complaints.step.CLOSE_INVALID')} description={t('complaints.invalidHint')} label={t('complaints.reason')} submitLabel={t('complaints.step.CLOSE_INVALID')} pending={move.isPending} error={move.error} onSubmit={(reason) => submit({ reason, invalid: true }, 'CLOSED')} />}
      {step === 'CLOSED' && (
        <Dialog open onOpenChange={(o) => !o && setStep(null)}>
          <DialogContent title={t('complaints.step.CLOSED')} description={t('complaints.closeHint')} closeLabel={tc('close')}
            footer={<><Button variant="secondary" onClick={() => setStep(null)}>{tc('cancel')}</Button><Button loading={move.isPending} onClick={() => submit({}, 'CLOSED')}>{t('complaints.step.CLOSED')}</Button></>}>
            {move.isError && <Alert tone="danger">{apiErr(move.error).message}</Alert>}
          </DialogContent>
        </Dialog>
      )}
      {step === 'ESCALATED' && <EscalateDialog pending={move.isPending} error={move.error} onClose={() => setStep(null)} onSubmit={(reason, escalatedToId) => submit({ reason, escalatedToId }, 'ESCALATED')} />}
      {step === 'RESOLVED' && <ResolveDialog pending={move.isPending} error={move.error} onClose={() => setStep(null)} onSubmit={(resolution, rootCauseCategory) => submit({ resolution, rootCauseCategory }, 'RESOLVED')} />}
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt><dd className="mt-0.5 text-ink">{children}</dd></div>;
}

function EscalateDialog({ onClose, onSubmit, pending, error }: { onClose: () => void; onSubmit: (reason: string, to: string) => void; pending?: boolean; error?: unknown }) {
  const t = useTranslations('cx');
  const targets = useOne<Person[]>(ck('assignable', 'escalation-target'), '/cx/assignable-users', { purpose: 'escalation-target' });
  const [to, setTo] = React.useState('');
  return (
    <NoteDialog open onOpenChange={(o) => !o && onClose()} title={t('complaints.step.ESCALATED')} description={t('complaints.escalateHint')} label={t('complaints.reason')} submitLabel={t('complaints.step.ESCALATED')} pending={pending} error={error}
      onSubmit={(reason) => to && onSubmit(reason, to)}>
      <FormField label={t('complaints.escalateTo')} required>
        <Select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">{t('complaints.chooseTarget')}</option>
          {targets.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </FormField>
    </NoteDialog>
  );
}

function ResolveDialog({ onClose, onSubmit, pending, error }: { onClose: () => void; onSubmit: (resolution: string, rootCause: string) => void; pending?: boolean; error?: unknown }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const [resolution, setResolution] = React.useState('');
  const [root, setRoot] = React.useState('');
  const invalid = resolution.trim().length < 3 || !root;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('complaints.step.RESOLVED')} description={t('complaints.resolveHint')} closeLabel={tc('close')}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!invalid) onSubmit(resolution.trim(), root); }}>
          {error ? <Alert tone="danger">{apiErr(error).message}</Alert> : null}
          <FormField label={t('complaints.resolution')} required><Textarea rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={5000} /></FormField>
          <FormField label={t('complaints.rootCause')} required hint={t('complaints.rootCauseHint')}>
            <Select value={root} onChange={(e) => setRoot(e.target.value)}>
              <option value="">{t('complaints.chooseRootCause')}</option>
              {ROOT_CAUSES.map((r) => <option key={r} value={r}>{t(`rootCause.${r}`)}</option>)}
            </Select>
          </FormField>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>{tc('cancel')}</Button>
            <Button type="submit" loading={pending} disabled={invalid}>{t('complaints.step.RESOLVED')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
