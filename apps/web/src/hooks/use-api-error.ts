'use client';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/client';

/** Turn any thrown value into a user-safe, translated message (never leaks internals). */
export function useApiErrorMessage() {
  const t = useTranslations('errors');
  return (e: unknown): { message: string; requestId?: string } => {
    if (e instanceof ApiError) {
      if (e.code === 'OFFLINE') return { message: t('offline') };
      if (e.isNetwork) return { message: t('network') };
      if (e.status === 401) return { message: t('unauthorized'), requestId: e.requestId };
      if (e.status === 403) return { message: t('forbidden'), requestId: e.requestId };
      if (e.status === 404) return { message: t('notFound'), requestId: e.requestId };
      if (e.status === 409) return { message: e.message || t('conflict'), requestId: e.requestId };
      if (e.status === 422 || e.status === 400)
        return { message: e.message || t('validation'), requestId: e.requestId };
      if (e.status === 429) return { message: t('rateLimited'), requestId: e.requestId };
      return { message: t('server'), requestId: e.requestId };
    }
    return { message: t('generic') };
  };
}
