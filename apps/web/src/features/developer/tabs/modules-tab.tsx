'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, ErrorState, LoadingRegion, Panel, Skeleton, Switch, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useModules, useSetModule } from '@/lib/api/hooks/devpanel-modules';

/** Organisation-wide ON/OFF for whole feature modules (Attendance, Payroll, ...). Sales/CRM core is not listed: it cannot be switched off. */
export function ModulesTab() {
  const t = useTranslations('developer.modules');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const { can } = useAuth();
  const canManage = can('devpanel:features:manage');
  const q = useModules();
  const set = useSetModule();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function toggle(module: string, enabled: boolean) {
    setBusy(module);
    try {
      await set.mutateAsync({ module, enabled });
      toast({ tone: 'success', title: t(enabled ? 'enabledToast' : 'disabledToast') });
    } catch (e) {
      toast({ tone: 'danger', title: apiErr(e).message });
    } finally {
      setBusy(null);
    }
  }

  if (q.isLoading) return <LoadingRegion label={t('loading')}><Skeleton className="h-64 w-full" /></LoadingRegion>;
  if (q.isError || !q.data) return <ErrorState title={t('error')} description={q.error ? apiErr(q.error).message : undefined} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />;

  return (
    <div className="space-y-4">
      <Alert tone="info" title={t('coreTitle')}>{t('coreBody')}</Alert>
      <Panel title={t('title')} description={t('description')}>
        <ul className="divide-y divide-border">
          {q.data.modules.map((m) => (
            <li key={m.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {m.label}
                  <Badge tone={m.enabled ? 'green' : 'neutral'}>{t(m.enabled ? 'on' : 'off')}</Badge>
                  {!m.defaultEnabled && <Badge tone="neutral">{t('hiddenByDefault')}</Badge>}
                </p>
                <p className="text-sm text-muted">{m.description}</p>
                <p className="text-xs text-muted">{t('permissions', { n: m.permissions })}</p>
              </div>
              <Switch aria-label={t('switchLabel', { name: m.label })} checked={m.enabled} disabled={!canManage || busy !== null} onCheckedChange={(on) => void toggle(m.key, on)} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
