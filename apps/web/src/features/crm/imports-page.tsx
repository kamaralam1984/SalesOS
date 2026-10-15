'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { Alert, Badge, Button, Combobox, DataTable, FormField, Input, Panel, Select, StatusBadge, cn, useToast, type Column } from '@salesos/ui';
import { PageHeader } from './motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { Can } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useAssignableUsers, useLeadMeta } from '@/lib/api/hooks/crm';
import {
  downloadImportReport,
  previewImport,
  useCreateImport,
  useImportErrors,
  useImportJob,
  useImports,
  useRetryImport,
  type ImportJob,
  type ImportOptions,
  type ImportPreview,
} from '@/lib/api/hooks/crm-admin';
import { CrmFrame, useCrmFormat } from './common';
import { Hint } from '@/features/hints/hint-views';

export const IMPORT_FIELDS = ['fullName', 'phone', 'email', 'source', 'program', 'interestLevel', 'consentStatus', 'estimatedValue', 'preferredLanguage', 'ownerEmail', 'note'] as const;
const MAX_BYTES = 5 * 1024 * 1024;

export function ImportsPage() {
  return (
    <RequirePermission permission={['leads:import', 'imports:view']}>
      <CrmFrame>
        <ImportsInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function ImportsInner() {
  const t = useTranslations('crm.imports');
  const [jobId, setJobId] = React.useState<string | null>(null);
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <div className="space-y-6">
        <Can permission="leads:import">
          {jobId ? <ProgressStep id={jobId} onReset={() => setJobId(null)} /> : <ImportWizard onSubmitted={setJobId} />}
        </Can>
        <History onOpen={setJobId} />
      </div>
    </>
  );
}

const STEPS = ['upload', 'map', 'options'] as const;

/** Upload -> map columns -> options -> submit. Everything before submit is local or a read-only preview call. */
export function ImportWizard({ onSubmitted }: { onSubmitted: (jobId: string) => void }) {
  const t = useTranslations('crm.imports');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const meta = useLeadMeta();
  const users = useAssignableUsers();
  const create = useCreateImport();
  const [step, setStep] = React.useState<(typeof STEPS)[number]>('upload');
  const [csv, setCsv] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [template, setTemplate] = React.useState<NonNullable<ImportOptions['template']>>('GENERIC');
  const [opts, setOpts] = React.useState<{ sourceId: string; programId: string; assignment: ImportOptions['assignment']; assigneeId: string | null; consentStatus: string }>({ sourceId: '', programId: '', assignment: 'none', assigneeId: null, consentStatus: 'UNKNOWN' });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [key] = React.useState(() => `ui-import-${Math.random().toString(36).slice(2)}`);

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setError(t('tooLarge'));
    if (!/\.csv$/i.test(file.name) && !file.type.includes('csv')) return setError(t('notCsv'));
    setBusy(true);
    try {
      const text = await file.text();
      const p = await previewImport(text, file.name, { assignment: 'none', template });
      setCsv(text);
      setFileName(file.name);
      setPreview(p);
      setMapping(Object.fromEntries(Object.entries(p.mapping).map(([f, i]) => [f, p.header[i] ?? ''])));
      setStep('map');
    } catch (e) {
      setError(apiErr(e).message);
    } finally {
      setBusy(false);
    }
  }

  const problems = !mapping.fullName && preview?.nameFrom !== 'firstLast' ? [t('needName')] : !mapping.phone && !mapping.email ? [t('needContact')] : [];

  async function submit() {
    setError(null);
    try {
      const options: ImportOptions = { mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)), assignment: opts.assignment, consentStatus: opts.consentStatus, template };
      if (opts.sourceId) options.sourceId = opts.sourceId;
      if (opts.programId) options.programId = opts.programId;
      if (opts.assignment === 'user') options.assigneeId = opts.assigneeId;
      const r = await create.mutateAsync({ csv, fileName, options, key });
      onSubmitted(r.data.id);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  return (
    <Panel accent="blue" title={t('wizardTitle')} description={t('wizardDescription')}>
      <ol aria-label={t('steps')} className="enter-fade mb-5 flex gap-2 overflow-x-auto pb-1 text-sm [scrollbar-width:none] [&>li]:shrink-0">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={s === step ? 'step' : undefined} className={cn('rounded-full border px-3 py-1', s === step ? 'border-gold-500 bg-gold-50 font-medium text-ink shadow-[var(--tone-glow-gold)]' : 'border-line text-muted')}>
            {i + 1}. {t(`step_${s}`)}
          </li>
        ))}
      </ol>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      {step === 'upload' && (
        <div className="space-y-3">
          <FormField label={t('template')} hint={t('templateHint')}>
            <Select value={template} onChange={(e) => setTemplate(e.target.value as typeof template)}>
              {(['GENERIC', 'LEADSQUARED', 'ZOHO', 'HUBSPOT'] as const).map((k) => (<option key={k} value={k}>{t(`template_${k}`)}</option>))}
            </Select>
          </FormField>
          <FormField label={t('file')} hint={t('fileHint')} info={<Hint id="importIdempotent" />}>
            <Input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
          </FormField>
          {busy && <p role="status" className="text-sm text-muted">{t('reading')}</p>}
          <p className="text-xs text-muted">{t('privacy')}</p>
        </div>
      )}

      {step === 'map' && preview && (
        <div className="space-y-4">
          <p className="text-sm text-ink-700">{t('previewSummary', { name: fileName, rows: preview.totalRows })}</p>
          {preview.problems.length > 0 && <Alert tone="warning">{preview.problems.join('; ')}</Alert>}
          {preview.nameFrom === 'firstLast' && <Alert tone="info">{t('nameFromFirstLast')}</Alert>}
          {preview.dryRun && (
            <Alert tone={preview.dryRun.rowsWithProblems > 0 ? 'warning' : 'success'} title={t('dryRunTitle')}>
              {t('dryRunSummary', { problems: preview.dryRun.rowsWithProblems, rows: preview.totalRows, name: preview.dryRun.missingName, contact: preview.dryRun.missingContact, email: preview.dryRun.invalidEmail })}
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((f) => (
              <FormField key={f} label={t(`field_${f}`)} required={f === 'fullName'}>
                <Select value={mapping[f] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}>
                  <option value="">{t('notMapped')}</option>
                  {preview.header.map((h) => (<option key={h} value={h}>{h}</option>))}
                </Select>
              </FormField>
            ))}
          </div>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[32rem] text-xs">
              <caption className="sr-only">{t('sample')}</caption>
              <thead className="bg-ivory-100 text-left"><tr>{preview.header.map((h) => (<th key={h} scope="col" className="px-2 py-1.5 font-medium">{h}</th>))}</tr></thead>
              <tbody>{preview.sample.map((r, i) => (<tr key={i} className="border-t border-line">{r.map((c, j) => (<td key={j} className="px-2 py-1.5">{c}</td>))}</tr>))}</tbody>
            </table>
          </div>
          {problems.map((p) => (<Alert key={p} tone="danger">{p}</Alert>))}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setStep('upload'); setPreview(null); }}>{tc('cancel')}</Button>
            <Button disabled={problems.length > 0} onClick={() => setStep('options')}>{t('next')}</Button>
          </div>
        </div>
      )}

      {step === 'options' && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('defaultSource')}>
              <Select value={opts.sourceId} onChange={(e) => setOpts((o) => ({ ...o, sourceId: e.target.value }))}>
                <option value="">{t('none')}</option>
                {(meta.data?.sources ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </Select>
            </FormField>
            <FormField label={t('defaultProgram')}>
              <Select value={opts.programId} onChange={(e) => setOpts((o) => ({ ...o, programId: e.target.value }))}>
                <option value="">{t('none')}</option>
                {(meta.data?.programs ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </Select>
            </FormField>
            <FormField label={t('assignment')} hint={t('assignmentHint')}>
              <Select value={opts.assignment} onChange={(e) => setOpts((o) => ({ ...o, assignment: e.target.value as ImportOptions['assignment'] }))}>
                <option value="none">{t('assignNone')}</option>
                <option value="round_robin">{t('assignRoundRobin')}</option>
                <option value="user">{t('assignUser')}</option>
              </Select>
            </FormField>
            {opts.assignment === 'user' && (
              <FormField label={t('assignee')} required>
                <Combobox options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name, description: u.email }))} value={opts.assigneeId} onValueChange={(v) => setOpts((o) => ({ ...o, assigneeId: v }))} loading={users.isPending} placeholder={t('assigneePlaceholder')} emptyText={tc('noMatches')} clearLabel={tc('clear')} />
              </FormField>
            )}
            <FormField label={t('consent')} hint={t('consentHint')} info={<Hint id="importConsent" />}>
              <Select value={opts.consentStatus} onChange={(e) => setOpts((o) => ({ ...o, consentStatus: e.target.value }))}>
                <option value="UNKNOWN">{t('consentUNKNOWN')}</option>
                <option value="GRANTED">{t('consentGRANTED')}</option>
              </Select>
            </FormField>
          </div>
          <Alert tone="info">{t('idempotencyNote')}</Alert>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep('map')}>{t('back')}</Button>
            <Button className="glow-gold" leadingIcon={<Upload className="size-4" aria-hidden="true" />} loading={create.isPending} loadingLabel={tc('saving')} disabled={opts.assignment === 'user' && !opts.assigneeId} onClick={() => void submit()}>{t('startImport', { rows: preview?.totalRows ?? 0 })}</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

const DONE = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'];

export function JobStatusBadge({ status }: { status: ImportJob['status'] }) {
  const t = useTranslations('crm.imports');
  const s = status === 'COMPLETED' ? 'success' : status === 'FAILED' ? 'danger' : status === 'COMPLETED_WITH_ERRORS' ? 'warning' : 'pending';
  return <StatusBadge status={s}>{t(`status_${status}` as 'status_QUEUED')}</StatusBadge>;
}

function ProgressStep({ id, onReset }: { id: string; onReset: () => void }) {
  const t = useTranslations('crm.imports');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const job = useImportJob(id);
  const finished = job.data ? DONE.includes(job.data.status) : false;
  const errs = useImportErrors(id, finished);
  const retry = useRetryImport();
  const [dlError, setDlError] = React.useState<string | null>(null);
  const j = job.data;
  if (job.isError) return <Alert tone="danger">{apiErr(job.error).message}</Alert>;
  if (!j) return <p role="status">{t('loadingJob')}</p>;
  return (
    <Panel title={t('progressTitle', { name: j.fileName ?? '' })} actions={<JobStatusBadge status={j.status} />}>
      <div className="space-y-4">
        <div>
          <div role="progressbar" aria-label={t('progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.progressPercent} className="h-2.5 overflow-hidden rounded-full bg-ivory-300">
            <div className={`h-full transition-[width] duration-500 ${j.status === 'COMPLETED' ? 'bg-green-600 glow-green' : 'bg-blue-600 glow-blue'}`} style={{ width: `${j.progressPercent}%` }} />
          </div>
          <p className="mt-1 text-sm text-muted" aria-live="polite">{t('progressText', { done: j.processedRows, total: j.totalRows })}</p>
        </div>
        <dl className="stagger grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted">{t('created')}</dt><dd className="text-lg font-semibold">{j.createdRows}</dd></div>
          <div><dt className="text-xs text-muted">{t('duplicates')}</dt><dd className="text-lg font-semibold">{j.duplicateRows}</dd></div>
          <div><dt className="text-xs text-muted">{t('errors')}</dt><dd className="text-lg font-semibold">{j.errorRows}</dd></div>
          <div><dt className="text-xs text-muted">{t('attempts')}</dt><dd className="text-lg font-semibold">{j.attempts}</dd></div>
        </dl>
        {!finished && <Alert tone="info">{t('workerNote')}</Alert>}
        {j.lastError && <Alert tone="danger">{j.lastError}</Alert>}
        {finished && j.duplicateRows > 0 && <Alert tone="warning">{t('duplicatesNote', { count: j.duplicateRows })}</Alert>}
        {finished && (errs.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">{t('errorReport')}</caption>
              <thead className="bg-ivory-100 text-left text-xs"><tr><th scope="col" className="px-3 py-2">{t('row')}</th><th scope="col" className="px-3 py-2">{t('severity')}</th><th scope="col" className="px-3 py-2">{t('field')}</th><th scope="col" className="px-3 py-2">{t('message')}</th></tr></thead>
              <tbody>
                {errs.data!.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="px-3 py-2 tabular">{e.rowNumber}</td>
                    <td className="px-3 py-2"><Badge tone={e.severity === 'ERROR' ? 'red' : 'gold'}>{e.severity === 'ERROR' ? t('sevError') : t('sevWarning')}</Badge></td>
                    <td className="px-3 py-2">{e.field ?? '—'}</td>
                    <td className="px-3 py-2">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dlError && <Alert tone="danger">{dlError}</Alert>}
        <div className="flex flex-wrap gap-2">
          {finished && (j.errorRows > 0 || (errs.data?.length ?? 0) > 0) && (
            <Button variant="secondary" leadingIcon={<Download className="size-4" aria-hidden="true" />} onClick={async () => { setDlError(null); try { await downloadImportReport(id); } catch (e) { setDlError(apiErr(e).message); } }}>{t('downloadReport')}</Button>
          )}
          {finished && j.status !== 'COMPLETED' && (
            <Can permission="imports:manage">
              <Button variant="secondary" leadingIcon={<RotateCcw className="size-4" aria-hidden="true" />} loading={retry.isPending} onClick={async () => { try { await retry.mutateAsync(id); toast({ tone: 'info', title: t('retryQueued') }); } catch (e) { setDlError(apiErr(e).message); } }}>{t('retry')}</Button>
            </Can>
          )}
          <Button variant="ghost" onClick={onReset}>{t('newImport')}</Button>
        </div>
      </div>
    </Panel>
  );
}

function History({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useTranslations('crm.imports');
  const tc = useTranslations('common');
  const f = useCrmFormat();
  const err = useApiErrorMessage();
  const q = useImports();
  const columns: Column<ImportJob>[] = [
    { id: 'file', header: t('colFile'), primary: true, cell: (j) => j.fileName ?? j.id.slice(0, 8) },
    { id: 'status', header: t('colStatus'), cell: (j) => <JobStatusBadge status={j.status} /> },
    { id: 'rows', header: t('colRows'), cell: (j) => t('rowsSummary', { created: j.createdRows, errors: j.errorRows, total: j.totalRows }) },
    { id: 'when', header: t('colWhen'), hideOnMobile: true, cell: (j) => f.dateTime(j.createdAt) },
  ];
  return (
    <Panel title={t('historyTitle')}>
      <DataTable
        caption={t('historyTitle')}
        columns={columns}
        rows={q.data}
        getRowId={(j) => j.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={q.isError ? { message: err(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('historyEmpty')}
        emptyDescription={t('historyEmptyDescription')}
        actionsHeader={tc('actions')}
        rowActions={(j) => (<Button size="sm" variant="secondary" onClick={() => onOpen(j.id)}>{t('open')}</Button>)}
      />
    </Panel>
  );
}
