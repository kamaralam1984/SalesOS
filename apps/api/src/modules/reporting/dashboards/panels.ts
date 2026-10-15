import { Prisma } from '@prisma/client';
import { D, DEFAULT_STAGE_PROBABILITIES, dailySeries, istRange, money, periodBounds, probabilityFor, addDays, ZERO } from '../../revenue/calc';
import type { KpiCtx } from '../kpi/types';
import { leadFilters, leadScope, notDemo, notMerged, num, ownerIn } from '../kpi/sql';
import { revenueFacts, revenueFor, targetWindow, userSet } from '../kpi/defs/revenue-facts';

/** Panels = non-KPI dashboard data. They use the same scope predicates as the KPI layer and never widen it. */

const dealWhere = (ctx: KpiCtx) =>
  Prisma.sql`d.organization_id = ${ctx.organizationId}::uuid${ownerIn(ctx.scope, 'd.owner_id')}${ctx.filters.programId ? Prisma.sql` AND d.program_id = ${ctx.filters.programId}::uuid` : Prisma.empty}${ctx.filters.sourceId ? Prisma.sql` AND EXISTS (SELECT 1 FROM leads l WHERE l.id = d.lead_id AND l.source_id = ${ctx.filters.sourceId}::uuid)` : Prisma.empty}`;

export interface PipelineStage {
  stage: string;
  deals: number;
  amount: string;
  /** probability-weighted amount using the DEC-030 default probabilities: an ESTIMATE */
  weightedAmount: string;
  probability: string;
}

export async function pipelineByStage(ctx: KpiCtx): Promise<PipelineStage[]> {
  const rows = await ctx.prisma.$queryRaw<Array<{ stage: string; n: number; v: Prisma.Decimal }>>(Prisma.sql`
    SELECT d.stage::text AS stage, count(*)::int AS n, coalesce(sum(d.amount), 0) AS v FROM deals d
    WHERE ${dealWhere(ctx)} AND d.stage IN ('OPEN','NEGOTIATION','PAYMENT_PENDING') GROUP BY d.stage`);
  const by = new Map(rows.map((r) => [r.stage, r]));
  return ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING'].map((stage) => {
    const r = by.get(stage);
    const p = probabilityFor(stage, DEFAULT_STAGE_PROBABILITIES);
    return { stage, deals: num(r?.n), amount: money(r?.v ?? ZERO), weightedAmount: money(D(r?.v ?? ZERO).times(p)), probability: p.toString() };
  });
}

/** Active leads per current stage (funnel health). */
export async function leadsByStage(ctx: KpiCtx): Promise<Array<{ stage: string; label: string; leads: number }>> {
  const rows = await ctx.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`
    SELECT l.status, count(*)::int AS n FROM leads l WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.stage_category = 'OPEN'${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)} GROUP BY l.status`);
  const cfg = await ctx.prisma.leadStageConfig.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { sortOrder: 'asc' } });
  const order = new Map(cfg.map((c, i) => [c.key, i]));
  return rows.map((r) => ({ stage: r.status, label: cfg.find((c) => c.key === r.status)?.label ?? r.status, leads: num(r.n) })).sort((a, b) => (order.get(a.stage) ?? 999) - (order.get(b.stage) ?? 999));
}

/** Net revenue per IST month for the last `months` months ending with the month of `asOf`: one fact load, calc per month. */
export async function monthlyRevenueTrend(ctx: KpiCtx, months = 6) {
  const cur = periodBounds('MONTH', ctx.window.endsOn);
  const periods: Array<{ startsOn: string; endsOn: string; label: string }> = [cur];
  for (let i = 1; i < months; i += 1) periods.unshift(periodBounds('MONTH', addDays(periods[0]!.startsOn, -1)));
  const full = istRange(periods[0]!.startsOn, cur.endsOn);
  const facts = await revenueFacts(ctx, full);
  const ids = userSet(ctx.scope);
  return periods.map((p) => {
    const win = istRange(p.startsOn, p.endsOn);
    const r = revenueFor(facts, win, ids);
    return { month: p.label, startsOn: p.startsOn, endsOn: p.endsOn, net: money(r.net), booked: money(r.booked), refundsApproved: money(r.refundedApproved), enrolments: r.enrolments, wonDeals: r.wonCount };
  });
}

/** Daily net revenue (booked less approved refunds, IST days) with a running total, for the period window. */
export async function revenueDailyTrend(ctx: KpiCtx) {
  const win = targetWindow(ctx);
  const facts = await revenueFacts(ctx, win);
  const ids = userSet(ctx.scope);
  const items: Array<{ at: Date; amount: Prisma.Decimal }> = [];
  for (const s of facts.sales) {
    if (s.closedAt < win.from || s.closedAt >= win.to) continue;
    const r = revenueFor({ sales: [s], refunds: [] }, win, ids);
    if (r.wonCount > 0) items.push({ at: s.closedAt, amount: r.booked });
  }
  const byDeal = new Map(facts.sales.map((s) => [s.dealId, s]));
  for (const rf of facts.refunds) {
    const s = byDeal.get(rf.dealId);
    if (!s || !rf.approvedAt || rf.approvedAt < win.from || rf.approvedAt >= win.to) continue;
    const r = revenueFor({ sales: [s], refunds: [rf] }, { from: new Date(0), to: new Date(8.64e15) }, ids);
    // refund share for the scope = booked(all) - net (the sale is inside this synthetic window)
    items.push({ at: rf.approvedAt, amount: r.refundedApproved.negated() });
  }
  return dailySeries(items, win.startsOn, win.endsOn);
}

export interface RiskPanel {
  overdueTasks: number;
  unassignedLeads: number;
  noNextActionLeads: number;
  staleLeads: number;
  openComplaints: number;
  p1Complaints: number;
  breachedComplaints: number;
  openEscalations: number;
  paymentsAwaitingVerification: number;
  refundsAwaitingDecision: number;
  dealsPastExpectedClose: number;
  highValueOpenDeals: number;
}

export async function riskPanel(ctx: KpiCtx, perms: { complaints: boolean; escalations: boolean; payments: boolean; refunds: boolean; deals: boolean }): Promise<Partial<RiskPanel>> {
  const org = ctx.organizationId;
  const out: Partial<RiskPanel> = {};
  const [c] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
    SELECT (count(*) FILTER (WHERE l.stage_category = 'OPEN' AND l.assigned_to_id IS NULL))::int AS unassigned,
           (count(*) FILTER (WHERE l.stage_category = 'OPEN' AND l.next_action_at IS NULL AND ot.lead_id IS NULL))::int AS no_next,
           (count(*) FILTER (WHERE l.stage_category = 'OPEN' AND coalesce(l.last_activity_at, l.created_at) < ${ctx.now}::timestamptz - make_interval(days => ${ctx.config.staleActivityDays}::int)))::int AS stale
    FROM leads l LEFT JOIN (SELECT DISTINCT lead_id FROM tasks WHERE status = 'OPEN') ot ON ot.lead_id = l.id -- anti-join: one hash instead of a per-lead NOT EXISTS probe (docs/performance-evidence-l3.md)
    WHERE l.organization_id = ${org}::uuid${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}`);
  out.unassignedLeads = num(c?.unassigned);
  out.noNextActionLeads = num(c?.no_next);
  out.staleLeads = num(c?.stale);
  const [t] = await ctx.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM tasks t WHERE t.organization_id = ${org}::uuid AND t.status = 'OPEN' AND t.due_at < ${ctx.now}::timestamptz${ownerIn(ctx.scope, 't.assigned_to_id')}`);
  out.overdueTasks = num(t?.n);
  if (perms.complaints) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`SELECT (count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','CLOSED')))::int AS open, (count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','CLOSED') AND c.priority = 'P1'))::int AS p1, (count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','CLOSED') AND (c.first_response_breached_at IS NOT NULL OR c.resolution_breached_at IS NOT NULL)))::int AS breached FROM complaints c WHERE c.organization_id = ${org}::uuid AND NOT c.closed_as_invalid${ownerIn(ctx.scope, 'c.owner_id')}`);
    out.openComplaints = num(r?.open);
    out.p1Complaints = num(r?.p1);
    out.breachedComplaints = num(r?.breached);
  }
  if (perms.escalations) {
    const [r] = await ctx.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM relationship_escalations e WHERE e.organization_id = ${org}::uuid AND e.status IN ('OPEN','IN_REVIEW')${ownerIn(ctx.scope, 'e.owner_id')}`);
    out.openEscalations = num(r?.n);
  }
  if (perms.payments) {
    const [r] = await ctx.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM payments p WHERE p.organization_id = ${org}::uuid AND p.status = 'RECORDED'${ownerIn(ctx.scope, 'p.owner_id')}`);
    out.paymentsAwaitingVerification = num(r?.n);
  }
  if (perms.refunds) {
    const [r] = await ctx.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM refunds r WHERE r.organization_id = ${org}::uuid AND r.status IN ('REQUESTED','REVIEWED')${ownerIn(ctx.scope, 'r.owner_id')}`);
    out.refundsAwaitingDecision = num(r?.n);
  }
  if (perms.deals) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`SELECT (count(*) FILTER (WHERE d.expected_close_on < ${ctx.asOf}::date))::int AS past, (count(*) FILTER (WHERE d.is_high_value))::int AS hv FROM deals d WHERE ${dealWhere(ctx)} AND d.stage IN ('OPEN','NEGOTIATION','PAYMENT_PENDING')`);
    out.dealsPastExpectedClose = num(r?.past);
    out.highValueOpenDeals = num(r?.hv);
  }
  return out;
}

/** Reactivation queue snapshot (CRM). */
export async function reactivationPanel(ctx: KpiCtx) {
  const rows = await ctx.prisma.$queryRaw<Array<{ status: string; n: number; due: number }>>(Prisma.sql`
    SELECT r.status::text AS status, count(*)::int AS n, (count(*) FILTER (WHERE r.eligible_from <= ${ctx.now}::timestamptz))::int AS due
    FROM reactivation_queue r JOIN leads l ON l.id = r.lead_id WHERE r.organization_id = ${ctx.organizationId}::uuid${leadScope(ctx.scope)}${leadFilters(ctx.filters)} GROUP BY r.status`);
  return rows.map((r) => ({ status: r.status, entries: num(r.n), eligibleNow: num(r.due) }));
}

/** Open deals the forecast does not count or that slipped: unscheduled / past expected close. */
export async function forecastRiskPanel(ctx: KpiCtx) {
  const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number | Prisma.Decimal>>>(Prisma.sql`
    SELECT (count(*) FILTER (WHERE d.expected_close_on IS NULL))::int AS unscheduled, coalesce(sum(d.amount) FILTER (WHERE d.expected_close_on IS NULL), 0) AS unscheduled_amount,
           (count(*) FILTER (WHERE d.expected_close_on < ${ctx.asOf}::date))::int AS slipped, coalesce(sum(d.amount) FILTER (WHERE d.expected_close_on < ${ctx.asOf}::date), 0) AS slipped_amount
    FROM deals d WHERE ${dealWhere(ctx)} AND d.stage IN ('OPEN','NEGOTIATION','PAYMENT_PENDING')`);
  return { unscheduledDeals: num(r?.unscheduled), unscheduledAmount: money((r?.unscheduled_amount as Prisma.Decimal) ?? ZERO), slippedDeals: num(r?.slipped), slippedAmount: money((r?.slipped_amount as Prisma.Decimal) ?? ZERO), note: 'Deals without a future expected close date are not counted in the stage-weighted forecast (DEC-030).' };
}

/** People-management status (counts only; the permission for each source is checked by the caller). */
export async function peopleStatusPanel(ctx: KpiCtx, perms: { reviews: boolean; pip: boolean; succession: boolean; coaching: boolean }) {
  const org = ctx.organizationId;
  const out: Record<string, unknown> = {};
  if (perms.coaching) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
      SELECT (SELECT count(*) FROM one_on_ones o WHERE o.organization_id = ${org}::uuid AND o.status = 'HELD' AND o.scheduled_for >= ${ctx.window.from}::timestamptz AND o.scheduled_for < ${ctx.window.to}::timestamptz${ownerIn(ctx.scope, 'o.manager_id')})::int AS held,
             (SELECT count(*) FROM one_on_ones o WHERE o.organization_id = ${org}::uuid AND o.status = 'SCHEDULED' AND o.scheduled_for >= ${ctx.now}::timestamptz${ownerIn(ctx.scope, 'o.manager_id')})::int AS upcoming,
             (SELECT count(*) FROM coaching_sessions s WHERE s.organization_id = ${org}::uuid AND s.session_date >= ${ctx.window.from}::timestamptz AND s.session_date < ${ctx.window.to}::timestamptz${ownerIn(ctx.scope, 's.coach_id')})::int AS sessions,
             (SELECT count(*) FROM coaching_actions a WHERE a.organization_id = ${org}::uuid AND a.status = 'OPEN'${ownerIn(ctx.scope, 'a.owner_id')})::int AS open_actions`);
    out.coaching = { oneOnOnesHeld: num(r?.held), oneOnOnesUpcoming: num(r?.upcoming), coachingSessions: num(r?.sessions), openCoachingActions: num(r?.open_actions) };
  }
  if (perms.reviews) {
    const rows = await ctx.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`SELECT r.status::text AS status, count(*)::int AS n FROM performance_reviews r WHERE r.organization_id = ${org}::uuid${ownerIn(ctx.scope, 'r.employee_id')} GROUP BY r.status`);
    out.reviews = Object.fromEntries(rows.map((r) => [r.status, num(r.n)]));
  }
  if (perms.pip) {
    const rows = await ctx.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`SELECT p.status::text AS status, count(*)::int AS n FROM improvement_plans p WHERE p.organization_id = ${org}::uuid AND p.status IN ('PENDING_APPROVAL','ACTIVE','EXTENDED')${ownerIn(ctx.scope, 'p.employee_id')} GROUP BY p.status`);
    out.pip = Object.fromEntries(rows.map((r) => [r.status, num(r.n)]));
  }
  if (perms.succession) {
    const rows = await ctx.prisma.$queryRaw<Array<{ readiness: string; n: number }>>(Prisma.sql`SELECT c.readiness::text AS readiness, count(*)::int AS n FROM succession_candidates c WHERE c.organization_id = ${org}::uuid GROUP BY c.readiness`);
    out.succession = Object.fromEntries(rows.map((r) => [r.readiness, num(r.n)]));
  }
  return out;
}

/** Incentive recommendation status counts (amounts never leave this function). */
export async function incentiveStatusPanel(ctx: KpiCtx) {
  const rows = await ctx.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`SELECT i.status::text AS status, count(*)::int AS n FROM incentive_recommendations i WHERE i.organization_id = ${ctx.organizationId}::uuid${ownerIn(ctx.scope, 'i.employee_id')} GROUP BY i.status`);
  return Object.fromEntries(rows.map((r) => [r.status, num(r.n)]));
}

/** Weekly KRA/KPI assignments of one user (current week) with the target; actuals come from the KPI layer when the item maps to a KPI id. */
export async function weeklyAssignments(ctx: KpiCtx, userIds: string[], weekStartIso: string) {
  if (userIds.length === 0) return [];
  const rows = await ctx.prisma.kpiAssignment.findMany({ where: { organizationId: ctx.organizationId, assigneeId: { in: userIds }, weekStart: new Date(`${weekStartIso}T00:00:00Z`) } });
  return rows.map((r) => ({ assigneeId: r.assigneeId, weekStart: weekStartIso, items: r.items as Array<{ key: string; name: string; kind?: string; target?: number | string; unit?: string }> }));
}

export async function latestFounderReport(ctx: KpiCtx) {
  const r = await ctx.prisma.founderReport.findFirst({ where: { organizationId: ctx.organizationId, versionNumber: 1 }, orderBy: [{ periodStart: 'desc' }, { type: 'asc' }], select: { id: true, type: true, status: true, periodStart: true, periodEnd: true, dueAt: true, publishedAt: true, onTime: true } });
  return r ? { id: r.id, type: r.type, status: r.status, periodStart: r.periodStart.toISOString().slice(0, 10), periodEnd: r.periodEnd.toISOString().slice(0, 10), dueAt: r.dueAt.toISOString(), publishedAt: r.publishedAt?.toISOString() ?? null, onTime: r.onTime } : null;
}

/** Pipeline movement in the context window (used for "today"): stage changes, wins and losses from the status history, within lead scope. */
export async function pipelineChangesPanel(ctx: KpiCtx) {
  const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
    SELECT count(*)::int AS changes,
           (count(*) FILTER (WHERE h.new_category = 'WON'))::int AS wins,
           (count(*) FILTER (WHERE h.new_category = 'LOST'))::int AS losses
    FROM lead_status_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.organization_id = ${ctx.organizationId}::uuid AND h.created_at >= ${ctx.window.from}::timestamptz AND h.created_at < ${ctx.window.to}::timestamptz${notMerged()}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}`);
  return { stageChanges: num(r?.changes), wins: num(r?.wins), losses: num(r?.losses) };
}
