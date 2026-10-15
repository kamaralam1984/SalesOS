'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Dialog, DialogContent, FormField, Input, Textarea, useToast } from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';

/** Runs a mutation, surfaces the API error inside the dialog (never claims success on failure), toasts on success. */
export function useSubmit(onDone: () => void, successTitle?: string) {
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const run = React.useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      setPending(true);
      try {
        await fn();
        if (successTitle) toast({ tone: 'success', title: successTitle });
        onDone();
      } catch (e) {
        setError(apiErr(e).message);
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onDone, successTitle],
  );
  return { run, error, pending, setError };
}

/** Money text field: shows the INR prefix, validates 2-decimals; the value stays a STRING. */
export function MoneyInput({ value, onChange, id, invalid, disabled, placeholder }: { value: string; onChange: (v: string) => void; id?: string; invalid?: boolean; disabled?: boolean; placeholder?: string }) {
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted">
        INR
      </span>
      <Input id={id} inputMode="decimal" autoComplete="off" className="pl-12 tabular" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} aria-invalid={invalid || undefined} disabled={disabled} placeholder={placeholder ?? '0.00'} />
    </div>
  );
}

/** One required free-text reason + submit. Used for escalate/resolve/reopen/reject/cancel/withdraw/reverse flows. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  submitLabel,
  successTitle,
  minLength = 3,
  danger,
  extra,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  label: string;
  submitLabel: string;
  successTitle?: string;
  minLength?: number;
  danger?: boolean;
  extra?: React.ReactNode;
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ReasonBody {...{ onOpenChange, title, description, label, submitLabel, successTitle, minLength, danger, extra, onSubmit }} />}
    </Dialog>
  );
}

function ReasonBody({ onOpenChange, title, description, label, submitLabel, successTitle, minLength, danger, extra, onSubmit }: Omit<React.ComponentProps<typeof ReasonDialog>, 'open'>) {
  const tc = useTranslations('common');
  const t = useTranslations('revenue.common');
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(close, successTitle);
  const tooShort = reason.trim().length < (minLength ?? 3);
  return (
    <DialogContent
      size="md"
      title={title}
      description={description}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{tc('cancel')}</Button>
          <Button type="submit" form="reason-form" variant={danger ? 'danger' : 'primary'} loading={pending} loadingLabel={tc('saving')}>{submitLabel}</Button>
        </>
      }
    >
      <form
        id="reason-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (tooShort) return;
          void run(() => onSubmit(reason.trim()));
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        {extra}
        <FormField label={label} required error={touched && tooShort ? t('reasonMin', { count: minLength ?? 3 }) : undefined}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </FormField>
      </form>
    </DialogContent>
  );
}
