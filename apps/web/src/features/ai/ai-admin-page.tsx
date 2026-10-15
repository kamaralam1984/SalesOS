'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, ErrorState, FormField, Input, PageHeader, Panel, Select, Skeleton, Stat, Switch, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useDateTimeFormat } from '@/features/admin/shared';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useAiConfig, useAiUsage, useSaveAiConfig, type AiConfigDto } from '@/lib/api/hooks/platform';
import { AiSuggestionPanel } from './ai-suggestion-panel';

export function AiAdminPage() {
  return (
    <RequirePermission permission={['ai:config', 'ai:usage:view']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('platform.ai.admin');
  const { can } = useAuth();
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <div className="space-y-6">
        {can('ai:config') && <Config />}
        {can('ai:usage:view') && <Usage />}
        {can('ai:use') && <AiSuggestionPanel feature="summarize" />}
      </div>
    </>
  );
}

function Config() {
  const t = useTranslations('platform.ai.admin');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const q = useAiConfig();
  const save = useSaveAiConfig();
  const [draft, setDraft] = React.useState<Partial<AiConfigDto>>({});
  const [error, setError] = React.useState<string | null>(null);
  if (q.isPending) return <Skeleton className="h-56 w-full" />;
  if (q.isError) return <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />;
  const v = { ...q.data, ...draft };
  async function onSave() {
    setError(null);
    try {
      await save.mutateAsync(draft);
      setDraft({});
      toast({ tone: 'success', title: t('saved') });
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <Panel accent="gold" title={t('configTitle')} description={t('configHelp')}>
      <div className="space-y-4">
        <Alert tone={v.enabled ? 'warning' : 'info'}>{v.enabled ? t('onNote') : t('offNote')}</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        <Switch label={t('enabled')} description={t('enabledHelp')} checked={v.enabled} onCheckedChange={(x) => setDraft((d) => ({ ...d, enabled: x }))} />
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t('provider')} hint={q.data.providersAvailable[v.provider] ? t('keyPresent') : t('keyMissing')}>
            <Select value={v.provider} onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value as AiConfigDto['provider'] }))}>
              <option value="fake">{t('providerFake')}</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="anthropic">Anthropic</option>
            </Select>
          </FormField>
          <FormField label={t('model')}><Input value={v.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} /></FormField>
          <FormField label={t('rate')}><Input type="number" min={1} max={120} value={v.rateLimitPerMinute} onChange={(e) => setDraft((d) => ({ ...d, rateLimitPerMinute: Number(e.target.value) }))} /></FormField>
        </div>
        <Switch label={t('redact')} description={t('redactHelp')} checked={v.redactPii} onCheckedChange={(x) => setDraft((d) => ({ ...d, redactPii: x }))} />
        <p className="text-[0.8125rem] text-muted">{q.data.note}</p>
        <div className="flex justify-end"><Button disabled={Object.keys(draft).length === 0} loading={save.isPending} onClick={() => void onSave()}>{tc('save')}</Button></div>
      </div>
    </Panel>
  );
}

function Usage() {
  const t = useTranslations('platform.ai.admin');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const fmt = useDateTimeFormat();
  const q = useAiUsage(30);
  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />;
  const d = q.data;
  return (
    <Panel accent="blue" title={t('usageTitle')} description={d.costNote}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('requests')} value={String(d.requests)} />
        <Stat label={t('avgLatency')} value={`${d.avgLatencyMs} ms`} />
        <Stat label={t('failures')} value={String((d.byOutcome.FAILED ?? 0) + (d.byOutcome.INVALID_OUTPUT ?? 0))} />
        <Stat label={t('cost')} value={`$${d.totalCostUsd.toFixed(4)}`} />
      </div>
      {d.recent.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">{t('usageTitle')}</caption>
            <thead><tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase"><th scope="col" className="py-2 pr-3">{t('when')}</th><th scope="col" className="px-2">{t('feature')}</th><th scope="col" className="px-2">{t('outcome')}</th><th scope="col" className="px-2">{t('latency')}</th></tr></thead>
            <tbody>
              {d.recent.slice(0, 15).map((r) => (
                <tr key={r.id} className="border-b border-line/60"><td className="py-1.5 pr-3 whitespace-nowrap">{fmt(r.createdAt)}</td><td className="px-2">{r.feature}</td><td className="px-2">{r.outcome}{r.errorCode ? ` (${r.errorCode})` : ''}</td><td className="px-2">{r.latencyMs} ms</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
