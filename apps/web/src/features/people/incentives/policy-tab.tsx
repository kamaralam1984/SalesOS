'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Badge, Button, Checkbox, EmptyState, ErrorState, FormField, Input, Panel, Select, Skeleton, Textarea } from '@salesos/ui';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ConfirmDialog, useDone, useFmt } from '../hrkit/kit';
import { useApprovePolicy, useCreatePolicy, usePolicies, useUpdatePolicy, type Policy } from './api';
import { buildPolicyPayload, emptyPolicyForm, policyFormSchema, policyToForm, type PolicyFormValues } from './policy-form';

export function PolicyTab() {
  const t = useTranslations('incentives');
  const apiErr = useApiErrorMessage();
  const q = usePolicies();
  const [editing, setEditing] = React.useState<{ policy: Policy | null; seed?: Policy } | null>(null);
  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} />;
  const { policies, state } = q.data;
  return (
    <div className="space-y-5">
      {state === 'POLICY_NOT_CONFIGURED' && (
        <Alert tone="warning" title={t('policy.notConfiguredTitle')} live={false}>{t('policy.notConfiguredBody')}</Alert>
      )}
      <Panel accent="gold"
        title={t('policy.versions')}
        actions={<Can permission="incentives:policy:manage"><Button onClick={() => setEditing({ policy: null })}>{t('policy.newDraft')}</Button></Can>}
      >
        {policies.length === 0 ? (
          <EmptyState title={t('policy.emptyTitle')} description={t('policy.emptyBody')} />
        ) : (
          <ul className="space-y-3">
            {policies.map((p) => <PolicyCard key={p.id} p={p} onEdit={() => setEditing({ policy: p })} onNewVersion={() => setEditing({ policy: null, seed: p })} />)}
          </ul>
        )}
      </Panel>
      {editing && <PolicyEditor key={editing.policy?.id ?? editing.seed?.id ?? 'new'} policy={editing.policy} seed={editing.seed} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PolicyCard({ p, onEdit, onNewVersion }: { p: Policy; onEdit: () => void; onNewVersion: () => void }) {
  const t = useTranslations('incentives');
  const fmt = useFmt();
  const canApprove = usePermission('incentives:policy:approve');
  const approve = useApprovePolicy();
  const done = useDone();
  const [confirm, setConfirm] = React.useState(false);
  const s = p.structure;
  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-ink">v{p.versionNumber} · {p.name}</h3>
        <Badge tone={p.status === 'APPROVED' ? 'green' : p.status === 'DRAFT' ? 'gold' : 'neutral'}>{t(`policy.status.${p.status}` as never)}</Badge>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-muted">{t('policy.basis')}: </dt><dd className="inline">{t(`policy.basisValue.${s.basis}` as never)}</dd></div>
        <div><dt className="inline text-muted">{t('policy.periodType')}: </dt><dd className="inline">{t(`policy.periodValue.${s.periodType}` as never)}</dd></div>
        <div><dt className="inline text-muted">{t('policy.slabMode')}: </dt><dd className="inline">{t(`policy.slabModeValue.${s.slabMode}` as never)}</dd></div>
        <div><dt className="inline text-muted">{t('policy.netOfRefunds')}: </dt><dd className="inline">{s.netOfRefunds ? t('yes') : t('no')}</dd></div>
        <div><dt className="inline text-muted">{t('policy.cap')}: </dt><dd className="inline">{s.cap === null ? t('policy.noCap') : fmt.money(s.cap, s.currency)}</dd></div>
        <div><dt className="inline text-muted">{t('policy.clawbackWindow')}: </dt><dd className="inline">{t('policy.days', { count: s.clawbackWindowDays })}</dd></div>
        <div><dt className="inline text-muted">{t('policy.effectiveFrom')}: </dt><dd className="inline">{fmt.date(p.effectiveFrom)}</dd></div>
        <div><dt className="inline text-muted">{t('policy.approvedBy')}: </dt><dd className="inline">{p.approvedByName ?? '—'}</dd></div>
      </dl>
      {s.slabs.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('policy.noSlabs')}</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">{t('policy.slabs')}</caption>
          <thead><tr className="text-left text-muted"><th className="py-1 pr-3">{t('policy.from')}</th><th className="pr-3">{t('policy.to')}</th><th>{t('policy.payout')}</th></tr></thead>
          <tbody>
            {s.slabs.map((x, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-3">{x.minPct}%</td><td className="pr-3">{x.maxPct === null ? t('policy.open') : `${x.maxPct}%`}</td>
                <td>{x.ratePct !== undefined ? t('policy.ratePctValue', { value: x.ratePct }) : fmt.money(x.fixedAmount, s.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {p.status === 'DRAFT' && <Can permission="incentives:policy:manage"><Button variant="secondary" size="sm" onClick={onEdit}>{t('policy.edit')}</Button></Can>}
        {p.status === 'DRAFT' && canApprove && <Button size="sm" onClick={() => setConfirm(true)}>{t('policy.approve')}</Button>}
        {p.status !== 'DRAFT' && <Can permission="incentives:policy:manage"><Button variant="secondary" size="sm" onClick={onNewVersion}>{t('policy.newVersion')}</Button></Can>}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('policy.approveTitle')}
        description={t('policy.approveBody')}
        confirmLabel={t('policy.approve')}
        pending={approve.isPending}
        error={approve.error}
        onConfirm={() => approve.mutate(p.id, { onSuccess: () => { setConfirm(false); done(t('policy.approved')); } })}
      />
    </li>
  );
}

function PolicyEditor({ policy, seed, onClose }: { policy: Policy | null; seed?: Policy; onClose: () => void }) {
  const t = useTranslations('incentives');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const create = useCreatePolicy();
  const update = useUpdatePolicy(policy?.id ?? '');
  const src = policy ?? seed;
  const form = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: src ? policyToForm(policy ? src.name : `${src.name}`, src.structure, src.notes) : emptyPolicyForm(),
  });
  const slabs = useFieldArray({ control: form.control, name: 'slabs' });
  const gates = useFieldArray({ control: form.control, name: 'gates' });
  const netOfRefunds = useWatch({ control: form.control, name: 'netOfRefunds' });
  const e = form.formState.errors;
  const fe = (x?: { message?: unknown }) => (typeof x?.message === 'string' ? t(`errors.${x.message}` as never) : undefined);
  const pending = create.isPending || update.isPending;
  const submit = form.handleSubmit(async (v) => {
    try {
      const payload = buildPolicyPayload(v);
      if (policy) await update.mutateAsync(payload);
      else await create.mutateAsync(payload);
      done(t('policy.saved'));
      onClose();
    } catch (err) {
      form.setError('root', { message: apiErr(err).message });
    }
  });
  return (
    <Panel accent="blue" title={policy ? t('policy.editTitle', { version: policy.versionNumber }) : t('policy.newTitle')} description={t('policy.formHint')}>
      {e.root && <Alert tone="danger" className="mb-3">{e.root.message}</Alert>}
      <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-2" aria-label={t('policy.newTitle')}>
        <FormField label={t('policy.name')} required error={fe(e.name)} className="md:col-span-2"><Input {...form.register('name')} /></FormField>
        <FormField label={t('policy.basis')}><Select {...form.register('basis')}><option value="REVENUE">{t('policy.basisValue.REVENUE')}</option><option value="COLLECTION">{t('policy.basisValue.COLLECTION')}</option></Select></FormField>
        <FormField label={t('policy.periodType')}><Select {...form.register('periodType')}><option value="MONTH">{t('policy.periodValue.MONTH')}</option><option value="QUARTER">{t('policy.periodValue.QUARTER')}</option></Select></FormField>
        <FormField label={t('policy.slabMode')}><Select {...form.register('slabMode')}><option value="FLAT_ON_TOTAL">{t('policy.slabModeValue.FLAT_ON_TOTAL')}</option><option value="MARGINAL">{t('policy.slabModeValue.MARGINAL')}</option></Select></FormField>
        <FormField label={t('policy.currency')} error={fe(e.currency)}><Input maxLength={3} {...form.register('currency')} /></FormField>
        <div className="md:col-span-2"><Checkbox label={t('policy.netOfRefunds')} checked={netOfRefunds} onCheckedChange={(c) => form.setValue('netOfRefunds', c === true)} /></div>

        <fieldset className="md:col-span-2">
          <legend className="mb-1 text-sm font-medium text-ink">{t('policy.slabs')}</legend>
          <p className="mb-2 text-xs text-muted">{t('policy.slabsHint')}</p>
          {slabs.fields.map((f, i) => (
            <div key={f.id} className="mb-2 grid grid-cols-2 gap-2 rounded-md border border-line p-2 sm:grid-cols-5">
              <FormField label={t('policy.from')} error={fe(e.slabs?.[i]?.minPct)}><Input inputMode="decimal" {...form.register(`slabs.${i}.minPct`)} /></FormField>
              <FormField label={t('policy.to')} hint={t('policy.toHint')} error={fe(e.slabs?.[i]?.maxPct)}><Input inputMode="decimal" {...form.register(`slabs.${i}.maxPct`)} /></FormField>
              <FormField label={t('policy.payoutKind')}><Select {...form.register(`slabs.${i}.kind`)}><option value="rate">{t('policy.kindRate')}</option><option value="fixed">{t('policy.kindFixed')}</option></Select></FormField>
              <FormField label={t('policy.value')} error={fe(e.slabs?.[i]?.value)}><Input inputMode="decimal" {...form.register(`slabs.${i}.value`)} /></FormField>
              <div className="flex items-end"><Button type="button" variant="ghost" onClick={() => slabs.remove(i)}>{t('policy.removeSlab')}</Button></div>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => slabs.append({ minPct: '', maxPct: '', kind: 'rate', value: '' })}>{t('policy.addSlab')}</Button>
        </fieldset>

        <fieldset className="md:col-span-2">
          <legend className="mb-1 text-sm font-medium text-ink">{t('policy.gates')}</legend>
          <p className="mb-2 text-xs text-muted">{t('policy.gatesHint')}</p>
          {gates.fields.map((f, i) => (
            <div key={f.id} className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <FormField label={t('policy.gateMetric')} error={fe(e.gates?.[i]?.metric)}><Input {...form.register(`gates.${i}.metric`)} /></FormField>
              <FormField label={t('policy.gateOp')}><Select {...form.register(`gates.${i}.op`)}>{['>=', '>', '<=', '<'].map((o) => <option key={o} value={o}>{o}</option>)}</Select></FormField>
              <FormField label={t('policy.value')} error={fe(e.gates?.[i]?.value)}><Input inputMode="decimal" {...form.register(`gates.${i}.value`)} /></FormField>
              <div className="flex items-end"><Button type="button" variant="ghost" onClick={() => gates.remove(i)}>{t('policy.removeGate')}</Button></div>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => gates.append({ metric: '', op: '>=', value: '' })}>{t('policy.addGate')}</Button>
        </fieldset>

        <FormField label={t('policy.cap')} hint={t('policy.capHint')} error={fe(e.cap)}><Input inputMode="decimal" {...form.register('cap')} /></FormField>
        <FormField label={t('policy.clawbackWindow')} hint={t('policy.clawbackHint')} error={fe(e.clawbackWindowDays)}><Input inputMode="numeric" {...form.register('clawbackWindowDays')} /></FormField>
        <FormField label={t('policy.notes')} className="md:col-span-2"><Textarea rows={3} {...form.register('notes')} /></FormField>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" loading={pending}>{t('policy.save')}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        </div>
      </form>
    </Panel>
  );
}
