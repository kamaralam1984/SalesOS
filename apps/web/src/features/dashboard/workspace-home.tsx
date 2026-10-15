'use client';
import { useTranslations } from 'next-intl';
import { EmptyState, PageHeader } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { HubTile, accentAt } from '@/features/reporting/hub-tile';
import { visibleNavSections } from '@/nav/registry';

/**
 * `/dashboard` for roles without a sales dashboard of their own (HR, Finance, Marketing, ...).
 * Shortcut tiles only: no KPI data, and nothing the role may not already open from the sidebar.
 */
export function WorkspaceHome() {
  const t = useTranslations('workspaceHome');
  const tn = useTranslations('nav');
  const { user, can } = useAuth();
  const items = visibleNavSections(can)
    .flatMap((s) => s.items.map((item) => ({ item, sectionKey: s.sectionKey })))
    .filter(({ item }) => item.href !== '/dashboard');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title', { name: user?.name ?? '' })} description={t('description')} />
      {items.length === 0 ? (
        <EmptyState title={t('noneTitle')} description={t('noneBody')} />
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map(({ item, sectionKey }, i) => (
            <li key={item.id}>
              <HubTile
                href={item.href}
                accent={accentAt(i)}
                icon={<item.icon />}
                title={tn(item.labelKey as never)}
                body={tn(`sections.${sectionKey}` as never)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
