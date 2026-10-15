'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Alert, Badge, Button, DataTable, Dialog, DialogContent, FormField, Input, Pagination, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, type Column } from '@salesos/ui';
import { PageHeader } from '@/features/crm/motion';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useCreateFeedback, useCreateGrowth, useFeedback, useGrowth, useUpdateFeedback, useUpdateGrowth, type FeedbackEntry, type GrowthOpportunity } from '@/lib/api/hooks/revenue';
import { Money, usePagerLabels, useRevFormat } from './common';
import { MoneyInput, useSubmit } from './forms';
import { isMoneyInput, normalizeMoney } from './lib';

export function IntelPage() {
  const t = useTranslations('revenue.intel');
  const [dlg, setDlg] = React.useState<null | 'feedback' | 'growth'>(null);
  return (
    <RequirePermission permission="market-intel:view">
      <PageHeader eyebrow={useTranslations('nav')('revenue')} title={t('title')} description={t('description')} actions={<Can permission="market-intel:create"><Button variant="gold" className="glow-gold" onClick={() => setDlg('feedback')}><Plus className="size-4" aria-hidden="true" />{t('addFeedback')}</Button><Button variant="secondary" onClick={() => setDlg('growth')}><Plus className="size-4" aria-hidden="true" />{t('addGrowth')}</Button></Can>} />
      <Tabs defaultValue="feedback">
        <TabsList aria-label={t('sections')}>
          <TabsTrigger value="feedback">{t('feedback')}</TabsTrigger>
          <TabsTrigger value="growth">{t('growth')}</TabsTrigger>
        </TabsList>
        <TabsContent value="feedback" className="pt-5"><FeedbackLog /></TabsContent>
        <TabsContent value="growth" className="pt-5"><GrowthLog /></TabsContent>
      </Tabs>
      <FeedbackDialog open={dlg === 'feedback'} onOpenChange={(o) => setDlg(o ? 'feedback' : null)} />
      <GrowthDialog open={dlg === 'growth'} onOpenChange={(o) => setDlg(o ? 'growth' : null)} />
    </RequirePermission>
  );
}

const KINDS = ['', 'MARKET', 'COMPETITOR', 'LEARNER'] as const;
const FSTATUS = ['NEW', 'REVIEWED', 'ACTIONED', 'DISMISSED'] as const;

function FeedbackLog() {
  const t = useTranslations('revenue.intel');
  const tc = useTranslations('common');
  const f = useRevFormat();
  const pager = usePagerLabels();
  const canEdit = usePermission('market-intel:create');
  const upd = useUpdateFeedback();
  const [kind, setKind] = React.useState<(typeof KINDS)[number]>('');
  const [page, setPage] = React.useState(1);
  const q = useFeedback({ page, limit: 15, ...(kind ? { kind } : {}) });
  const columns: Column<FeedbackEntry>[] = [
    { id: 'title', header: t('colTitle'), primary: true, cell: (e) => (<span><span className="font-medium text-ink">{e.title}</span><span className="mt-0.5 block text-sm text-muted">{e.notes}</span>{e.competitor && <span className="block text-xs text-muted">{t('competitor', { name: e.competitor })}</span>}</span>) },
    { id: 'kind', header: t('colKind'), cell: (e) => <Badge tone={e.kind === 'COMPETITOR' ? 'red' : e.kind === 'LEARNER' ? 'green' : 'blue'}>{t(`kind${e.kind}` as 'kindMARKET')}</Badge> },
    { id: 'category', header: t('colCategory'), hideOnMobile: true, cell: (e) => e.category },
    { id: 'by', header: t('colBy'), hideOnMobile: true, cell: (e) => `${e.createdByName ?? ''} · ${f.dateTime(e.createdAt)}` },
    { id: 'status', header: t('colStatus'), cell: (e) => canEdit ? (
      <Select aria-label={t('statusFor', { title: e.title })} value={e.status} onChange={(ev) => upd.mutate({ id: e.id, status: ev.target.value })} className="w-36">
        {FSTATUS.map((s) => (<option key={s} value={s}>{t(`fstatus${s}` as 'fstatusNEW')}</option>))}
      </Select>) : t(`fstatus${e.status}` as 'fstatusNEW') },
  ];
  return (
    <div className="space-y-4 enter-up">
      <div role="group" aria-label={t('filterKind')} className="flex flex-wrap gap-2">
        {KINDS.map((k) => (<Button key={k || 'all'} size="sm" variant={kind === k ? 'primary' : 'secondary'} aria-pressed={kind === k} onClick={() => { setKind(k); setPage(1); }}>{k === '' ? t('all') : t(`kind${k}` as 'kindMARKET')}</Button>))}
      </div>
      <DataTable caption={t('feedback')} loadingLabel={tc('loading')} columns={columns} rows={q.data?.items} getRowId={(e) => e.id} loading={q.isPending} error={q.isError ? { message: t('loadError'), onRetry: () => void q.refetch() } : null} emptyTitle={t('noFeedback')} emptyDescription={t('noFeedbackHint')} />
      <Pagination page={page} hasNext={Boolean(q.data?.pagination?.hasMore)} onPageChange={setPage} labels={pager} />
    </div>
  );
}

const GSTATUS = ['IDEA', 'EVALUATING', 'PILOT', 'ADOPTED', 'DROPPED'] as const;

function GrowthLog() {
  const t = useTranslations('revenue.intel');
  const tc = useTranslations('common');
  const pager = usePagerLabels();
  const canEdit = usePermission('market-intel:create');
  const upd = useUpdateGrowth();
  const [page, setPage] = React.useState(1);
  const q = useGrowth({ page, limit: 15 });
  const columns: Column<GrowthOpportunity>[] = [
    { id: 'title', header: t('colTitle'), primary: true, cell: (g) => (<span><span className="font-medium text-ink">{g.title}</span><span className="mt-0.5 block text-sm text-muted">{g.description}</span></span>) },
    { id: 'type', header: t('colType'), cell: (g) => <Badge>{t(`gtype${g.type}` as 'gtypeCHANNEL')}</Badge> },
    { id: 'value', header: t('colEstimate'), align: 'right', hideOnMobile: true, cell: (g) => (g.estimatedValue ? <span><Money value={g.estimatedValue} /><span className="block text-xs text-muted">{t('estimateLabel')}</span></span> : '—') },
    { id: 'owner', header: t('colOwner'), hideOnMobile: true, cell: (g) => g.ownerName },
    { id: 'status', header: t('colStatus'), cell: (g) => canEdit ? (
      <Select aria-label={t('statusFor', { title: g.title })} value={g.status} onChange={(ev) => upd.mutate({ id: g.id, status: ev.target.value })} className="w-36">
        {GSTATUS.map((s) => (<option key={s} value={s}>{t(`gstatus${s}` as 'gstatusIDEA')}</option>))}
      </Select>) : t(`gstatus${g.status}` as 'gstatusIDEA') },
  ];
  return (
    <div className="space-y-4 enter-up">
      <Alert tone="info">{t('growthNote')}</Alert>
      <DataTable caption={t('growth')} loadingLabel={tc('loading')} columns={columns} rows={q.data?.items} getRowId={(g) => g.id} loading={q.isPending} error={q.isError ? { message: t('loadError'), onRetry: () => void q.refetch() } : null} emptyTitle={t('noGrowth')} emptyDescription={t('noGrowthHint')} />
      <Pagination page={page} hasNext={Boolean(q.data?.pagination?.hasMore)} onPageChange={setPage} labels={pager} />
    </div>
  );
}

function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (<Dialog open={open} onOpenChange={onOpenChange}>{open && <FeedbackBody onOpenChange={onOpenChange} />}</Dialog>);
}
function FeedbackBody({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('revenue.intel');
  const tc = useTranslations('common');
  const create = useCreateFeedback();
  const [kind, setKind] = React.useState('MARKET');
  const [category, setCategory] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [source, setSource] = React.useState('');
  const [competitor, setCompetitor] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(done, t('feedbackAdded'));
  const bad = { category: category.trim().length < 2, title: title.trim().length < 3, notes: notes.trim().length < 3 };
  return (
    <DialogContent size="md" title={t('addFeedback')} description={t('feedbackHint')} closeLabel={tc('close')} footer={<><Button variant="secondary" onClick={done}>{tc('cancel')}</Button><Button type="submit" form="feedback-form" loading={pending} loadingLabel={tc('saving')}>{t('save')}</Button></>}>
      <form id="feedback-form" noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (Object.values(bad).some(Boolean)) return; void run(() => create.mutateAsync({ kind, category: category.trim(), title: title.trim(), notes: notes.trim(), ...(source.trim() ? { source: source.trim() } : {}), ...(kind === 'COMPETITOR' && competitor.trim() ? { competitor: competitor.trim() } : {}) })); }}>
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('colKind')}><Select value={kind} onChange={(e) => setKind(e.target.value)}>{(['MARKET', 'COMPETITOR', 'LEARNER'] as const).map((k) => (<option key={k} value={k}>{t(`kind${k}` as 'kindMARKET')}</option>))}</Select></FormField>
        <FormField label={t('colCategory')} required error={touched && bad.category ? t('required') : undefined} hint={t('categoryHint')}><Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} /></FormField>
        {kind === 'COMPETITOR' && <FormField label={t('competitorName')}><Input value={competitor} onChange={(e) => setCompetitor(e.target.value)} maxLength={120} /></FormField>}
        <FormField label={t('colTitle')} required error={touched && bad.title ? t('required') : undefined}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></FormField>
        <FormField label={t('notes')} required error={touched && bad.notes ? t('required') : undefined}><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} /></FormField>
        <FormField label={t('source')}><Input value={source} onChange={(e) => setSource(e.target.value)} maxLength={120} /></FormField>
      </form>
    </DialogContent>
  );
}

function GrowthDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (<Dialog open={open} onOpenChange={onOpenChange}>{open && <GrowthBody onOpenChange={onOpenChange} />}</Dialog>);
}
function GrowthBody({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('revenue.intel');
  const tc = useTranslations('common');
  const create = useCreateGrowth();
  const [type, setType] = React.useState('CHANNEL');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [estimate, setEstimate] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(done, t('growthAdded'));
  const bad = { title: title.trim().length < 3, description: description.trim().length < 3, estimate: estimate !== '' && !isMoneyInput(estimate) };
  return (
    <DialogContent size="md" title={t('addGrowth')} description={t('growthHint')} closeLabel={tc('close')} footer={<><Button variant="secondary" onClick={done}>{tc('cancel')}</Button><Button type="submit" form="growth-form" loading={pending} loadingLabel={tc('saving')}>{t('save')}</Button></>}>
      <form id="growth-form" noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (Object.values(bad).some(Boolean)) return; void run(() => create.mutateAsync({ type, title: title.trim(), description: description.trim(), ...(estimate ? { estimatedValue: normalizeMoney(estimate) } : {}) })); }}>
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('colType')}><Select value={type} onChange={(e) => setType(e.target.value)}>{(['CHANNEL', 'SEGMENT', 'OTHER'] as const).map((k) => (<option key={k} value={k}>{t(`gtype${k}` as 'gtypeCHANNEL')}</option>))}</Select></FormField>
        <FormField label={t('colTitle')} required error={touched && bad.title ? t('required') : undefined}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></FormField>
        <FormField label={t('description2')} required error={touched && bad.description ? t('required') : undefined}><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} /></FormField>
        <FormField label={t('colEstimate')} hint={t('estimateHint')} error={touched && bad.estimate ? t('amountInvalid') : undefined}><MoneyInput value={estimate} onChange={setEstimate} invalid={touched && bad.estimate} /></FormField>
      </form>
    </DialogContent>
  );
}
