'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader, PermissionDenied } from '@salesos/ui';
import { adminNav } from '@/nav/admin';
import { useAuth } from '@/features/auth/auth-provider';
import { HubTile, accentAt } from '@/features/reporting/hub-tile';

export function AdminIndex() {
  const t = useTranslations('nav');
  const ta = useTranslations('admin');
  const { can } = useAuth();
  const items = adminNav.items.filter((i) => can(i.permission, i.minScope));
  if (items.length === 0) return <PermissionDenied />;
  return (
    <>
      <PageHeader eyebrow={ta('eyebrow')} title={t('admin')} description={ta('indexDescription')} />
      <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i, idx) => {
          const Icon = i.icon;
          return (
            <li key={i.id}>
              <HubTile href={i.href} accent={accentAt(idx)} icon={<Icon />} title={t(i.labelKey)} body={ta(`cards.${i.labelKey}`)} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
