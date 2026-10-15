'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Combobox, Dialog, DialogContent, EmptyState, ErrorState, FormField, Input, PageHeader, Select, Skeleton, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useTeamMemberOptions } from '../common/api';
import { ConfirmDialog, useDone } from '../hrkit/kit';
import { useCreatePosition, useRemoveBench, useSaveBench, useSuccession, type BenchCandidate, type Position } from './api';
import { SuccessionBoard } from './board';

export function SuccessionPage() {
  return (
    <RequirePermission permission="succession:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('succession');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const q = useSuccession();
  const save = useSaveBench();
  const remove = useRemoveBench();
  const [newPos, setNewPos] = React.useState(false);
  const [bench, setBench] = React.useState<Position | null>(null);
  const [removing, setRemoving] = React.useState<BenchCandidate | null>(null);
  const move = (p: Position, c: BenchCandidate) =>
    save.mutate({ positionId: p.id, userId: c.userId, readiness: c.readiness === 'READY_NOW' ? 'READY_LATER' : 'READY_NOW', developmentActions: c.developmentActions, notes: c.notes ?? undefined }, { onSuccess: () => done(t('saved')) });
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} actions={<Can permission="succession:manage"><Button className="glow-gold" onClick={() => setNewPos(true)}>{t('newPosition')}</Button></Can>} />
      <Alert tone="info" className="enter-fade mb-5" live={false}>{t('restricted')}</Alert>
      {save.isError && <Alert tone="danger" className="mb-3">{apiErr(save.error).message}</Alert>}
      {q.isPending ? <Skeleton className="shimmer h-40 w-full" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} /> : q.data.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <SuccessionBoard positions={q.data} onAdd={setBench} onMove={move} onRemove={setRemoving} />
      )}
      <Dialog open={newPos} onOpenChange={setNewPos}>{newPos && <PositionForm onClose={() => setNewPos(false)} />}</Dialog>
      <Dialog open={bench !== null} onOpenChange={(o) => !o && setBench(null)}>{bench && <BenchForm position={bench} onClose={() => setBench(null)} />}</Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('removeTitle')}
        description={t('removeBody')}
        confirmLabel={t('remove')}
        danger
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing.id, { onSuccess: () => { setRemoving(null); done(t('saved')); } })}
      />
    </>
  );
}

function PositionForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('succession');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const people = useTeamMemberOptions();
  const create = useCreatePosition();
  const [v, setV] = React.useState({ title: '', roleKey: '', incumbentId: null as string | null, notes: '' });
  const valid = v.title.trim().length >= 3 && v.roleKey.trim().length >= 2;
  return (
    <DialogContent title={t('newPosition')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate({ title: v.title, roleKey: v.roleKey, ...(v.incumbentId ? { incumbentId: v.incumbentId } : {}), ...(v.notes ? { notes: v.notes } : {}) }, { onSuccess: () => { done(t('saved')); onClose(); } })}>{t('create')}</Button></>}>
      {create.isError && <Alert tone="danger" className="mb-3">{apiErr(create.error).message}</Alert>}
      <div className="grid gap-3">
        <FormField label={t('positionTitle')} required><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></FormField>
        <FormField label={t('roleKey')} required hint={t('roleKeyHint')}><Input value={v.roleKey} onChange={(e) => setV({ ...v, roleKey: e.target.value.toUpperCase() })} /></FormField>
        <FormField label={t('incumbentLabel')}><Combobox options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} value={v.incumbentId} onValueChange={(x) => setV({ ...v, incumbentId: x })} loading={people.isPending} placeholder={t('pickPerson')} /></FormField>
        <FormField label={t('notes')}><Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></FormField>
      </div>
    </DialogContent>
  );
}

const benchSchema = z.object({
  readiness: z.enum(['READY_NOW', 'READY_LATER']),
  notes: z.string().max(2000),
  actions: z.array(z.object({ title: z.string().trim().min(3, 'min3'), dueDate: z.string(), status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']) })),
});
function BenchForm({ position, onClose }: { position: Position; onClose: () => void }) {
  const t = useTranslations('succession');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const people = useTeamMemberOptions();
  const save = useSaveBench();
  const [userId, setUserId] = React.useState<string | null>(null);
  const form = useForm<z.infer<typeof benchSchema>>({ resolver: zodResolver(benchSchema), defaultValues: { readiness: 'READY_LATER', notes: '', actions: [] } });
  const actions = useFieldArray({ control: form.control, name: 'actions' });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    if (!userId) return;
    try {
      await save.mutateAsync({ positionId: position.id, userId, readiness: v.readiness, notes: v.notes || undefined, developmentActions: v.actions.map((a) => ({ title: a.title, status: a.status, ...(a.dueDate ? { dueDate: a.dueDate } : {}) })) });
      done(t('saved'));
      onClose();
    } catch (err) { form.setError('root', { message: apiErr(err).message }); }
  });
  return (
    <DialogContent size="lg" title={t('addBenchTitle', { title: position.title })} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="bench-form" disabled={!userId} loading={save.isPending}>{t('save')}</Button></>}>
      {e.root && <Alert tone="danger" className="mb-3">{e.root.message}</Alert>}
      <form id="bench-form" onSubmit={submit} noValidate className="grid gap-3">
        <FormField label={t('person')} required><Combobox options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} value={userId} onValueChange={setUserId} loading={people.isPending} placeholder={t('pickPerson')} /></FormField>
        <FormField label={t('readiness')}><Select {...form.register('readiness')}><option value="READY_NOW">{t('readyNow')}</option><option value="READY_LATER">{t('readyLater')}</option></Select></FormField>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink">{t('devActions')}</legend>
          {actions.fields.map((f, i) => (
            <div key={f.id} className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <FormField label={t('actionTitle')} error={e.actions?.[i]?.title ? t('min3') : undefined} className="col-span-2"><Input {...form.register(`actions.${i}.title`)} /></FormField>
              <FormField label={t('due')}><Input type="date" {...form.register(`actions.${i}.dueDate`)} /></FormField>
              <FormField label={t('statusLabel')}><Select {...form.register(`actions.${i}.status`)}>{['OPEN', 'IN_PROGRESS', 'DONE'].map((s) => <option key={s} value={s}>{t(`actionStatus.${s}` as never)}</option>)}</Select></FormField>
              <div className="flex items-end"><Button type="button" variant="ghost" onClick={() => actions.remove(i)}>{t('remove')}</Button></div>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => actions.append({ title: '', dueDate: '', status: 'OPEN' })}>{t('addAction')}</Button>
        </fieldset>
        <FormField label={t('notes')}><Textarea rows={2} {...form.register('notes')} /></FormField>
      </form>
    </DialogContent>
  );
}
