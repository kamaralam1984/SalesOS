'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardCheck, FileText, Flame, LifeBuoy, ListChecks, MessageSquareHeart, RotateCcw, Siren, Star } from 'lucide-react';
import { PageHeader } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { HubTile, accentAt } from '@/features/reporting/hub-tile';
import { RequirePermission } from '@/features/auth/require-permission';
import { ck, useList, type ActionItem, type Complaint, type Handover } from './api';

interface Tile { id: string; href: string; icon: React.ReactNode; permission: string; countKey?: 'complaints' | 'handovers' | 'actionItems' }

const TILES: Tile[] = [
  { id: 'complaints', href: '/cx/complaints', icon: <LifeBuoy />, permission: 'complaints:view', countKey: 'complaints' },
  { id: 'escalations', href: '/cx/escalations', icon: <Flame />, permission: 'complaints:view' },
  { id: 'relationships', href: '/cx/relationships', icon: <Star />, permission: 'relationships:view' },
  { id: 'satisfaction', href: '/cx/satisfaction', icon: <MessageSquareHeart />, permission: 'satisfaction:view' },
  { id: 'refunds', href: '/cx/refunds', icon: <RotateCcw />, permission: 'refunds:view' },
  { id: 'handovers', href: '/cx/handovers', icon: <ClipboardCheck />, permission: 'handover:view', countKey: 'handovers' },
  { id: 'reports', href: '/cx/founder-reports', icon: <FileText />, permission: 'founder-reports:view' },
  { id: 'actionItems', href: '/cx/action-items', icon: <ListChecks />, permission: 'action-items:view', countKey: 'actionItems' },
  { id: 'risks', href: '/cx/risks', icon: <Siren />, permission: 'founder-reports:view' },
];

export function CxHubPage() {
  return (
    <RequirePermission permission={['complaints:view', 'handover:view', 'founder-reports:view', 'action-items:view', 'satisfaction:view', 'relationships:view']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('cx');
  const { can } = useAuth();
  const complaints = useList<Complaint>(ck('hub', 'complaints'), '/cx/complaints', { open: true, limit: 100 }, can('complaints:view'));
  const handovers = useList<Handover>(ck('hub', 'handovers'), '/handovers', { pending: true, limit: 100 }, can('handover:view'));
  const items = useList<ActionItem>(ck('hub', 'items'), '/action-items', { mine: true, open: true, limit: 100 }, can('action-items:view'));
  const counts = { complaints: complaints, handovers, actionItems: items };
  const visible = TILES.filter((x) => can(x.permission));
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('hub.title')} description={t('hub.description')} />
      <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('hub.title')}>
        {visible.map((x, idx) => {
          const c = x.countKey ? counts[x.countKey] : null;
          const n = c?.data ? (c.data.pagination?.hasMore ? `${c.data.items.length}+` : String(c.data.items.length)) : null;
          return (
            <li key={x.id}>
              <HubTile
                href={x.href}
                accent={accentAt(idx)}
                icon={x.icon}
                title={t(`hub.${x.id}.title` as never)}
                body={t(`hub.${x.id}.hint` as never)}
                extra={c && <span className="kpi-number mt-1.5 block text-sm font-medium text-ink-700">{c.isError ? t('common.loadFailed') : n === null ? '…' : t(`hub.${x.id}.count` as never, { n } as never)}</span>}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
