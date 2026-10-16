'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Archive, CheckCircle2, Info, Plug, RefreshCw } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, LoadingRegion, Panel, Skeleton } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { CountUp } from '@/components/motion';
import {
  useDashboardBackup,
  useDashboardIntegrations,
  useDashboardSnapshot,
  type AlertSeverity,
  type DashboardSnapshot,
} from '@/lib/api/hooks/devpanel-overview';

type Tone = 'green' | 'red' | 'gold' | 'neutral' | 'blue';

/** Status dot: the label next to it carries the meaning; the pulse is decorative and off under reduced motion. */
function StatusDot({ tone, live }: { tone: Tone; live?: boolean }) {
  const reduce = useReducedMotion();
  const color = tone === 'green' ? 'bg-green-600' : tone === 'red' ? 'bg-red-600' : tone === 'gold' ? 'bg-gold-500' : tone === 'blue' ? 'bg-blue-600' : 'bg-muted';
  return (
    <span aria-hidden="true" className="relative inline-flex size-2.5 shrink-0">
      {live && !reduce && (
        <motion.span className={`absolute inset-0 rounded-full ${color}`} animate={{ scale: [1, 2.2], opacity: [0.5, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }} />
      )}
      <span className={`relative inline-block size-2.5 rounded-full ${color}`} />
    </span>
  );
}

const healthTone = (v: string): Tone => (v === 'ok' ? 'green' : v === 'down' ? 'red' : 'gold');
const sevTone: Record<AlertSeverity, Tone> = { critical: 'red', warning: 'gold', info: 'blue' };
const stateTone = { healthy: 'green', degraded: 'red', blocked: 'gold', disabled: 'neutral', not_configured: 'neutral', unknown: 'gold' } as const;

function useFmtTime() {
  return (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);
}

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } } };

function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} variants={container} initial={reduce ? false : 'hidden'} animate="show">
      {children}
    </motion.div>
  );
}
function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return <motion.div className={className} variants={reduce ? undefined : item}>{children}</motion.div>;
}

export function OverviewTab() {
  const t = useTranslations('developer.overview');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { can } = useAuth();
  const q = useDashboardSnapshot();
  const canConfig = can('devpanel:config:view');
  const integrations = useDashboardIntegrations(canConfig);
  const backup = useDashboardBackup(canConfig);
  const fmt = useFmtTime();

  const refreshAll = () => {
    void q.refetch();
    if (canConfig) { void integrations.refetch(); void backup.refetch(); }
  };
  const updated = q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString() : null;
  const fetching = q.isFetching || integrations.isFetching || backup.isFetching;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {updated ? t('lastUpdated', { time: updated }) : ''} <span className="ml-1">{t('autoRefresh')}</span>
        </p>
        <Button size="sm" variant="secondary" loading={fetching} onClick={refreshAll} leadingIcon={<RefreshCw aria-hidden />}>
          {t('refresh')}
        </Button>
      </div>

      {q.isPending && (
        <LoadingRegion label={tc('loading')} className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
        </LoadingRegion>
      )}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {q.data && <Loaded s={q.data} />}

      {canConfig && (
        <Stagger className="grid gap-4 lg:grid-cols-2">
          <StaggerItem>
            <Panel title={<span className="inline-flex items-center gap-2"><Plug aria-hidden className="size-4" />{t('integrations.title')}</span>}>
              {integrations.isPending && <LoadingRegion label={tc('loading')}><Skeleton className="h-20 w-full" /></LoadingRegion>}
              {integrations.isError && <ErrorState description={apiErr(integrations.error).message} onRetry={() => void integrations.refetch()} retryLabel={tc('retry')} />}
              {integrations.data && integrations.data.items.length === 0 && <EmptyState title={t('integrations.empty')} />}
              {integrations.data && integrations.data.items.length > 0 && (
                <ul className="divide-y divide-line">
                  {integrations.data.items.map((i) => (
                    <li key={i.provider} className="flex flex-wrap items-start justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{i.provider} <span className="text-sm font-normal text-muted">{i.kind}</span></p>
                        <p className="text-sm text-muted">
                          {i.last7d.lastSuccessAt ? t('integrations.lastSuccess', { time: fmt(i.last7d.lastSuccessAt) ?? '' }) : t('integrations.noSuccess')}
                          {' · '}
                          {i.last7d.lastFailureAt ? t('integrations.lastFailure', { time: fmt(i.last7d.lastFailureAt) ?? '' }) : t('integrations.noFailure')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={stateTone[i.state]}>{t(`integrations.state.${i.state}`)}</Badge>
                        <Badge tone="neutral">{i.mode}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </StaggerItem>
          <StaggerItem>
            <Panel title={<span className="inline-flex items-center gap-2"><Archive aria-hidden className="size-4" />{t('backup.title')}</span>}>
              {backup.isPending && <LoadingRegion label={tc('loading')}><Skeleton className="h-20 w-full" /></LoadingRegion>}
              {backup.isError && <ErrorState description={apiErr(backup.error).message} onRetry={() => void backup.refetch()} retryLabel={tc('retry')} />}
              {backup.data && (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={backup.data.status === 'OK' ? 'green' : backup.data.status === 'STALE' || backup.data.status === 'MISSING' ? 'red' : 'gold'} />
                    <Badge tone={backup.data.status === 'OK' ? 'green' : backup.data.status === 'UNKNOWN' ? 'gold' : 'red'}>{t(`backup.status.${backup.data.status}`)}</Badge>
                  </div>
                  {backup.data.lastBackupAt && (
                    <p className="text-ink">{t('backup.last', { time: fmt(backup.data.lastBackupAt) ?? '', hours: backup.data.ageHours ?? 0 })}</p>
                  )}
                  {backup.data.hasChecksum !== null && <p className="text-muted">{backup.data.hasChecksum ? t('backup.checksumYes') : t('backup.checksumNo')}</p>}
                  {backup.data.reason && <p className="text-muted">{t(`backup.reason.${backup.data.reason}`)}</p>}
                  <p className="text-muted">{t('backup.threshold', { hours: backup.data.maxAgeHours })}</p>
                </div>
              )}
            </Panel>
          </StaggerItem>
        </Stagger>
      )}
    </div>
  );
}

function Loaded({ s }: { s: DashboardSnapshot }) {
  const t = useTranslations('developer.overview');
  const ts = useTranslations('developer.server');
  const tr = useTranslations('roles');
  const h = s.health;
  const c = s.alerts24h.counters;
  const chips: Array<{ label: string; value: string; tone: Tone }> = [
    { label: ts('database'), value: ts(h.database), tone: healthTone(h.database) },
    { label: ts('redis'), value: ts(h.redis), tone: healthTone(h.redis) },
    { label: ts('worker'), value: ts(h.worker), tone: healthTone(h.worker) },
    {
      label: ts('outbox'),
      value: h.outbox ? t('outboxValue', { pending: h.outbox.pending, dead: h.outbox.dead }) : ts('unknown'),
      tone: !h.outbox ? 'gold' : h.outbox.dead > 0 ? 'red' : 'green',
    },
  ];
  const tiles: Array<{ label: string; value: number }> = [
    { label: t('users'), value: s.users.total },
    { label: t('active'), value: s.users.active },
    { label: t('sessions'), value: s.liveSessions },
    { label: t('lockedNow'), value: c.currentlyLockedAccounts },
  ];
  const roles = Object.entries(s.users.perRole).filter(([, n]) => n > 0);
  return (
    <Stagger className="space-y-4">
      <StaggerItem>
        <section aria-label={t('health')} className="rounded-xl border border-line bg-paper p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusDot tone={healthTone(h.status)} live={h.status === 'ok'} />
            <h2 className="font-display text-lg font-semibold text-ink">{t(`overall.${h.status}`)}</h2>
            <span className="text-sm text-muted">{t('probe', { ms: s.probeMs })}</span>
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {chips.map((x) => (
              <li key={x.label} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2">
                <StatusDot tone={x.tone} live={x.tone === 'green'} />
                <span className="text-sm text-muted">{x.label}</span>
                <span className="ml-auto text-sm font-medium text-ink">{x.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </StaggerItem>

      <StaggerItem>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((x) => (
            <li key={x.label} className="rounded-lg border border-line bg-paper p-4">
              <p className="text-sm text-muted">{x.label}</p>
              <p className="font-display mt-1 text-2xl font-semibold text-ink"><CountUp value={x.value} /></p>
            </li>
          ))}
        </ul>
      </StaggerItem>

      <StaggerItem>
        <Panel title={t('alerts.title')} description={t('alerts.description', { hours: s.alerts24h.windowHours })}>
          {s.alerts24h.alerts.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ink"><CheckCircle2 aria-hidden className="size-4 text-green-700" />{t('alerts.none')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.alerts24h.alerts.map((a) => (
                <li key={a.key} className="flex items-center gap-3 py-2.5 text-sm">
                  {a.severity === 'info' ? <Info aria-hidden className="size-4 shrink-0 text-blue-700" /> : <AlertTriangle aria-hidden className={`size-4 shrink-0 ${a.severity === 'critical' ? 'text-red-700' : 'text-gold-700'}`} />}
                  <span className="min-w-0 flex-1 text-ink">{t(`alerts.items.${a.key}`, { count: a.count ?? 0 })}</span>
                  <Badge tone={sevTone[a.severity]}>{t(`alerts.severity.${a.severity}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-sm sm:grid-cols-4">
            {([['failedLogins', c.failedLogins], ['accountLockouts', c.accountLockouts], ['forceLogouts', c.forceLogouts], ['roleChanges', c.roleChanges]] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{t(`counters.${k}`)}</dt>
                <dd className="font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </StaggerItem>

      {roles.length > 0 && (
        <StaggerItem>
          <Panel title={t('perRole')}>
            <div className="flex flex-wrap gap-1.5">
              {roles.map(([r, n]) => <Badge key={r} tone={r === 'DEVELOPER' ? 'gold' : 'neutral'}>{tr(r)}: {n}</Badge>)}
            </div>
          </Panel>
        </StaggerItem>
      )}
    </Stagger>
  );
}
