'use client';
import { useTranslations } from 'next-intl';

/** Translate a react-hook-form error whose message is a `validation.*` key. */
export function useFieldError() {
  const t = useTranslations('validation');
  return (err?: { message?: unknown } | null): string | undefined => {
    const m = err?.message;
    if (typeof m !== 'string' || !m) return undefined;
    return t.has(m as never) ? t(m as never) : m;
  };
}
