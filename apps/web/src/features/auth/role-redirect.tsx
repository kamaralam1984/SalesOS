'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@salesos/ui';
import { useAuth } from './auth-provider';
import { landingPathFor } from './roles';

/** Sends the signed-in user to their role's dashboard. Used by `/` and `/dashboard`. */
export function RoleRedirect() {
  const { user, permissions } = useAuth();
  const router = useRouter();
  const t = useTranslations('common');
  React.useEffect(() => {
    if (user) router.replace(landingPathFor(user.roles, permissions));
  }, [user, permissions, router]);
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}
