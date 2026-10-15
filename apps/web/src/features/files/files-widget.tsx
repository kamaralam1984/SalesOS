'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, RotateCcw, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, ErrorState, Skeleton, cn, useToast } from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ApiError } from '@/lib/api/client';
import { getDownloadUrl, uploadFile, useFileActions, useFileList, type FileDto } from '@/lib/api/hooks/platform';
import { useQueryClient } from '@tanstack/react-query';

interface Pending {
  key: string;
  file: File;
  pct: number;
  state: 'uploading' | 'failed';
  error?: string;
  abort?: () => void;
}

const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.csv';
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Reusable upload + list widget. Upload progress, failure + retry, honest processing/scan status, signed-URL download.
 * Pass entityType/entityId to attach files to a record (they then inherit that record's access scope).
 */
export function FilesWidget({ entityType, entityId, purpose, title }: { entityType?: string; entityId?: string; purpose?: string; title?: string }) {
  const t = useTranslations('platform.files');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useFileList({ entityType, entityId });
  const { retry, remove } = useFileActions();
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [over, setOver] = React.useState(false);
  const inputId = React.useId();

  const start = React.useCallback(
    (file: File, key = `${file.name}-${Date.now()}-${Math.random()}`) => {
      const h = uploadFile(file, { entityType, entityId, purpose, onProgress: (pct) => setPending((p) => p.map((x) => (x.key === key ? { ...x, pct } : x))) });
      setPending((p) => [...p.filter((x) => x.key !== key), { key, file, pct: 0, state: 'uploading', abort: h.abort }]);
      h.promise.then(
        () => {
          setPending((p) => p.filter((x) => x.key !== key));
          void qc.invalidateQueries({ queryKey: ['files'] });
        },
        (e: unknown) => {
          if (e instanceof ApiError && e.code === 'ABORTED') return setPending((p) => p.filter((x) => x.key !== key));
          setPending((p) => p.map((x) => (x.key === key ? { ...x, state: 'failed', error: e instanceof ApiError ? e.message : apiErr(e).message } : x)));
        },
      );
    },
    [entityType, entityId, purpose, qc, apiErr],
  );

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) start(f);
  };

  async function download(f: FileDto) {
    try {
      const url = await getDownloadUrl(f.id);
      window.location.assign(url);
    } catch (e) {
      toast({ tone: 'danger', title: t('downloadFailed'), description: apiErr(e).message });
    }
  }

  return (
    <section aria-label={title ?? t('title')} className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
        className={cn('rounded-lg border border-dashed p-5 text-center', over ? 'border-gold-500 bg-gold-50' : 'border-line-strong bg-ivory-100')}
      >
        <Upload aria-hidden="true" className="mx-auto mb-2 size-6 text-ink-600" />
        <p className="text-sm text-ink">{t('dropHint')}</p>
        <p className="mt-1 text-xs text-muted">{t('allowed')}</p>
        <input id={inputId} data-testid="file-input" type="file" accept={ACCEPT} multiple className="sr-only" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        <Button asChild variant="secondary" className="mt-3">
          <label htmlFor={inputId} className="cursor-pointer">{t('choose')}</label>
        </Button>
      </div>

      {pending.length > 0 && (
        <ul className="space-y-2" aria-label={t('uploads')}>
          {pending.map((p) => (
            <li key={p.key} className="rounded-md border border-line bg-surface p-3" data-testid="upload-row" data-state={p.state}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium">{p.file.name}</span>
                {p.state === 'uploading' ? (
                  <Button size="sm" variant="ghost" onClick={() => p.abort?.()}>{tc('cancel')}</Button>
                ) : (
                  <span className="flex gap-2">
                    <Button size="sm" variant="secondary" leadingIcon={<RotateCcw aria-hidden="true" className="size-4" />} onClick={() => start(p.file, p.key)}>{t('retryUpload')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>{t('dismiss')}</Button>
                  </span>
                )}
              </div>
              {p.state === 'uploading' ? (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-ivory-300" role="progressbar" aria-label={p.file.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct}>
                  <div className="h-full bg-gold-500 transition-[width]" style={{ width: `${p.pct}%` }} />
                </div>
              ) : (
                <p className="mt-1 text-[0.8125rem] text-red-700" role="alert">{p.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {list.isPending ? (
        <div role="status"><span className="sr-only">{tc('loading')}</span><Skeleton className="h-16 w-full" /></div>
      ) : list.isError ? (
        <ErrorState compact description={apiErr(list.error).message} onRetry={() => void list.refetch()} retryLabel={tc('retry')} />
      ) : list.data.length === 0 && pending.length === 0 ? (
        <EmptyState compact icon={<FileText />} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface" aria-label={t('listLabel')}>
          {list.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-start gap-3 px-3 py-3" data-testid="file-row" data-status={f.status}>
              <FileText aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{f.displayName} <span className="font-normal text-muted">({fmtSize(f.sizeBytes)})</span></p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusChip f={f} />
                  <ScanChip f={f} />
                </p>
                {(f.status === 'PENDING' || f.status === 'SCANNING' || f.status === 'PROCESSING') && (
                  <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-ivory-300" role="progressbar" aria-label={t('processing')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.progress}>
                    <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.max(5, f.progress)}%` }} />
                  </div>
                )}
                {f.processingNote && f.status !== 'FAILED' && <p className="mt-1 text-[0.8125rem] text-muted">{f.processingNote}</p>}
                {f.status === 'FAILED' && <Alert tone="danger" className="mt-2" live={false}>{t('failedNote')} {f.lastError && <span className="text-muted">({f.lastError})</span>}</Alert>}
              </div>
              <div className="flex gap-2">
                {f.downloadable && (
                  <Button size="sm" variant="secondary" leadingIcon={<Download aria-hidden="true" className="size-4" />} onClick={() => void download(f)}>{t('download')}</Button>
                )}
                {f.status === 'FAILED' && (
                  <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === f.id} leadingIcon={<RotateCcw aria-hidden="true" className="size-4" />} onClick={() => retry.mutate(f.id)}>{t('retry')}</Button>
                )}
                <Button size="sm" variant="ghost" aria-label={`${t('delete')} ${f.displayName}`} leadingIcon={<Trash2 aria-hidden="true" className="size-4" />} onClick={() => remove.mutate(f.id)}>{t('delete')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusChip({ f }: { f: FileDto }) {
  const t = useTranslations('platform.files');
  if (f.status === 'READY') return <Badge tone="green" icon={<CheckCircle2 />}>{t('status.READY')}</Badge>;
  if (f.status === 'REJECTED') return <Badge tone="red" icon={<ShieldAlert />}>{t('status.REJECTED')}</Badge>;
  if (f.status === 'FAILED') return <Badge tone="red" icon={<AlertTriangle />}>{t('status.FAILED')}</Badge>;
  return <Badge tone="blue" icon={<Loader2 className="animate-spin motion-reduce:animate-none" />}>{t(`status.${f.status}`)}</Badge>;
}

function ScanChip({ f }: { f: FileDto }) {
  const t = useTranslations('platform.files');
  if (f.status === 'PENDING') return null;
  const key = f.scanStatus === 'CLEAN' ? 'CLEAN' : f.scanStatus === 'INFECTED' ? 'INFECTED' : f.scanStatus === 'NOT_SCANNED' ? 'NOT_SCANNED' : f.scanStatus === 'ERROR' ? 'ERROR' : 'PENDING';
  return <Badge tone={key === 'CLEAN' ? 'green' : key === 'INFECTED' || key === 'ERROR' ? 'red' : 'neutral'}>{t(`scan.${key}`)}</Badge>;
}
