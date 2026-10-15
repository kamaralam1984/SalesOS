'use client';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { FilesWidget } from './files-widget';

/** "My files": the signed-in user's uploads (the API scopes the list; other people's files never appear). */
export function MyFilesPage() {
  const t = useTranslations('platform.myFiles');
  return (
    <RequirePermission permission="files:view">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <div className="enter-up max-w-3xl">
        <FilesWidget purpose="general" />
      </div>
    </RequirePermission>
  );
}
