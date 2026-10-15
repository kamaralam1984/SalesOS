'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { FormField, Input, Textarea, useToast } from '@salesos/ui';
import { ConfirmDialog, useFormErrors } from '../hub/shared';
import { usePipTransition } from './api';
import { buildTransition, type TransitionKind, type TransitionValues } from './pip-logic';

const FIELDS: Record<TransitionKind, Array<keyof TransitionValues>> = {
  PENDING_APPROVAL: [],
  EXTENDED: ['reason', 'newEndDate'],
  COMPLETED_SUCCESS: ['finalReview', 'evidence'],
  COMPLETED_NOT_IMPROVED: ['finalReview', 'recommendedAction', 'evidence'],
  CANCELLED: ['reason'],
};
const KEY: Record<TransitionKind, string> = { PENDING_APPROVAL: 'submit', EXTENDED: 'extend', COMPLETED_SUCCESS: 'success', COMPLETED_NOT_IMPROVED: 'notImproved', CANCELLED: 'cancel' };

/** One confirm dialog for every PIP transition; the audited, irreversible ones explain consequences first. */
export function TransitionDialog({ pipId, kind, onClose }: { pipId: string; kind: TransitionKind | null; onClose: () => void }) {
  const t = useTranslations('pips');
  const { toast } = useToast();
  const fe = useFormErrors('pips');
  const mut = usePipTransition(pipId);
  const [v, setV] = React.useState<TransitionValues>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const k = kind ?? 'PENDING_APPROVAL';
  const fields = FIELDS[k];
  const submit = async () => {
    const r = buildTransition(k, v);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    try {
      await mut.mutateAsync(r.body);
      toast({ tone: 'success', title: t(`tr.${KEY[k]}.done` as never) });
      setV({});
      onClose();
    } catch {
      /* shown in dialog */
    }
  };
  const err = (f: string) => (errors[f] ? fe({ message: errors[f] }) : undefined);
  const set = (f: keyof TransitionValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [f]: e.target.value }));
  return (
    <ConfirmDialog
      open={kind !== null}
      onOpenChange={(o) => { if (!o) { setErrors({}); mut.reset(); onClose(); } }}
      title={t(`tr.${KEY[k]}.title` as never)}
      description={t(`tr.${KEY[k]}.body` as never)}
      confirmLabel={t(`tr.${KEY[k]}.action` as never)}
      danger={k === 'CANCELLED' || k === 'COMPLETED_NOT_IMPROVED'}
      pending={mut.isPending}
      error={mut.error}
      onConfirm={() => void submit()}
    >
      {fields.includes('reason') && <FormField label={t('f.reason')} error={err('reason')} required><Textarea rows={3} value={v.reason ?? ''} onChange={set('reason')} /></FormField>}
      {fields.includes('newEndDate') && <FormField label={t('f.newEndDate')} error={err('newEndDate')} required><Input type="date" value={v.newEndDate ?? ''} onChange={set('newEndDate')} /></FormField>}
      {fields.includes('finalReview') && <FormField label={t('f.finalReview')} error={err('finalReview')} required><Textarea rows={4} value={v.finalReview ?? ''} onChange={set('finalReview')} /></FormField>}
      {fields.includes('recommendedAction') && <FormField label={t('f.recommendedAction')} hint={t('f.recommendedHint')} error={err('recommendedAction')} required><Textarea rows={2} value={v.recommendedAction ?? ''} onChange={set('recommendedAction')} /></FormField>}
      {fields.includes('evidence') && <FormField label={t('f.evidence')}><Textarea rows={3} value={v.evidence ?? ''} onChange={set('evidence')} /></FormField>}
      <p className="text-xs text-muted">{t('auditNote')}</p>
    </ConfirmDialog>
  );
}
