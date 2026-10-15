'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Dialog, DialogContent, EmptyState, ErrorState, Skeleton, LoadingRegion } from '@salesos/ui';
import { ShieldAlert } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/hooks/use-api-error';

/** Date helpers in the org timezone (Asia/Kolkata). Accepts ISO timestamps or YYYY-MM-DD. */
export function useFormatDate(timeZone = 'Asia/Kolkata') {
  const locale = useLocale();
  return React.useMemo(() => {
    const loc = locale === 'en' ? 'en-IN' : locale;
    const d = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone: 'UTC' });
    const dt = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short', timeZone });
    return {
      date: (v?: string | null) => (v ? d.format(new Date(v.length === 10 ? `${v}T00:00:00Z` : v)) : '—'),
      dateTime: (v?: string | null) => (v ? dt.format(new Date(v)) : '—'),
    };
  }, [locale, timeZone]);
}

interface QueryLike {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** Loading / error / empty / content in one place. Permission-denied (403) is shown as its own state. */
export function QueryState({
  query,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  children,
}: {
  query: QueryLike;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('common');
  const apiErr = useApiErrorMessage();
  if (query.isLoading) {
    return (
      <LoadingRegion label={t('loading')} className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </LoadingRegion>
    );
  }
  if (query.isError) {
    const e = query.error;
    const m = apiErr(e);
    return (
      <ErrorState
        title={e instanceof ApiError && e.isForbidden ? m.message : undefined}
        description={m.message}
        requestId={m.requestId}
        onRetry={() => void query.refetch()}
        retryLabel={t('retry')}
      />
    );
  }
  if (isEmpty) return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  return <>{children}</>;
}

/** Shows a failed mutation inline (never claims success). */
export function MutationAlert({ error }: { error: unknown }) {
  const apiErr = useApiErrorMessage();
  if (!error) return null;
  const m = apiErr(error);
  return (
    <Alert tone="danger">
      {m.message}
      {m.requestId ? <span className="mt-1 block text-xs opacity-80">#{m.requestId}</span> : null}
    </Alert>
  );
}

/** Banner for sensitive HR data (PIPs, reviews). */
export function RestrictedBanner({ children }: { children?: React.ReactNode }) {
  const t = useTranslations('peopleHub');
  return (
    <Alert tone="warning" title={t('restrictedTitle')} className="mb-4">
      <span className="inline-flex items-start gap-1.5">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{children ?? t('restrictedBody')}</span>
      </span>
    </Alert>
  );
}

/** Generic confirm dialog for irreversible or audited actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  pending,
  error,
  onConfirm,
  disabled,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  error?: unknown;
  disabled?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        closeLabel={t('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button variant={danger ? 'danger' : 'primary'} loading={pending} disabled={disabled} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {children}
          <MutationAlert error={error} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const initials = (name?: string | null) => (name ?? '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/** Translate form error codes: `validation.<code>` first, then `<ns>.errors.<code>`, else the raw message. */
export function useFormErrors(ns: string) {
  const t = useTranslations(ns);
  const tv = useTranslations('validation');
  return (err?: { message?: unknown } | null): string | undefined => {
    const m = err?.message;
    if (typeof m !== 'string' || !m) return undefined;
    if (tv.has(m as never)) return tv(m as never);
    return t.has(`errors.${m}` as never) ? t(`errors.${m}` as never) : m;
  };
}

/** Set of tones for status badges by name. */
export const toneFor = (s: string): 'neutral' | 'gold' | 'red' | 'blue' | 'green' => {
  if (['DONE', 'APPROVED', 'ACKNOWLEDGED', 'COMPLETED_SUCCESS', 'ACTIVE', 'HELD', 'COMPLETED'].includes(s)) return 'green';
  if (['SUBMITTED', 'PENDING_APPROVAL', 'IN_PROGRESS', 'EXTENDED', 'SCHEDULED'].includes(s)) return 'gold';
  if (['COMPLETED_NOT_IMPROVED', 'CANCELLED', 'MISSED'].includes(s)) return 'red';
  if (['OPEN', 'PENDING'].includes(s)) return 'blue';
  return 'neutral';
};
