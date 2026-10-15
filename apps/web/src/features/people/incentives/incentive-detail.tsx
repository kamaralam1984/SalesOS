'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Alert, Button, ErrorState, FormField, Input, PageHeader, Panel, Select, Skeleton, Textarea, Timeline } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ConfirmDialog, numStr, useDone, useFmt } from '../hrkit/kit';
import { allowedIncentiveActions, INCENTIVE_STEPS, stepIndex, type IncentiveAction } from './actions';
import { useIncentive, useIncentiveTransition, useMarkPaid, type IncentiveFull, type IncentiveInputs, type IncentiveStatusOnly } from './api';
import { IncentiveStatusBadge } from './incentives-page';

export function IncentiveDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="incentives:recommendation:view">
      <Inner id={id} />
    </RequirePermission>
  );
}

function Inner({ id }: { id: string }) {
  const t = useTranslations('incentives');
  const apiErr = useApiErrorMessage();
  const q = useIncentive(id);
  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} />;
  const r = q.data;
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={r.employeeName ?? t('detail.title')}
        description={<IncentiveStatusBadge status={r.status} />}
        breadcrumbs={[{ label: t('title'), href: '/people/incentives' }, { label: r.employeeName ?? '…' }]}
        breadcrumbLabel={t('breadcrumb')}
      />
      <Alert tone="info" className="enter-fade mb-5" live={false}>{t('recommendationOnly')}</Alert>
      <Stepper status={r.status} />
      {r.statusOnly ? <StatusOnlyView r={r} /> : <FullView r={r} />}
    </>
  );
}

export function Stepper({ status }: { status: IncentiveFull['status'] }) {
  const t = useTranslations('incentives');
  const idx = stepIndex(status);
  const branch = ['REJECTED', 'ON_HOLD', 'CLAWBACK_PROPOSED', 'ADJUSTED', 'WAIVED'].includes(status);
  return (
    <div className="mb-6">
      <ol aria-label={t('detail.progress')} className="flex flex-wrap gap-2">
        {INCENTIVE_STEPS.map((s, i) => (
          <li key={s} aria-current={i === idx && !branch ? 'step' : undefined} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${i < idx || (i === idx && status === 'PAID') ? 'border-green-600/30 bg-green-50 text-green-700' : i === idx ? 'border-gold-300 bg-gold-50 text-gold-700 glow-gold' : 'border-line text-muted'}`}>
            {(i < idx || status === 'PAID') && <Check aria-hidden className="size-3.5" />}
            {t(`status.${s}` as never)}
          </li>
        ))}
      </ol>
      {branch && <p className="mt-2 text-sm text-ink-600">{t('detail.branchNote', { status: t(`status.${status}` as never) })}</p>}
    </div>
  );
}

function StatusOnlyView({ r }: { r: IncentiveStatusOnly }) {
  const t = useTranslations('incentives');
  const fmt = useFmt();
  return (
    <Panel accent="gold" title={t('detail.statusOnlyTitle')} description={t('detail.statusOnlyBody')}>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="inline text-muted">{t('col.period')}: </dt><dd className="inline">{fmt.date(r.periodStart)} – {fmt.date(r.periodEnd)}</dd></div>
        <div><dt className="inline text-muted">{t('col.status')}: </dt><dd className="inline"><IncentiveStatusBadge status={r.status} /></dd></div>
        {r.paidAt && <div><dt className="inline text-muted">{t('detail.paidAt')}: </dt><dd className="inline">{fmt.dateTime(r.paidAt)}</dd></div>}
      </dl>
    </Panel>
  );
}

function FullView({ r }: { r: IncentiveFull }) {
  const t = useTranslations('incentives');
  const fmt = useFmt();
  const { user, can } = useAuth();
  const actions = allowedIncentiveActions(
    r.status,
    { create: can('incentives:recommendation:create'), approve: can('incentives:recommendation:approve'), markPaid: can('incentives:recommendation:mark-paid') },
    { isRecommender: r.recommendedById === user?.id, isEmployee: r.employeeId === user?.id, hasOpenProposal: r.adjustments.some((a) => a.status === 'PROPOSED') },
  );
  const b = r.breakdown;
  return (
    <div className="enter-up grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Panel accent="blue" title={t('detail.amounts')} actions={<ActionBar r={r} actions={actions} />}>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Amount label={t('detail.computed')} value={fmt.money(r.computedAmount, r.currency)} />
            <Amount label={t('detail.approved')} value={fmt.money(r.approvedAmount, r.currency)} />
            <Amount label={t('col.period')} value={`${fmt.date(r.periodStart)} – ${fmt.date(r.periodEnd)}`} />
          </dl>
          {r.overrideReason && <p className="mt-3 text-sm"><span className="text-muted">{t('detail.overrideReason')}: </span>{r.overrideReason}</p>}
          {r.rejectionReason && <Alert tone="danger" className="mt-3" live={false}>{r.rejectionReason}</Alert>}
          {r.holdReason && r.status === 'ON_HOLD' && <Alert tone="warning" className="mt-3" live={false}>{r.holdReason}</Alert>}
          {r.paymentReference && <p className="mt-3 text-sm"><span className="text-muted">{t('detail.paymentReference')}: </span>{r.paymentReference}</p>}
        </Panel>

        <Panel accent="green" title={t('detail.breakdown')} description={t('detail.breakdownHint', { version: r.snapshotVersion })}>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Row k={t('detail.basis')} v={fmt.money(b.basisAmount, b.currency)} />
            <Row k={t('detail.netBasis')} v={fmt.money(b.netBasisAmount, b.currency)} />
            <Row k={t('detail.achievement')} v={b.achievementPct === null ? '—' : `${b.achievementPct}%`} />
            <Row k={t('detail.slab')} v={b.slab ? `${b.slab.minPct}% – ${b.slab.maxPct === null ? t('policy.open') : `${b.slab.maxPct}%`}` : t('detail.noSlab')} />
            <Row k={t('detail.raw')} v={fmt.money(b.rawAmount, b.currency)} />
            <Row k={t('detail.cap')} v={b.capApplied ? t('detail.capApplied') : t('detail.capNotApplied')} />
          </dl>
          {b.reasons.length > 0 && <p className="mt-3 text-sm text-ink-600">{t('detail.reasons')}: {b.reasons.map((x) => reasonText(t, x)).join(' · ')}</p>}
          {b.gateResults.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm" aria-label={t('detail.gates')}>
              {b.gateResults.map((g, i) => (
                <li key={i}>{g.passed ? '✓' : '✗'} {g.label ?? g.metric} {g.op} {g.value} <span className="text-muted">({t('detail.actual')}: {g.actual ?? '—'})</span></li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel accent="gold" title={t('detail.inputs')} description={t('detail.inputsHint', { source: r.inputSource })}>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Row k={t('create.target')} v={fmt.money(r.inputs.target, r.currency)} />
            <Row k={t('create.revenue')} v={fmt.money(r.inputs.revenue, r.currency)} />
            <Row k={t('create.collections')} v={fmt.money(r.inputs.collections, r.currency)} />
            <Row k={t('create.refunds')} v={fmt.money(r.inputs.refunds, r.currency)} />
            {Object.entries(r.inputs.metrics ?? {}).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
          </dl>
        </Panel>

        {r.adjustments.length > 0 && (
          <Panel accent="blue" title={t('detail.adjustments')}>
            <ul className="space-y-2 text-sm">
              {r.adjustments.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-line p-2">
                  <span>{t('clawbacks.proposed')}: {fmt.money(a.proposedAmount, r.currency)}</span>
                  <span>{t(`adjustment.${a.status}` as never)}{a.decidedAmount ? ` · ${fmt.money(a.decidedAmount, r.currency)}` : ''}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      <Panel accent="green" title={t('detail.history')}>
        {r.history && r.history.length > 0 ? (
          <Timeline label={t('detail.history')} items={r.history.map((h, i) => ({ id: String(i), title: t(`status.${h.to}` as never), description: [h.actorName, h.note].filter(Boolean).join(' · ') || undefined, time: fmt.dateTime(h.at), dateTime: h.at }))} />
        ) : <p className="text-sm text-muted">{t('detail.noHistory')}</p>}
        <p className="mt-4 text-xs text-muted">{t('detail.auditNote')}</p>
        <Link href="/people/incentives" className="link-underline mt-3 inline-block text-sm text-blue-700">{t('detail.back')}</Link>
      </Panel>
    </div>
  );
}

const Amount = ({ label, value }: { label: string; value: string }) => (
  <div className="hover-lift rounded-md bg-ivory-100 p-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-0.5 font-display text-lg font-semibold text-ink">{value}</dd></div>
);
const Row = ({ k, v }: { k: string; v: string }) => (
  <div><dt className="inline text-muted">{k}: </dt><dd className="inline text-ink">{v}</dd></div>
);

function ActionBar({ r, actions }: { r: IncentiveFull; actions: IncentiveAction[] }) {
  const t = useTranslations('incentives');
  const [open, setOpen] = React.useState<IncentiveAction | null>(null);
  if (actions.length === 0) return <span className="text-sm text-muted">{t('actions.none')}</span>;
  return (
    <>
      {actions.map((a) => (
        <Button key={a} size="sm" variant={a === 'reject' ? 'danger' : a === 'approve' || a === 'submit' || a === 'markPaid' ? 'primary' : 'secondary'} onClick={() => setOpen(a)}>
          {t(`actions.${a}` as never)}
        </Button>
      ))}
      {open && <ActionDialog r={r} action={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ActionDialog({ r, action, onClose }: { r: IncentiveFull; action: IncentiveAction; onClose: () => void }) {
  const t = useTranslations('incentives');
  const done = useDone();
  const transition = useIncentiveTransition(r.id);
  const paid = useMarkPaid(r.id);
  const [text, setText] = React.useState('');
  const [amount, setAmount] = React.useState(r.computedAmount);
  const [override, setOverride] = React.useState('');
  const [adj, setAdj] = React.useState(r.adjustments.find((a) => a.status === 'PROPOSED')?.id ?? '');
  const [inp, setInp] = React.useState<Record<keyof Omit<IncentiveInputs, 'metrics'>, string>>({ target: String(r.inputs.target), revenue: String(r.inputs.revenue), collections: String(r.inputs.collections), refunds: String(r.inputs.refunds) });
  const isOver = numStr(amount) !== undefined && Number(amount) > Number(r.computedAmount);
  const needsText = ['reject', 'hold', 'markPaid', 'recalculate', 'waive'].includes(action);
  const textOk = !needsText || text.trim().length >= (action === 'markPaid' ? 2 : 5);
  const valid = textOk && (action !== 'approve' || (numStr(amount) !== undefined && (!isOver || override.trim().length > 0))) && (action !== 'adjust' || (numStr(amount) !== undefined && adj !== '')) && (action !== 'waive' || adj !== '');
  const pending = transition.isPending || paid.isPending;
  const error = transition.error ?? paid.error;
  const ok = () => { done(t('actions.done')); onClose(); };
  const run = () => {
    switch (action) {
      case 'submit': return transition.mutate({ to: 'SUBMITTED', ...(text.trim() ? { comments: text.trim() } : {}) }, { onSuccess: ok });
      case 'recalculate': return transition.mutate({ to: 'CALCULATED', reason: text.trim(), inputs: { target: Number(inp.target), revenue: Number(inp.revenue || 0), collections: Number(inp.collections || 0), refunds: Number(inp.refunds || 0), metrics: r.inputs.metrics ?? {} } }, { onSuccess: ok });
      case 'approve': return transition.mutate({ to: 'APPROVED', approvedAmount: Number(amount), ...(override.trim() ? { overrideReason: override.trim() } : {}) }, { onSuccess: ok });
      case 'reject': return transition.mutate({ to: 'REJECTED', reason: text.trim() }, { onSuccess: ok });
      case 'hold': return transition.mutate({ to: 'ON_HOLD', reason: text.trim() }, { onSuccess: ok });
      case 'release': return transition.mutate({ to: 'RELEASED' }, { onSuccess: ok });
      case 'markPaid': return paid.mutate({ reference: text.trim() }, { onSuccess: ok });
      case 'adjust': return transition.mutate({ to: 'ADJUSTED', adjustmentId: adj, decidedAmount: Number(amount), ...(text.trim() ? { reason: text.trim() } : {}) }, { onSuccess: ok });
      case 'waive': return transition.mutate({ to: 'WAIVED', adjustmentId: adj, reason: text.trim() }, { onSuccess: ok });
    }
  };
  const proposals = r.adjustments.filter((a) => a.status === 'PROPOSED');
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`confirm.${action}.title` as never)}
      description={t(`confirm.${action}.body` as never)}
      confirmLabel={t(`actions.${action}` as never)}
      danger={action === 'reject' || action === 'waive'}
      pending={pending}
      error={error}
      disabled={!valid}
      onConfirm={run}
    >
      <p className="mb-3 text-xs text-muted">{t('confirm.auditNote')}</p>
      <div className="grid gap-3">
        {action === 'recalculate' && (['target', 'revenue', 'collections', 'refunds'] as const).map((k) => (
          <FormField key={k} label={t(`create.${k}` as never)}><Input inputMode="decimal" value={inp[k]} onChange={(e) => setInp({ ...inp, [k]: e.target.value })} /></FormField>
        ))}
        {(action === 'approve' || action === 'adjust') && (
          <FormField label={action === 'approve' ? t('confirm.approvedAmount') : t('confirm.decidedAmount')} required><Input inputMode="decimal" value={action === 'adjust' && amount === r.computedAmount ? '' : amount} onChange={(e) => setAmount(e.target.value)} /></FormField>
        )}
        {action === 'approve' && isOver && (
          <FormField label={t('confirm.overrideReason')} hint={t('confirm.overrideHint')} required><Textarea rows={2} value={override} onChange={(e) => setOverride(e.target.value)} /></FormField>
        )}
        {(action === 'adjust' || action === 'waive') && (
          <FormField label={t('confirm.proposal')} required>
            <Select value={adj} onChange={(e) => setAdj(e.target.value)}>
              <option value="">—</option>
              {proposals.map((p) => <option key={p.id} value={p.id}>{p.proposedAmount} {r.currency}</option>)}
            </Select>
          </FormField>
        )}
        {action !== 'release' && action !== 'approve' && (
          <FormField label={action === 'markPaid' ? t('confirm.reference') : action === 'submit' || action === 'adjust' ? t('confirm.commentsOptional') : t('confirm.reason')} required={needsText}>
            {action === 'markPaid' ? <Input value={text} onChange={(e) => setText(e.target.value)} /> : <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
          </FormField>
        )}
      </div>
    </ConfirmDialog>
  );
}

type T = ReturnType<typeof useTranslations>;
function reasonText(t: T, code: string): string {
  const [key, detail] = code.split(':');
  const k = `reason.${key}`;
  return t.has(k as never) ? (t as unknown as (k: string, v?: Record<string, string>) => string)(k, { detail: detail ?? '' }) : code;
}
