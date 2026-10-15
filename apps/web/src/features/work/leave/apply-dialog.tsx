'use client';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Alert, Button, Checkbox, Dialog, DialogContent, FormField, Input, Select, Textarea, useToast } from '@salesos/ui';
import { MutationAlert, useFormErrors } from '@/features/people/hub/shared';
import { useApplyLeave, useLeaveTypes, type HalfDay } from '@/lib/api/hooks/work-leave';
import { isSingleDay, trimDays, unpaidPrompt } from './leave-logic';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'required');
const schema = z
  .object({ typeKey: z.string().min(1, 'required'), startDate: day, endDate: day, halfDay: z.enum(['NONE', 'FIRST_HALF', 'SECOND_HALF']), reason: z.string().trim().min(3, 'reasonShort').max(500, 'tooLong') })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'dateOrder' })
  .refine((v) => v.halfDay === 'NONE' || v.startDate === v.endDate, { path: ['halfDay'], message: 'halfDaySingle' });
type Values = z.infer<typeof schema>;

export function ApplyLeaveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('workLeave');
  const tc = useTranslations('common');
  const fe = useFormErrors('workLeave');
  const { toast } = useToast();
  const types = useLeaveTypes();
  const apply = useApplyLeave();
  const [confirmed, setConfirmed] = React.useState(false);
  const { register, handleSubmit, formState, control } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { typeKey: '', startDate: '', endDate: '', halfDay: 'NONE', reason: '' },
  });
  const prompt = unpaidPrompt(apply.error);
  const [startDate, endDate] = useWatch({ control, name: ['startDate', 'endDate'] });
  const single = isSingleDay(startDate, endDate);
  const formId = React.useId();
  const submit = handleSubmit(async (v) => {
    try {
      const r = await apply.mutateAsync({ ...v, halfDay: v.halfDay as HalfDay, confirmUnpaid: confirmed });
      toast({ tone: 'success', title: t('apply.submitted', { days: trimDays(r.days) }) });
      onOpenChange(false);
    } catch {
      /* the 409 prompt or the error is shown in the dialog */
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('apply.title')}
        description={t('apply.description')}
        size="lg"
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
            <Button type="submit" form={formId} loading={apply.isPending} disabled={Boolean(prompt) && !confirmed}>{t('apply.submit')}</Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} noValidate className="space-y-4" aria-label={t('apply.title')}>
          <FormField label={t('apply.type')} error={fe(formState.errors.typeKey)} required>
            <Select {...register('typeKey')}>
              <option value="">{t('apply.typePrompt')}</option>
              {(types.data ?? []).map((x) => <option key={x.key} value={x.key}>{x.name}{x.isPaid ? '' : ` (${t('apply.unpaid')})`}</option>)}
            </Select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('apply.start')} error={fe(formState.errors.startDate)} required><Input type="date" {...register('startDate')} /></FormField>
            <FormField label={t('apply.end')} error={fe(formState.errors.endDate)} required><Input type="date" {...register('endDate')} /></FormField>
          </div>
          <FormField label={t('apply.half')} hint={single ? undefined : t('apply.halfHint')} error={fe(formState.errors.halfDay)}>
            <Select {...register('halfDay')} disabled={!single}>
              {(['NONE', 'FIRST_HALF', 'SECOND_HALF'] as const).map((h) => <option key={h} value={h}>{t(`halfDay.${h}` as never)}</option>)}
            </Select>
          </FormField>
          <FormField label={t('apply.reason')} error={fe(formState.errors.reason)} required><Textarea rows={3} {...register('reason')} /></FormField>
          {prompt && (
            <Alert tone="warning" title={t('apply.unpaidTitle')}>
              <p>{t('apply.unpaidBody', { shortfall: trimDays(prompt.shortfall), available: trimDays(prompt.available) })}</p>
              <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} label={t('apply.unpaidConfirm', { n: trimDays(prompt.shortfall) })} />
            </Alert>
          )}
          {!prompt && <MutationAlert error={apply.error} />}
        </form>
      </DialogContent>
    </Dialog>
  );
}
