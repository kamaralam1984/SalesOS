'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, History, LineChart as LineIcon, Plus, SquarePen } from 'lucide-react';
import { Alert, Badge, Button, ChartCard, Dialog, DialogContent, FormField, Input, Panel, Select, Sheet, SheetContent, Stat, StatusBadge, Timeline, cn } from '@salesos/ui';
import { PageHeader } from '@/features/crm/motion';
import { Can, useAuth, usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import {
  useAchievement,
  useAssignableOwners,
  useBreakdown,
  useCreatePeriod,
  useCreateTarget,
  useDecideRevision,
  useReviseTarget,
  useRevisions,
  useTargetPeriods,
  useTargets,
  type BreakdownNode,
  type Target,
  type TargetLevel,
  type TargetMetric,
} from '@/lib/api/hooks/revenue';
import { DataState, Segmented, useRevFormat } from './common';
import { MoneyInput, ReasonDialog, useSubmit } from './forms';
import { cmpMoney, formatCount, formatMoney, isMoneyInput, normalizeMoney, subMoney, todayIst } from './lib';
import { Hint } from '@/features/hints/hint-views';

const LEVELS: TargetLevel[] = ['FOUNDER', 'TEAM_LEAD', 'MANAGER', 'EXECUTIVE'];
const LEVEL_ROLE: Record<TargetLevel, string> = { FOUNDER: 'FOUNDER_CEO', TEAM_LEAD: 'SALES_TEAM_LEAD', MANAGER: 'SALES_MANAGER', EXECUTIVE: 'SALES_EXECUTIVE' };
const childOf = (l: TargetLevel): TargetLevel | null => LEVELS[LEVELS.indexOf(l) + 1] ?? null;
const METRICS: TargetMetric[] = ['REVENUE', 'COLLECTION', 'ENROLMENT'];

/** Amount as shown for the metric: INR with explicit currency, or a plain count for enrolments. */
export function useTargetAmount(metric: TargetMetric) {
  const f = useRevFormat();
  const t = useTranslations('revenue.targets');
  return (v: string) => (metric === 'ENROLMENT' ? t('count', { n: formatCount(v) }) : f.money(v));
}

export function TargetsPage() {
  const t = useTranslations('revenue.targets');
  const tn = useTranslations('nav');
  const periods = useTargetPeriods();
  const [periodId, setPeriodId] = React.useState<string | null>(null);
  const [metric, setMetric] = React.useState<TargetMetric>('REVENUE');
  const [adding, setAdding] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const list = periods.data ?? [];
  const current = periodId ?? list.find((p) => p.startsOn <= todayIst() && p.endsOn >= todayIst() && p.type === 'MONTH')?.id ?? list[0]?.id ?? null;
  const period = list.find((p) => p.id === current) ?? null;
  return (
    <RequirePermission permission="targets:view">
      <PageHeader
        eyebrow={tn('revenue')}
        title={t('title')}
        description={t('description')}
        actions={
          <Can permission="targets:create">
            <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" />{t('addPeriod')}</Button>
            {current && <Button variant="gold" className="glow-gold" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />{t('newTarget')}</Button>}
          </Can>
        }
      />
      <DataState q={periods} isEmpty={(d) => d.length === 0} empty={{ title: t('noPeriods'), description: t('noPeriodsHint') }}>
        {() => (
          <div className="space-y-5 enter-up">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-end">
              <FormField label={t('period')}>
                <Select value={current ?? ''} onChange={(e) => setPeriodId(e.target.value)}>
                  {list.map((p) => (<option key={p.id} value={p.id}>{`${p.label} (${t(`type${p.type}` as 'typeMONTH')})`}</option>))}
                </Select>
              </FormField>
              <Segmented label={t('metric')} value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m, label: t(`metric${m}` as 'metricREVENUE') }))} />
            </div>
            {period && <p className="text-sm text-muted">{t('periodRange', { from: period.startsOn, to: period.endsOn })}</p>}
            {current && <Planner periodId={current} metric={metric} />}
          </div>
        )}
      </DataState>
      <PeriodDialog open={adding} onOpenChange={setAdding} onCreated={(id) => setPeriodId(id)} />
      {current && <TargetDialog open={creating} onOpenChange={setCreating} periodId={current} metric={metric} parent={null} />}
    </RequirePermission>
  );
}

function Planner({ periodId, metric }: { periodId: string; metric: TargetMetric }) {
  const t = useTranslations('revenue.targets');
  const q = useTargets({ periodId, metric });
  return (
    <DataState q={q} isEmpty={(d) => d.items.length === 0} empty={{ title: t('noTargets'), description: t('noTargetsHint') }}>
      {(d) => {
        const ids = new Set(d.items.map((x) => x.id));
        const entries = d.items.filter((x) => !x.parentId || !ids.has(x.parentId));
        return (
          <div className="space-y-5 stagger">
            {entries.map((e) => (<TargetTree key={e.id} entry={e} metric={metric} />))}
          </div>
        );
      }}
    </DataState>
  );
}

function TargetTree({ entry, metric }: { entry: Target; metric: TargetMetric }) {
  const t = useTranslations('revenue.targets');
  const q = useBreakdown(entry.id);
  return (
    <Panel title={t('breakdownTitle', { name: entry.ownerName ?? t(`level${entry.level}` as 'levelFOUNDER') })} description={t('breakdownHint')} actions={<Hint id="targetBreakdown" />}>
      <DataState q={q} empty={{ title: t('noTargets') }}>
        {(d) => <ul role="tree" aria-label={t('breakdownTitle', { name: d.root.ownerName ?? '' })} className="space-y-1.5 stagger-fast"><Node node={d.root} metric={metric} periodId={entry.periodId} depth={0} /></ul>}
      </DataState>
    </Panel>
  );
}

function ConsistencyBadge({ node }: { node: BreakdownNode }) {
  const t = useTranslations('revenue.targets');
  if (node.consistency === 'NO_BREAKDOWN') return <Badge tone="neutral">{t('noBreakdown')}</Badge>;
  if (node.consistency === 'CONSISTENT') return <StatusBadge status="success">{t('consistent')}</StatusBadge>;
  if (node.consistency === 'OVER_ALLOCATED') return <StatusBadge status="danger">{t('over')}</StatusBadge>;
  return <StatusBadge status="warning">{t('under')}</StatusBadge>;
}

function Node({ node, metric, periodId, depth }: { node: BreakdownNode; metric: TargetMetric; periodId: string; depth: number }) {
  const t = useTranslations('revenue.targets');
  const show = useTargetAmount(metric);
  const [open, setOpen] = React.useState(depth < 2);
  const [dlg, setDlg] = React.useState<null | 'child' | 'revise' | 'history' | 'progress' | 'decide'>(null);
  const targets = useTargets({ periodId, metric });
  const full = targets.data?.items.find((x) => x.id === node.id);
  const childLevel = childOf(node.level);
  const canCreate = usePermission('targets:create');
  const canUpdate = usePermission('targets:update');
  const canApprove = usePermission('targets:approve');
  const pending = full?.pendingRevision ?? null;
  return (
    <li role="treeitem" aria-expanded={node.children.length > 0 ? open : undefined} aria-selected={false} className="list-none">
      <div className={cn('hover-lift rounded-lg border border-line bg-surface p-3', depth === 0 && 'accent-top', depth > 0 && 'ml-3 sm:ml-6')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {node.children.length > 0 ? (
            <button type="button" className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-ivory-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500" aria-label={open ? t('collapse') : t('expand')} onClick={() => setOpen(!open)}>
              {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
            </button>
          ) : (
            <span className="size-8" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{node.ownerName ?? t('hiddenOwner')}</p>
            <p className="text-xs text-muted">{t(`level${node.level}` as 'levelFOUNDER')}</p>
          </div>
          <div className="text-right">
            <p className="tabular kpi-number text-base font-semibold text-ink">{show(node.amount)}</p>
            {node.amount !== node.originalAmount && <p className="text-xs text-muted">{t('original', { amount: show(node.originalAmount) })}</p>}
          </div>
        </div>
        {node.hasChildren && (
          <div className="mt-2 flex flex-wrap items-center gap-2 pl-11 text-sm" aria-live="polite">
            <ConsistencyBadge node={node} />
            <span className="text-muted">{t('allocated', { sum: show(node.childrenSum), left: show(node.unallocated) })}</span>
            {node.hiddenChildren > 0 && <span className="text-muted">{t('hiddenChildren', { count: node.hiddenChildren })}</span>}
          </div>
        )}
        {pending && (
          <p className="mt-2 pl-11 text-sm text-gold-700">{t('pending', { amount: show(pending.newAmount) })}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5 pl-11">
          <Button size="sm" variant="ghost" onClick={() => setDlg('progress')}><LineIcon className="size-4" aria-hidden="true" />{t('progress')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDlg('history')}><History className="size-4" aria-hidden="true" />{t('history')}</Button>
          {canUpdate && !pending && <Button size="sm" variant="ghost" onClick={() => setDlg('revise')}><SquarePen className="size-4" aria-hidden="true" />{t('revise')}</Button>}
          {canApprove && pending && <Button size="sm" variant="secondary" onClick={() => setDlg('decide')}>{t('decide')}</Button>}
          {canCreate && childLevel && <Button size="sm" variant="ghost" onClick={() => setDlg('child')}><Plus className="size-4" aria-hidden="true" />{t('addChild', { level: t(`level${childLevel}` as 'levelFOUNDER') })}</Button>}
        </div>
      </div>
      {open && node.children.length > 0 && (
        <ul role="group" className="mt-1.5 space-y-1.5">
          {node.children.map((c) => (<Node key={c.id} node={c} metric={metric} periodId={periodId} depth={depth + 1} />))}
        </ul>
      )}
      {dlg === 'child' && childLevel && <TargetDialog open onOpenChange={(o) => !o && setDlg(null)} periodId={periodId} metric={metric} parent={node} />}
      {dlg === 'revise' && <ReviseDialog open onOpenChange={(o) => !o && setDlg(null)} node={node} metric={metric} />}
      {dlg === 'decide' && pending && <DecideDialog open onOpenChange={(o) => !o && setDlg(null)} node={node} metric={metric} pendingId={pending.id} newAmount={pending.newAmount} />}
      {dlg === 'history' && <HistorySheet open onOpenChange={(o) => !o && setDlg(null)} node={node} metric={metric} />}
      {dlg === 'progress' && <ProgressSheet open onOpenChange={(o) => !o && setDlg(null)} node={node} metric={metric} />}
    </li>
  );
}

/* ------------------------------------------------------------------ dialogs */
function PeriodDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <PeriodBody onOpenChange={onOpenChange} onCreated={onCreated} />}
    </Dialog>
  );
}
function PeriodBody({ onOpenChange, onCreated }: { onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const t = useTranslations('revenue.targets');
  const tc = useTranslations('common');
  const create = useCreatePeriod();
  const [type, setType] = React.useState('MONTH');
  const [anchor, setAnchor] = React.useState(todayIst());
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(done, t('periodAdded'));
  return (
    <DialogContent size="sm" title={t('addPeriod')} description={t('periodHelp')} closeLabel={tc('close')} footer={<><Button variant="secondary" onClick={done}>{tc('cancel')}</Button><Button type="submit" form="period-form" loading={pending} loadingLabel={tc('saving')}>{t('addPeriod')}</Button></>}>
      <form id="period-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => onCreated((await create.mutateAsync({ type, anchor })).id)); }}>
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label={t('periodType')}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="MONTH">{t('typeMONTH')}</option>
            <option value="QUARTER">{t('typeQUARTER')}</option>
            <option value="YEAR">{t('typeYEAR')}</option>
          </Select>
        </FormField>
        <FormField label={t('anchor')} hint={t('anchorHint')}>
          <Input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} required />
        </FormField>
      </form>
    </DialogContent>
  );
}

export function TargetDialog({ open, onOpenChange, periodId, metric, parent }: { open: boolean; onOpenChange: (o: boolean) => void; periodId: string; metric: TargetMetric; parent: BreakdownNode | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <TargetBody onOpenChange={onOpenChange} periodId={periodId} metric={metric} parent={parent} />}
    </Dialog>
  );
}

function TargetBody({ onOpenChange, periodId, metric, parent }: { onOpenChange: (o: boolean) => void; periodId: string; metric: TargetMetric; parent: BreakdownNode | null }) {
  const t = useTranslations('revenue.targets');
  const tc = useTranslations('common');
  const { hasRole } = useAuth();
  const level: TargetLevel = parent ? childOf(parent.level)! : hasRole('FOUNDER_CEO') ? 'FOUNDER' : 'TEAM_LEAD';
  const [lvl, setLvl] = React.useState<TargetLevel>(level);
  const owners = useAssignableOwners(true);
  const create = useCreateTarget();
  const [owner, setOwner] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [joinOn, setJoinOn] = React.useState('');
  const [note, setNote] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(done, t('created'));
  const candidates = (owners.data ?? []).filter((u) => u.isActive && u.roles.includes(LEVEL_ROLE[lvl] as never));
  const isCount = metric === 'ENROLMENT';
  const amountOk = isCount ? /^\d{1,6}$/.test(amount) && Number(amount) > 0 : isMoneyInput(amount);
  const norm = isCount ? amount : amount ? normalizeMoney(amount) : '0.00';
  // live sum validation against what the parent still has unallocated
  const remaining = parent?.unallocated ?? null;
  const exceeds = Boolean(parent && amountOk && !joinOn && cmpMoney(isCount ? `${amount}.00` : norm, isCount ? `${remaining}.00` : remaining!) > 0);
  const after = parent && amountOk && !exceeds ? subMoney(isCount ? `${remaining}.00` : remaining!, isCount ? `${amount}.00` : norm) : null;
  const show = (v: string) => (isCount ? formatCount(v) : formatMoney(v));
  const problems = { owner: !owner, amount: !amountOk || exceeds };
  return (
    <DialogContent size="md" title={parent ? t('addChildTitle', { level: t(`level${lvl}` as 'levelFOUNDER') }) : t('newTarget')} description={parent ? t('addChildHint', { parent: parent.ownerName ?? '', left: show(parent.unallocated) }) : t('newTargetHint')} closeLabel={tc('close')} footer={<><Button variant="secondary" onClick={done}>{tc('cancel')}</Button><Button type="submit" form="target-form" loading={pending} loadingLabel={tc('saving')}>{t('create')}</Button></>}>
      <form
        id="target-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (problems.owner || problems.amount) return;
          void run(() => create.mutateAsync({ periodId, metric, level: lvl, ownerUserId: owner, amount: norm, ...(parent ? { parentId: parent.id } : {}), ...(joinOn ? { proration: { joinOn } } : {}), ...(note.trim() ? { note: note.trim() } : {}) }));
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        {!parent && (
          <FormField label={t('level')}>
            <Select value={lvl} onChange={(e) => { setLvl(e.target.value as TargetLevel); setOwner(''); }}>
              <option value="FOUNDER">{t('levelFOUNDER')}</option>
              <option value="TEAM_LEAD">{t('levelTEAM_LEAD')}</option>
            </Select>
          </FormField>
        )}
        <FormField label={t('owner')} required error={touched && problems.owner ? t('ownerRequired') : undefined} hint={candidates.length === 0 && !owners.isPending ? t('noOwners', { level: t(`level${lvl}` as 'levelFOUNDER') }) : undefined}>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t('choose')}</option>
            {candidates.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
          </Select>
        </FormField>
        <FormField label={isCount ? t('countTarget') : t('amountTarget')} required hint={isCount ? t('countHint') : joinOn ? t('prorateHint') : undefined} error={touched && !amountOk ? t('amountInvalid') : exceeds ? t('exceeds', { left: show(remaining!) }) : undefined}>
          {isCount ? <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /> : <MoneyInput value={amount} onChange={setAmount} invalid={touched && problems.amount} />}
        </FormField>
        {parent && amountOk && !exceeds && after !== null && (
          <p role="status" className="text-sm text-muted">{t('afterThis', { left: show(isCount ? after.replace(/\.00$/, '') : after) })}</p>
        )}
        <FormField label={t('joinOn')} hint={t('joinHint')}>
          <Input type="date" value={joinOn} onChange={(e) => setJoinOn(e.target.value)} />
        </FormField>
        <FormField label={t('note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </FormField>
      </form>
    </DialogContent>
  );
}

function ReviseDialog({ open, onOpenChange, node, metric }: { open: boolean; onOpenChange: (o: boolean) => void; node: BreakdownNode; metric: TargetMetric }) {
  const t = useTranslations('revenue.targets');
  const revise = useReviseTarget();
  const [amount, setAmount] = React.useState('');
  const [effective, setEffective] = React.useState('');
  const isCount = metric === 'ENROLMENT';
  const valid = isCount ? /^\d{1,6}$/.test(amount) : isMoneyInput(amount) || amount === '0';
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('reviseTitle', { name: node.ownerName ?? '' })}
      description={t('reviseHint')}
      label={t('reviseReason')}
      minLength={10}
      submitLabel={t('submitRevision')}
      successTitle={t('revisionProposed')}
      extra={
        <>
          <FormField label={isCount ? t('countTarget') : t('newAmount')} required error={amount && !valid ? t('amountInvalid') : undefined} hint={t('currentValue', { amount: isCount ? formatCount(node.amount) : formatMoney(node.amount) })}>
            {isCount ? <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /> : <MoneyInput value={amount} onChange={setAmount} />}
          </FormField>
          <FormField label={t('effectiveFrom')} hint={t('effectiveHint')}>
            <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
          </FormField>
        </>
      }
      onSubmit={(reason) => revise.mutateAsync({ id: node.id, newAmount: isCount ? amount : normalizeMoney(amount || '0'), reason, ...(effective ? { effectiveFrom: effective } : {}) })}
    />
  );
}

function DecideDialog({ open, onOpenChange, node, metric, pendingId, newAmount }: { open: boolean; onOpenChange: (o: boolean) => void; node: BreakdownNode; metric: TargetMetric; pendingId: string; newAmount: string }) {
  const t = useTranslations('revenue.targets');
  const tc = useTranslations('common');
  const decide = useDecideRevision();
  const show = useTargetAmount(metric);
  const [note, setNote] = React.useState('');
  const done = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const { run, error, pending } = useSubmit(done, t('decided'));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title={t('decideTitle', { name: node.ownerName ?? '' })} description={t('decideHint', { from: show(node.amount), to: show(newAmount) })} closeLabel={tc('close')} footer={
        <>
          <Button variant="secondary" onClick={done}>{tc('cancel')}</Button>
          <Button variant="secondary" loading={pending} onClick={() => void run(() => decide.mutateAsync({ id: node.id, revisionId: pendingId, decision: 'reject', note: note.trim() || undefined }))}>{t('reject')}</Button>
          <Button loading={pending} onClick={() => void run(() => decide.mutateAsync({ id: node.id, revisionId: pendingId, decision: 'approve', note: note.trim() || undefined }))}>{t('approve')}</Button>
        </>
      }>
        {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
        <FormField label={t('decisionNote')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </FormField>
      </DialogContent>
    </Dialog>
  );
}

function HistorySheet({ open, onOpenChange, node, metric }: { open: boolean; onOpenChange: (o: boolean) => void; node: BreakdownNode; metric: TargetMetric }) {
  const t = useTranslations('revenue.targets');
  const tc = useTranslations('common');
  const q = useRevisions(node.id);
  const f = useRevFormat();
  const show = useTargetAmount(metric);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={t('historyTitle', { name: node.ownerName ?? '' })} description={t('historyHint')} closeLabel={tc('close')}>
        <DataState q={q} empty={{ title: t('noHistory') }}>
          {(rows) => (
            <Timeline
              label={t('history')}
              items={rows.map((r) => ({
                id: r.id,
                title: r.oldAmount === null ? t('initial', { amount: show(r.newAmount) }) : t('changed', { from: show(r.oldAmount), to: show(r.newAmount) }),
                time: f.dateTime(r.proposedAt),
                tone: r.status === 'APPROVED' ? 'blue' : r.status === 'REJECTED' ? 'red' : 'gold',
                description: [t(`rev${r.status}` as 'revPENDING'), r.reason, r.proposedByName ? t('by', { name: r.proposedByName }) : null, r.decidedByName ? t('approvedBy', { name: r.decidedByName }) : null, r.decisionNote].filter(Boolean).join(' · '),
                meta: <span className="text-xs text-muted">{t('effective', { date: f.date(r.effectiveFrom) })}</span>,
              }))}
            />
          )}
        </DataState>
      </SheetContent>
    </Sheet>
  );
}

function ProgressSheet({ open, onOpenChange, node, metric }: { open: boolean; onOpenChange: (o: boolean) => void; node: BreakdownNode; metric: TargetMetric }) {
  const t = useTranslations('revenue.targets');
  const tc = useTranslations('common');
  const q = useAchievement(node.id);
  const show = useTargetAmount(metric);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={t('progressTitle', { name: node.ownerName ?? '' })} description={t('progressHint')} closeLabel={tc('close')}>
        <DataState q={q} empty={{ title: t('noProgress') }}>
          {(a) => (
            <div className="space-y-4">
              {a.noTargetSet && <Alert tone="warning">{t('noTargetSet')}</Alert>}
              <div className="grid grid-cols-2 gap-3">
                <Stat label={t('actual')} value={show(a.actual)} hint={t('asOf', { date: a.asOf })} />
                <Stat label={t('achievement')} value={a.achievementPct === null ? '—' : `${a.achievementPct}%`} hint={t('ofTarget', { target: show(a.target) })} accent="gold" />
              </div>
              {a.pacing.expectedToDate && (
                <p className="text-sm text-muted">{t('pacing', { expected: show(a.pacing.expectedToDate), gap: show(a.pacing.gap ?? '0.00'), status: a.pacing.onTrack ? t('onTrack') : t('behind') })}</p>
              )}
              {a.originalTarget !== a.target && <p className="text-sm text-muted">{t('targetAsOf', { target: show(a.target), original: show(a.originalTarget) })}</p>}
              <ChartCard
                title={t('dailyTitle')}
                summary={t('dailySummary', { actual: show(a.actual), days: a.daily.length })}
                data={a.daily.map((d) => ({ day: d.date.slice(5), cumulative: Number(d.cumulative.split('.')[0]) }))}
                xKey="day"
                kind="area"
                series={[{ key: 'cumulative', label: t('cumulative'), tone: 'gold' }]}
                height={220}
                labels={{ chart: t('chart'), table: t('table'), view: t('viewAs') }}
              />
              <p className="text-xs text-muted">{a.definition}</p>
            </div>
          )}
        </DataState>
      </SheetContent>
    </Sheet>
  );
}
