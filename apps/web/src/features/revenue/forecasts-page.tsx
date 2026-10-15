'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Camera } from 'lucide-react';
import { Alert, Badge, Button, DataTable, Panel, Sheet, SheetContent, Stat, useToast, type Column } from '@salesos/ui';
import { PageHeader } from '@/features/crm/motion';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useAccuracy, useForecastPreview, useForecastSnapshots, useForecasts, useTakeSnapshot, type ForecastRow, type ForecastSnapshot } from '@/lib/api/hooks/revenue';
import { DataState, Money, Segmented, useRevFormat } from './common';
import { formatPct } from './lib';
import { Hint } from '@/features/hints/hint-views';

type Span = 'WEEK' | 'MONTH';

export function ForecastsPage() {
  const t = useTranslations('revenue.forecasts');
  const [span, setSpan] = React.useState<Span>('MONTH');
  const [snapshotsOf, setSnapshotsOf] = React.useState<string | null>(null);
  return (
    <RequirePermission permission="forecasts:view">
      <PageHeader eyebrow={useTranslations('nav')('revenue')} title={t('title')} description={t('description')} />
      <Alert tone="warning" className="mb-5">{t('estimateBanner')}</Alert>
      <Segmented label={t('span')} value={span} onChange={setSpan} options={[{ value: 'MONTH', label: t('monthly') }, { value: 'WEEK', label: t('weekly') }]} />
      <div className="mt-5 space-y-6 stagger">
        <Can permission="forecasts:create">
          <Preview span={span} />
        </Can>
        <Stored span={span} onOpen={setSnapshotsOf} />
        <Accuracy span={span} />
      </div>
      <Sheet open={snapshotsOf !== null} onOpenChange={(o) => !o && setSnapshotsOf(null)}>
        {snapshotsOf && <SnapshotsSheet id={snapshotsOf} />}
      </Sheet>
    </RequirePermission>
  );
}

function Preview({ span }: { span: Span }) {
  const t = useTranslations('revenue.forecasts');
  const tc = useTranslations('common');
  const q = useForecastPreview(span, true);
  const take = useTakeSnapshot();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const f = useRevFormat();
  return (
    <Panel
      title={t('current')}
      description={q.data ? t('currentRange', { from: f.date(q.data.periodStart), to: f.date(q.data.periodEnd), asOf: f.date(q.data.asOf) }) : undefined}
      actions={
        <div className="flex flex-wrap gap-2">
          {(['PERIOD_START', 'ADHOC'] as const).map((kind) => (
            <Button key={kind} size="sm" variant={kind === 'PERIOD_START' ? 'gold' : 'secondary'} loading={take.isPending && take.variables?.kind === kind} loadingLabel={tc('saving')} onClick={() => take.mutate({ periodType: span, kind }, { onSuccess: () => toast({ tone: 'success', title: t('stored') }), onError: (e) => toast({ tone: 'danger', title: apiErr(e).message }) })}>
              <Camera className="size-4" aria-hidden="true" />
              {kind === 'PERIOD_START' ? t('takeStart') : t('takeAdhoc')}
            </Button>
          ))}
        </div>
      }
    >
      <DataState q={q} empty={{ title: t('noPreview') }}>
        {(p) => (
          <div className="space-y-4">
            <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t('total')} value={<Money value={p.total} />} hint={t('estimate')} accent="gold" />
              <Stat label={t('booked')} value={<Money value={p.bookedToDate} />} hint={t('bookedHint')} />
              <Stat label={t('weighted')} value={<Money value={p.weightedPipeline} />} hint={t('weightedHint', { raw: f.money(p.unweightedPipeline) })} />
              <Stat label={t('deals')} value={String(p.dealCount)} hint={t('dealsHint')} />
            </div>
            <StageTable rows={p.byStage} />
            {(p.unscheduled.count > 0 || p.overdue.count > 0) && (
              <Alert tone="info">
                {p.unscheduled.count > 0 && <span className="block">{t('unscheduled', { count: p.unscheduled.count, amount: f.money(p.unscheduled.amount) })}</span>}
                {p.overdue.count > 0 && <span className="block">{t('overdue', { count: p.overdue.count, amount: f.money(p.overdue.amount) })}</span>}
              </Alert>
            )}
            <p className="text-sm text-muted">{p.methodNote}</p>
          </div>
        )}
      </DataState>
    </Panel>
  );
}

function StageTable({ rows }: { rows: ForecastSnapshot['byStage'] }) {
  const t = useTranslations('revenue.forecasts');
  const tc = useTranslations('common');
  const columns: Column<ForecastSnapshot['byStage'][number]>[] = [
    { id: 'stage', header: t('colStage'), primary: true, cell: (r) => r.stage.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) },
    { id: 'count', header: t('colCount'), align: 'right', cell: (r) => r.count },
    { id: 'amount', header: t('colAmount'), align: 'right', cell: (r) => <Money value={r.amount} /> },
    { id: 'prob', header: t('colProbability'), align: 'right', cell: (r) => `${Math.round(Number(r.probability) * 100)}%` },
    { id: 'weighted', header: t('colWeighted'), align: 'right', cell: (r) => <Money value={r.weighted} /> },
  ];
  return <DataTable caption={t('stageTable')} loadingLabel={tc('loading')} columns={columns} rows={rows} getRowId={(r) => r.stage} emptyTitle={t('noStages')} />;
}

function Stored({ span, onOpen }: { span: Span; onOpen: (id: string) => void }) {
  const t = useTranslations('revenue.forecasts');
  const tc = useTranslations('common');
  const q = useForecasts();
  const f = useRevFormat();
  const rows = (q.data?.items ?? []).filter((r) => r.periodType === span);
  const columns: Column<ForecastRow>[] = [
    { id: 'period', header: t('colPeriod'), primary: true, cell: (r) => `${f.date(r.periodStart)} – ${f.date(r.periodEnd)}` },
    { id: 'scope', header: t('colScope'), hideOnMobile: true, cell: (r) => (r.scope === 'ORG' ? t('scopeOrg') : t('scopeTeam')) },
    { id: 'latest', header: t('colLatest'), align: 'right', cell: (r) => (r.latest ? <Money value={r.latest.total} /> : '—') },
    { id: 'count', header: t('colSnapshots'), align: 'right', hideOnMobile: true, cell: (r) => r.snapshotCount },
    { id: 'acc', header: t('colAccuracy'), align: 'right', cell: (r) => (r.accuracy?.accuracyPct ? <Badge tone="blue">{formatPct(r.accuracy.accuracyPct)}</Badge> : <span className="text-muted">{r.accuracy?.periodClosed ? t('noAccuracy') : t('open')}</span>) },
  ];
  return (
    <Panel accent="blue" title={t('stored')} description={t('storedHint')}>
      <DataTable caption={t('storedCaption')} loadingLabel={tc('loading')} columns={columns} rows={rows} getRowId={(r) => r.id} loading={q.isPending} error={q.isError ? { message: t('loadError'), onRetry: () => void q.refetch() } : null} emptyTitle={t('noStored')} emptyDescription={t('noStoredHint')} onRowClick={(r) => onOpen(r.id)} />
    </Panel>
  );
}

function SnapshotsSheet({ id }: { id: string }) {
  const t = useTranslations('revenue.forecasts');
  const tc = useTranslations('common');
  const q = useForecastSnapshots(id);
  const f = useRevFormat();
  return (
    <SheetContent title={t('snapshotsTitle')} description={t('snapshotsHint')} closeLabel={tc('close')}>
      <DataState q={q} empty={{ title: t('noStored') }}>
        {(d) => (
          <div className="space-y-4">
            {d.accuracy && (
              <Alert tone={d.accuracy.accuracyPct ? 'info' : 'warning'}>
                {d.accuracy.accuracyPct ? t('accuracyLine', { pct: d.accuracy.accuracyPct, forecast: f.money(d.accuracy.forecast), actual: f.money(d.accuracy.actual), bias: d.accuracy.biasPct ?? '—' }) : d.accuracy.note ?? t('noAccuracyYet')}
              </Alert>
            )}
            <ul className="stagger space-y-3">
              {d.snapshots.map((s) => (
                <li key={s.id} className="hover-lift rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><Badge tone={s.kind === 'PERIOD_START' ? 'gold' : 'neutral'}>{s.kind === 'PERIOD_START' ? t('kindStart') : t('kindAdhoc')}</Badge><Badge tone="blue">{t('estimate')}</Badge></span>
                    <span className="text-xs text-muted">{f.dateTime(s.takenAt)} {s.takenByName ? `· ${s.takenByName}` : ''}</span>
                  </div>
                  <p className="mt-2 text-lg font-semibold"><Money value={s.total} /></p>
                  <p className="text-sm text-muted">{t('snapshotParts', { booked: f.money(s.bookedToDate), weighted: f.money(s.weightedPipeline) })}</p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">{t('immutable')}</p>
          </div>
        )}
      </DataState>
    </SheetContent>
  );
}

function Accuracy({ span }: { span: Span }) {
  const t = useTranslations('revenue.forecasts');
  const tc = useTranslations('common');
  const q = useAccuracy(span);
  const f = useRevFormat();
  const columns: Column<NonNullable<typeof q.data>['periods'][number]>[] = [
    { id: 'period', header: t('colPeriod'), primary: true, cell: (r) => `${f.date(r.periodStart)} – ${f.date(r.periodEnd)}` },
    { id: 'forecast', header: t('colForecast'), align: 'right', cell: (r) => <Money value={r.forecast} /> },
    { id: 'actual', header: t('colActual'), align: 'right', cell: (r) => <Money value={r.actual} /> },
    { id: 'acc', header: t('colAccuracy'), align: 'right', cell: (r) => formatPct(r.accuracyPct) },
    { id: 'bias', header: t('colBias'), align: 'right', hideOnMobile: true, cell: (r) => formatPct(r.biasPct) },
  ];
  return (
    <Panel title={t('accuracyTitle')} description={t('accuracyHint')} actions={<span className="inline-flex items-center gap-1">{q.data ? <Badge tone="blue">{t('wape', { pct: q.data.wapePct ?? '—' })}</Badge> : null}<Hint id="forecastAccuracy" /></span>}>
      <DataTable caption={t('accuracyCaption')} loadingLabel={tc('loading')} columns={columns} rows={q.data?.periods} getRowId={(r) => r.forecastId} loading={q.isPending} error={q.isError ? { message: t('loadError'), onRetry: () => void q.refetch() } : null} emptyTitle={t('noAccuracyRows')} emptyDescription={t('noAccuracyRowsHint')} />
    </Panel>
  );
}
