'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Alert, Button, useToast } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { type AnalyticsQuery, type ExportRecord, downloadExport, useCreateExport, useExportStatus } from '@/lib/api/hooks/analytics';

/**
 * Export buttons, shown only to holders of reports:export (the server re-checks and applies scope + row caps; exports are audited).
 * Small exports are ready immediately; large ones are queued, polled, and offered for download when the worker finishes.
 */
export function ExportButtons({ report, params, size = 'sm' }: { report: string; params: AnalyticsQuery; size?: 'sm' | 'md' }) {
  const t = useTranslations('analytics.export');
  const err = useApiErrorMessage();
  const { toast } = useToast();
  const create = useCreateExport();
  const [pending, setPending] = React.useState<string | null>(null);
  const status = useExportStatus(pending);
  const record: ExportRecord | undefined = status.data ?? (create.data && create.data.id === pending ? create.data : undefined);

  const start = (format: 'CSV' | 'XLSX') => {
    create.mutate(
      { report, format, params },
      {
        onSuccess: (r) => {
          setPending(r.id);
          if (r.status === 'READY') void finish(r);
          else toast({ title: t('queued'), description: t('queuedHint'), tone: 'info' });
        },
        onError: (e) => toast({ title: t('failed'), description: err(e).message, tone: 'danger' }),
      },
    );
  };
  const finish = async (r: ExportRecord) => {
    try {
      await downloadExport(r);
      toast({ title: t('downloaded', { rows: r.rowCount ?? 0 }), description: r.truncated ? t('truncated', { cap: r.rowCap }) : undefined, tone: r.truncated ? 'warning' : 'success' });
    } catch (e) {
      toast({ title: t('failed'), description: err(e).message, tone: 'danger' });
    }
  };
  const downloaded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (record?.status === 'READY' && record.id !== downloaded.current && pending === record.id && create.data?.status !== 'READY') {
      downloaded.current = record.id;
      void finish(record);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.status, record?.id]);

  return (
    <Can permission="reports:export">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('group')}>
        <Button variant="secondary" size={size} loading={create.isPending} onClick={() => start('CSV')} leadingIcon={<FileText className="size-4" aria-hidden="true" />}>
          {t('csv')}
        </Button>
        <Button variant="secondary" size={size} loading={create.isPending} onClick={() => start('XLSX')} leadingIcon={<FileSpreadsheet className="size-4" aria-hidden="true" />}>
          {t('xlsx')}
        </Button>
        {record && (record.status === 'QUEUED' || record.status === 'RUNNING') && (
          <span role="status" className="text-[0.8125rem] text-muted">
            {t('working')}
          </span>
        )}
        {record?.status === 'READY' && (
          <Button variant="ghost" size={size} onClick={() => void finish(record)} leadingIcon={<Download className="size-4" aria-hidden="true" />}>
            {t('again', { rows: record.rowCount ?? 0 })}
          </Button>
        )}
      </div>
      {record?.status === 'FAILED' && <Alert tone="danger" className="mt-2">{t('failedServer')}</Alert>}
    </Can>
  );
}
