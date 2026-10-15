'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { PermissionDenied } from '@salesos/ui';
import type { ScopeLevel } from '@/lib/api/types';
import { useAuth } from './auth-provider';

/** Page-level guard: shows the standard permission-denied state. The API still enforces. */
export function RequirePermission({
  permission,
  minScope,
  children,
}: {
  permission: string | readonly string[];
  /** Require at least this scope (e.g. `team`) so own-scope grants do not open admin screens. */
  minScope?: ScopeLevel;
  children: React.ReactNode;
}) {
  const { can } = useAuth();
  const t = useTranslations('denied');
  if (!can(permission, minScope)) {
    return <PermissionDenied headingLevel={1} title={t('title')} description={t('description')} />;
  }
  return <>{children}</>;
}
