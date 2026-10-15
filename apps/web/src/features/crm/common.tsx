'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, Phone, Radio, RefreshCw } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Skeleton, StatusBadge, cn } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useCrmStream, type StreamMode } from '@/lib/api/hooks/crm-admin';
import { useLeadMeta, type Lead } from '@/lib/api/hooks/crm';
import { markPendingCall } from './pending-call';
import { PendingCallPrompt } from './pending-call-prompt';
import { humanize, toTel } from './lib';
import { Reveal } from './motion';

/* ---------------------------------------------------------------- formatting */
export function useCrmFormat() {
  const locale = useLocale();
  return React.useMemo(() => {
    const lc = locale === 'en' ? 'en-IN' : locale;
    const dt = new Intl.DateTimeFormat(lc, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    const day = new Intl.DateTimeFormat(lc, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
    const time = new Intl.DateTimeFormat(lc, { timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    const rel = new Intl.RelativeTimeFormat(lc, { numeric: 'auto' });
    return {
      dateTime: (iso?: string | null) => (iso ? dt.format(new Date(iso)) : '—'),
      day: (iso?: string | null) => (iso ? day.format(new Date(iso)) : '—'),
      time: (iso?: string | null) => (iso ? time.format(new Date(iso)) : '—'),
      /** "in 3 hours" / "2 days ago" */
      relative: (iso?: string | null, now = Date.now()) => {
        if (!iso) return '—';
        const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
        const abs = Math.abs(mins);
        if (abs < 60) return rel.format(mins, 'minute');
        if (abs < 60 * 36) return rel.format(Math.round(mins / 60), 'hour');
        return rel.format(Math.round(mins / 1440), 'day');
      },
    };
  }, [locale]);
}

/* ---------------------------------------------------------------- badges */
export function useStageLabel() {
  const meta = useLeadMeta();
  return React.useCallback((key: string) => meta.data?.stages.find((s) => s.key === key)?.label ?? humanize(key), [meta.data]);
}

export function StageBadge({ lead }: { lead: Pick<Lead, 'status' | 'stageCategory'> }) {
  const label = useStageLabel();
  const status = lead.stageCategory === 'WON' ? 'success' : lead.stageCategory === 'LOST' ? 'danger' : lead.stageCategory === 'NURTURE' ? 'pending' : 'info';
  return <StatusBadge status={status}>{label(lead.status)}</StatusBadge>;
}

export function InterestBadge({ level }: { level?: string | null }) {
  const t = useTranslations('crm.common');
  if (!level) return null;
  return <Badge tone={level === 'HIGH' ? 'gold' : level === 'MEDIUM' ? 'blue' : 'neutral'}>{t(`interest.${level}` as 'interest.HIGH')}</Badge>;
}

export function DueBadge({ iso, done }: { iso?: string | null; done?: boolean }) {
  const f = useCrmFormat();
  const t = useTranslations('crm.common');
  const [now] = React.useState(() => Date.now());
  if (!iso) return <span className="text-muted">{t('noNextAction')}</span>;
  const overdue = !done && new Date(iso).getTime() < now;
  return (
    <StatusBadge status={overdue ? 'overdue' : 'neutral'}>
      {overdue ? t('overdueBy', { when: f.relative(iso) }) : f.relative(iso)}
    </StatusBadge>
  );
}

/** `tel:` dial button. Manual calling only: the disposition form must follow (docs: no device permissions needed). */
export function CallButton({ leadId, phone, name, className, onClick, size = 'md' }: { leadId?: string; phone?: string | null; name: string; className?: string; onClick?: () => void; size?: 'sm' | 'md' | 'lg' }) {
  const t = useTranslations('crm.common');
  const href = toTel(phone);
  if (!href) return <span className="text-sm text-muted">{t('noPhone')}</span>;
  return (
    <Button asChild variant="gold" size={size} className={className}>
      <a
        href={href}
        onClick={() => {
          if (leadId) markPendingCall({ leadId, name, phone });
          onClick?.();
        }}
        aria-label={t('callLead', { name })}
      >
        <Phone className="size-4" aria-hidden="true" />
        <span>{t('call')}</span>
      </a>
    </Button>
  );
}

/* ---------------------------------------------------------------- five-state boundary */
export function DataState<T>({
  q,
  isEmpty,
  empty,
  children,
  skeleton,
}: {
  q: Pick<UseQueryResult<T>, 'isPending' | 'isError' | 'error' | 'data' | 'refetch'>;
  isEmpty?: (d: T) => boolean;
  empty: { title: string; description?: string; action?: React.ReactNode };
  children: (d: T) => React.ReactNode;
  skeleton?: React.ReactNode;
}) {
  const tc = useTranslations('common');
  const err = useApiErrorMessage();
  if (q.isPending) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">{tc('loading')}</span>
        {skeleton ?? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}
      </div>
    );
  }
  if (q.isError) {
    const e = err(q.error);
    return <ErrorState description={e.message} requestId={e.requestId} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />;
  }
  const data = q.data as T;
  if (isEmpty?.(data)) return <EmptyState title={empty.title} description={empty.description} action={empty.action} />;
  return <Reveal>{children(data)}</Reveal>;
}

/* ---------------------------------------------------------------- navigation inside the module */
interface SubItem {
  href: string;
  key: string;
  permission: string | string[];
  minScope?: 'own' | 'team' | 'org';
}
export const CRM_SUBNAV: SubItem[] = [
  { href: '/crm', key: 'crmToday', permission: 'leads:view' },
  { href: '/crm/leads', key: 'crmLeads', permission: 'leads:view' },
  { href: '/crm/tasks', key: 'crmTasks', permission: 'tasks:view' },
  { href: '/crm/calendar', key: 'crmCalendar', permission: 'tasks:view' },
  { href: '/crm/overdue', key: 'crmOverdue', permission: 'tasks:view' },
  { href: '/crm/exceptions', key: 'crmExceptions', permission: 'leads:exceptions:view', minScope: 'team' },
  { href: '/crm/reassignment', key: 'crmReassignment', permission: 'leads:reassignment-queue:resolve' },
  { href: '/crm/duplicates', key: 'crmDuplicates', permission: 'leads:duplicates:review' },
  { href: '/crm/reactivation', key: 'crmReactivation', permission: 'leads:reactivation:view' },
  { href: '/crm/imports', key: 'crmImports', permission: ['leads:import', 'imports:view'] },
  { href: '/crm/events', key: 'crmEvents', permission: 'events:view' },
  { href: '/crm/settings', key: 'crmSettings', permission: 'settings:view' },
];

export function CrmSubNav() {
  const { can } = useAuth();
  const t = useTranslations('nav');
  const path = usePathname();
  const items = CRM_SUBNAV.filter((i) => can(i.permission, i.minScope));
  return (
    <nav aria-label={t('crm')} className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0 [scrollbar-width:none]">
      <ul className="flex gap-1.5 whitespace-nowrap border-b border-line pb-2">
        {items.map((i) => {
          const active = i.href === '/crm' ? path === '/crm' : path === i.href || path.startsWith(i.href + '/');
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-10 items-center rounded-full px-3.5 text-sm font-medium transition-colors',
                  active ? 'bg-inverse text-on-inverse' : 'text-ink-700 hover:bg-ivory-200',
                )}
              >
                {t(i.key as 'crm')}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function StreamBadge({ mode }: { mode: StreamMode }) {
  const t = useTranslations('crm.common');
  const label = mode === 'live' ? t('streamLive') : mode === 'polling' ? t('streamPolling') : t('streamConnecting');
  const Icon = mode === 'live' ? Radio : mode === 'polling' ? RefreshCw : AlertTriangle;
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted" data-stream-mode={mode}>
      <Icon className={cn('size-3.5', mode === 'live' && 'text-green-700')} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Module frame: sub navigation + live-update subscription (SSE with polling fallback). */
export function CrmFrame({ children }: { children: React.ReactNode }) {
  const { mode } = useCrmStream(true);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <StreamBadge mode={mode} />
      </div>
      <CrmSubNav />
      <PendingCallPrompt />
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- lead card (mobile-first row) */
export function LeadCard({ lead, actions }: { lead: Lead; actions?: React.ReactNode }) {
  const t = useTranslations('crm.common');
  const f = useCrmFormat();
  const tObj = useTranslations('crm.objection');
  return (
    <article className="group relative overflow-hidden rounded-lg border border-line bg-surface p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-md motion-reduce:transform-none" aria-label={lead.fullName}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] origin-top scale-y-50 transition-transform duration-300 group-hover:scale-y-100 ${lead.stageCategory === 'WON' ? 'bg-green-600' : lead.isKeyProspect ? 'bg-gold-500' : 'bg-blue-600'}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold text-ink">
            <Link href={`/crm/leads/${lead.id}`} className="hover:underline">
              {lead.fullName}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StageBadge lead={lead} />
            <InterestBadge level={lead.interestLevel} />
            {lead.isKeyProspect && <Badge tone="gold">{t('keyProspect')}</Badge>}
            {lead.duplicateFlag && <Badge tone="red">{t('possibleDuplicate')}</Badge>}
          </div>
        </div>
        {actions}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted">{t('nextAction')}</dt>
          <dd><DueBadge iso={lead.nextActionAt} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('lastContact')}</dt>
          <dd className="text-ink">{lead.lastContactAt ? f.relative(lead.lastContactAt) : t('never')}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('lastObjection')}</dt>
          <dd className="text-ink">{lead.lastCall?.objectionCategory ? tObj(lead.lastCall.objectionCategory as 'PRICE') : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('eventStatus')}</dt>
          <dd className="text-ink">
            {lead.latestEvent ? `${lead.latestEvent.title} · ${humanize(lead.latestEvent.status)}` : '—'}
          </dd>
        </div>
      </dl>
    </article>
  );
}
