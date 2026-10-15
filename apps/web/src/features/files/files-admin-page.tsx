'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, ErrorState, FormField, Input, PageHeader, Panel, Skeleton, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useFileSettings, useSaveFileSettings, type FileSettingsDto } from '@/lib/api/hooks/platform';
import { FilesWidget } from './files-widget';

const MB = 1024 * 1024;

export function FilesAdminPage() {
  return (
    <RequirePermission permission="integrations:manage">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('platform.files.admin');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useFileSettings(true);
  if (q.isPending) return <div role="status"><span className="sr-only">{tc('loading')}</span><Skeleton className="h-72 w-full" /></div>;
  if (q.isError) return <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />;
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <div className="grid gap-6 xl:grid-cols-2">
        <SettingsForm data={q.data} />
        <Panel accent="gold" title={t('tryTitle')} description={t('tryHelp')}>
          <FilesWidget title={t('tryTitle')} />
        </Panel>
      </div>
    </>
  );
}

function SettingsForm({ data }: { data: FileSettingsDto }) {
  const t = useTranslations('platform.files.admin');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const save = useSaveFileSettings();
  const s = data.settings;
  const [form, setForm] = React.useState({
    image: String(s.maxBytesByCategory.image / MB), document: String(s.maxBytesByCategory.document / MB), csv: String(s.maxBytesByCategory.csv / MB),
    userQuota: String(Math.round(s.userQuotaBytes / MB)), ttl: String(s.signedUrlTtlSeconds), purge: String(s.purgeAfterDays),
  });
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  async function onSave() {
    setError(null);
    try {
      await save.mutateAsync({
        maxBytesByCategory: { image: Math.round(Number(form.image) * MB), document: Math.round(Number(form.document) * MB), csv: Math.round(Number(form.csv) * MB) },
        userQuotaBytes: Math.round(Number(form.userQuota) * MB), signedUrlTtlSeconds: Number(form.ttl), purgeAfterDays: Number(form.purge),
      });
      toast({ tone: 'success', title: t('saved') });
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <div className="stagger space-y-6">
      <Alert tone="warning" title={t('honestyTitle')}>
        {t('honesty', { scanner: data.scanner, pdf: data.pdfOptimiser })}
      </Alert>
      {error && <Alert tone="danger">{error}</Alert>}
      <Panel accent="blue" title={t('limitsTitle')} description={t('limitsHelp')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t('imageMb')}><Input type="number" min={0.001} step="0.5" value={form.image} onChange={set('image')} /></FormField>
          <FormField label={t('documentMb')}><Input type="number" min={0.001} step="0.5" value={form.document} onChange={set('document')} /></FormField>
          <FormField label={t('csvMb')}><Input type="number" min={0.001} step="0.5" value={form.csv} onChange={set('csv')} /></FormField>
          <FormField label={t('quotaMb')}><Input type="number" min={1} value={form.userQuota} onChange={set('userQuota')} /></FormField>
          <FormField label={t('ttl')} hint={t('ttlHint')}><Input type="number" min={5} max={300} value={form.ttl} onChange={set('ttl')} /></FormField>
          <FormField label={t('purge')}><Input type="number" min={1} value={form.purge} onChange={set('purge')} /></FormField>
        </div>
        <div className="mt-4 flex justify-end"><Button className="glow-gold" loading={save.isPending} onClick={() => void onSave()}>{tc('save')}</Button></div>
      </Panel>
      <Panel accent="green" title={t('typesTitle')} description={t('typesHelp')}>
        <ul className="flex flex-wrap gap-2 text-sm">
          {data.allowed.map((a) => <li key={a.extension} className="rounded-md border border-line bg-ivory-100 px-2 py-1 font-mono">.{a.extension}</li>)}
        </ul>
        <p className="mt-3 text-[0.8125rem] text-muted">{t('blocked')}</p>
      </Panel>
      <p className="text-sm"><Link className="font-medium text-blue-700 hover:underline" href="/admin/integrations">{t('failuresLink')}</Link></p>
    </div>
  );
}
