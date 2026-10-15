'use client';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Button, FormField, Input, useToast } from '@salesos/ui';
import { MutationAlert, useFormErrors } from '../hub/shared';
import { useUpdatePipDraft, type Pip } from './api';

const schema = z.object({
  goals: z.array(z.object({ title: z.string().trim().min(3, 'tooShort').max(300, 'tooLong'), measure: z.string().max(300).optional() })).min(1, 'goalsRequired').max(15),
  measures: z.array(z.object({ text: z.string().trim().min(3, 'tooShort').max(300, 'tooLong') })).min(1, 'measuresRequired').max(15),
  durationDays: z.number({ error: 'integer' }).int('integer').min(7, 'durationRange').max(120, 'durationRange'),
  checkpoints: z.array(z.object({ dueDate: z.string().min(1, 'required'), title: z.string().trim().min(3, 'tooShort').max(200, 'tooLong') })).min(1, 'checkpointsRequired').max(12),
});
type V = z.infer<typeof schema>;

/** PURE: form values -> PATCH body. */
export const buildDraftPatch = (v: V) => ({
  goals: v.goals.map((g) => ({ title: g.title.trim(), ...(g.measure?.trim() ? { measure: g.measure.trim() } : {}) })),
  measures: v.measures.map((m) => m.text.trim()),
  durationDays: v.durationDays,
  checkpoints: v.checkpoints.map((c) => ({ dueDate: c.dueDate, title: c.title.trim() })),
});

export function DraftEditor({ pip, onDone }: { pip: Pip; onDone: () => void }) {
  const t = useTranslations('pips');
  const fe = useFormErrors('pips');
  const { toast } = useToast();
  const save = useUpdatePipDraft(pip.id);
  const { register, control, handleSubmit, formState } = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: {
      goals: pip.goals.length ? pip.goals.map((g) => ({ title: g.title, measure: g.measure ?? '' })) : [{ title: '', measure: '' }],
      measures: pip.measures.length ? pip.measures.map((text) => ({ text })) : [{ text: '' }],
      durationDays: pip.durationDays,
      checkpoints: pip.checkpoints.length ? pip.checkpoints.map((c) => ({ dueDate: c.dueDate ?? '', title: c.title })) : [{ dueDate: '', title: '' }],
    },
  });
  const goals = useFieldArray({ control, name: 'goals' });
  const measures = useFieldArray({ control, name: 'measures' });
  const cps = useFieldArray({ control, name: 'checkpoints' });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync(buildDraftPatch(v));
      toast({ tone: 'success', title: t('draft.saved') });
      onDone();
    } catch {
      /* shown below */
    }
  });
  const topErr = (e: unknown) => fe(e as { message?: unknown });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label={t('draft.title')}>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">{t('draft.goals')}</legend>
        {goals.fields.map((f, i) => (
          <div key={f.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <FormField label={t('draft.goalTitle')} error={fe(formState.errors.goals?.[i]?.title)} required><Input {...register(`goals.${i}.title`)} /></FormField>
            <FormField label={t('draft.goalMeasure')}><Input {...register(`goals.${i}.measure`)} /></FormField>
            <Button type="button" variant="ghost" size="icon" aria-label={t('removeRow')} disabled={goals.fields.length === 1} onClick={() => goals.remove(i)}><Trash2 aria-hidden="true" /></Button>
          </div>
        ))}
        <p role={formState.errors.goals?.root ? 'alert' : undefined} className="text-sm text-red-700">{topErr(formState.errors.goals?.root ?? formState.errors.goals)}</p>
        <Button type="button" variant="secondary" size="sm" leadingIcon={<Plus aria-hidden="true" />} onClick={() => goals.append({ title: '', measure: '' })}>{t('draft.addGoal')}</Button>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">{t('draft.measures')}</legend>
        {measures.fields.map((f, i) => (
          <div key={f.id} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <FormField label={t('draft.measure')} error={fe(formState.errors.measures?.[i]?.text)} required><Input {...register(`measures.${i}.text`)} /></FormField>
            <Button type="button" variant="ghost" size="icon" aria-label={t('removeRow')} disabled={measures.fields.length === 1} onClick={() => measures.remove(i)}><Trash2 aria-hidden="true" /></Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" leadingIcon={<Plus aria-hidden="true" />} onClick={() => measures.append({ text: '' })}>{t('draft.addMeasure')}</Button>
      </fieldset>
      <FormField label={t('draft.duration')} hint={t('draft.durationHint')} error={fe(formState.errors.durationDays)} className="max-w-xs" required>
        <Input type="number" inputMode="numeric" {...register('durationDays', { valueAsNumber: true })} />
      </FormField>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">{t('draft.checkpoints')}</legend>
        {cps.fields.map((f, i) => (
          <div key={f.id} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <FormField label={t('draft.cpDate')} error={fe(formState.errors.checkpoints?.[i]?.dueDate)} required><Input type="date" {...register(`checkpoints.${i}.dueDate`)} /></FormField>
            <FormField label={t('draft.cpTitle')} error={fe(formState.errors.checkpoints?.[i]?.title)} required><Input {...register(`checkpoints.${i}.title`)} /></FormField>
            <Button type="button" variant="ghost" size="icon" aria-label={t('removeRow')} disabled={cps.fields.length === 1} onClick={() => cps.remove(i)}><Trash2 aria-hidden="true" /></Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" leadingIcon={<Plus aria-hidden="true" />} onClick={() => cps.append({ dueDate: '', title: '' })}>{t('draft.addCheckpoint')}</Button>
      </fieldset>
      <MutationAlert error={save.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{t('cancel')}</Button>
        <Button type="submit" loading={save.isPending}>{t('draft.save')}</Button>
      </div>
    </form>
  );
}
