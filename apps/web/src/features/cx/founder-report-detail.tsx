'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Hourglass, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, ErrorState, FormField, Input, PageHeader, Panel, Select, Skeleton, StatusBadge, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useList, useOne, type FounderReport, type ReportRisk, type ReportSections, type ReportSnapshot, type Risk } from './api';
import { useFmt } from './shared';

export function FounderReportDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="founder-reports:view">
      <Inner id={id} />
    </RequirePermission>
  );
}

/** Mirrors @salesos/cx-core reportCompleteness (DEC-028) so the meter updates while typing. The server recomputes on publish. */
export function completeness(s: ReportSections) {
  const risks = s.risks?.items ?? [];
  const checks = {
    performance: Boolean(s.performance?.narrative?.trim()),
    risks: (risks.length > 0 && risks.every((r) => r.proposedSolution?.trim())) || (risks.length === 0 && s.risks?.noneConfirmed === true),
    opportunities: (s.opportunities?.items?.length ?? 0) > 0 || s.opportunities?.noneConfirmed === true,
    actionItems: s.actionItems?.reviewed === true,
  };
  return { pct: Math.round((Object.values(checks).filter(Boolean).length / 4) * 100), checks };
}

function Inner({ id }: { id: string }) {
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const query = useOne<FounderReport>(ck('reports', id), `/founder-reports/${id}`);
  if (query.isPending) return <div className="space-y-3" aria-busy="true" aria-label={tc('loading')}><Skeleton className="h-10 w-2/3" /><Skeleton className="h-72" /></div>;
  if (query.isError) return <ErrorState description={apiErr(query.error).message} requestId={apiErr(query.error).requestId} onRetry={() => query.refetch()} retryLabel={tc('retry')} />;
  return query.data.status === 'DRAFT' ? <Builder key={`${query.data.id}-${query.data.version}`} report={query.data} /> : <Published report={query.data} />;
}

function Header({ r }: { r: FounderReport }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  return (
    <PageHeader
      eyebrow={t('reports.eyebrow')}
      title={r.title}
      description={`${fmt.date(r.periodStart)} – ${fmt.date(r.periodEnd)} · ${t('reports.due')}: ${fmt.dateTime(r.dueAt)}`}
      breadcrumbs={[{ label: t('reports.title'), href: '/cx/founder-reports' }, { label: r.title }]}
      breadcrumbLabel={tc('breadcrumb')}
    />
  );
}

// ------------------------------------------------------------------ draft builder
function Builder({ report }: { report: FounderReport }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const [s, setS] = React.useState<ReportSections>(report.sections ?? {});
  const [dirty, setDirty] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const save = useAction<{ sections: ReportSections; version: number }, FounderReport>('patch', `/founder-reports/${report.id}`);
  const publish = useAction<Record<string, never>, FounderReport>('post', `/founder-reports/${report.id}/submit`);
  const register = useList<Risk>(ck('risks', 'open'), '/risk-register', { limit: 50 });
  const edit = (fn: (p: ReportSections) => ReportSections) => { setS(fn); setDirty(true); };
  const c = completeness(s);
  const risks = s.risks?.items ?? [];
  const unsolved = risks.filter((r) => !r.proposedSolution?.trim());
  const canPublish = Boolean(s.performance?.narrative?.trim()) && unsolved.length === 0;
  const doPublish = async () => {
    try {
      if (dirty) await save.mutateAsync({ sections: s, version: report.version });
      await publish.mutateAsync({});
      setConfirm(false);
    } catch (e) {
      setConfirm(false);
      if (!(e instanceof ApiError)) throw e;
    }
  };
  const updateRisk = (i: number, patch: Partial<ReportRisk>) => edit((p) => ({ ...p, risks: { ...p.risks, items: (p.risks?.items ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)) } }));
  const importable = (register.data?.items ?? []).filter((r) => r.status !== 'RESOLVED' && !risks.some((x) => x.riskId === r.id));

  return (
    <>
      <Header r={report} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <StatusBadge status={report.overdue ? 'overdue' : 'pending'}>{report.overdue ? t('reports.overdue') : t('reports.statusDRAFT')}</StatusBadge>
        <Badge tone="blue">{t(`reports.type${report.type}` as never)}</Badge>
        {report.versionNumber > 1 && <Badge tone="gold">{t('reports.correctionOf', { n: report.versionNumber - 1 })}</Badge>}
        <div className="flex min-w-48 flex-1 items-center gap-2" aria-label={t('reports.completeness')}>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.pct} aria-label={t('reports.completeness')} className="h-2 flex-1 overflow-hidden rounded-full bg-ivory-300"><div className="h-full rounded-full bg-blue-600 transition-[width] motion-reduce:transition-none" style={{ width: `${c.pct}%` }} /></div>
          <span className="text-sm font-medium tabular-nums text-ink">{c.pct}%</span>
        </div>
      </div>
      {(save.isError || publish.isError) && <Alert tone="danger" className="mb-4">{apiErr(save.error ?? publish.error).message}</Alert>}
      <div className="stagger space-y-4">
        <Panel accent="gold" title={t('reports.dataTitle')} description={t('reports.dataHint')}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {report.dataSections?.map((d) => (
              <li key={d.key} className="rounded-lg border border-dashed border-line-strong bg-ivory-100/70 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-ink"><Hourglass className="size-4 text-gold-700" aria-hidden="true" />{d.label}</p>
                {d.status === 'DATA_PENDING_PHASE_5' ? <p className="mt-1 text-xs text-muted">{t('reports.dataPending')}</p> : <ul className="mt-1 text-sm">{d.metrics.map((m) => <li key={m.kpiId}>{m.label}: {m.value ?? t('common.dash')}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel accent="blue" title={t('reports.performance')} description={t('reports.performanceHint')}>
          <FormField label={t('reports.narrative')} required>
            <Textarea rows={6} value={s.performance?.narrative ?? ''} onChange={(e) => edit((p) => ({ ...p, performance: { ...p.performance, narrative: e.target.value } }))} maxLength={10_000} />
          </FormField>
        </Panel>

        <Panel accent="green" title={t('reports.risks')} description={t('reports.risksHint')}
          actions={importable.length > 0 ? (
            <FormField label={t('reports.importRisk')} hideLabel><Select value="" onChange={(e) => { const r = importable.find((x) => x.id === e.target.value); if (r) edit((p) => ({ ...p, risks: { ...p.risks, items: [...(p.risks?.items ?? []), { title: r.title, description: r.description, severity: r.severity, proposedSolution: r.proposedSolution ?? '', riskId: r.id }] } })); }}><option value="">{t('reports.importRisk')}</option>{importable.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</Select></FormField>
          ) : undefined}>
          <ul className="space-y-3">
            {risks.map((r, i) => (
              <li key={i} className="rounded-lg border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                  <FormField label={t('reports.riskTitle')} required><Input value={r.title} onChange={(e) => updateRisk(i, { title: e.target.value })} maxLength={200} /></FormField>
                  <FormField label={t('reports.severity')}><Select value={String(r.severity ?? 2)} onChange={(e) => updateRisk(i, { severity: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{t(`reports.sev.${n}` as never)}</option>)}</Select></FormField>
                </div>
                <FormField className="mt-3" label={t('reports.riskDescription')}><Textarea rows={2} value={r.description ?? ''} onChange={(e) => updateRisk(i, { description: e.target.value })} maxLength={3000} /></FormField>
                <FormField className="mt-3" label={t('reports.proposedSolution')} required hint={t('reports.solutionHint')} error={!r.proposedSolution?.trim() ? t('reports.solutionRequired') : undefined}>
                  <Textarea rows={2} value={r.proposedSolution ?? ''} onChange={(e) => updateRisk(i, { proposedSolution: e.target.value })} maxLength={3000} />
                </FormField>
                <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => edit((p) => ({ ...p, risks: { ...p.risks, items: (p.risks?.items ?? []).filter((_, j) => j !== i) } }))}><Trash2 className="size-4" aria-hidden="true" />{t('reports.remove')}</Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => edit((p) => ({ ...p, risks: { ...p.risks, noneConfirmed: false, items: [...(p.risks?.items ?? []), { title: '', severity: 2, proposedSolution: '' }] } }))}><Plus className="size-4" aria-hidden="true" />{t('reports.addRisk')}</Button>
            {risks.length === 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-gold-600" checked={Boolean(s.risks?.noneConfirmed)} onChange={(e) => edit((p) => ({ ...p, risks: { ...p.risks, noneConfirmed: e.target.checked } }))} />{t('reports.noRisks')}</label>}
          </div>
        </Panel>

        <ItemsPanel title={t('reports.opportunities')} hint={t('reports.opportunitiesHint')} items={s.opportunities?.items ?? []} noneConfirmed={s.opportunities?.noneConfirmed} noneLabel={t('reports.noOpportunities')} addLabel={t('reports.addOpportunity')}
          onChange={(items, noneConfirmed) => edit((p) => ({ ...p, opportunities: { items, noneConfirmed: noneConfirmed ?? p.opportunities?.noneConfirmed } }))} />
        <ItemsPanel title={t('reports.solutions')} hint={t('reports.solutionsHint')} items={s.solutions?.items ?? []} addLabel={t('reports.addSolution')}
          onChange={(items) => edit((p) => ({ ...p, solutions: { items } }))} />

        <Panel accent="gold" title={t('reports.actionItems')} description={t('reports.actionItemsHint')} actions={<Button asChild variant="secondary" size="sm"><Link href="/cx/action-items">{t('reports.openTracker')}</Link></Button>}>
          {report.actionItems && report.actionItems.length > 0 ? (
            <ul className="mb-3 space-y-1.5 text-sm">{report.actionItems.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2"><span className="text-ink">{a.title}</span><span className="text-muted">{t(`workStatus.${a.status}` as never)} · {fmt.date(a.dueAt)}</span></li>)}</ul>
          ) : <p className="mb-3 text-sm text-muted">{t('reports.noOpenActionItems')}</p>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-gold-600" checked={Boolean(s.actionItems?.reviewed)} onChange={(e) => edit((p) => ({ ...p, actionItems: { reviewed: e.target.checked } }))} />{t('reports.actionItemsReviewed')}</label>
        </Panel>
      </div>

      <Can permission="founder-reports:create">
        <div className="sticky bottom-0 z-10 mt-6 -mx-4 flex flex-col gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-lg sm:border">
          <p className="text-sm text-muted" role="status">{!canPublish ? (unsolved.length > 0 ? t('reports.blockedSolutions', { n: unsolved.length }) : t('reports.blockedNarrative')) : dirty ? t('reports.unsaved') : t('reports.saved')}</p>
          <div className="flex gap-2">
            <Button variant="secondary" loading={save.isPending && !publish.isPending} disabled={!dirty} onClick={() => save.mutate({ sections: s, version: report.version }, { onSuccess: () => setDirty(false) })}>{t('reports.saveDraft')}</Button>
            <Button disabled={!canPublish} onClick={() => setConfirm(true)}>{t('reports.publish')}</Button>
          </div>
        </div>
      </Can>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title={t('reports.publishTitle')} description={t('reports.publishDescription')} closeLabel={tc('close')}
          footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>{tc('cancel')}</Button><Button loading={publish.isPending || save.isPending} onClick={() => void doPublish()}><Lock className="size-4" aria-hidden="true" />{t('reports.publishConfirm')}</Button></>}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
            <li>{t('reports.publishImmutable')}</li>
            <li>{report.overdue ? t('reports.publishLate') : t('reports.publishOnTime', { due: fmt.dateTime(report.dueAt) })}</li>
            <li>{t('reports.publishCompleteness', { pct: c.pct })}</li>
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ItemsPanel({ title, hint, items, noneConfirmed, noneLabel, addLabel, onChange }: { title: string; hint: string; items: Array<{ title: string; description?: string }>; noneConfirmed?: boolean; noneLabel?: string; addLabel: string; onChange: (items: Array<{ title: string; description?: string }>, noneConfirmed?: boolean) => void }) {
  const t = useTranslations('cx');
  return (
    <Panel accent="blue" title={title} description={hint}>
      <ul className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
            <FormField label={t('reports.itemTitle')}><Input value={it.title} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} maxLength={200} /></FormField>
            <FormField label={t('reports.itemDescription')}><Input value={it.description ?? ''} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} maxLength={2000} /></FormField>
            <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={t('reports.remove')} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden="true" /></Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => onChange([...items, { title: '' }], false)}><Plus className="size-4" aria-hidden="true" />{addLabel}</Button>
        {noneLabel && items.length === 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-gold-600" checked={Boolean(noneConfirmed)} onChange={(e) => onChange(items, e.target.checked)} />{noneLabel}</label>}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ published (immutable) view
function Published({ report }: { report: FounderReport }) {
  const router = useRouter();
  const t = useTranslations('cx');
  const fmt = useFmt();
  const apiErr = useApiErrorMessage();
  const snap = useOne<ReportSnapshot>(ck('reports', report.id, 'snapshot'), `/founder-reports/${report.id}/snapshot`);
  const newVersion = useAction<Record<string, never>, FounderReport>('post', `/founder-reports/${report.id}/new-version`);
  const review = useAction<{ rating?: number; note?: string }, FounderReport>('post', `/founder-reports/${report.id}/review`);
  const [rating, setRating] = React.useState(report.rating ? String(report.rating) : '');
  const [note, setNote] = React.useState(report.reviewNote ?? '');
  const content = snap.data?.content as { sections?: ReportSections; dataSections?: FounderReport['dataSections']; actionItems?: Array<{ id: string; title: string; dueAt: string; status: string }>; completeness?: { pct: number } } | undefined;
  const sections = content?.sections ?? report.sections;
  return (
    <>
      <Header r={report} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusBadge status="success">{t('reports.statusPUBLISHED')}</StatusBadge>
        <Badge tone="blue">{t(`reports.type${report.type}` as never)}</Badge>
        {report.versionNumber > 1 && <Badge tone="gold">{t('reports.version', { n: report.versionNumber })}</Badge>}
        {report.onTime !== null && <Badge tone={report.onTime ? 'green' : 'red'}>{report.onTime ? t('reports.onTime') : t('reports.lateBadge')}</Badge>}
        <Badge icon={<Lock />}>{t('reports.immutable')}</Badge>
        <Can permission="founder-reports:create"><Button size="sm" variant="secondary" className="ml-auto" loading={newVersion.isPending} onClick={() => newVersion.mutate({}, { onSuccess: (r) => router.push(`/cx/founder-reports/${r.id}`) })}>{t('reports.correct')}</Button></Can>
      </div>
      {newVersion.isError && <Alert tone="danger" className="mb-4">{apiErr(newVersion.error).message}</Alert>}
      <div className="stagger grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="stagger space-y-4">
          <Panel accent="green" title={t('reports.performance')}><p className="whitespace-pre-wrap text-ink">{sections.performance?.narrative || t('common.dash')}</p></Panel>
          <Panel accent="gold" title={t('reports.risks')}>
            {(sections.risks?.items ?? []).length === 0 ? <p className="text-sm text-muted">{sections.risks?.noneConfirmed ? t('reports.noRisksConfirmed') : t('common.dash')}</p> : (
              <ul className="space-y-3">{sections.risks?.items?.map((r, i) => <li key={i} className="rounded-lg border border-line p-3"><p className="font-medium text-ink">{r.title} <Badge className="ml-1">{t(`reports.sev.${r.severity ?? 2}` as never)}</Badge></p>{r.description && <p className="mt-1 text-sm text-ink-700">{r.description}</p>}<p className="mt-2 text-sm"><span className="font-medium text-ink">{t('reports.proposedSolution')}: </span>{r.proposedSolution}</p></li>)}</ul>
            )}
          </Panel>
          <Panel accent="blue" title={t('reports.opportunities')}>{(sections.opportunities?.items ?? []).length === 0 ? <p className="text-sm text-muted">{t('common.dash')}</p> : <ul className="space-y-2">{sections.opportunities?.items?.map((o, i) => <li key={i}><p className="font-medium text-ink">{o.title}</p>{o.description && <p className="text-sm text-ink-700">{o.description}</p>}</li>)}</ul>}</Panel>
          {(sections.solutions?.items ?? []).length > 0 && <Panel accent="green" title={t('reports.solutions')}><ul className="space-y-2">{sections.solutions?.items?.map((o, i) => <li key={i}><p className="font-medium text-ink">{o.title}</p>{o.description && <p className="text-sm text-ink-700">{o.description}</p>}</li>)}</ul></Panel>}
          <Panel accent="gold" title={t('reports.dataTitle')} description={t('reports.dataHint')}>
            <ul className="grid gap-3 sm:grid-cols-2">{(content?.dataSections ?? []).map((d) => <li key={d.key} className="rounded-lg border border-dashed border-line-strong bg-ivory-100/70 p-3"><p className="flex items-center gap-2 text-sm font-medium text-ink"><Hourglass className="size-4 text-gold-700" aria-hidden="true" />{d.label}</p><p className="mt-1 text-xs text-muted">{d.status === 'DATA_PENDING_PHASE_5' ? t('reports.dataPending') : ''}</p></li>)}</ul>
          </Panel>
          {(content?.actionItems ?? []).length > 0 && <Panel accent="blue" title={t('reports.actionItems')}><ul className="space-y-1.5 text-sm">{content?.actionItems?.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2"><span className="text-ink">{a.title}</span><span className="text-muted">{t(`workStatus.${a.status}` as never)} · {fmt.date(a.dueAt)}</span></li>)}</ul></Panel>}
        </div>
        <div className="space-y-4">
          <Panel accent="green" title={t('reports.snapshot')} description={t('reports.snapshotHint')}>
            {snap.isPending ? <Skeleton className="h-16" /> : snap.isError ? <Alert tone="danger">{apiErr(snap.error).message}</Alert> : (
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('reports.publishedBy')}</dt><dd className="text-ink">{report.publishedByName ?? '—'} · {fmt.dateTime(report.publishedAt)}</dd></div>
                <div><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('reports.contentHash')}</dt><dd className="font-mono text-xs break-all text-ink">{snap.data.contentHash}</dd></div>
                <div className="flex items-center gap-1.5 text-ink">{snap.data.integrityVerified ? <><ShieldCheck className="size-4 text-green-700" aria-hidden="true" />{t('reports.integrityOk')}</> : <span className="text-red-700">{t('reports.integrityFail')}</span>}</div>
                <div><dt className="text-xs font-medium tracking-wide text-muted uppercase">{t('reports.completeness')}</dt><dd className="text-ink">{report.completenessPct ?? '—'}%</dd></div>
              </dl>
            )}
          </Panel>
          <Panel accent="gold" title={t('reports.versions')}>
            <ul className="space-y-1.5 text-sm">{report.versions?.map((v) => <li key={v.id}>{v.id === report.id ? <span className="font-medium text-ink">{t('reports.version', { n: v.versionNumber })} ({t('reports.thisOne')})</span> : <Link className="text-blue-700 underline" href={`/cx/founder-reports/${v.id}`}>{t('reports.version', { n: v.versionNumber })}</Link>} · {t(`reports.status${v.status}` as never)}</li>)}</ul>
          </Panel>
          <Panel accent="blue" title={t('reports.review')} description={t('reports.reviewHint')}>
            {report.reviewedByName && <p className="mb-3 text-sm text-ink-700">{t('reports.reviewedBy', { name: report.reviewedByName })}{report.rating ? ` · ${report.rating}/5` : ''}{report.reviewNote ? ` · ${report.reviewNote}` : ''}</p>}
            <Can permission="founder-reports:review">
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); review.mutate({ ...(rating ? { rating: Number(rating) } : {}), ...(note.trim() ? { note: note.trim() } : {}) }); }}>
                {review.isError && <Alert tone="danger">{apiErr(review.error).message}</Alert>}
                <FormField label={t('reports.rating')}><Select value={rating} onChange={(e) => setRating(e.target.value)}><option value="">{t('reports.noRating')}</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></FormField>
                <FormField label={t('reports.reviewNote')}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={3000} /></FormField>
                <Button type="submit" loading={review.isPending} disabled={!rating && !note.trim()}>{t('reports.saveReview')}</Button>
              </form>
            </Can>
          </Panel>
        </div>
      </div>
    </>
  );
}
