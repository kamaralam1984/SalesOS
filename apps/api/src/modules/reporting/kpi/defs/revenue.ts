import { achievementPct, averageDealValue, D, forecastAccuracy, forecastBias, forecastBounds, istRange, money, pacing, addDays, sum, wape, ZERO } from '../../../revenue/calc';
import type { KpiComputed, KpiCtx, KpiImpl } from '../types';
import { collectionFacts, collectionsFor, loadTargets, revenueFacts, revenueFor, scopeTopTargets, subtrees, sumTargets, targetWindow, userNames, userSet } from './revenue-facts';
import { DATE_ONLY, dec, meta } from './helpers';
import { Prisma } from '@prisma/client';

const NO_TARGET_NOTE = 'No target set for this scope and period';

async function achievementKpi(ctx: KpiCtx, metric: 'REVENUE' | 'COLLECTION' | 'ENROLMENT'): Promise<KpiComputed> {
  const win = targetWindow(ctx);
  const targets = scopeTopTargets(await loadTargets(ctx, metric, win.endsOn), ctx.scope);
  const target = sumTargets(targets);
  const ids = userSet(ctx.scope);
  let actual = ZERO;
  let detail: Record<string, unknown> = {};
  if (metric === 'COLLECTION') {
    const f = await collectionFacts(ctx, win);
    const r = collectionsFor(f, win, ids);
    actual = r.net;
    detail = { verifiedCollections: money(r.verified), refundsProcessed: money(r.refunded) };
  } else {
    const f = await revenueFacts(ctx, win);
    const r = revenueFor(f, win, ids);
    actual = metric === 'ENROLMENT' ? D(r.enrolments.toString()) : r.net;
    detail = { booked: money(r.booked), refundsApproved: money(r.refundedApproved), wonDeals: r.wonCount, enrolments: r.enrolments };
  }
  const isCount = metric === 'ENROLMENT';
  const fmt = (v: Prisma.Decimal) => (isCount ? v.toFixed(0) : money(v));
  const base = {
    numerator: fmt(actual),
    denominator: target.isZero() ? null : fmt(target),
    currency: isCount ? null : 'INR',
    effectiveRange: { from: win.startsOn, to: win.endsOn },
    breakdown: { periodLabel: ctx.period.label, targetNodes: targets.length, ...detail, pacing: target.isZero() ? null : pacing(target, actual, ctx.period.startsOn, ctx.period.endsOn, win.endsOn) },
  };
  if (target.isZero()) return { ...base, value: null, nullReason: 'NO_TARGET', note: NO_TARGET_NOTE };
  return { ...base, value: achievementPct(actual, target) };
}

const common = {
  group: 'REV' as const,
  unit: 'PERCENT' as const,
  window: 'Target period of the `to` date (month by default; quarter / fiscal year selectable); actuals run from period start to min(as-of, period end).',
  tables: ['sales_records', 'sales_credits', 'sale_adjustments', 'refunds', 'targets', 'target_revisions'],
  rounding: '1 decimal place, shown as %; values above 100 are allowed',
  usesWindow: 'PERIOD' as const,
  zeroDenominator: 'No target set -> null (dash) with the note "No target set"; never 0% or infinity',
};

export const REV_001: KpiImpl = {
  meta: meta({
    ...common,
    id: 'KPI-REV-001',
    name: 'Monthly revenue achievement (%)',
    source: 'JD KPI Revenue',
    definition: 'Booked sales (net of approved adjustments and approved refunds), credited per DEC-005, as a percentage of the revenue target in force on the as-of date.',
    numerator: 'Sum of booked sale value (net of approved adjustments) with close date in the period, minus approved refunds approved in the period; each sale once at organisation level, credit split at team/individual level',
    denominator: 'Revenue target for the scope and period (as-of-date revision, DEC-002)',
    exclusions: 'Deals not WON; cancelled sales; refunds in REQUESTED/REVIEWED/REJECTED; non-INR without conversion (excluded and flagged)',
    owner: 'Founder (owner); Team Lead',
    refresh: 'On request (live); org snapshot daily',
    formula: 'actual / target x 100',
    implementation: 'revenueFacts() loads sales_records (+credits, adjustments) closed in the window and refunds approved in it; revenue/calc revenueActual(); target = sum of scope-top targets (targets.metric=REVENUE) via targetAsOf(); achievementPct()',
    decisions: ['DEC-001', 'DEC-002', 'DEC-003', 'DEC-005'],
    cacheTtlSeconds: 60,
  }),
  compute: (ctx) => achievementKpi(ctx, 'REVENUE'),
};

export const REV_002: KpiImpl = {
  meta: meta({
    ...common,
    id: 'KPI-REV-002',
    name: 'Collection target achievement (%)',
    source: 'JD KPI Revenue (collection targets)',
    definition: 'Verified payments (net of processed refunds) credited per DEC-004 as a percentage of the collection target.',
    numerator: 'Sum of VERIFIED/RECONCILED payments with verified date in the period minus PROCESSED/RECONCILED refunds processed in the period',
    denominator: 'Collection target for the scope and period',
    exclusions: 'Unverified/pending payments; duplicate external references; failed/rejected/reversed payments',
    owner: 'Finance (data) / Team Lead',
    refresh: 'On request (live); org snapshot daily',
    formula: 'net collections / collection target x 100',
    implementation: 'collectionFacts(); revenue/calc collectionActual(); targets.metric=COLLECTION via targetAsOf(); achievementPct()',
    decisions: ['DEC-003', 'DEC-004'],
    cacheTtlSeconds: 60,
  }),
  compute: (ctx) => achievementKpi(ctx, 'COLLECTION'),
};

export const REV_004: KpiImpl = {
  meta: meta({
    ...common,
    id: 'KPI-REV-004',
    name: 'Enrolment target achievement (%)',
    unit: 'PERCENT',
    source: 'Blueprint s8 (enrolment target)',
    definition: 'Won enrolments credited to the scope as a percentage of the enrolment (count) target.',
    numerator: 'Sum of sales_records.enrolments closed in the period (credited owners in scope)',
    denominator: 'Enrolment target (count) for the scope and period',
    exclusions: 'As KPI-REV-001',
    owner: 'Team Lead',
    refresh: 'On request',
    formula: 'enrolments / enrolment target x 100',
    implementation: 'revenueFacts(); revenueActual().enrolments; targets.metric=ENROLMENT',
    decisions: ['DEC-001', 'DEC-005'],
    cacheTtlSeconds: 60,
  }),
  compute: (ctx) => achievementKpi(ctx, 'ENROLMENT'),
};

/** Per-manager rows: subtree revenue vs the manager-level target. */
async function managerRows(ctx: KpiCtx, level: 'MANAGER' | 'EXECUTIVE') {
  const win = targetWindow(ctx);
  const all = await loadTargets(ctx, 'REVENUE', win.endsOn);
  const ids = ctx.scope.userIds ? new Set(ctx.scope.userIds) : null;
  const nodes = all.filter((t) => t.level === level && (!ids || ids.has(t.ownerUserId)));
  const facts = await revenueFacts(ctx, win);
  const subs = level === 'MANAGER' ? await subtrees(ctx, nodes.map((n) => n.ownerUserId)) : new Map<string, string[]>();
  const names = await userNames(ctx, nodes.map((n) => n.ownerUserId));
  const rows = nodes.map((n) => {
    const members = level === 'MANAGER' ? subs.get(n.ownerUserId) ?? [n.ownerUserId] : [n.ownerUserId];
    const actual = revenueFor(facts, win, new Set(members)).net;
    return { userId: n.ownerUserId, name: names.get(n.ownerUserId) ?? null, memberCount: members.length, target: n.asOfAmount, actual, members, achievementPct: achievementPct(actual, n.asOfAmount) };
  });
  return { win, rows, facts };
}

const serializeRows = (rows: Awaited<ReturnType<typeof managerRows>>['rows'], detail: boolean) =>
  rows.map((r) => ({ userId: detail ? r.userId : null, name: detail ? r.name : null, memberCount: r.memberCount, target: money(r.target), actual: money(r.actual), achievementPct: r.achievementPct }));

export const REV_003: KpiImpl = {
  meta: meta({
    ...common,
    id: 'KPI-REV-003',
    name: 'Team sales achievement (%)',
    source: 'JD KPI Revenue (team sales achievement)',
    definition: 'Revenue credited to the managers\' teams (manager plus everyone reporting to them) as a percentage of the sum of the managers\' allocated targets.',
    numerator: 'Net booked revenue credited to the union of the managers\' subtrees (each sale once, DEC-005)',
    denominator: 'Sum of MANAGER-level revenue targets in scope',
    exclusions: 'As KPI-REV-001; managers without a target are listed but excluded from the denominator',
    owner: 'Team Lead',
    refresh: 'On request',
    formula: 'sum credited revenue of team subtrees / sum manager targets x 100',
    implementation: 'loadTargets(level=MANAGER); subtrees() recursive CTE on users.manager_id; revenueActual() once over the union of subtree users',
    decisions: ['DEC-005'],
    filters: ['teamId', 'programId', 'sourceId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const { win, rows, facts } = await managerRows(ctx, 'MANAGER');
    const target = rows.reduce((a, r) => a.plus(r.target), ZERO);
    const union = new Set(rows.flatMap((r) => r.members));
    const actual = revenueFor(facts, win, union).net;
    const base = { numerator: money(actual), currency: 'INR', effectiveRange: { from: win.startsOn, to: win.endsOn }, breakdown: { periodLabel: ctx.period.label, teams: serializeRows(rows, ctx.scope.detail) } };
    if (target.isZero()) return { ...base, denominator: null, value: null, nullReason: 'NO_TARGET', note: NO_TARGET_NOTE };
    return { ...base, denominator: money(target), value: achievementPct(actual, target) };
  },
};

export const TEA_001: KpiImpl = {
  meta: meta({
    ...common,
    id: 'KPI-TEA-001',
    name: 'Sales Manager target achievement (%)',
    source: 'JD KPI Team',
    definition: 'Average of each manager\'s own team achievement (credited team revenue / the manager\'s allocated target); every manager counts equally.',
    numerator: 'Sum of per-manager achievement percentages',
    denominator: 'Number of managers with a target',
    exclusions: 'As KPI-REV-001; managers with no allocation are not averaged (listed)',
    owner: 'Team Lead',
    refresh: 'On request',
    formula: 'mean over managers of (team credited revenue / manager target x 100)',
    implementation: 'managerRows(MANAGER): per-manager revenueActual() over the manager subtree vs targets.level=MANAGER',
    decisions: ['DEC-002', 'DEC-005'],
    filters: ['teamId', 'programId', 'sourceId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const { win, rows } = await managerRows(ctx, 'MANAGER');
    const withTarget = rows.filter((r) => r.target.gt(0));
    const pcts = withTarget.map((r) => D(achievementPct(r.actual, r.target) ?? '0'));
    const base = { effectiveRange: { from: win.startsOn, to: win.endsOn }, breakdown: { periodLabel: ctx.period.label, managers: serializeRows(rows, ctx.scope.detail), atOrAbove100: pcts.filter((p) => p.gte(100)).length } };
    if (withTarget.length === 0) return { ...base, value: null, numerator: null, denominator: null, nullReason: 'NO_TARGET', note: NO_TARGET_NOTE };
    const total = sum(pcts);
    return { ...base, value: dec(total.div(withTarget.length), 1), numerator: dec(total, 1), denominator: String(withTarget.length) };
  },
};

export const TEA_002: KpiImpl = {
  meta: meta({
    ...common,
    id: 'KPI-TEA-002',
    name: 'Individual target achievement (%)',
    source: 'JD KPI Team',
    definition: 'Average of each executive\'s credited revenue as a percentage of the executive\'s allocated revenue target; every executive counts equally. For a single executive this is their own achievement.',
    numerator: 'Sum of per-executive achievement percentages',
    denominator: 'Number of executives with a target',
    exclusions: 'As KPI-REV-001; executives without a target are listed but not averaged',
    owner: 'Manager',
    refresh: 'On request',
    formula: 'mean over executives of (credited revenue / own target x 100)',
    implementation: 'managerRows(EXECUTIVE): revenueActual() for the single executive vs targets.level=EXECUTIVE',
    decisions: ['DEC-002', 'DEC-005'],
    filters: ['teamId', 'ownerId', 'programId', 'sourceId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const { win, rows } = await managerRows(ctx, 'EXECUTIVE');
    const withTarget = rows.filter((r) => r.target.gt(0));
    const pcts = withTarget.map((r) => D(achievementPct(r.actual, r.target) ?? '0'));
    const base = { effectiveRange: { from: win.startsOn, to: win.endsOn }, breakdown: { periodLabel: ctx.period.label, executives: serializeRows(rows, ctx.scope.detail), atOrAbove100: pcts.filter((p) => p.gte(100)).length } };
    if (withTarget.length === 0) return { ...base, value: null, numerator: null, denominator: null, nullReason: 'NO_TARGET', note: NO_TARGET_NOTE };
    const total = sum(pcts);
    return { ...base, value: dec(total.div(withTarget.length), 1), numerator: dec(total, 1), denominator: String(withTarget.length) };
  },
};

export const SAL_004: KpiImpl = {
  meta: meta({
    id: 'KPI-SAL-004',
    name: 'Average deal value',
    group: 'SAL',
    unit: 'CURRENCY',
    source: 'JD KPI Sales',
    definition: 'Net booked sale value of the won deals in the period divided by their number.',
    numerator: 'Sum of net booked sale value (net of approved adjustments) of won deals closed in the window',
    denominator: 'Count of won deals in the window',
    window: 'Date range (default: current month)',
    exclusions: 'Zero-value (complimentary) deals; cancelled sales; non-INR; refunds are not netted (see KPI-REV-001)',
    tables: ['sales_records', 'sales_credits', 'sale_adjustments'],
    rounding: 'whole rupees, INR',
    owner: 'Team Lead',
    refresh: 'On request',
    zeroDenominator: 'No won deals -> null (dash)',
    formula: 'sum / count',
    implementation: 'revenueFacts(); zero-value sales dropped; revenueActual().booked / wonCount via calc averageDealValue()',
    decisions: ['DEC-005'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const f = await revenueFacts(ctx, ctx.window);
    const sales = f.sales.filter((s) => D(s.saleValue).gt(0));
    const r = revenueFor({ sales, refunds: [] }, ctx.window, userSet(ctx.scope));
    const avg = averageDealValue(r.booked, r.wonCount);
    return { value: avg, numerator: money(r.booked), denominator: String(r.wonCount), currency: 'INR', nullReason: avg === null ? 'ZERO_DENOMINATOR' : undefined, note: avg === null ? 'No won deals in this period' : null, breakdown: { complimentaryExcluded: f.sales.length - sales.length } };
  },
};

/** Forecast helpers ------------------------------------------------------------------------------------------------ */
async function forecastFor(ctx: KpiCtx, type: 'WEEK' | 'MONTH', startsOn: string) {
  const org = ctx.scope.userIds === null;
  const forecast = await ctx.prisma.forecast.findFirst({
    where: { organizationId: ctx.organizationId, periodType: type, periodStart: DATE_ONLY(startsOn), ...(org ? { scopeKey: 'ORG' } : { scopeUserId: ctx.filters.ownerId ?? ctx.user.userId }) },
    include: { snapshots: true },
  });
  if (!forecast) return null;
  const basis = forecast.snapshots.find((s) => s.kind === 'PERIOD_START') ?? [...forecast.snapshots].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())[0];
  return basis ? { forecast, basis } : null;
}

export const SAL_005: KpiImpl = {
  meta: meta({
    id: 'KPI-SAL-005',
    name: 'Forecast accuracy',
    group: 'SAL',
    unit: 'PERCENT',
    source: 'JD KPI Sales; DEC-030',
    definition: 'Accuracy = max(0, 1 - |F - A| / A) x 100 of the period-start forecast snapshot (F) against the actual net revenue of the period (A); WAPE over the trailing six closed periods and bias are reported alongside.',
    numerator: 'Absolute forecast error |F - A| of the latest closed period',
    denominator: 'Actual net revenue A of that period',
    window: 'Latest CLOSED week or month (the open period is shown as forecast vs actual-so-far, without an accuracy figure)',
    exclusions: 'Periods without a stored snapshot; A <= 0 (never reported as 100%)',
    tables: ['forecasts', 'forecast_snapshots', 'sales_records', 'refunds'],
    rounding: '1 decimal place',
    owner: 'Team Lead / Founder',
    refresh: 'After period close',
    zeroDenominator: 'A = 0 -> accuracy null (dash); WAPE null when the sum of actuals is 0',
    formula: 'max(0, 1 - |F - A| / A) x 100; WAPE = sum|F_i - A_i| / sum A_i x 100; bias = (F - A) / A x 100',
    implementation: 'prisma.forecast + forecast_snapshots (PERIOD_START snapshot, else earliest); actual via revenueActual().net; calc forecastAccuracy()/forecastBias()/wape()',
    decisions: ['DEC-030'],
    filters: ['ownerId', 'teamId'],
    usesWindow: 'PERIOD',
    isEstimate: true,
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const type: 'WEEK' | 'MONTH' = ctx.period.type === 'WEEK' ? 'WEEK' : 'MONTH';
    const bounds = (anchor: string) => forecastBounds(type, anchor);
    let cur = bounds(ctx.period.type === 'WEEK' || ctx.period.type === 'MONTH' ? ctx.period.startsOn : ctx.asOf);
    if (cur.endsOn >= ctx.asOf) cur = bounds(addDays(cur.startsOn, -1)); // latest closed period
    const ids = userSet(ctx.scope);
    const actualOf = async (b: { startsOn: string; endsOn: string }) => {
      const win = { ...istRange(b.startsOn, b.endsOn) };
      return revenueFor(await revenueFacts(ctx, win), win, ids).net;
    };
    const bounds6: Array<ReturnType<typeof bounds>> = [];
    let anchor = cur;
    for (let i = 0; i < 6; i += 1) {
      bounds6.push(anchor);
      anchor = bounds(addDays(anchor.startsOn, -1));
    }
    const periods = await Promise.all(
      bounds6.map(async (b) => {
        const [fc, actual] = await Promise.all([forecastFor(ctx, type, b.startsOn), actualOf(b)]);
        return { startsOn: b.startsOn, endsOn: b.endsOn, forecast: fc ? money(fc.basis.total) : null, actual: money(actual), accuracyPct: fc ? forecastAccuracy(fc.basis.total, actual) : null };
      }),
    );
    const head = periods[0]!;
    const pairs = periods.filter((p) => p.forecast !== null && D(p.actual).gt(0)).map((p) => ({ forecast: p.forecast!, actual: p.actual }));
    const base = { effectiveRange: { from: head.startsOn, to: head.endsOn }, currency: 'INR', breakdown: { errorMetric: 'max(0, 1 - |F - A| / A) x 100', periodType: type, forecast: head.forecast, actual: head.actual, biasPct: head.forecast ? forecastBias(head.forecast, head.actual) : null, wapePct: wape(pairs), wapePeriods: pairs.length, periods } };
    if (head.forecast === null) return { ...base, value: null, nullReason: 'NO_SNAPSHOT', note: 'No forecast snapshot was stored for this period, so accuracy cannot be computed' };
    if (head.accuracyPct === null) return { ...base, value: null, numerator: null, denominator: money(head.actual), nullReason: 'ZERO_DENOMINATOR', note: 'Actual revenue was zero: accuracy is not defined' };
    return { ...base, value: head.accuracyPct, numerator: money(D(head.forecast).minus(head.actual).abs()), denominator: head.actual };
  },
};

export const SAL_006: KpiImpl = {
  meta: meta({
    id: 'KPI-SAL-006',
    name: 'Weekly forecast',
    group: 'SAL',
    unit: 'CURRENCY',
    source: 'Blueprint s8 (weekly forecast)',
    definition: 'Latest stored forecast (an ESTIMATE, never a fact) for the current week: booked-to-date plus stage-weighted open pipeline.',
    numerator: 'Total of the most recent forecast snapshot of the current week (booked to date + weighted pipeline)',
    denominator: 'n/a',
    window: 'Current week (Monday to Sunday, IST)',
    exclusions: 'Weeks with no snapshot',
    tables: ['forecasts', 'forecast_snapshots'],
    rounding: '2 decimals, INR',
    owner: 'Team Lead',
    refresh: 'Per snapshot',
    zeroDenominator: 'No snapshot -> null (dash)',
    formula: 'forecast_snapshots.total',
    implementation: 'prisma.forecast(periodType=WEEK) + latest forecast_snapshots row',
    decisions: ['DEC-030'],
    filters: ['ownerId', 'teamId'],
    usesWindow: 'PERIOD',
    isEstimate: true,
  }),
  async compute(ctx) {
    const b = forecastBounds('WEEK', ctx.asOf);
    const org = ctx.scope.userIds === null;
    const forecast = await ctx.prisma.forecast.findFirst({
      where: { organizationId: ctx.organizationId, periodType: 'WEEK', periodStart: DATE_ONLY(b.startsOn), ...(org ? { scopeKey: 'ORG' } : { scopeUserId: ctx.filters.ownerId ?? ctx.user.userId }) },
      include: { snapshots: { orderBy: { takenAt: 'desc' }, take: 1 } },
    });
    const snap = forecast?.snapshots[0];
    const eff = { from: b.startsOn, to: b.endsOn };
    if (!snap) return { value: null, nullReason: 'NO_SNAPSHOT', note: 'No forecast snapshot for this week yet', currency: 'INR', effectiveRange: eff };
    return { value: money(snap.total), currency: snap.currency, effectiveRange: eff, dataAsOf: snap.takenAt, breakdown: { bookedToDate: money(snap.bookedToDate), weightedPipeline: money(snap.weightedPipeline), unweightedPipeline: money(snap.unweightedPipeline), takenAt: snap.takenAt.toISOString(), isEstimate: true }, caution: 'Estimate, not a fact' };
  },
};

export const REVENUE_KPIS: KpiImpl[] = [REV_001, REV_002, REV_003, REV_004, SAL_004, SAL_005, SAL_006, TEA_001, TEA_002];
