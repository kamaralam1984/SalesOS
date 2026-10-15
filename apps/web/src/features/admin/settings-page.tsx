'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Button,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  useToast,
} from '@salesos/ui';
import { useOrgSettings, useUpdateOrgSettings } from '@/lib/api/hooks/admin';
import { usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useFieldError } from '@/hooks/use-field-error';
import { useApiErrorMessage } from '@/hooks/use-api-error';

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC',
];
const CURRENCIES = ['INR', 'USD', 'AED', 'GBP', 'EUR'];

const schema = z.object({
  teamSoftLimit: z.coerce.number().int('integer').min(1, 'min1').max(50, 'max50'),
  businessTimezone: z.string().min(1, 'required'),
  defaultCurrency: z.string().length(3, 'required'),
  sessionIdleMinutes: z.coerce.number().int('integer').min(5, 'min5').max(1440, 'max1440'),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

export function SettingsPage() {
  return (
    <RequirePermission permission="settings:view" minScope="org">
      <SettingsInner />
    </RequirePermission>
  );
}

function SettingsInner() {
  const t = useTranslations('admin.settings');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const canEdit = usePermission('settings:update');
  const q = useOrgSettings();
  const update = useUpdateOrgSettings();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    values: q.data,
  });

  if (q.isPending) {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tc('loading')}</span>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (q.isError)
    return (
      <ErrorState
        description={apiErr(q.error).message}
        onRetry={() => void q.refetch()}
        retryLabel={tc('retry')}
      />
    );

  async function onSubmit(v: FormOut) {
    setError(null);
    try {
      await update.mutateAsync(v);
      toast({ tone: 'success', title: t('saved') });
      form.reset(v);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {!canEdit && (
        <Alert tone="info" className="mb-5">
          {t('readOnly')}
        </Alert>
      )}
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        aria-label={t('title')}
        className="grid max-w-3xl gap-6"
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Panel accent="gold" title={t('teamsSection')} description={t('teamsSectionHelp')}>
          <FormField
            label={t('softLimit')}
            hint={t('softLimitHint')}
            error={fe(form.formState.errors.teamSoftLimit)}
            required
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              disabled={!canEdit}
              className="max-w-32"
              {...form.register('teamSoftLimit')}
            />
          </FormField>
        </Panel>
        <Panel accent="blue" title={t('regionSection')} description={t('regionSectionHelp')}>
          <div className="stagger grid gap-5 sm:grid-cols-2">
            <FormField
              label={t('timezone')}
              hint={t('timezoneHint')}
              error={fe(form.formState.errors.businessTimezone)}
              required
            >
              <Select disabled={!canEdit} {...form.register('businessTimezone')}>
                {[...new Set([q.data.businessTimezone, ...TIMEZONES])].map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label={t('currency')}
              hint={t('currencyHint')}
              error={fe(form.formState.errors.defaultCurrency)}
              required
            >
              <Select disabled={!canEdit} {...form.register('defaultCurrency')}>
                {[...new Set([q.data.defaultCurrency, ...CURRENCIES])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </Panel>
        <Panel accent="green" title={t('securitySection')} description={t('securitySectionHelp')}>
          <FormField
            label={t('idle')}
            hint={t('idleHint')}
            error={fe(form.formState.errors.sessionIdleMinutes)}
            required
          >
            <Input
              type="number"
              inputMode="numeric"
              min={5}
              max={1440}
              disabled={!canEdit}
              className="max-w-32"
              {...form.register('sessionIdleMinutes')}
            />
          </FormField>
        </Panel>
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              loading={update.isPending}
              loadingLabel={tc('saving')}
              disabled={!form.formState.isDirty}
            >
              {tc('save')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!form.formState.isDirty}
              onClick={() => form.reset()}
            >
              {tc('reset')}
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
