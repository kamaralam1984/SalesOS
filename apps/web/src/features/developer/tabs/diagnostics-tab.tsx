'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, FormField, LoadingRegion, Panel, Select, Skeleton, Textarea, useToast } from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useAuth } from '@/features/auth/auth-provider';
import { CountUp, GrowBar, Reveal, StaggerList } from '@/components/motion';
import {
  useDiagBuild, useDiagErrors, useDiagHealth, useDiagJobs, useDiagMigrations, useDiscardJob, useRetryAllJobs, useRetryJob,
  type DiagJob, type Verdict,
} from '@/lib/api/hooks/devpanel-diagnostics';

const TONE: Record<Verdict, 'green' | 'gold' | 'red' | 'neutral'> = { ok: 'green', slow: 'gold', down: 'red', unknown: 'neutral' };
const FILL: Record<Verdict, string> = { ok: 'bg-green-600', slow: 'bg-gold-500', down: 'bg-red-600', unknown: 'bg-muted' };

export function DiagnosticsTab() {
  return (
    <div className="space-y-4">
      <Reveal><HealthSection /></Reveal>
      <Reveal delay={0.05}><JobsSection /></Reveal>
      <Reveal delay={0.1}><ErrorsSection /></Reveal>
      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal delay={0.15}><MigrationsSection /></Reveal>
        <Reveal delay={0.2}><BuildSection /></Reveal>
      </div>
    </div>
  );
}

const fmtDur = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

function LiveDot({ verdict }: { verdict: Verdict }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden="true"
      className={`inline-block size-2.5 rounded-full ${FILL[verdict]}`}
      animate={reduce || verdict === 'unknown' ? undefined : { opacity: [1, 0.4, 1] }}
      transition={{ duration: 2, repeat: Infinity }}
    />
  );
}

/* ------------------------------ Health ------------------------------ */

function Gauge({ label, ms, verdict, slow, down }: { label: string; ms: number | null; verdict: Verdict; slow: number; down: number }) {
  const t = useTranslations('developer.diagnostics.health');
  return (
    <div className="rounded-lg border border-line bg-paper p-4" data-testid={`gauge-${label}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-sm text-muted"><LiveDot verdict={verdict} />{label}</p>
        <Badge tone={TONE[verdict]}>{t(`verdict.${verdict}`)}</Badge>
      </div>
      <p className="font-display mt-2 text-2xl font-semibold text-ink">
        {ms === null ? t('noReading') : <><CountUp value={ms} format={(n) => n.toFixed(1)} /> <span className="text-base font-normal text-muted">{t('ms')}</span></>}
      </p>
      <GrowBar className="mt-2" value={ms === null ? 100 : (ms / down) * 100} fillClassName={FILL[verdict]} />
      <p className="mt-1 text-xs text-muted">{t('thresholds', { slow, down })}</p>
    </div>
  );
}

function HealthSection() {
  const t = useTranslations('developer.diagnostics.health');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useDiagHealth();
  const h = q.data;
  return (
    <Panel title={t('title')} description={t('description')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{h ? t('checked', { time: new Date(h.checkedAt).toLocaleTimeString() }) : ''}</p>
        <Button size="sm" variant="secondary" loading={q.isFetching} onClick={() => void q.refetch()} leadingIcon={<RefreshCw aria-hidden />}>{t('refresh')}</Button>
      </div>
      {q.isPending && <LoadingRegion label={tc('loading')}><Skeleton className="h-32 w-full" /></LoadingRegion>}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {h && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Gauge label={t('database')} ms={h.database.latencyMs} verdict={h.database.verdict} slow={h.thresholds.dbSlowMs} down={h.thresholds.dbDownMs} />
          <Gauge label={t('redis')} ms={h.redis.latencyMs} verdict={h.redis.verdict} slow={h.thresholds.redisSlowMs} down={h.thresholds.redisDownMs} />
          <div className="rounded-lg border border-line bg-paper p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-sm text-muted"><LiveDot verdict={h.worker.verdict} />{t('worker')}</p>
              <Badge tone={TONE[h.worker.verdict]}>{t(`verdict.${h.worker.verdict}`)}</Badge>
            </div>
            <p className="mt-2 text-sm text-ink">
              {h.worker.lastHeartbeatAgeSeconds === null ? t('noHeartbeat') : t('heartbeat', { seconds: Math.round(h.worker.lastHeartbeatAgeSeconds) })}
            </p>
            <p className="text-xs text-muted">{t('instances', { count: h.worker.instances })}</p>
          </div>
          <div className="rounded-lg border border-line bg-paper p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-sm text-muted"><LiveDot verdict={h.outbox.verdict} />{t('outbox')}</p>
              <Badge tone={TONE[h.outbox.verdict]}>{t(`verdict.${h.outbox.verdict}`)}</Badge>
            </div>
            {h.outbox.pending === null ? (
              <p className="mt-2 text-sm text-muted">{t('noReading')}</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-ink">{t('pending')}: <CountUp value={h.outbox.pending} /> · {t('dead')}: <CountUp value={h.outbox.dead ?? 0} /></p>
                <p className="text-xs text-muted">{t('oldest', { seconds: Math.round(h.outbox.oldestPendingSeconds ?? 0) })}</p>
              </>
            )}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{t('auto')}</p>
    </Panel>
  );
}

/* ------------------------------ Failed jobs ------------------------------ */

function JobsSection() {
  const t = useTranslations('developer.diagnostics.jobs');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const { can } = useAuth();
  const manage = can('devpanel:jobs:manage');
  const q = useDiagJobs();
  const retry = useRetryJob();
  const retryAll = useRetryAllJobs();
  const discard = useDiscardJob();
  const [confirmAll, setConfirmAll] = React.useState(false);
  const [discarding, setDiscarding] = React.useState<DiagJob | null>(null);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? null;

  async function doRetryAll() {
    setError(null);
    try {
      const r = await retryAll.mutateAsync();
      toast({ tone: 'success', title: t('retryAllDone', { count: (r as { requeued: number }).requeued }) });
      setConfirmAll(false);
    } catch (e) { setError(apiErr(e).message); }
  }
  async function doDiscard() {
    if (!discarding) return;
    setError(null);
    try {
      await discard.mutateAsync({ id: discarding.id, reason: reason.trim() });
      toast({ tone: 'success', title: t('discardDone') });
      setDiscarding(null);
      setReason('');
    } catch (e) { setError(apiErr(e).message); }
  }

  return (
    <Panel title={t('title')} description={t('description')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{total !== null ? t('total', { count: total }) : ''}</p>
        {manage && (
          <Button size="sm" variant="secondary" disabled={items.length === 0} onClick={() => { setError(null); setConfirmAll(true); }} leadingIcon={<RotateCcw aria-hidden />}>{t('retryAll')}</Button>
        )}
      </div>
      {q.isPending && <LoadingRegion label={tc('loading')}><Skeleton className="h-16 w-full" /></LoadingRegion>}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {q.data && items.length === 0 && <EmptyState title={t('empty')} />}
      {items.length > 0 && (
        <StaggerList className="divide-y divide-line">
          {items.map((j) => (
            <div key={j.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{j.eventType}</p>
                <p className="text-sm text-muted">{t('meta', { aggregate: j.aggregateType, attempts: j.attempts, time: new Date(j.createdAt).toLocaleString() })}</p>
                <p className="mt-1 break-words text-sm text-red-700">{j.lastError ?? t('noError')}</p>
              </div>
              {manage && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === j.id} onClick={() =>
                    retry.mutate(j.id, { onSuccess: () => toast({ tone: 'success', title: t('retryDone') }), onError: (e) => toast({ tone: 'danger', title: apiErr(e).message }) })
                  } leadingIcon={<RotateCcw aria-hidden />}>{t('retry')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setError(null); setDiscarding(j); }} leadingIcon={<Trash2 aria-hidden />}>{t('discard')}</Button>
                </div>
              )}
            </div>
          ))}
        </StaggerList>
      )}
      {q.hasNextPage && <div className="mt-3"><Button size="sm" variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t('loadMore')}</Button></div>}

      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent size="sm" title={t('retryAllTitle')} description={t('retryAllBody')} closeLabel={tc('close')}
          footer={<><Button variant="secondary" onClick={() => setConfirmAll(false)}>{tc('cancel')}</Button><Button onClick={() => void doRetryAll()} loading={retryAll.isPending} loadingLabel={tc('saving')}>{t('retryAll')}</Button></>}>
          {error && <Alert tone="danger">{error}</Alert>}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(discarding)} onOpenChange={(o) => !o && setDiscarding(null)}>
        <DialogContent size="sm" title={t('discardTitle')} description={t('discardBody')} closeLabel={tc('close')}
          footer={<><Button variant="secondary" onClick={() => setDiscarding(null)}>{tc('cancel')}</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={() => void doDiscard()} loading={discard.isPending} loadingLabel={tc('saving')}>{t('discard')}</Button></>}>
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <FormField label={t('reason')}><Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

/* ------------------------------ Errors ------------------------------ */

function ErrorsSection() {
  const t = useTranslations('developer.diagnostics.errors');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const [kind, setKind] = React.useState<'all' | 'error' | 'slow'>('all');
  const q = useDiagErrors(kind);
  const d = q.data;
  return (
    <Panel title={t('title')} description={t('description')}>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <FormField label={t('filter')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">{t('all')}</option>
            <option value="error">{t('error')}</option>
            <option value="slow">{t('slow')}</option>
          </Select>
        </FormField>
        <div className="sm:col-span-2 flex items-end"><Button size="sm" variant="secondary" loading={q.isFetching} onClick={() => void q.refetch()} leadingIcon={<RefreshCw aria-hidden />}>{t('refresh')}</Button></div>
      </div>
      {q.isPending && <LoadingRegion label={tc('loading')}><Skeleton className="h-16 w-full" /></LoadingRegion>}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {d && <Alert tone="info">{t('scope', { since: new Date(d.capturingSince).toLocaleString(), size: d.bufferSize, slow: d.slowThresholdMs })}</Alert>}
      {d && d.items.length === 0 && <div className="mt-3"><EmptyState title={t('empty')} /></div>}
      {d && d.items.length > 0 && (
        <>
          <table className="mt-3 hidden w-full text-left text-sm md:table">
            <thead className="text-muted"><tr>
              <th scope="col" className="py-2">{t('time')}</th><th scope="col">{t('request')}</th><th scope="col">{t('status')}</th><th scope="col">{t('duration')}</th><th scope="col">{t('requestId')}</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {d.items.map((i, n) => (
                <tr key={`${i.at}-${n}`}>
                  <td className="py-2 text-muted">{new Date(i.at).toLocaleTimeString()}</td>
                  <td className="font-mono text-xs">{i.method} {i.route}</td>
                  <td><Badge tone={i.status >= 500 ? 'red' : 'gold'}>{i.status}</Badge></td>
                  <td className="tabular-nums">{i.durationMs} {t('ms')}</td>
                  <td className="font-mono text-xs text-muted">{i.requestId ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-3 space-y-2 md:hidden">
            {d.items.map((i, n) => (
              <li key={`${i.at}-${n}`} className="rounded-lg border border-line bg-paper p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><Badge tone={i.status >= 500 ? 'red' : 'gold'}>{i.status}</Badge><span className="tabular-nums text-muted">{i.durationMs} {t('ms')}</span></div>
                <p className="mt-1 break-all font-mono text-xs">{i.method} {i.route}</p>
                <p className="text-xs text-muted">{new Date(i.at).toLocaleTimeString()} · {i.requestId ?? '–'}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------ Migrations ------------------------------ */

function MigrationsSection() {
  const t = useTranslations('developer.diagnostics.migrations');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useDiagMigrations();
  const d = q.data;
  return (
    <Panel title={t('title')}>
      {q.isPending && <LoadingRegion label={tc('loading')}><Skeleton className="h-24 w-full" /></LoadingRegion>}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {d && !d.available && <Alert tone="info">{t('unavailable')}</Alert>}
      {d && d.available && (
        <>
          {d.problems.length > 0 && <Alert tone="warning">{t('problems', { count: d.problems.length })}</Alert>}
          <p className="my-2 text-sm text-muted">{t('count', { count: d.count })}</p>
          <ol className="max-h-72 space-y-0 overflow-y-auto border-l border-line pl-4">
            <AnimatePresence initial={false}>
              {d.items.slice(0, 30).map((m) => (
                <li key={m.name} className="relative pb-3">
                  <span aria-hidden="true" className={`absolute -left-[21px] top-1 size-2.5 rounded-full ${m.state === 'applied' ? 'bg-green-600' : 'bg-red-600'}`} />
                  <p className="break-all font-mono text-xs text-ink">{m.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    {m.state === 'applied' ? <CheckCircle2 aria-hidden className="size-3.5" /> : <AlertTriangle aria-hidden className="size-3.5" />}
                    {t(m.state)} · {new Date(m.finishedAt ?? m.startedAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </AnimatePresence>
          </ol>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------ Build ------------------------------ */

function BuildSection() {
  const t = useTranslations('developer.diagnostics.build');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useDiagBuild();
  const b = q.data;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-2 text-sm"><dt className="text-muted">{label}</dt><dd className="break-all text-right font-medium text-ink">{value}</dd></div>
  );
  return (
    <Panel title={t('title')}>
      {q.isPending && <LoadingRegion label={tc('loading')}><Skeleton className="h-24 w-full" /></LoadingRegion>}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {b && (
        <dl className="divide-y divide-line">
          {row(t('version'), b.version)}
          {row(t('commit'), b.gitCommit ?? t('unknown'))}
          {row(t('buildTime'), b.buildTime ?? t('unknown'))}
          {row(t('node'), b.nodeVersion)}
          {row(t('env'), b.nodeEnv)}
          {row(t('uptime'), fmtDur(b.uptimeSeconds))}
          {row(t('platform'), b.platform)}
        </dl>
      )}
    </Panel>
  );
}
