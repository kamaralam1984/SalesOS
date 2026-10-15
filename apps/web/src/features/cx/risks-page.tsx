'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Plus, Siren } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Pagination, Select, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useList, type Risk } from './api';
import { ListShell, NoteDialog, useFmt, usePaginationLabels } from './shared';

const STATUSES = ['OPEN', 'MITIGATING', 'RESOLVED', 'ACCEPTED'] as const;

export function RisksPage() {
  return (
    <RequirePermission permission="founder-reports:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const labels = usePaginationLabels();
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [edit, setEdit] = React.useState<Risk | 'new' | null>(null);
  const [resolving, setResolving] = React.useState<Risk | null>(null);
  const query = useList<Risk>(ck('risks', 'list'), '/risk-register', { page, limit: 12, status: status || undefined });
  const update = useAction<{ id: string; [k: string]: unknown }, Risk>('patch', (i) => `/risk-register/${i.id}`);
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('risks.title')} description={t('risks.description')} actions={<Can permission="founder-reports:create"><Button onClick={() => setEdit('new')}><Plus className="size-4" aria-hidden="true" />{t('risks.new')}</Button></Can>} />
      <div className="mb-4 w-full max-w-60"><FormField label={t('risks.status')} hideLabel><Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">{t('risks.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`risks.statusValue.${s}`)}</option>)}</Select></FormField></div>
      <ListShell query={query} skeletons={3}>
        {query.data && query.data.items.length === 0 ? (
          <EmptyState icon={<Siren className="size-6" aria-hidden="true" />} title={status ? tc('noMatches') : t('risks.empty')} description={t('risks.emptyHint')} />
        ) : (
          <>
            <ul className="stagger grid gap-3 md:grid-cols-2" aria-label={t('risks.listLabel')}>
              {query.data?.items.map((r) => (
                <li key={r.id} className={`hover-lift rounded-lg border border-line bg-surface p-4 shadow-xs ${r.severity >= 3 && r.status !== 'RESOLVED' ? 'accent-top' : ''}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone={r.severity >= 3 ? 'red' : r.severity === 2 ? 'gold' : 'neutral'}>{r.severity >= 3 && <AlertTriangle className="mr-1 size-3" aria-hidden="true" />}{t(`reports.sev.${r.severity}` as never)}</Badge>
                    <Badge tone="blue">{t(`risks.statusValue.${r.status}` as never)}</Badge>
                    {r.earlyWarning && <Badge tone="gold">{t('risks.earlyWarning')}</Badge>}
                    {!r.hasSolution && r.status !== 'RESOLVED' && <Badge tone="red"><AlertTriangle className="mr-1 size-3" aria-hidden="true" />{t('risks.noSolution')}</Badge>}
                  </div>
                  <p className="font-medium text-ink">{r.title}</p>
                  <p className="mt-0.5 text-sm text-ink-700">{r.description}</p>
                  <p className="mt-2 text-sm"><span className="font-medium text-ink">{t('reports.proposedSolution')}: </span>{r.proposedSolution || <span className="inline-flex items-center gap-1 text-red-700"><AlertTriangle className="size-3.5" aria-hidden="true" />{t('risks.solutionMissing')}</span>}</p>
                  {r.resolutionNote && <p className="mt-1 text-sm text-ink-700">{r.resolutionNote}</p>}
                  <p className="mt-2 text-xs text-muted">{t('complaints.owner')}: {r.ownerName ?? '—'} · {t('risks.raised', { when: fmt.date(r.raisedAt) })}</p>
                  <Can permission="founder-reports:create">
                    {r.status !== 'RESOLVED' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>{t('risks.edit')}</Button>
                        {r.status === 'OPEN' && <Button size="sm" variant="ghost" loading={update.isPending && update.variables?.id === r.id} onClick={() => update.mutate({ id: r.id, status: 'MITIGATING' })}>{t('risks.startMitigation')}</Button>}
                        <Button size="sm" onClick={() => { update.reset(); setResolving(r); }}>{t('risks.resolve')}</Button>
                      </div>
                    )}
                  </Can>
                </li>
              ))}
            </ul>
            <Pagination className="mt-5" page={page} hasNext={Boolean(query.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
          </>
        )}
      </ListShell>
      <RiskDialog value={edit} onClose={() => setEdit(null)} />
      {resolving && <NoteDialog open onOpenChange={(o) => !o && setResolving(null)} title={t('risks.resolve')} description={t('risks.resolveHint')} label={t('risks.resolutionNote')} submitLabel={t('risks.resolve')} pending={update.isPending} error={update.error} onSubmit={(resolutionNote) => update.mutate({ id: resolving.id, status: 'RESOLVED', resolutionNote }, { onSuccess: () => setResolving(null) })} />}
    </>
  );
}

function RiskDialog({ value, onClose }: { value: Risk | 'new' | null; onClose: () => void }) {
  const t = useTranslations('cx');
  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={value === 'new' ? t('risks.newTitle') : t('risks.edit')} description={t('risks.formHint')} closeLabel={t('common.close')} size="lg">
        {value !== null && <RiskForm risk={value === 'new' ? null : value} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RiskForm({ risk, onDone }: { risk: Risk | null; onDone: () => void }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const save = useAction<Record<string, unknown>, Risk>(risk ? 'patch' : 'post', risk ? `/risk-register/${risk.id}` : '/risk-register');
  const [f, setF] = React.useState({ title: risk?.title ?? '', description: risk?.description ?? '', severity: String(risk?.severity ?? 2), proposedSolution: risk?.proposedSolution ?? '', earlyWarning: risk?.earlyWarning ?? false });
  const invalid = f.title.trim().length < 3 || f.description.trim().length < 3;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate({ title: f.title.trim(), description: f.description.trim(), severity: Number(f.severity), proposedSolution: f.proposedSolution.trim(), earlyWarning: f.earlyWarning }, { onSuccess: onDone }); }}>
      {save.isError && <Alert tone="danger">{apiErr(save.error).message}</Alert>}
      <FormField label={t('reports.riskTitle')} required><Input value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} maxLength={200} /></FormField>
      <FormField label={t('reports.riskDescription')} required><Textarea rows={3} value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} maxLength={4000} /></FormField>
      <FormField label={t('reports.proposedSolution')} hint={t('risks.solutionHint')}><Textarea rows={3} value={f.proposedSolution} onChange={(e) => setF((p) => ({ ...p, proposedSolution: e.target.value }))} maxLength={3000} /></FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('reports.severity')}><Select value={f.severity} onChange={(e) => setF((p) => ({ ...p, severity: e.target.value }))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{t(`reports.sev.${n}` as never)}</option>)}</Select></FormField>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" className="size-4 accent-gold-600" checked={f.earlyWarning} onChange={(e) => setF((p) => ({ ...p, earlyWarning: e.target.checked }))} />{t('risks.earlyWarningLabel')}</label>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={save.isPending} disabled={invalid}>{risk ? t('risks.save') : t('risks.create')}</Button>
      </div>
    </form>
  );
}
