'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Alert, Badge, Button, DataTable, Dialog, DialogContent, FormField, Input, Panel, Pagination, Select, Sheet, SheetContent, StatusBadge, Textarea, Timeline, type Column } from '@salesos/ui';
import { PageHeader } from '@/features/crm/motion';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useCreateProposal, usePrices, usePrograms, useProposal, useProposalAction, useProposals, type Proposal, type ProgramPrice } from '@/lib/api/hooks/revenue';
import { DataState, Money, usePagerLabels, useRevFormat } from './common';
import { MoneyInput, ReasonDialog, useSubmit } from './forms';
import { isMoneyInput, normalizeMoney } from './lib';

const TONE: Record<Proposal['status'], 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'pending'> = { DRAFT: 'neutral', SUBMITTED: 'pending', APPROVED: 'success', REJECTED: 'danger', WITHDRAWN: 'neutral' };

export function PricingPage() {
  const t = useTranslations('revenue.pricing');
  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  return (
    <RequirePermission permission="proposals:view">
      <PageHeader
        eyebrow={useTranslations('nav')('revenue')}
        title={t('title')}
        description={t('description')}
        actions={<Can permission="proposals:create"><Button variant="gold" className="glow-gold" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />{t('new')}</Button></Can>}
      />
      <div className="space-y-6 stagger">
        <Prices />
        <ProposalList onOpen={setOpenId} />
      </div>
      <ProposalDialog open={creating} onOpenChange={setCreating} />
      <Sheet open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>{openId && <ProposalSheet id={openId} />}</Sheet>
    </RequirePermission>
  );
}

function Prices() {
  const t = useTranslations('revenue.pricing');
  const tc = useTranslations('common');
  const q = usePrices();
  const f = useRevFormat();
  const columns: Column<ProgramPrice>[] = [
    { id: 'program', header: t('colProgram'), primary: true, cell: (p) => p.programName },
    { id: 'price', header: t('colPrice'), align: 'right', cell: (p) => <Money value={p.amount} strong /> },
    { id: 'tax', header: t('colTax'), hideOnMobile: true, cell: (p) => (p.taxInclusive ? t('taxIncl') : t('taxExcl')) },
    { id: 'from', header: t('colEffective'), hideOnMobile: true, cell: (p) => f.dateTime(p.effectiveFrom) },
  ];
  return (
    <Panel accent="gold" title={t('current')} description={t('currentHint')}>
      <DataTable caption={t('current')} loadingLabel={tc('loading')} columns={columns} rows={q.data} getRowId={(p) => p.id} loading={q.isPending} error={q.isError ? { message: t('loadError'), onRetry: () => void q.refetch() } : null} emptyTitle={t('noPrices')} emptyDescription={t('noPricesHint')} />
    </Panel>
  );
}

function ProposalList({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useTranslations('revenue.pricing');
  const tc = useTranslations('common');
  const f = useRevFormat();
  const pager = usePagerLabels();
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useProposals({ page, limit: 15, ...(status ? { status } : {}) });
  const columns: Column<Proposal>[] = [
    { id: 'title', header: t('colTitle'), primary: true, cell: (p) => p.title },
    { id: 'type', header: t('colType'), hideOnMobile: true, cell: (p) => t(`type${p.type}` as 'typeOFFER') },
    { id: 'status', header: t('colStatus'), cell: (p) => <StatusBadge status={TONE[p.status]}>{t(`status${p.status}` as 'statusDRAFT')}</StatusBadge> },
    { id: 'proposed', header: t('colProposed'), align: 'right', cell: (p) => (p.proposedAmount ? <Money value={p.proposedAmount} /> : '—') },
    { id: 'by', header: t('colBy'), hideOnMobile: true, cell: (p) => p.createdByName },
    { id: 'when', header: t('colWhen'), hideOnMobile: true, cell: (p) => f.dateTime(p.createdAt) },
  ];
  return (
    <Panel title={t('proposals')} description={t('proposalsHint')}>
      <div className="mb-4 max-w-xs">
        <FormField label={t('filterStatus')}>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('all')}</option>
            {(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const).map((s) => (<option key={s} value={s}>{t(`status${s}` as 'statusDRAFT')}</option>))}
          </Select>
        </FormField>
      </div>
      <DataTable caption={t('proposals')} loadingLabel={tc('loading')} columns={columns} rows={q.data?.items} getRowId={(p) => p.id} loading={q.isPending} error={q.isError ? { message: t('loadError'), onRetry: () => void q.refetch() } : null} emptyTitle={t('noProposals')} emptyDescription={t('noProposalsHint')} onRowClick={(p) => onOpen(p.id)} />
      <Pagination page={page} hasNext={Boolean(q.data?.pagination?.hasMore)} onPageChange={setPage} labels={pager} className="mt-4" />
    </Panel>
  );
}

function ProposalSheet({ id }: { id: string }) {
  const t = useTranslations('revenue.pricing');
  const tc = useTranslations('common');
  const q = useProposal(id);
  return (
    <SheetContent title={t('detail')} description={t('detailHint')} closeLabel={tc('close')}>
      <DataState q={q} empty={{ title: t('missing') }}>{(p) => <ProposalDetail p={p} />}</DataState>
    </SheetContent>
  );
}

function ProposalDetail({ p }: { p: Proposal }) {
  const t = useTranslations('revenue.pricing');
  const f = useRevFormat();
  const act = useProposalAction();
  const canDecide = usePermission('proposals:approve');
  const canAuthor = usePermission('proposals:create');
  const [dlg, setDlg] = React.useState<null | 'approve' | 'reject' | 'withdraw'>(null);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={TONE[p.status]}>{t(`status${p.status}` as 'statusDRAFT')}</StatusBadge><Badge>{t(`type${p.type}` as 'typeOFFER')}</Badge></div>
      <h3 className="font-display text-xl font-semibold text-ink">{p.title}</h3>
      <p className="text-sm text-ink-700">{p.rationale}</p>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        {p.programName && (<><dt className="text-muted">{t('colProgram')}</dt><dd>{p.programName}</dd></>)}
        <dt className="text-muted">{t('currentPrice')}</dt><dd><Money value={p.currentAmount} /></dd>
        <dt className="text-muted">{t('proposedPrice')}</dt><dd><Money value={p.proposedAmount} strong /></dd>
        {p.effectiveFrom && (<><dt className="text-muted">{t('colEffective')}</dt><dd>{f.dateTime(p.effectiveFrom)}</dd></>)}
      </dl>
      <Alert tone="info">{t('noRetro')}</Alert>
      <div className="flex flex-wrap gap-2">
        {p.status === 'DRAFT' && canAuthor && <Button loading={act.isPending} onClick={() => act.mutate({ id: p.id, action: 'submit' })}>{t('submit')}</Button>}
        {(p.status === 'DRAFT' || p.status === 'SUBMITTED') && canAuthor && <Button variant="secondary" onClick={() => setDlg('withdraw')}>{t('withdraw')}</Button>}
        {p.status === 'SUBMITTED' && canDecide && (<><Button onClick={() => setDlg('approve')}>{t('approve')}</Button><Button variant="danger" onClick={() => setDlg('reject')}>{t('reject')}</Button></>)}
      </div>
      {p.feedback && p.feedback.length > 0 && (
        <section><h4 className="mb-2 font-medium text-ink">{t('linkedFeedback')}</h4><ul className="list-disc pl-5 text-sm">{p.feedback.map((x) => (<li key={x.id}>{x.title}</li>))}</ul></section>
      )}
      <section aria-label={t('history')}>
        <h4 className="mb-3 font-medium text-ink">{t('history')}</h4>
        <Timeline label={t('history')} items={(p.history ?? []).map((h) => ({ id: h.id, title: t(`status${h.toStatus}` as 'statusDRAFT'), time: f.dateTime(h.at), description: [h.actorName, h.actorRole?.replace(/_/g, ' ').toLowerCase(), h.note].filter(Boolean).join(' · ') }))} />
      </section>
      <ReasonDialog open={dlg !== null} onOpenChange={(o) => !o && setDlg(null)} title={dlg === 'approve' ? t('approveTitle') : dlg === 'reject' ? t('rejectTitle') : t('withdrawTitle')} description={dlg === 'approve' ? t('approveHint') : undefined} label={t('note')} minLength={dlg === 'withdraw' ? 0 : 3} danger={dlg === 'reject'} submitLabel={dlg === 'approve' ? t('approve') : dlg === 'reject' ? t('reject') : t('withdraw')} successTitle={t('done')} onSubmit={(note) => act.mutateAsync(dlg === 'withdraw' ? { id: p.id, action: 'withdraw', body: { note } } : { id: p.id, action: 'decision', body: { decision: dlg === 'approve' ? 'approve' : 'reject', note } })} />
    </div>
  );
}

function ProposalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (<Dialog open={open} onOpenChange={onOpenChange}>{open && <ProposalBody onOpenChange={onOpenChange} />}</Dialog>);
}

function ProposalBody({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('revenue.pricing');
  const tc = useTranslations('common');
  const programs = usePrograms();
  const create = useCreateProposal();
  const [type, setType] = React.useState('PRICE_CHANGE');
  const [programId, setProgramId] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [rationale, setRationale] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [submit, setSubmit] = React.useState(true);
  const [touched, setTouched] = React.useState(false);
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(done, t('created'));
  const needsPrice = type === 'PRICE_CHANGE';
  const bad = { title: title.trim().length < 3, rationale: rationale.trim().length < 10, program: needsPrice && !programId, amount: needsPrice && !isMoneyInput(amount) };
  return (
    <DialogContent size="lg" title={t('new')} description={t('newHint')} closeLabel={tc('close')} footer={<><Button variant="secondary" onClick={done}>{tc('cancel')}</Button><Button type="submit" form="proposal-form" loading={pending} loadingLabel={tc('saving')}>{submit ? t('createSubmit') : t('createDraft')}</Button></>}>
      <form id="proposal-form" noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (Object.values(bad).some(Boolean)) return; void run(() => create.mutateAsync({ type, title: title.trim(), rationale: rationale.trim(), submit, ...(programId ? { programId } : {}), ...(amount ? { proposedAmount: normalizeMoney(amount) } : {}) })); }}>
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('colType')}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {(['PRICE_CHANGE', 'OFFER', 'DISCOUNT', 'BUNDLE'] as const).map((x) => (<option key={x} value={x}>{t(`type${x}` as 'typeOFFER')}</option>))}
          </Select>
        </FormField>
        <FormField label={t('colProgram')} required={needsPrice} error={touched && bad.program ? t('programRequired') : undefined}>
          <Select value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="">{t('noProgram')}</option>
            {(programs.data ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </Select>
        </FormField>
        <FormField label={t('colTitle')} required error={touched && bad.title ? t('titleMin') : undefined}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></FormField>
        <FormField label={t('proposedPrice')} required={needsPrice} error={touched && bad.amount ? t('amountInvalid') : undefined}><MoneyInput value={amount} onChange={setAmount} invalid={touched && bad.amount} /></FormField>
        <FormField label={t('rationale')} required hint={t('rationaleHint')} error={touched && bad.rationale ? t('rationaleMin') : undefined}><Textarea rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} maxLength={4000} /></FormField>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={submit} onChange={(e) => setSubmit(e.target.checked)} />{t('submitNow')}</label>
      </form>
    </DialogContent>
  );
}
