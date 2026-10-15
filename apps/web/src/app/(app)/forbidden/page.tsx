'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, PermissionDenied } from '@salesos/ui';

/** Destination for explicit 403 redirects. Inline guards use <RequirePermission> instead. */
export default function ForbiddenPage() {
  const t = useTranslations('denied');
  return (
    <PermissionDenied
      title={t('title')}
      description={t('description')}
      action={
        <Button asChild variant="secondary" className="sheen">
          <Link href="/">{t('home')}</Link>
        </Button>
      }
    />
  );
}
