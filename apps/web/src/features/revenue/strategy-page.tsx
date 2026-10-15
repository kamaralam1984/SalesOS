'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, Panel, Select, Textarea } from '@salesos/ui';
import { PageHeader } from '@/features/crm/motion';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useAddInitiative, useCreatePlan, useStrategyPlans, useUpdateInitiative, useUpdatePlan, type StrategyInitiative, type StrategyPlan } from '@/lib/api/hooks/revenue';
import { useRevFormat } from './common';

const PLAN_STATUS: StrategyPlan['status'][] = ['DRAFT', 'ACTIVE', 'CLOSED'];
const INIT_STATUS: StrategyInitiative['status'][] = ['PLANNED', 'IN_PROGRESS', 'DONE', 'DROPPED'];
const planTone = (s: StrategyPlan['status']) => (s === 'ACTIVE' ? 'green' : s === 'CLOSED' ? 'neutral' : 'gold');

/** Strategy plans and their initiatives (JD-STRAT-001). Visible to managers and above; edited with targets:update. */
export function StrategyPage() {
  const t = useTranslations('revenue.strategy');
  const tn = useTranslations('nav');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useStrategyPlans();
  const [dlg, setDlg] = React.useState(false);
  return (
    <RequirePermission permission="targets:view" minScope="team">
      <PageHeader
        eyebrow={tn('revenue')}
        title={t('title')}
        description={t('description')}
        actions={<Can permission="targets:update"><Button variant="gold" className="glow-gold" leadingIcon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setDlg(true)}>{t('newPlan')}</Button></Can>}
      />
      {q.isPending && <p role="status" className="shimmer text-sm text-muted">{tc('loading')}</p>}
      {q.isError && (
        <Alert tone="danger" title={t('loadFailed')}>
          {apiErr(q.error).message} <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{tc('retry')}</Button>
        </Alert>
      )}
      {q.data && q.data.length === 0 && <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />}
      <div className="space-y-5 stagger">
        {(q.data ?? []).map((p) => (<PlanCard key={p.id} plan={p} />))}
      </div>
      <PlanDialog open={dlg} onOpenChange={setDlg} />
    </RequirePermission>
  );
}

function PlanCard({ plan }: { plan: StrategyPlan }) {
  const t = useTranslations('revenue.strategy');
  const f = useRevFormat();
  const upd = useUpdatePlan();
  const apiErr = useApiErrorMessage();
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  return (
    <Panel
      title={plan.title}
      description={t('byOwner', { name: plan.ownerName ?? '—', when: f.date(plan.createdAt) })}
      actions={<Badge tone={planTone(plan.status)}>{t(`plan${plan.status}` as 'planDRAFT')}</Badge>}
    >
      <p className="text-sm whitespace-pre-line text-ink-700">{plan.summary}</p>
      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
      <Can permission="targets:update">
        <div className="mt-3 max-w-xs">
          <FormField label={t('planStatus')}>
            <Select
              value={plan.status}
              onChange={(e) => {
                setError(null);
                upd.mutate({ id: plan.id, status: e.target.value as StrategyPlan['status'] }, { onError: (er) => setError(apiErr(er).message) });
              }}
            >
              {PLAN_STATUS.map((s) => (<option key={s} value={s}>{t(`plan${s}` as 'planDRAFT')}</option>))}
            </Select>
          </FormField>
        </div>
      </Can>
      <h3 className="mt-5 text-sm font-semibold text-ink">{t('initiatives')}</h3>
      {plan.initiatives.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t('noInitiatives')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line" aria-label={t('initiatives')}>
          {plan.initiatives.map((i) => (<InitiativeRow key={i.id} i={i} />))}
        </ul>
      )}
      <Can permission="targets:update">
        <Button className="mt-3" size="sm" variant="secondary" leadingIcon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('addInitiative')}</Button>
        <InitiativeDialog open={adding} onOpenChange={setAdding} planId={plan.id} />
      </Can>
    </Panel>
  );
}

function InitiativeRow({ i }: { i: StrategyInitiative }) {
  const t = useTranslations('revenue.strategy');
  const f = useRevFormat();
  const upd = useUpdateInitiative();
  const apiErr = useApiErrorMessage();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm transition-colors hover:bg-ivory-100">
      <div className="min-w-0">
        <p className="font-medium text-ink">{i.title}</p>
        <p className="text-xs text-muted">{i.ownerName ?? '—'}{i.dueOn ? ` · ${t('due', { date: f.date(i.dueOn) })}` : ''}</p>
        {i.notes && <p className="mt-1 text-ink-700">{i.notes}</p>}
        {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
      <Can permission="targets:update" fallback={<Badge tone="neutral">{t(`init${i.status}` as 'initPLANNED')}</Badge>}>
        <Select
          aria-label={t('initiativeStatus', { title: i.title })}
          className="w-40"
          value={i.status}
          onChange={(e) => {
            setError(null);
            upd.mutate({ id: i.id, status: e.target.value as StrategyInitiative['status'] }, { onError: (er) => setError(apiErr(er).message) });
          }}
        >
          {INIT_STATUS.map((s) => (<option key={s} value={s}>{t(`init${s}` as 'initPLANNED')}</option>))}
        </Select>
      </Can>
    </li>
  );
}

function PlanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('revenue.strategy');
  const tc = useTranslations('common');
  const create = useCreatePlan();
  const apiErr = useApiErrorMessage();
  const [title, setTitle] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [status, setStatus] = React.useState<StrategyPlan['status']>('DRAFT');
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);
  const ok = title.trim().length >= 3 && summary.trim().length >= 3;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!ok) return;
    setError(null);
    try {
      await create.mutateAsync({ title: title.trim(), summary: summary.trim(), status });
      setTitle(''); setSummary(''); setTouched(false);
      onOpenChange(false);
    } catch (er) {
      setError(apiErr(er).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('newPlan')}
        description={t('newPlanHint')}
        closeLabel={tc('close')}
        footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button><Button type="submit" form="plan-form" loading={create.isPending} loadingLabel={tc('saving')}>{t('create')}</Button></>}
      >
        <form id="plan-form" noValidate onSubmit={(e) => void submit(e)} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label={t('planTitle')} required error={touched && title.trim().length < 3 ? t('tooShort') : undefined}><Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></FormField>
          <FormField label={t('planSummary')} required error={touched && summary.trim().length < 3 ? t('tooShort') : undefined}><Textarea rows={4} value={summary} maxLength={4000} onChange={(e) => setSummary(e.target.value)} /></FormField>
          <FormField label={t('planStatus')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as StrategyPlan['status'])}>{PLAN_STATUS.map((s) => (<option key={s} value={s}>{t(`plan${s}` as 'planDRAFT')}</option>))}</Select>
          </FormField>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InitiativeDialog({ open, onOpenChange, planId }: { open: boolean; onOpenChange: (o: boolean) => void; planId: string }) {
  const t = useTranslations('revenue.strategy');
  const tc = useTranslations('common');
  const add = useAddInitiative();
  const apiErr = useApiErrorMessage();
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [dueOn, setDueOn] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (title.trim().length < 3) return;
    setError(null);
    try {
      await add.mutateAsync({ planId, title: title.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}), ...(dueOn ? { dueOn } : {}) });
      setTitle(''); setNotes(''); setDueOn(''); setTouched(false);
      onOpenChange(false);
    } catch (er) {
      setError(apiErr(er).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('addInitiative')}
        closeLabel={tc('close')}
        footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button><Button type="submit" form={`init-form-${planId}`} loading={add.isPending} loadingLabel={tc('saving')}>{t('add')}</Button></>}
      >
        <form id={`init-form-${planId}`} noValidate onSubmit={(e) => void submit(e)} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label={t('initTitle')} required error={touched && title.trim().length < 3 ? t('tooShort') : undefined}><Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></FormField>
          <FormField label={t('initNotes')}><Textarea rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></FormField>
          <FormField label={t('initDue')}><Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></FormField>
        </form>
      </DialogContent>
    </Dialog>
  );
}
