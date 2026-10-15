'use client';
import { useTranslations } from 'next-intl';
import { EmptyState, PageHeader } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { HubTile, accentAt } from '@/features/reporting/hub-tile';
import { visibleSections } from './sections';

export function PeopleHubPage() {
  const t = useTranslations('peopleHub');
  const { can } = useAuth();
  const sections = visibleSections(can);
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {sections.length === 0 ? (
        <EmptyState title={t('noneTitle')} description={t('noneBody')} />
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((s, i) => (
            <li key={s.id}>
              <HubTile
                href={s.href}
                accent={accentAt(i)}
                icon={<s.icon />}
                title={t(`sections.${s.id}.title` as never)}
                body={t(`sections.${s.id}.body` as never)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
