'use client';
import { useTranslations } from 'next-intl';
import { TasksPage } from '@/features/crm/task-pages';

/** `/m/calls`: the existing follow-up / calls queue under a mobile title. Permission guard lives in TasksPage. */
export function MobileCallsPage() {
  const t = useTranslations('mobileShell');
  return (
    <>
      <h1 className="mb-3 text-xl font-semibold text-ink">{t('callsTitle')}</h1>
      <TasksPage />
    </>
  );
}
