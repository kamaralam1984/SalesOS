'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { UseQueryResult } from '@tanstack/react-query';
import { AccentLine, ErrorState, PermissionDenied, Skeleton } from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ApiError } from '@/lib/api/client';

/** Dashboard-level states: loading skeleton, permission denied (403), error with retry, success. */
export function QueryBoundary<T>({ q, children }: { q: Pick<UseQueryResult<T>, 'isPending' | 'isError' | 'error' | 'data' | 'refetch' | 'isFetching'>; children: (d: T, fetching: boolean) => React.ReactNode }) {
  const tc = useTranslations('common');
  const td = useTranslations('denied');
  const err = useApiErrorMessage();
  if (q.isPending) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">{tc('loading')}</span>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 403) return <PermissionDenied title={td('title')} description={td('description')} />;
    const e = err(q.error);
    return <ErrorState description={e.message} requestId={e.requestId} onRetry={() => void q.refetch()} />;
  }
  return <>{children(q.data as T, q.isFetching)}</>;
}

export function Section({ title, description, children, id, info }: { title: string; description?: string; children: React.ReactNode; id?: string; info?: React.ReactNode }) {
  const hid = React.useId();
  return (
    <section aria-labelledby={hid} className="enter-up mt-8 first:mt-0" id={id}>
      <div className="flex items-center gap-1.5">
        <h2 id={hid} className="font-display text-xl font-semibold text-ink">
          {title}
        </h2>
        {info}
      </div>
      <AccentLine tone="gold" className="mt-1.5 mb-1 max-w-12" />
      {description && <p className="mt-0.5 mb-3 text-sm text-muted">{description}</p>}
      {!description && <div className="mb-3" />}
      {children}
    </section>
  );
}
