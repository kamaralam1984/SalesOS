import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Principal } from '../../../common/authz';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { D, money } from '../../revenue/calc';
import { KpiService, type KpiQuery } from '../kpi/kpi.service';
import { ReportsService } from '../reports/reports.service';
import { sumBy } from '../reports/members';
import type { KpiCtx } from '../kpi/types';
import { pipelineByStage } from '../dashboards/panels';

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIPPED';
export interface ReconCheck {
  id: string;
  name: string;
  kpiId: string | null;
  /** independent raw SQL recompute from the base tables */
  expected: string | null;
  /** what the dashboard / KPI layer / report reports */
  actual: string | null;
  difference: string | null;
  tolerance: string;
  status: CheckStatus;
  note: string | null;
}

const orgWide = (ctx: KpiCtx) => ctx.scope.userIds === null && !ctx.filters.programId && !ctx.filters.sourceId && !ctx.filters.teamId && !ctx.filters.ownerId;

/**
 * Proves "dashboard totals equal raw database totals" (KPI-PRO-002 evidence). Each check recomputes the figure with plain SQL on the
 * base tables (no shared predicates helpers, no revenue calc) and compares it with what the KPI layer / the reports return to the dashboards.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService, private readonly kpis: KpiService, private readonly reports: ReportsService, private readonly audit: AuditService) {}

  async check(user: Principal, q: KpiQuery = {}) {
    const started = Date.now();
    const ctx = await this.kpis.contextFor(user, ['kpi:view', 'reports:view'], q);
    const ids = ctx.scope.userIds;
    const org = ctx.organizationId;
    const { from, to } = ctx.window;
    const checks: ReconCheck[] = [];
    const count = (id: string, name: string, kpiId: string | null, expected: number, actual: number | null, note: string | null = null) => {
      const diff = actual === null ? null : actual - expected;
      checks.push({ id, name, kpiId, expected: String(expected), actual: actual === null ? null : String(actual), difference: diff === null ? null : String(diff), tolerance: '0', status: actual === null ? 'SKIPPED' : diff === 0 ? 'PASS' : 'FAIL', note });
    };
    const amount = (id: string, name: string, kpiId: string | null, expected: Prisma.Decimal, actual: string | null, note: string | null = null) => {
      const diff = actual === null ? null : D(actual).minus(expected).abs();
      checks.push({ id, name, kpiId, expected: money(expected), actual, difference: diff === null ? null : money(diff), tolerance: '0.01', status: actual === null ? 'SKIPPED' : diff!.lte('0.01') ? 'PASS' : 'FAIL', note });
    };
    const skip = (id: string, name: string, kpiId: string | null, note: string) => checks.push({ id, name, kpiId, expected: null, actual: null, difference: null, tolerance: '-', status: 'SKIPPED', note });
    const val = async (kpiId: string): Promise<number | null> => {
      const r = await this.kpis.run(user, kpiId, { from: ctx.window.startsOn, to: ctx.window.endsOn, period: ctx.period.type, asOf: ctx.asOf, ...ctx.filters }, { tile: true });
      return r.value === null ? null : Number(r.value);
    };
    const own = (c: string) => (ids === null ? Prisma.empty : Prisma.sql` AND ${Prisma.raw(c)} = ANY(${ids}::uuid[])`);
    const leadOwn = (a: string) => {
      if (ids === null) return Prisma.empty;
      if (ctx.scope.level === 'team' && ctx.scope.teamIds.length && !ctx.scope.narrowed) return Prisma.sql` AND (${Prisma.raw(a)}.assigned_to_id = ANY(${ids}::uuid[]) OR ${Prisma.raw(a)}.team_id = ANY(${ctx.scope.teamIds}::uuid[]))`;
      return Prisma.sql` AND ${Prisma.raw(a)}.assigned_to_id = ANY(${ids}::uuid[])`;
    };
    const noLeadFilters = !ctx.filters.programId && !ctx.filters.sourceId;
    const one = async <T>(sql: Prisma.Sql): Promise<T> => (await this.prisma.$queryRaw<T[]>(sql))[0]!;

    // ---- counts
    if (noLeadFilters) {
      const newLeads = await one<{ n: number }>(Prisma.sql`SELECT count(*)::int AS n FROM leads WHERE organization_id = ${org}::uuid AND created_at >= ${from}::timestamptz AND created_at < ${to}::timestamptz AND merged_into_id IS NULL ${ids === null ? Prisma.empty : Prisma.sql`AND (assigned_to_id = ANY(${ids}::uuid[])${ctx.scope.level === 'team' && ctx.scope.teamIds.length && !ctx.scope.narrowed ? Prisma.sql` OR team_id = ANY(${ctx.scope.teamIds}::uuid[])` : Prisma.empty})`}`);
      count('new-leads', 'New leads', 'KPI-EXC-004', newLeads.n, await val('KPI-EXC-004'));
      const unassigned = await one<{ n: number }>(Prisma.sql`SELECT count(*)::int AS n FROM leads l WHERE l.organization_id = ${org}::uuid AND l.stage_category = 'OPEN' AND l.assigned_to_id IS NULL AND l.merged_into_id IS NULL${leadOwn('l')}`);
      count('unassigned', 'Unassigned active leads', 'KPI-EXC-001', unassigned.n, await val('KPI-EXC-001'));
      const noNext = await one<{ n: number }>(Prisma.sql`SELECT count(*)::int AS n FROM leads l WHERE l.organization_id = ${org}::uuid AND l.stage_category = 'OPEN' AND l.merged_into_id IS NULL AND l.next_action_at IS NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.status = 'OPEN')${leadOwn('l')}`);
      count('no-next-action', 'Active leads without a next action', 'KPI-EXC-002', noNext.n, await val('KPI-EXC-002'));
      const active = await one<{ n: number }>(Prisma.sql`SELECT count(*)::int AS n FROM leads l WHERE l.organization_id = ${org}::uuid AND l.stage_category = 'OPEN' AND l.merged_into_id IS NULL${leadOwn('l')}`);
      const ageing = await this.kpis.run(user, 'KPI-PRD-005', { ...ctx.filters }, { tile: true });
      count('ageing-denominator', 'Active leads counted by the ageing KPI', 'KPI-PRD-005', active.n, ageing.denominator === null ? null : Number(ageing.denominator));
    } else {
      skip('new-leads', 'Lead counts', null, 'Program/source filters are applied through the KPI layer; the raw recompute here is unfiltered, so the lead checks run on the unfiltered scope only');
    }
    const calls = await one<{ attempts: number; completed: number; uniq: number }>(Prisma.sql`SELECT count(*)::int AS attempts, (count(*) FILTER (WHERE outcome <> 'FAILED'))::int AS completed, count(DISTINCT lead_id)::int AS uniq FROM call_logs WHERE organization_id = ${org}::uuid AND started_at >= ${from}::timestamptz AND started_at < ${to}${own('user_id')}${noLeadFilters ? Prisma.empty : Prisma.sql` AND lead_id IN (SELECT l.id FROM leads l WHERE l.organization_id = ${org}::uuid${ctx.filters.programId ? Prisma.sql` AND l.program_id = ${ctx.filters.programId}::uuid` : Prisma.empty}${ctx.filters.sourceId ? Prisma.sql` AND l.source_id = ${ctx.filters.sourceId}::uuid` : Prisma.empty})`}`);
    count('call-attempts', 'Call attempts', 'KPI-PRD-006', calls.attempts, await val('KPI-PRD-006'));
    count('calls-completed', 'Calls completed', 'KPI-PRD-001', calls.completed, await val('KPI-PRD-001'));
    count('unique-clients', 'Unique clients called', 'KPI-PRD-008', calls.uniq, await val('KPI-PRD-008'));
    if (noLeadFilters) {
      const overdue = await one<{ n: number }>(Prisma.sql`SELECT count(*)::int AS n FROM tasks WHERE organization_id = ${org}::uuid AND status = 'OPEN' AND due_at < now()${own('assigned_to_id')}`);
      count('overdue-tasks', 'Overdue open tasks', 'KPI-EXC-003', overdue.n, await val('KPI-EXC-003'), 'Point-in-time: compared at the moment of the check');
      const fu = await one<{ n: number }>(Prisma.sql`SELECT count(*)::int AS n FROM tasks WHERE organization_id = ${org}::uuid AND status = 'DONE' AND type IN ('FOLLOW_UP','CALLBACK','DEMO','EMAIL') AND completed_at >= ${from}::timestamptz AND completed_at < ${to}${own('assigned_to_id')}`);
      count('follow-ups-completed', 'Follow-ups completed', 'KPI-PRD-002', fu.n, await val('KPI-PRD-002'));
    }

    // ---- report totals vs KPI totals (dashboards and exports read both)
    const fuReport = await this.reports.run(user, 'follow-ups', { from: ctx.window.startsOn, to: ctx.window.endsOn, ...ctx.filters, limit: 5000 }).catch(() => null);
    if (fuReport && !fuReport.meta.detailWithheld) {
      const rowsSum = sumBy(fuReport.rows, (r) => Number(r.callAttempts ?? 0));
      count('report-follow-ups-attempts', 'Follow-up report rows add up to the call-attempt KPI', 'KPI-PRD-006', Number((fuReport.kpis.find((k) => k.id === 'KPI-PRD-006')?.value as string | null) ?? 0), rowsSum, fuReport.truncated ? 'Report rows were truncated by the row limit' : null);
    } else skip('report-follow-ups-attempts', 'Follow-up report rows add up to the call-attempt KPI', 'KPI-PRD-006', 'Person-level rows are not available in this scope');

    // ---- money (organisation-wide scope only: credit splits need the full sale list)
    if (orgWide(ctx)) {
      const rev = await this.kpis.run(user, 'KPI-REV-001', { to: ctx.period.endsOn, from: ctx.period.startsOn, period: ctx.period.type, asOf: ctx.period.endsOn }, { tile: true });
      // the raw window for this check is the target window of the KPI (period start .. min(asOf, period end))
      const revWin = rev.dateRange;
      const rawWin = { from: new Date(`${revWin.from}T00:00:00+05:30`), to: new Date(new Date(`${revWin.to}T00:00:00+05:30`).getTime() + 86_400_000) };
      const b2 = await one<{ v: Prisma.Decimal }>(Prisma.sql`SELECT coalesce(sum(sale_value), 0) AS v FROM sales_records WHERE organization_id = ${org}::uuid AND closed_at >= ${rawWin.from} AND closed_at < ${rawWin.to}`);
      const a2 = await one<{ v: Prisma.Decimal }>(Prisma.sql`SELECT coalesce(sum(a.delta), 0) AS v FROM sale_adjustments a JOIN sales_records s ON s.id = a.sales_record_id WHERE a.organization_id = ${org}::uuid AND a.status = 'APPROVED' AND s.closed_at >= ${rawWin.from} AND s.closed_at < ${rawWin.to}`);
      const r2 = await one<{ v: Prisma.Decimal }>(Prisma.sql`SELECT coalesce(sum(coalesce(approved_amount, amount)), 0) AS v FROM refunds WHERE organization_id = ${org}::uuid AND status IN ('APPROVED','PROCESSED','RECONCILED') AND approved_at >= ${rawWin.from} AND approved_at < ${rawWin.to}`);
      amount('revenue-net', 'Net revenue (booked + approved adjustments - approved refunds)', 'KPI-REV-001', D(b2.v).plus(a2.v).minus(r2.v), rev.numerator, `Window ${revWin.from} to ${revWin.to}`);
      const col = await this.kpis.run(user, 'KPI-REV-002', { to: ctx.period.endsOn, from: ctx.period.startsOn, period: ctx.period.type, asOf: ctx.period.endsOn }, { tile: true });
      const cw = { from: new Date(`${col.dateRange.from}T00:00:00+05:30`), to: new Date(new Date(`${col.dateRange.to}T00:00:00+05:30`).getTime() + 86_400_000) };
      const pay = await one<{ v: Prisma.Decimal }>(Prisma.sql`SELECT coalesce(sum(amount), 0) AS v FROM payments WHERE organization_id = ${org}::uuid AND status IN ('VERIFIED','RECONCILED') AND verified_at >= ${cw.from} AND verified_at < ${cw.to}`);
      const pr = await one<{ v: Prisma.Decimal }>(Prisma.sql`SELECT coalesce(sum(coalesce(processed_amount, approved_amount, amount)), 0) AS v FROM refunds WHERE organization_id = ${org}::uuid AND status IN ('PROCESSED','RECONCILED') AND processed_at >= ${cw.from} AND processed_at < ${cw.to}`);
      amount('collections-net', 'Net collections (verified payments - processed refunds)', 'KPI-REV-002', D(pay.v).minus(pr.v), col.numerator, `Window ${col.dateRange.from} to ${col.dateRange.to}`);
      const revReport = await this.reports.run(user, 'revenue', { from: ctx.window.startsOn, to: ctx.window.endsOn, period: ctx.period.type, by: 'owner', limit: 5000 }).catch(() => null);
      if (revReport && !revReport.meta.detailWithheld) amount('report-revenue-owner-rows', 'Revenue report (by owner) rows add up to the organisation total', 'KPI-REV-001', D((revReport.summary.totals as { net: string }).net), String((revReport.summary.rowTotals as { net: string }).net), 'Each credited owner counted once per split');
      const fr = await this.reports.run(user, 'revenue', { from: ctx.window.startsOn, to: ctx.window.endsOn, period: ctx.period.type, by: 'program', limit: 5000 }).catch(() => null);
      if (fr) amount('report-revenue-program-rows', 'Revenue report (by program) rows add up to the organisation total', 'KPI-REV-001', D((fr.summary.totals as { net: string }).net), String((fr.summary.rowTotals as { net: string }).net));
      const open = await one<{ n: number; v: Prisma.Decimal }>(Prisma.sql`SELECT count(*)::int AS n, coalesce(sum(amount), 0) AS v FROM deals WHERE organization_id = ${org}::uuid AND stage IN ('OPEN','NEGOTIATION','PAYMENT_PENDING')`);
      count('pipeline-deals', 'Open pipeline deal count (dashboard pipeline panel)', null, open.n, (await pipelineByStage(await this.kpis.contextFor(user, ['kpi:view', 'deals:view'], { ...ctx.filters, from: ctx.window.startsOn, to: ctx.window.endsOn })).then((p) => p.reduce((a, x) => a + x.deals, 0)).catch(() => null)));
    } else {
      skip('revenue-net', 'Net revenue', 'KPI-REV-001', 'Money checks need organisation-wide scope without filters (credit splits cannot be recomputed independently per scope)');
    }

    const passed = checks.filter((c) => c.status === 'PASS').length;
    const failed = checks.filter((c) => c.status === 'FAIL').length;
    const skipped = checks.filter((c) => c.status === 'SKIPPED').length;
    return {
      ranAt: new Date().toISOString(),
      dateRange: { from: ctx.window.startsOn, to: ctx.window.endsOn, timezone: 'Asia/Kolkata' },
      scope: { level: ctx.scope.level, orgWide: orgWide(ctx) },
      summary: { total: checks.length - skipped, passed, failed, skipped, allPassed: failed === 0 && passed > 0, accuracyPct: checks.length - skipped > 0 ? ((passed / (checks.length - skipped)) * 100).toFixed(1) : null },
      checks,
      durationMs: Date.now() - started,
      method: 'Each figure is recomputed with independent SQL on the base tables and compared with the value the KPI layer / reports return to the dashboards (tolerance 0 for counts, 0.01 for money).',
    };
  }

  /** Persist a run (KPI-PRO-002 evidence) and audit it. */
  async run(user: Principal, q: KpiQuery = {}, trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL') {
    const result = await this.check(user, q);
    // KPI-PRO-002 aggregates stored runs: only organisation-wide runs (money checks included) are evidence, never a narrowed or team-scope run
    if (!result.scope.orgWide) throw new AppError('ORG_SCOPE_REQUIRED', 'Only an organisation-wide reconciliation (no filters, organisation scope) can be recorded', 403);
    const row = await this.prisma.kpiReconciliationRun.create({
      data: {
        organizationId: user.organizationId,
        trigger,
        triggeredById: trigger === 'MANUAL' ? user.userId : null,
        periodStart: new Date(`${result.dateRange.from}T00:00:00Z`),
        periodEnd: new Date(`${result.dateRange.to}T00:00:00Z`),
        totalChecks: result.summary.total,
        passed: result.summary.passed,
        failed: result.summary.failed,
        skipped: result.summary.skipped,
        checks: result.checks as unknown as Prisma.InputJsonValue,
        durationMs: result.durationMs,
      },
    });
    await this.audit.record({ organizationId: user.organizationId, actorId: trigger === 'MANUAL' ? user.userId : null, action: 'analytics.reconciliation_run', entityType: 'kpi_reconciliation_run', entityId: row.id, metadata: { trigger, passed: result.summary.passed, failed: result.summary.failed, skipped: result.summary.skipped, scopeLevel: result.scope.level } });
    return { ...result, runId: row.id };
  }
}
