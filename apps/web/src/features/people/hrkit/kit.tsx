'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Dialog, DialogContent, useToast } from '@salesos/ui';
import { api } from '@/lib/api/client';
import { useApiErrorMessage } from '@/hooks/use-api-error';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

/** Locale-aware formatters. Money is formatted from the API string; nothing is computed client-side. */
export function useFmt(timeZone = 'Asia/Kolkata') {
  const locale = useLocale();
  return React.useMemo(() => {
    const loc = locale === 'en' ? 'en-IN' : locale;
    const date = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone: 'UTC' });
    const dateTime = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short', timeZone });
    return {
      date: (d?: string | null) => (d ? date.format(new Date(d.length === 10 ? `${d}T00:00:00Z` : d)) : '—'),
      dateTime: (d?: string | null) => (d ? dateTime.format(new Date(d)) : '—'),
      money: (amount?: string | number | null, currency = 'INR') =>
        amount === null || amount === undefined || amount === ''
          ? '—'
          : new Intl.NumberFormat(loc, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount)),
    };
  }, [locale, timeZone]);
}

type Method = 'post' | 'patch' | 'put' | 'delete';

/** Generic mutation: calls the API, invalidates every ['people'] query, never claims success on failure. */
export function useApiMutation<V, R = unknown>(method: Method, path: (v: V) => string, body?: (v: V) => unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V) => {
      const p = path(v);
      const b = body ? body(v) : v;
      const r = method === 'delete' ? await api.delete<R>(p) : await api[method]<R>(p, b);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

/** Confirmation dialog for irreversible / audited actions. Mount the body only while open. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  pending,
  error,
  children,
  disabled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  pending?: boolean;
  error?: unknown;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={title}
          description={description}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button variant={danger ? 'danger' : 'primary'} loading={pending} disabled={disabled} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </>
          }
        >
          {children}
          {error ? (
            <Alert tone="danger" className="mt-3">
              {apiErr(error).message}
            </Alert>
          ) : null}
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Shared toast helper: `done('Saved')`. */
export function useDone() {
  const { toast } = useToast();
  return (title: string) => toast({ title, tone: 'success' });
}

export const numStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? v.trim() : undefined);

/** First/last day (YYYY-MM-DD) of a `YYYY-MM` month value. */
export function monthRange(ym: string): { periodStart: string; periodEnd: string } {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { periodStart: `${y}-${mm}-01`, periodEnd: `${y}-${mm}-${String(end).padStart(2, '0')}` };
}
