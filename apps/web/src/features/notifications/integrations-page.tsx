'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Ban, CheckCircle2, CircleDashed, HeartPulse, RefreshCw, Send, Settings2 } from 'lucide-react';
import {
  Alert, Badge, Button, Card, Dialog, DialogContent, DialogTrigger, EmptyState, ErrorState, FormField, Input, PageHeader, Select, Skeleton, Switch, Tabs, Textarea, TabsContent, TabsList, TabsTrigger, useToast,
} from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { useDateTimeFormat } from '@/features/admin/shared';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import {
  useCheckHealth, useDeliveries, useFailures, useHealthSummary, useIntegrations, usePatchIntegration, useRetryDelivery, useSendTest, type DeliveryDto, type IntegrationDto,
} from '@/lib/api/hooks/platform';

export function IntegrationsPage() {
  return (
    <RequirePermission permission="integrations:manage">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('platform.integrations');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <HealthStrip />
      <Tabs defaultValue="providers" className="mt-6">
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="providers">{t('tabProviders')}</TabsTrigger>
          <TabsTrigger value="deliveries">{t('tabDeliveries')}</TabsTrigger>
          <TabsTrigger value="failures">{t('tabFailures')}</TabsTrigger>
        </TabsList>
        <TabsContent value="providers"><Providers /></TabsContent>
        <TabsContent value="deliveries"><Deliveries /></TabsContent>
        <TabsContent value="failures"><Failures /></TabsContent>
      </Tabs>
    </>
  );
}

function HealthStrip() {
  const t = useTranslations('platform.integrations');
  const h = useHealthSummary();
  if (!h.data) return null;
  const d = h.data;
  const cell = (label: string, value: number, bad: boolean) => (
    <div className="rounded-lg border border-line bg-surface p-3" data-testid={`health-${label}`}>
      <p className="text-xs text-muted">{t(`health.${label}`)}</p>
      <p className={`mt-1 font-display text-2xl font-semibold ${bad && value > 0 ? 'text-red-700' : 'text-ink'}`}>{value}</p>
    </div>
  );
  return (
    <section aria-label={t('healthTitle')} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cell('queued', d.deliveriesLast24h.QUEUED ?? 0, false)}
        {cell('sent', d.deliveriesLast24h.SENT ?? 0, false)}
        {cell('delivered', d.deliveriesLast24h.DELIVERED ?? 0, false)}
        {cell('deadLetters', d.deadLetters, true)}
        {cell('failedFiles', d.failedFiles, true)}
      </div>
      <p className="text-[0.8125rem] text-muted">{t('sentExplain')}</p>
    </section>
  );
}

function StatusPill({ p }: { p: IntegrationDto }) {
  const t = useTranslations('platform.integrations');
  if (p.status === 'BLOCKED') return <Badge tone="red" icon={<Ban />}>{t('status.BLOCKED')}</Badge>;
  if (p.status === 'ENABLED') return <Badge tone="green" icon={<CheckCircle2 />}>{p.sandbox ? t('status.SANDBOX') : t('status.ENABLED')}</Badge>;
  return <Badge tone="neutral" icon={<CircleDashed />}>{t('status.DISABLED')}</Badge>;
}

function Providers() {
  const t = useTranslations('platform.integrations');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useIntegrations();
  const check = useCheckHealth();
  const fmt = useDateTimeFormat();
  if (q.isPending) return <Skeleton className="h-48 w-full" />;
  if (q.isError) return <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />;
  return (
    <div className="space-y-4">
      <Alert tone="warning" title={t('blockedTitle')}>{t('blockedText')}</Alert>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data.map((p) => (
          <li key={p.provider}>
            <Card className="flex h-full flex-col gap-3" data-testid={`provider-${p.provider}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold">{p.label}</p>
                  <p className="font-mono text-xs text-muted">{p.provider} · {t(`kind.${p.kind}`)}</p>
                </div>
                <StatusPill p={p} />
              </div>
              {p.blockedReason && <p className="text-[0.8125rem] text-red-700">{p.blockedReason}</p>}
              <p className="text-[0.8125rem] text-muted">
                {p.lastHealthAt ? t('lastHealth', { status: p.lastHealthStatus ?? '-', at: fmt(p.lastHealthAt) }) : t('neverChecked')}
                {p.lastError && <> · {p.lastError}</>}
              </p>
              <p className="flex flex-wrap gap-1.5 text-xs">
                <Badge tone={p.hasSecret ? 'green' : 'neutral'}>{p.hasSecret ? t('secretSet') : t('secretNotSet')}</Badge>
                <Badge tone={p.hasWebhookSecret ? 'green' : 'neutral'}>{p.hasWebhookSecret ? t('webhookSet') : t('webhookNotSet')}</Badge>
              </p>
              <div className="mt-auto flex flex-wrap gap-2">
                <ConfigureDialog p={p} />
                {p.status === 'ENABLED' && p.kind !== 'TELEPHONY' && <TestDialog p={p} />}
                <Button size="sm" variant="ghost" loading={check.isPending && check.variables === p.provider} onClick={() => check.mutate(p.provider)} leadingIcon={<HeartPulse aria-hidden="true" className="size-4" />}>{t('checkHealth')}</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfigureDialog({ p }: { p: IntegrationDto }) {
  const t = useTranslations('platform.integrations');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const patch = usePatchIntegration();
  const [open, setOpen] = React.useState(false);
  const [enabled, setEnabled] = React.useState(p.enabled);
  const [mode, setMode] = React.useState(p.mode);
  const [outage, setOutage] = React.useState(p.settings.simulateOutage === true);
  const [secret, setSecret] = React.useState('');
  const [webhookSecret, setWebhookSecret] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const onOpenChange = (o: boolean) => {
    if (o) { setEnabled(p.enabled); setMode(p.mode); setOutage(p.settings.simulateOutage === true); setSecret(''); setWebhookSecret(''); setError(null); }
    setOpen(o);
  };
  const webhookPath = p.kind === 'TELEPHONY' ? '/api/v1/integrations/telephony/webhook' : `/api/v1/integrations/webhooks/${p.provider}`;
  async function save(extra: object = {}) {
    setError(null);
    try {
      await patch.mutateAsync({ provider: p.provider, body: { enabled, mode, ...(p.sandbox ? { settings: { ...p.settings, simulateOutage: outage } } : {}), ...(secret ? { secret } : {}), ...(webhookSecret ? { webhookSecret } : {}), ...extra } });
      toast({ tone: 'success', title: t('saved') });
      setOpen(false);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" leadingIcon={<Settings2 aria-hidden="true" className="size-4" />}>{t('configure')}</Button>
      </DialogTrigger>
      <DialogContent title={p.label} description={p.provider} closeLabel={tc('close')} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{tc('cancel')}</Button><Button loading={patch.isPending} onClick={() => void save()}>{tc('save')}</Button></>}>
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          {p.blockedReason && <Alert tone="warning">{p.blockedReason}</Alert>}
          <Switch label={t('enabled')} description={p.blockedReason ? t('cannotEnable') : t('enabledHelp')} checked={enabled} disabled={!!p.blockedReason} onCheckedChange={setEnabled} />
          <FormField label={t('mode')} hint={p.sandbox ? t('sandboxOnly') : undefined}>
            <Select value={mode} disabled={p.sandbox || !!p.blockedReason} onChange={(e) => setMode(e.target.value as 'SANDBOX' | 'LIVE')}>
              <option value="SANDBOX">{t('modeSandbox')}</option>
              <option value="LIVE">{t('modeLive')}</option>
            </Select>
          </FormField>
          {p.sandbox && <Switch label={t('simulateOutage')} description={t('simulateOutageHelp')} checked={outage} onCheckedChange={setOutage} />}
          <FormField label={t('secret')} hint={p.hasSecret ? t('secretKeep') : t('secretHint')}>
            <Input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={p.hasSecret ? '••••••••' : ''} />
          </FormField>
          <FormField label={t('webhookSecret')} hint={t('webhookHint')}>
            <Input type="password" autoComplete="new-password" minLength={16} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder={p.hasWebhookSecret ? '••••••••' : ''} />
          </FormField>
          <div className="rounded-md bg-ivory-100 p-3 text-[0.8125rem]">
            <p className="font-medium">{t('webhookUrl')}</p>
            <code className="break-all font-mono text-xs">POST {webhookPath}</code>
            <p className="mt-1 text-muted">{t('signatureFormat')}</p>
          </div>
          {(p.hasSecret || p.hasWebhookSecret) && (
            <div className="flex flex-wrap gap-2">
              {p.hasSecret && <Button size="sm" variant="ghost" onClick={() => void save({ secret: null })}>{t('clearSecret')}</Button>}
              {p.hasWebhookSecret && <Button size="sm" variant="ghost" onClick={() => void save({ webhookSecret: null })}>{t('clearWebhookSecret')}</Button>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TestDialog({ p }: { p: IntegrationDto }) {
  const t = useTranslations('platform.integrations');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const send = useSendTest();
  const [open, setOpen] = React.useState(false);
  const [to, setTo] = React.useState('');
  const [body, setBody] = React.useState(t('testBodyDefault'));
  const [error, setError] = React.useState<string | null>(null);
  async function onSend() {
    setError(null);
    try {
      await send.mutateAsync({ provider: p.provider, to, body });
      toast({ tone: 'success', title: t('testQueued') });
      setOpen(false);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" leadingIcon={<Send aria-hidden="true" className="size-4" />}>{t('sendTest')}</Button>
      </DialogTrigger>
      <DialogContent title={t('sendTest')} description={p.label} closeLabel={tc('close')} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{tc('cancel')}</Button><Button loading={send.isPending} disabled={!to.trim() || !body.trim()} onClick={() => void onSend()}>{t('queueTest')}</Button></>}>
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Alert tone="info">{p.sandbox ? t('testSandboxNote') : t('testRealNote')}</Alert>
          <FormField label={t('testTo')}><Input value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
          <FormField label={t('testBody')}><Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} /></FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'DEAD_LETTER', 'SUPPRESSED'];

function DeliveryTable({ rows }: { rows: Array<DeliveryDto & { recoverable?: boolean }> }) {
  const t = useTranslations('platform.integrations');
  const fmt = useDateTimeFormat();
  const retry = useRetryDelivery();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[46rem] text-sm">
        <caption className="sr-only">{t('tabDeliveries')}</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
            <th scope="col" className="px-3 py-2">{t('colWhen')}</th>
            <th scope="col" className="px-3 py-2">{t('colChannel')}</th>
            <th scope="col" className="px-3 py-2">{t('colTo')}</th>
            <th scope="col" className="px-3 py-2">{t('colStatus')}</th>
            <th scope="col" className="px-3 py-2">{t('colAttempts')}</th>
            <th scope="col" className="px-3 py-2"><span className="sr-only">{t('colActions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-b border-line/60 align-top" data-testid="delivery-row" data-status={d.status}>
              <td className="px-3 py-2 whitespace-nowrap">{fmt(d.createdAt)}</td>
              <td className="px-3 py-2">{d.channel}<br /><span className="font-mono text-xs text-muted">{d.provider}</span></td>
              <td className="px-3 py-2">{d.to}{d.subject && <><br /><span className="text-xs text-muted">{d.subject}</span></>}</td>
              <td className="px-3 py-2">
                <Badge tone={d.status === 'DELIVERED' ? 'green' : d.status === 'DEAD_LETTER' || d.status === 'FAILED' ? 'red' : d.status === 'SUPPRESSED' ? 'neutral' : 'blue'}>{t(`deliveryStatus.${d.status}`)}</Badge>
                <p className="mt-1 text-xs text-muted">{d.statusLabel}</p>
                {d.errorCode && <p className="text-xs text-red-700">{d.errorCode}</p>}
              </td>
              <td className="px-3 py-2">{d.attempts}/{d.maxAttempts}</td>
              <td className="px-3 py-2 text-right">
                {(d.status === 'FAILED' || d.status === 'DEAD_LETTER') && (
                  <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === d.id} leadingIcon={<RefreshCw aria-hidden="true" className="size-4" />}
                    onClick={() => retry.mutate(d.id, { onSuccess: () => toast({ tone: 'success', title: t('requeued') }), onError: (e) => toast({ tone: 'danger', title: apiErr(e).message }) })}>
                    {t('retry')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Deliveries() {
  const t = useTranslations('platform.integrations');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const [status, setStatus] = React.useState('');
  const q = useDeliveries({ status: status || undefined });
  return (
    <div className="space-y-4">
      <FormField label={t('filterStatus')} className="w-56">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('allStatuses')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`deliveryStatus.${s}`)}</option>)}
        </Select>
      </FormField>
      {q.isPending ? <Skeleton className="h-32 w-full" /> : q.isError ? <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} /> : q.data.length === 0 ? (
        <EmptyState title={t('noDeliveries')} description={t('noDeliveriesHelp')} />
      ) : <DeliveryTable rows={q.data} />}
    </div>
  );
}

function Failures() {
  const t = useTranslations('platform.integrations');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useFailures();
  const fmt = useDateTimeFormat();
  if (q.isPending) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />;
  const { deliveries, files, deadEvents } = q.data;
  if (deliveries.length + files.length + deadEvents.length === 0) return <EmptyState title={t('nothingFailed')} description={t('nothingFailedHelp')} />;
  return (
    <div className="space-y-6">
      {deliveries.length > 0 && <section><h3 className="mb-2 font-semibold">{t('failedDeliveries')}</h3><DeliveryTable rows={deliveries} /></section>}
      {files.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">{t('failedFiles')}</h3>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {files.map((f) => (
              <li key={f.id} className="px-3 py-2 text-sm">
                <span className="font-medium">{f.displayName}</span> <Badge tone="red">{f.status}</Badge>
                <p className="text-xs text-muted">{f.error} · {fmt(f.createdAt)} · {f.recoverable ? t('fileRecover') : t('fileRejectedNote')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {deadEvents.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">{t('deadEvents')}</h3>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {deadEvents.map((e) => (
              <li key={e.id} className="px-3 py-2 text-sm"><code className="font-mono text-xs">{e.eventType}</code> · {e.attempts} {t('attempts')}<p className="text-xs text-muted">{e.error} · {fmt(e.createdAt)}</p></li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{deadEvents[0]!.note}</p>
        </section>
      )}
    </div>
  );
}
