'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, FormField, Input, Select, Textarea, useToast } from '@salesos/ui';
import { MutationAlert, useFormErrors } from '@/features/people/hub/shared';
import { ATTENDANCE_STATUSES, useCorrectAttendance, type AttendanceDay, type AttendanceStatus } from '@/lib/api/hooks/work-attendance';
import { isoToIstLocal, istLocalToIso } from './attendance-logic';

const schema = z
  .object({
    status: z.enum(ATTENDANCE_STATUSES as unknown as [AttendanceStatus, ...AttendanceStatus[]]),
    checkIn: z.string(),
    checkOut: z.string(),
    reason: z.string().trim().min(5, 'reasonShort').max(500, 'tooLong'),
  })
  .refine((v) => !v.checkIn || !v.checkOut || v.checkOut > v.checkIn, { path: ['checkOut'], message: 'timeOrder' });
type Values = z.infer<typeof schema>;

/** HR / manager correction of one day. The server enforces scope, the correction window and keeps old/new value + reason. */
export function CorrectAttendanceDialog({ userId, userName, day, open, onOpenChange }: { userId: string; userName: string; day: AttendanceDay; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('workAttendance');
  const tc = useTranslations('common');
  const fe = useFormErrors('workAttendance');
  const { toast } = useToast();
  const correct = useCorrectAttendance();
  const rec = day.record;
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { status: rec?.status ?? 'PRESENT', checkIn: isoToIstLocal(rec?.checkInAt), checkOut: isoToIstLocal(rec?.checkOutAt), reason: '' },
  });
  const formId = React.useId();
  const submit = handleSubmit(async (v) => {
    try {
      await correct.mutateAsync({
        userId, date: day.date, status: v.status, reason: v.reason.trim(), checkInAt: istLocalToIso(v.checkIn), checkOutAt: istLocalToIso(v.checkOut), ...(rec ? { version: rec.version } : {}),
      });
      toast({ tone: 'success', title: t('correct.done') });
      onOpenChange(false);
    } catch {
      /* shown in the dialog */
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('correct.title', { name: userName, date: day.date })}
        description={t('correct.description')}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
            <Button type="submit" form={formId} loading={correct.isPending}>{t('correct.submit')}</Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} noValidate className="space-y-4" aria-label={t('correct.title', { name: userName, date: day.date })}>
          <FormField label={t('correct.status')} required>
            <Select {...register('status')}>{ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}</Select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('correct.checkIn')} hint={t('correct.timeHint')}><Input type="datetime-local" {...register('checkIn')} /></FormField>
            <FormField label={t('correct.checkOut')} error={fe(formState.errors.checkOut)}><Input type="datetime-local" {...register('checkOut')} /></FormField>
          </div>
          <FormField label={t('correct.reason')} hint={t('correct.reasonHint')} error={fe(formState.errors.reason)} required><Textarea rows={3} {...register('reason')} /></FormField>
          <MutationAlert error={correct.error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
