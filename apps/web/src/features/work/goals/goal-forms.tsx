'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, FormField, Input, Select, Textarea, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { MutationAlert, useFormErrors } from '@/features/people/hub/shared';
import { useTeamMemberOptions } from '@/features/people/common/api';
import { useCreateGoal, useUpdateGoal, type GoalDetail } from '@/lib/api/hooks/work-goals';

const num = z.string().trim().refine((v) => v === '' || /^\d{1,12}(\.\d{1,2})?$/.test(v), 'badNumber');
const day = z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'required');

const createSchema = z
  .object({
    title: z.string().trim().min(3, 'titleShort').max(200, 'tooLong'),
    description: z.string().trim().max(4000, 'tooLong'),
    ownerId: z.string(),
    startDate: day,
    targetDate: day,
    targetValue: num,
    unit: z.string().trim().max(30, 'tooLong'),
  })
  .refine((v) => !v.startDate || !v.targetDate || v.targetDate >= v.startDate, { message: 'dateOrder', path: ['targetDate'] });
type CreateValues = z.infer<typeof createSchema>;

/** Default goal cycle: 45 days counting the start day, like the server default (start + 44). */
const DEFAULT_CYCLE_DAYS = 45;
export function defaultTargetDay(start: string, cycleDays = DEFAULT_CYCLE_DAYS): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return '';
  const d = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + cycleDays - 1);
  return d.toISOString().slice(0, 10);
}

export function CreateGoalDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const t = useTranslations('workGoals');
  const tc = useTranslations('common');
  const fe = useFormErrors('workGoals');
  const { can, user } = useAuth();
  const { toast } = useToast();
  const assign = can('goals:create', 'team');
  const people = useTeamMemberOptions(assign);
  const create = useCreateGoal();
  const { register, handleSubmit, formState, setValue, getFieldState } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { title: '', description: '', ownerId: '', startDate: '', targetDate: '', targetValue: '', unit: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      const res = await create.mutateAsync({
        title: v.title.trim(),
        ...(v.description.trim() ? { description: v.description.trim() } : {}),
        ...(v.ownerId && v.ownerId !== user?.id ? { ownerId: v.ownerId } : {}),
        ...(v.startDate ? { startDate: v.startDate } : {}),
        ...(v.targetDate ? { targetDate: v.targetDate } : {}),
        ...(v.targetValue.trim() ? { targetValue: v.targetValue.trim() } : {}),
        ...(v.unit.trim() ? { unit: v.unit.trim() } : {}),
      });
      toast({ tone: 'success', title: t('create.created') });
      onCreated(res.id);
    } catch {
      /* shown in the dialog */
    }
  });
  const formId = React.useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('create.title')}
        description={t('create.description')}
        size="lg"
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
            <Button type="submit" form={formId} loading={create.isPending}>{t('create.submit')}</Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('create.title')}>
          <FormField label={t('create.name')} error={fe(formState.errors.title)} required><Input {...register('title')} autoComplete="off" /></FormField>
          <FormField label={t('create.details')} error={fe(formState.errors.description)}><Textarea rows={3} {...register('description')} /></FormField>
          {assign && (
            <FormField label={t('create.owner')}>
              <Select {...register('ownerId')}>
                <option value="">{t('create.ownerSelf')}</option>
                {(people.data ?? []).filter((p) => p.id !== user?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('create.startDate')} error={fe(formState.errors.startDate)}><Input type="date" {...register('startDate', { onChange: (e: React.ChangeEvent<HTMLInputElement>) => { if (!getFieldState('targetDate', formState).isDirty) setValue('targetDate', defaultTargetDay(e.target.value)); } })} /></FormField>
            <FormField label={t('create.targetDate')} hint={t('create.targetHint')} error={fe(formState.errors.targetDate)}><Input type="date" {...register('targetDate')} /></FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('create.targetValue')} hint={t('create.targetValueHint')} error={fe(formState.errors.targetValue)}><Input inputMode="decimal" {...register('targetValue')} /></FormField>
            <FormField label={t('create.unit')} hint={t('create.unitHint')} error={fe(formState.errors.unit)}><Input {...register('unit')} /></FormField>
          </div>
          <MutationAlert error={create.error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const editSchema = z.object({
  title: z.string().trim().min(3, 'titleShort').max(200, 'tooLong'),
  description: z.string().trim().max(4000, 'tooLong'),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'required'),
  targetValue: num,
  unit: z.string().trim().max(30, 'tooLong'),
});
type EditValues = z.infer<typeof editSchema>;

export function EditGoalDialog({ goal, open, onOpenChange }: { goal: GoalDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('workGoals');
  const tc = useTranslations('common');
  const fe = useFormErrors('workGoals');
  const { toast } = useToast();
  const update = useUpdateGoal(goal.id);
  const { register, handleSubmit, formState, setError } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { title: goal.title, description: goal.description ?? '', targetDate: goal.targetDate, targetValue: goal.targetValue ?? '', unit: goal.unit ?? '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    if (v.targetDate < goal.startDate) {
      setError('targetDate', { message: 'dateOrder' });
      return;
    }
    try {
      await update.mutateAsync({
        version: goal.version,
        title: v.title.trim(),
        description: v.description.trim() || null,
        targetDate: v.targetDate,
        targetValue: v.targetValue.trim() || null,
        unit: v.unit.trim() || null,
      });
      toast({ tone: 'success', title: t('saved') });
      onOpenChange(false);
    } catch {
      /* shown in the dialog */
    }
  });
  const formId = React.useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('editTitle')}
        description={t('editDescription')}
        size="lg"
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
            <Button type="submit" form={formId} loading={update.isPending}>{tc('save')}</Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('editTitle')}>
          <FormField label={t('create.name')} error={fe(formState.errors.title)} required><Input {...register('title')} /></FormField>
          <FormField label={t('create.details')} error={fe(formState.errors.description)}><Textarea rows={3} {...register('description')} /></FormField>
          <FormField label={t('create.targetDate')} error={fe(formState.errors.targetDate)} required><Input type="date" min={goal.startDate} {...register('targetDate')} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('create.targetValue')} error={fe(formState.errors.targetValue)}><Input inputMode="decimal" {...register('targetValue')} /></FormField>
            <FormField label={t('create.unit')} error={fe(formState.errors.unit)}><Input {...register('unit')} /></FormField>
          </div>
          <MutationAlert error={update.error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
