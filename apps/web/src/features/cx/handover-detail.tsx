'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Circle } from 'lucide-react';
import { Alert, Button, ErrorState, FormField, Input, PageHeader, Panel, Select, Skeleton, Textarea } from '@salesos/ui';
import { Can, useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useOne, type Handover } from './api';
import { HandoverStatusBadge, HistoryList, NoteDialog, SlaCountdown, useFmt } from './shared';
import { Hint } from '@/features/hints/hint-views';

export function HandoverDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="handover:view">
      <Inner id={id} />
    </RequirePermission>
  );
}

interface FormState {
  learnerName: string; learnerContact: string; languagePreference: string; programName: string; amountPaid: string; amountDue: string; paymentVerified: '' | 'yes' | 'no';
  promisesMade: string; goals: string; objections: string; specialNotes: string; dataSharing: boolean; contact: boolean; marketing: boolean;
}
const fromHandover = (h: Handover): FormState => ({
  learnerName: h.learnerName ?? '', learnerContact: h.learnerContact ?? '', languagePreference: h.languagePreference ?? '', programName: h.programName ?? '', amountPaid: h.amountPaid ?? '', amountDue: h.amountDue ?? '',
  paymentVerified: h.paymentVerified == null ? '' : h.paymentVerified ? 'yes' : 'no', promisesMade: h.promisesMade ?? '', goals: h.goals ?? '', objections: h.objections ?? '', specialNotes: h.specialNotes ?? '',
  dataSharing: Boolean(h.consents?.dataSharing), contact: Boolean(h.consents?.contact), marketing: Boolean(h.consents?.marketing),
});
const toPatch = (f: FormState) => ({
  ...(f.learnerName.trim() ? { learnerName: f.learnerName.trim() } : {}), ...(f.learnerContact.trim() ? { learnerContact: f.learnerContact.trim() } : {}), ...(f.languagePreference ? { languagePreference: f.languagePreference } : {}),
  ...(f.programName.trim() ? { programName: f.programName.trim() } : {}), ...(f.amountPaid !== '' ? { amountPaid: Number(f.amountPaid) } : {}), ...(f.amountDue !== '' ? { amountDue: Number(f.amountDue) } : {}),
  ...(f.paymentVerified ? { paymentVerified: f.paymentVerified === 'yes' } : {}), ...(f.promisesMade.trim() ? { promisesMade: f.promisesMade.trim() } : {}), ...(f.goals.trim() ? { goals: f.goals.trim() } : {}),
  ...(f.objections.trim() ? { objections: f.objections.trim() } : {}), ...(f.specialNotes.trim() ? { specialNotes: f.specialNotes.trim() } : {}),
  consents: { dataSharing: f.dataSharing, contact: f.contact, marketing: f.marketing },
});

function Inner({ id }: { id: string }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const { can } = useAuth();
  const query = useOne<Handover>(ck('handovers', id), `/handovers/${id}`);
  const save = useAction<Record<string, unknown>, Handover>('patch', `/handovers/${id}`);
  const submit = useAction<Record<string, never>, Handover>('post', `/handovers/${id}/submit`);
  const ack = useAction<Record<string, unknown>, Handover>('post', `/handovers/${id}/acknowledge`);
  const info = useAction<{ questions: string }, Handover>('post', `/handovers/${id}/request-info`);
  const done = useAction<{ note: string }, Handover>('post', `/handovers/${id}/complete`);
  const [edits, setEdits] = React.useState<Partial<FormState>>({});
  const [dialog, setDialog] = React.useState<'info' | 'complete' | null>(null);
  const [missingFromServer, setMissing] = React.useState<string[] | null>(null);

  if (query.isPending) return <div className="space-y-3" aria-busy="true" aria-label={tc('loading')}><Skeleton className="h-10 w-1/2" /><Skeleton className="h-72" /></div>;
  if (query.isError) return <ErrorState description={apiErr(query.error).message} requestId={apiErr(query.error).requestId} onRetry={() => query.refetch()} retryLabel={tc('retry')} />;
  const hv = query.data;
  const editable = (hv.status === 'DRAFT' || hv.status === 'INFO_REQUESTED') && can('handover:create');
  const receiver = can('handover:acknowledge');
  const form: FormState | null = hv.minimumData ? null : { ...fromHandover(hv), ...edits };
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setMissing(null); setEdits((p) => ({ ...p, [k]: v })); };
  const checklist = hv.checklist ?? [];

  const doSubmit = async () => {
    if (!form) return;
    setMissing(null);
    try {
      await save.mutateAsync(toPatch(form));
      await submit.mutateAsync({});
      setEdits({});
    } catch (e) {
      if (e instanceof ApiError && e.code === 'HANDOVER_INCOMPLETE') setMissing(Object.keys(e.fieldErrors));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t('handover.eyebrow')}
        title={hv.learnerName ?? t('handover.unnamed')}
        breadcrumbs={[{ label: t('handover.title'), href: '/cx/handovers' }, { label: hv.learnerName ?? t('handover.unnamed') }]}
        breadcrumbLabel={tc('breadcrumb')}
        actions={
          receiver ? (
            <>
              {(hv.status === 'SUBMITTED' || hv.status === 'OVERDUE') && <Button loading={ack.isPending} onClick={() => ack.mutate({})}>{t('handover.acknowledge')}</Button>}
              {hv.status === 'SUBMITTED' && <Button variant="secondary" onClick={() => { info.reset(); setDialog('info'); }}>{t('handover.requestInfo')}</Button>}
              {hv.status === 'ACKNOWLEDGED' && <Button onClick={() => { done.reset(); setDialog('complete'); }}>{t('handover.complete')}</Button>}
            </>
          ) : undefined
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <HandoverStatusBadge status={hv.status} />
        {hv.pending && hv.ackDueAt && <SlaCountdown label={t('handover.acknowledgeBy')} dueAt={hv.ackDueAt} breachedAt={hv.overdueAt} />}
        <span className="text-sm text-muted">{t('handover.salesOwner')}: {hv.ownerName ?? '—'}{hv.receivingOwnerName ? ` · ${t('handover.receivedBy')}: ${hv.receivingOwnerName}` : ''}</span>
      </div>
      {ack.isError && <Alert tone="danger" className="mb-4">{apiErr(ack.error).message}</Alert>}
      {hv.status === 'INFO_REQUESTED' && hv.infoRequest && <Alert tone="warning" title={t('handover.infoRequested')} className="mb-4">{hv.infoRequest}</Alert>}
      {hv.minimumData ? (
        <Alert tone="info" title={t('handover.minimumData')}>{t('handover.minimumDataHint')}</Alert>
      ) : (
        <div className="stagger grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Panel accent="gold" title={t('handover.checklistTitle')} description={editable ? t('handover.checklistEditHint') : t('handover.checklistReadHint')} actions={<Hint id="handoverChecklist" />}>
            {form && editable ? (
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void doSubmit(); }} noValidate>
                {(save.isError || submit.isError) && !missingFromServer?.length && <Alert tone="danger">{apiErr(save.error ?? submit.error).message}</Alert>}
                {missingFromServer && missingFromServer.length > 0 && <Alert tone="danger" title={t('handover.cannotSubmit')}>{t('handover.cannotSubmitHint', { fields: missingFromServer.map((k) => t(`handoverField.${k}` as never)).join(', ') })}</Alert>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={t('handoverField.learnerName')} required><Input value={form.learnerName} onChange={(e) => set('learnerName', e.target.value)} maxLength={200} /></FormField>
                  <FormField label={t('handoverField.learnerContact')} required><Input value={form.learnerContact} onChange={(e) => set('learnerContact', e.target.value)} maxLength={200} /></FormField>
                  <FormField label={t('handoverField.languagePreference')} required>
                    <Select value={form.languagePreference} onChange={(e) => set('languagePreference', e.target.value)}><option value="">{t('handover.choose')}</option>{['EN', 'HI', 'MR'].map((l) => <option key={l} value={l}>{t(`handover.language.${l}`)}</option>)}</Select>
                  </FormField>
                  <FormField label={t('handoverField.program')} required><Input value={form.programName} onChange={(e) => set('programName', e.target.value)} maxLength={200} /></FormField>
                  <FormField label={t('handoverField.amountPaid', { currency: hv.currency ?? 'INR' })} required><Input type="number" min={0} step="0.01" inputMode="decimal" value={form.amountPaid} onChange={(e) => set('amountPaid', e.target.value)} /></FormField>
                  <FormField label={t('handoverField.amountDue', { currency: hv.currency ?? 'INR' })} required><Input type="number" min={0} step="0.01" inputMode="decimal" value={form.amountDue} onChange={(e) => set('amountDue', e.target.value)} /></FormField>
                </div>
                <FormField label={t('handoverField.paymentVerified')} required hint={t('handover.paymentVerifiedHint')}>
                  <Select value={form.paymentVerified} onChange={(e) => set('paymentVerified', e.target.value as FormState['paymentVerified'])}><option value="">{t('handover.choose')}</option><option value="yes">{t('satisfaction.yes')}</option><option value="no">{t('satisfaction.no')}</option></Select>
                </FormField>
                <FormField label={t('handoverField.promisesMade')} required hint={t('handover.promisesHint')}><Textarea rows={3} value={form.promisesMade} onChange={(e) => set('promisesMade', e.target.value)} maxLength={4000} /></FormField>
                <FormField label={t('handoverField.goals')} required><Textarea rows={3} value={form.goals} onChange={(e) => set('goals', e.target.value)} maxLength={4000} /></FormField>
                <FormField label={t('handoverField.objections')} required hint={t('handover.noneHint')}><Textarea rows={2} value={form.objections} onChange={(e) => set('objections', e.target.value)} maxLength={4000} /></FormField>
                <FormField label={t('handoverField.specialNotes')} required hint={t('handover.noneHint')}><Textarea rows={2} value={form.specialNotes} onChange={(e) => set('specialNotes', e.target.value)} maxLength={4000} /></FormField>
                <fieldset className="space-y-2 rounded-lg border border-line p-3">
                  <legend className="px-1 text-sm font-semibold text-ink">{t('handoverField.consents')} <span aria-hidden="true" className="text-red-700">*</span></legend>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-gold-600" checked={form.dataSharing} onChange={(e) => set('dataSharing', e.target.checked)} /><span><span className="font-medium">{t('handover.consentSharing')}</span><span className="block text-muted">{t('handover.consentSharingHint')}</span></span></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-gold-600" checked={form.contact} onChange={(e) => set('contact', e.target.checked)} />{t('handover.consentContact')}</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-gold-600" checked={form.marketing} onChange={(e) => set('marketing', e.target.checked)} />{t('handover.consentMarketing')}</label>
                </fieldset>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="secondary" loading={save.isPending && !submit.isPending} onClick={() => save.mutate(toPatch(form), { onSuccess: () => setEdits({}) })}>{t('handover.saveDraft')}</Button>
                  <Button type="submit" loading={submit.isPending}>{t('handover.submit')}</Button>
                </div>
              </form>
            ) : (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Item label={t('handoverField.learnerName')}>{hv.learnerName}</Item>
                <Item label={t('handoverField.learnerContact')}>{hv.learnerContact}</Item>
                <Item label={t('handoverField.languagePreference')}>{hv.languagePreference ? t(`handover.language.${hv.languagePreference}` as never) : null}</Item>
                <Item label={t('handoverField.program')}>{hv.programName}</Item>
                <Item label={t('handoverField.amountPaid', { currency: hv.currency ?? 'INR' })}>{hv.amountPaid != null ? fmt.money(hv.amountPaid, hv.currency) : null}</Item>
                <Item label={t('handoverField.amountDue', { currency: hv.currency ?? 'INR' })}>{hv.amountDue != null ? fmt.money(hv.amountDue, hv.currency) : null}</Item>
                <Item label={t('handoverField.paymentVerified')}>{hv.paymentVerified == null ? null : hv.paymentVerified ? t('satisfaction.yes') : t('satisfaction.no')}</Item>
                <Item label={t('handoverField.consents')}>{hv.consents ? [hv.consents.dataSharing && t('handover.consentSharing'), hv.consents.contact && t('handover.consentContact'), hv.consents.marketing && t('handover.consentMarketing')].filter(Boolean).join(' · ') || t('handover.noConsent') : null}</Item>
                <div className="sm:col-span-2"><Item label={t('handoverField.promisesMade')}>{hv.promisesMade}</Item></div>
                <div className="sm:col-span-2"><Item label={t('handoverField.goals')}>{hv.goals}</Item></div>
                <Item label={t('handoverField.objections')}>{hv.objections}</Item>
                <Item label={t('handoverField.specialNotes')}>{hv.specialNotes}</Item>
                {hv.completionNote && <div className="sm:col-span-2"><Item label={t('handover.completionNote')}>{hv.completionNote}</Item></div>}
              </dl>
            )}
          </Panel>
          <div className="stagger space-y-4">
            <Panel accent="blue" title={t('handover.checklistProgress')} description={t('handover.checklistProgressHint')}>
              <ul className="space-y-1.5" aria-label={t('handover.checklistProgress')}>
                {checklist.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 text-sm">
                    {c.done ? <CheckCircle2 className="size-4 text-green-700" aria-hidden="true" /> : <Circle className="size-4 text-ink-400" aria-hidden="true" />}
                    <span className={c.done ? 'text-ink' : 'text-ink-700'}>{t(`handoverField.${c.key}` as never, { currency: hv.currency ?? 'INR' } as never)}</span>
                    <span className="sr-only">{c.done ? t('handover.done') : t('handover.missing')}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Can permission="handover:view"><Panel accent="green" title={t('common.history')}><HistoryList items={hv.history ?? []} /></Panel></Can>
          </div>
        </div>
      )}
      {dialog === 'info' && <NoteDialog open onOpenChange={(o) => !o && setDialog(null)} title={t('handover.requestInfo')} description={t('handover.requestInfoHint')} label={t('handover.questions')} submitLabel={t('handover.requestInfo')} pending={info.isPending} error={info.error} onSubmit={(questions) => info.mutate({ questions }, { onSuccess: () => setDialog(null) })} />}
      {dialog === 'complete' && <NoteDialog open onOpenChange={(o) => !o && setDialog(null)} title={t('handover.complete')} description={t('handover.completeHint')} label={t('handover.completionNote')} submitLabel={t('handover.complete')} pending={done.isPending} error={done.error} onSubmit={(note) => done.mutate({ note }, { onSuccess: () => setDialog(null) })} />}
    </>
  );
}

function Item({ label, children }: { label: string; children?: React.ReactNode }) {
  const t = useTranslations('cx');
  return <div><dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap text-ink">{children || <span className="text-muted">{t('handover.notProvided')}</span>}</dd></div>;
}

/** Manual creation: pick a WON deal id (from the sale) or learner; normally the handover is created automatically when a sale is won. */
export function NewHandoverPage() {
  return (
    <RequirePermission permission="handover:create">
      <NewInner />
    </RequirePermission>
  );
}

function NewInner() {
  const t = useTranslations('cx');
  const router = useRouter();
  const apiErr = useApiErrorMessage();
  const create = useAction<Record<string, unknown>, Handover>('post', '/handovers');
  const [dealId, setDealId] = React.useState('');
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId.trim());
  return (
    <>
      <PageHeader eyebrow={t('handover.eyebrow')} title={t('handover.newTitle')} description={t('handover.newDescription')} />
      <form className="max-w-xl space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate({ dealId: dealId.trim() }, { onSuccess: (h) => router.push(`/cx/handovers/${h.id}`) }); }}>
        {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
        <Alert tone="info">{t('handover.autoCreated')}</Alert>
        <FormField label={t('handover.dealId')} required hint={t('handover.dealIdHint')} error={dealId && !valid ? t('handover.dealIdInvalid') : undefined}>
          <Input value={dealId} onChange={(e) => setDealId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
        </FormField>
        <Button type="submit" loading={create.isPending} disabled={!valid}>{t('handover.create')}</Button>
      </form>
    </>
  );
}
