'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Hammer } from 'lucide-react';
import { Badge, Card, EmptyState, PageHeader } from '@salesos/ui';
import { allNavItems } from '@/nav/registry';
import { RequirePermission } from '@/features/auth/require-permission';

/**
 * Honest placeholder for modules that are not built yet. No fake numbers, no demo rows.
 * The owning phase replaces the page.tsx that renders this component.
 */
export function ModulePlaceholder({ navId, phase }: { navId: string; phase: number }) {
  const t = useTranslations('nav');
  const tm = useTranslations('modulePlaceholder');
  const item = allNavItems().find((i) => i.id === navId);
  const title = t(item?.labelKey ?? navId);
  const body = (
    <>
      <PageHeader
        title={title}
        eyebrow={tm('eyebrow')}
        actions={<Badge tone="gold">{tm('phaseBadge', { phase })}</Badge>}
      />
      <Card accent="blue" padded={false} className="rounded-xl">
        <EmptyState
          icon={<Hammer />}
          title={tm('title', { module: title, phase })}
          description={tm('description', { phase })}
        />
      </Card>
    </>
  );
  return item?.permission ? (
    <RequirePermission permission={item.permission} minScope={item.minScope}>
      {body}
    </RequirePermission>
  ) : (
    body
  );
}
