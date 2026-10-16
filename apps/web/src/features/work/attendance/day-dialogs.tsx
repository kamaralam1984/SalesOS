'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, FormField, Input, Textarea } from '@salesos/ui';
import { MutationAlert } from '@/features/people/hub/shared';

const PRESETS = [0, 25, 50, 75, 100] as const;

/** After the check-in cutoff a person can still check in, but must say why (HR and the Boss are told every day). */
export function LateJoinDialog({ open, onOpenChange, onSubmit, pending, error, lateBy }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (reason: string) => void; pending: boolean; error: unknown; lateBy?: string;
}) {
  const t = useTranslations('workAttendance');
  const tc = useTranslations('common');
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const bad = reason.trim().length < 3;
  const formId = React.useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('lateJoin.title')}
        description={lateBy ? t('lateJoin.descriptionLate', { duration: lateBy }) : t('lateJoin.description')}
        closeLabel={tc('close')}
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button><Button type="submit" form={formId} loading={pending}>{t('lateJoin.submit')}</Button></>}
      >
        <form id={formId} noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!bad) onSubmit(reason.trim()); }}>
          <FormField label={t('lateJoin.reason')} error={touched && bad ? t('lateJoin.reasonShort') : undefined} required>
            <Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <MutationAlert error={error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Before check-out: how much of today's work is done (0-100) and, when not everything, what is still pending. HR gets this every day. */
export function DayReportDialog({ open, onOpenChange, onSubmit, pending, error }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (v: { dayReportPct: number; dayReportNote?: string }) => void; pending: boolean; error: unknown;
}) {
  const t = useTranslations('workAttendance');
  const tc = useTranslations('common');
  const [pct, setPct] = React.useState('');
  const [note, setNote] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const n = pct.trim() === '' ? NaN : Number(pct);
  const pctBad = !Number.isInteger(n) || n < 0 || n > 100;
  const noteBad = !pctBad && n < 100 && note.trim().length < 3;
  const formId = React.useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('dayReport.title')}
        description={t('dayReport.description')}
        closeLabel={tc('close')}
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button><Button type="submit" form={formId} loading={pending}>{t('dayReport.submit')}</Button></>}
      >
        <form
          id={formId}
          noValidate
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!pctBad && !noteBad) onSubmit({ dayReportPct: n, ...(note.trim() ? { dayReportNote: note.trim() } : {}) }); }}
        >
          <FormField label={t('dayReport.pct')} hint={t('dayReport.pctHint')} error={touched && pctBad ? t('dayReport.pctBad') : undefined} required>
            <Input inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} />
          </FormField>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('dayReport.quick')}>
            {PRESETS.map((p) => <Button key={p} type="button" size="sm" variant={pct === String(p) ? 'primary' : 'secondary'} onClick={() => setPct(String(p))}>{p}%</Button>)}
          </div>
          <FormField label={t('dayReport.note')} error={touched && noteBad ? t('dayReport.noteBad') : undefined}>
            <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <MutationAlert error={error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
