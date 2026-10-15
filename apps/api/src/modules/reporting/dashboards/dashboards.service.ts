import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService, type Principal } from '../../../common/authz';
import type { PermissionKey } from '../../../common/authz/permissions.catalogue';
import { PrismaService } from '../../../common/prisma';
import { RedisService } from '../../../common/security/redis.module';
import { forecastBounds } from '../../revenue/calc';
import { KpiService, type KpiQuery } from '../kpi/kpi.service';
import { num } from '../kpi/sql';
import type { KpiCtx, KpiResult } from '../kpi/types';
import { memberFacts, type MemberRow } from '../reports/members';
import { forecastRiskPanel, incentiveStatusPanel, latestFounderReport, leadsByStage, monthlyRevenueTrend, peopleStatusPanel, pipelineByStage, pipelineChangesPanel, reactivationPanel, revenueDailyTrend, riskPanel, weeklyAssignments } from './panels';

type Panel<T> = ({ status: 'OK' } & T) | { status: 'FORBIDDEN'; requires: string } | { status: 'ERROR'; message: string };

export type DashboardKind = 'founder' | 'team-lead' | 'manager' | 'executive';

@Injectable()
export class DashboardsService {
  constructor(private readonly kpis: KpiService, private readonly access: AccessService, private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  private envelope(kind: string, ctx: KpiCtx) {
    return {
      dashboard: kind,
      generatedAt: new Date().toISOString(),
      dateRange: { from: ctx.window.startsOn, to: ctx.window.endsOn, timezone: 'Asia/Kolkata', asOf: ctx.asOf },
      period: ctx.period,
      currency: 'INR',
      filters: { applied: Object.fromEntries(Object.entries(ctx.filters).filter(([, v]) => Boolean(v))), scopeLevel: ctx.scope.level, narrowedByFilter: ctx.scope.narrowed },
    };
  }

  private async tiles(user: Principal, ids: string[], q: KpiQuery): Promise<Record<string, KpiResult>> {
    const res = await this.kpis.runMany(user, ids, q);
    return Object.fromEntries(res.map((r) => [r.id, r]));
  }

  /** Run a panel only when the caller holds the permission; a failure inside one panel never blanks the dashboard. */
  private async panel<T>(user: Principal, perm: PermissionKey | null, fn: () => Promise<T>): Promise<Panel<T>> {
    if (perm && !this.access.has(user, perm)) return { status: 'FORBIDDEN', requires: perm };
    try {
      return { status: 'OK', ...(await fn()) } as Panel<T>;
    } catch (e) {
      return { status: 'ERROR', message: process.env.NODE_ENV === 'production' ? 'Could not load this panel' : (e as Error).message.slice(0, 200) };
    }
  }

  private pctOf(a: number, b: number) {
    return b > 0 ? Math.round((a / b) * 1000) / 10 : null;
  }

  /** members for a panel, scope = kpi:view narrowed by the domain permissions already checked by the caller */
  private async members(ctx: KpiCtx, roleFilter?: (m: MemberRow) => boolean): Promise<MemberRow[]> {
    const all = await memberFacts(ctx);
    return roleFilter ? all.filter(roleFilter) : all;
  }

  private riskPerms(user: Principal) {
    const has = (p: PermissionKey) => this.access.has(user, p);
    return { complaints: has('complaints:view'), escalations: has('relationships:view'), payments: has('collections:view'), refunds: has('refunds:view'), deals: has('deals:view') };
  }

  private peoplePerms(user: Principal) {
    const has = (p: PermissionKey) => this.access.has(user, p);
    return { reviews: has('reviews:view'), pip: has('pip:view'), succession: has('succession:view'), coaching: has('coaching:view') };
  }

  /** the four periods a Founder compares the target against */
  private async targetTiles(user: Principal, id: string, q: KpiQuery) {
    const [month, quarter, year] = await Promise.all((['MONTH', 'QUARTER', 'YEAR'] as const).map((period) => this.kpis.run(user, id, { ...q, period, from: undefined }, { tile: true })));
    return { month, quarter, year };
  }

  // ---------------------------------------------------------------------------------------------------- Founder
  async founder(user: Principal, q: KpiQuery) {
    const ctx = await this.kpis.contextFor(user, ['kpi:view'], q);
    const weekly = ctx.period.type === 'WEEK';
    const panelsP = Promise.all([
      this.panel(user, 'reports:view', async () => ({ members: (await this.members(ctx, (m) => m.roles.includes('SALES_MANAGER') || m.roles.includes('SALES_TEAM_LEAD'))).map((m) => this.scorecard(m)) })),
      this.panel(user, 'deals:view', async () => ({ stages: await pipelineByStage(await this.kpis.contextFor(user, ['kpi:view', 'deals:view'], q)) })),
      this.panel(user, 'targets:view', async () => ({ months: await monthlyRevenueTrend(ctx, 6) })),
      this.panel(user, 'targets:view', async () => ({ series: await revenueDailyTrend(ctx) })),
      this.panel(user, null, async () => ({ items: await riskPanel(ctx, this.riskPerms(user)) })),
      this.panel(user, 'leads:view', async () => ({ stages: await leadsByStage(ctx) })),
      this.panel(user, 'deals:view', async () => forecastRiskPanel(await this.kpis.contextFor(user, ['kpi:view', 'deals:view'], q))),
      this.panel(user, 'founder-reports:view', async () => ({ latest: await latestFounderReport(ctx) })),
    ]);
    const [revenue, collections, enrolment, tiles] = await Promise.all([
      this.targetTiles(user, 'KPI-REV-001', q),
      this.targetTiles(user, 'KPI-REV-002', q),
      this.targetTiles(user, 'KPI-REV-004', q),
      this.tiles(user, ['KPI-SAL-001', 'KPI-SAL-002', 'KPI-SAL-003', 'KPI-SAL-004', 'KPI-SAL-005', 'KPI-SAL-006', 'KPI-TEA-001', 'KPI-TEA-003', 'KPI-PRD-003', 'KPI-EXC-001', 'KPI-EXC-002', 'KPI-EXC-003', 'KPI-EXC-004', 'KPI-EXC-005', 'KPI-FND-001', 'KPI-FND-002', 'KPI-FND-003', 'KPI-CX-001', 'KPI-CX-002', 'KPI-CX-003', 'KPI-CX-004', 'KPI-PRO-001', 'KPI-PRO-002', 'KPI-TEA-004', 'KPI-TEA-005'], q),
    ]);
    const [teams, pipeline, trend, daily, risks, funnel, forecastRisk, latest] = await panelsP;
    return {
      ...this.envelope('founder', ctx),
      view: weekly ? 'weekly' : ctx.period.type === 'MONTH' ? 'monthly' : ctx.period.type.toLowerCase(),
      targets: { revenue, collections, enrolments: enrolment },
      kpis: tiles,
      panels: { teamPerformance: teams, pipeline, revenueTrend: trend, revenueDaily: daily, risks, funnelHealth: funnel, forecastRisk, founderReport: latest },
    };
  }

  private scorecard(m: MemberRow) {
    return { userId: m.userId, name: m.name, role: m.roles.map((r) => r.replace('SALES_', '').toLowerCase()).join('/'), revenueTarget: m.revenueTarget, revenueActual: m.revenueActual, achievementPct: m.achievementPct, callAttempts: m.callAttempts, uniqueClients: m.uniqueClients, followUpsCompleted: m.followUpsCompleted, onTimePct: m.onTimePct, overdueOpen: m.overdueOpen, activeLeads: m.activeLeads, leadsWon: m.leadsWon, conversionPct: m.conversionPct };
  }

  // ---------------------------------------------------------------------------------------------------- Team Lead
  async teamLead(user: Principal, q: KpiQuery) {
    const ctx = await this.kpis.contextFor(user, ['kpi:view'], q);
    const today = { from: ctx.asOf, to: ctx.asOf, period: 'MONTH' as const, asOf: ctx.asOf };
    const [revenue, collections, enrolment, tiles, daily] = await Promise.all([
      this.targetTiles(user, 'KPI-REV-001', q),
      this.targetTiles(user, 'KPI-REV-002', q),
      this.targetTiles(user, 'KPI-REV-004', q),
      this.tiles(user, ['KPI-REV-003', 'KPI-TEA-001', 'KPI-TEA-002', 'KPI-TEA-003', 'KPI-TEA-006', 'KPI-SAL-001', 'KPI-SAL-005', 'KPI-SAL-006', 'KPI-PRD-001', 'KPI-PRD-002', 'KPI-PRD-003', 'KPI-PRD-004', 'KPI-PRD-005', 'KPI-EXC-001', 'KPI-EXC-002', 'KPI-EXC-003', 'KPI-EXC-005', 'KPI-PRO-001', 'KPI-FND-001', 'KPI-FND-003'], q),
      this.tiles(user, ['KPI-PRD-006', 'KPI-PRD-008', 'KPI-PRD-007', 'KPI-PRD-002', 'KPI-EXC-004', 'KPI-REV-002'], { ...q, ...today }),
    ]);
    const todayRevenue = await this.kpis.run(user, 'KPI-REV-001', { ...q, ...today, period: 'MONTH' }, { tile: true });
    const [members, pipeline, funnel, risks, react, forecastRisk, people, incentives, latest, assignments, changes] = await Promise.all([
      this.panel(user, 'reports:view', async () => ({ managers: (await this.members(ctx, (m) => m.roles.includes('SALES_MANAGER'))).map((m) => this.scorecard(m)), executives: (await this.members(ctx, (m) => m.roles.includes('SALES_EXECUTIVE'))).map((m) => this.scorecard(m)) })),
      this.panel(user, 'deals:view', async () => ({ stages: await pipelineByStage(await this.kpis.contextFor(user, ['kpi:view', 'deals:view'], q)) })),
      this.panel(user, 'leads:view', async () => ({ stages: await leadsByStage(ctx) })),
      this.panel(user, null, async () => ({ items: await riskPanel(ctx, this.riskPerms(user)) })),
      this.panel(user, 'leads:reactivation:view', async () => ({ queue: await reactivationPanel(ctx) })),
      this.panel(user, 'deals:view', async () => forecastRiskPanel(await this.kpis.contextFor(user, ['kpi:view', 'deals:view'], q))),
      this.panel(user, null, async () => peopleStatusPanel(ctx, this.peoplePerms(user))),
      this.panel(user, 'incentives:recommendation:view', async () => ({ statusCounts: await incentiveStatusPanel(await this.kpis.contextFor(user, ['kpi:view', 'incentives:recommendation:view'], q)) })),
      this.panel(user, 'founder-reports:view', async () => ({ latest: await latestFounderReport(ctx) })),
      this.panel(user, null, async () => ({ thisWeek: await weeklyAssignments(ctx, ctx.scope.userIds ?? [], this.weekStart(ctx.asOf)).then((a) => a.length) })),
      this.panel(user, 'leads:view', async () => pipelineChangesPanel(await this.kpis.contextFor(user, ['kpi:view', 'leads:view'], { ...q, ...today }))),
    ]);
    return {
      ...this.envelope('team-lead', ctx),
      targets: { revenue, collections, enrolments: enrolment },
      kpis: tiles,
      today: { ...daily, revenue: todayRevenue },
      panels: { scorecards: members, pipeline, funnelHealth: funnel, exceptions: risks, reactivation: react, forecastRisk, people, incentives, founderReport: latest, kraAssignments: assignments, pipelineChanges: changes },
    };
  }

  private weekStart(asOf: string) {
    return forecastBounds('WEEK', asOf).startsOn;
  }

  // ---------------------------------------------------------------------------------------------------- Manager
  async manager(user: Principal, q: KpiQuery) {
    const ctx = await this.kpis.contextFor(user, ['kpi:view'], q);
    const [revenue, tiles] = await Promise.all([
      this.targetTiles(user, 'KPI-REV-001', q),
      this.tiles(user, ['KPI-REV-003', 'KPI-TEA-001', 'KPI-TEA-002', 'KPI-TEA-003', 'KPI-TEA-006', 'KPI-SAL-001', 'KPI-PRD-001', 'KPI-PRD-006', 'KPI-PRD-008', 'KPI-PRD-002', 'KPI-PRD-005', 'KPI-EXC-001', 'KPI-EXC-002', 'KPI-EXC-003', 'KPI-EXC-005', 'KPI-PRD-003'], q),
    ]);
    const [roster, risks, callbacks, people, kra, funnel] = await Promise.all([
      this.panel(user, 'reports:view', async () => ({ members: (await this.members(ctx, (m) => m.roles.includes('SALES_EXECUTIVE') || m.roles.includes('SALES_MANAGER'))).map((m) => ({ ...this.scorecard(m), openTasks: m.openTasks, followUpsDue: m.followUpsDue, wonDeals: m.wonDeals })) })),
      this.panel(user, null, async () => ({ items: await riskPanel(ctx, this.riskPerms(user)) })),
      this.panel(user, 'tasks:view', async () => {
        const rows = await this.prisma.$queryRaw<Array<{ uid: string; n: number; overdue: number }>>(Prisma.sql`SELECT t.assigned_to_id::text AS uid, count(*)::int AS n, (count(*) FILTER (WHERE t.due_at < ${ctx.now}::timestamptz))::int AS overdue FROM tasks t WHERE t.organization_id = ${ctx.organizationId}::uuid AND t.type = 'CALLBACK' AND t.status = 'OPEN'${ctx.scope.userIds ? Prisma.sql` AND t.assigned_to_id = ANY(${ctx.scope.userIds}::uuid[])` : Prisma.empty} GROUP BY t.assigned_to_id`);
        return { callbacksPending: rows.reduce((a, r) => a + num(r.n), 0), callbacksOverdue: rows.reduce((a, r) => a + num(r.overdue), 0), byOwner: rows.map((r) => ({ userId: r.uid, pending: num(r.n), overdue: num(r.overdue) })) };
      }),
      this.panel(user, null, async () => peopleStatusPanel(ctx, this.peoplePerms(user))),
      this.panel(user, null, async () => {
        const ids = (ctx.scope.userIds ?? []).slice(0, 200);
        const a = await weeklyAssignments(ctx, ids, this.weekStart(ctx.asOf));
        const names = await this.prisma.user.findMany({ where: { id: { in: a.map((x) => x.assigneeId) }, organizationId: ctx.organizationId }, select: { id: true, name: true } });
        const nm = new Map(names.map((n) => [n.id, n.name]));
        return { weekStart: this.weekStart(ctx.asOf), assignments: a.map((x) => ({ ...x, name: nm.get(x.assigneeId) ?? null })) };
      }),
      this.panel(user, 'leads:view', async () => ({ stages: await leadsByStage(ctx) })),
    ]);
    return { ...this.envelope('manager', ctx), targets: { revenue }, kpis: tiles, panels: { roster, risks, callbacks, people, kra, funnelHealth: funnel } };
  }

  // ---------------------------------------------------------------------------------------------------- Executive
  async executive(user: Principal, q: KpiQuery) {
    // the personal workspace is always the caller's own scope, whatever role they hold
    const own = { ...q, teamId: undefined, ownerId: user.userId };
    const ctx = await this.kpis.contextFor(user, ['dashboard:salesperson:view'], own);
    const [revenue, collections, tiles] = await Promise.all([
      this.targetTiles(user, 'KPI-REV-001', own),
      this.targetTiles(user, 'KPI-REV-002', own),
      this.tiles(user, ['KPI-TEA-002', 'KPI-SAL-001', 'KPI-SAL-004', 'KPI-PRD-001', 'KPI-PRD-006', 'KPI-PRD-008', 'KPI-PRD-002', 'KPI-EXC-005', 'KPI-EXC-003', 'KPI-EXC-002', 'KPI-PRD-005', 'KPI-PRD-003', 'KPI-PRD-004'], own),
    ]);
    const [incentive, pipeline, kra] = await Promise.all([
      this.panel(user, 'incentives:recommendation:view', async () => {
        const rows = await this.prisma.incentiveRecommendation.findMany({ where: { organizationId: ctx.organizationId, employeeId: user.userId, status: { in: ['APPROVED', 'PAID', 'ON_HOLD'] } }, orderBy: { periodStart: 'desc' }, take: 6, select: { periodStart: true, periodEnd: true, status: true, paidAt: true } });
        return { items: rows.map((r) => ({ periodStart: r.periodStart.toISOString().slice(0, 10), periodEnd: r.periodEnd.toISOString().slice(0, 10), status: r.status, paidAt: r.paidAt?.toISOString() ?? null })), note: 'Status only. Amounts are shown to you in the incentives page once approved.' };
      }),
      this.panel(user, 'deals:view', async () => ({ stages: await pipelineByStage(await this.kpis.contextFor(user, ['dashboard:salesperson:view', 'deals:view'], own)) })),
      this.panel(user, null, async () => ({ weekStart: this.weekStart(ctx.asOf), assignments: await weeklyAssignments(ctx, [user.userId], this.weekStart(ctx.asOf)) })),
    ]);
    return { ...this.envelope('executive', ctx), targets: { revenue, collections }, kpis: tiles, panels: { incentive, pipeline, kra } };
  }

  // ---------------------------------------------------------------------------------------------------- Admin: system health only
  async systemHealth(user: Principal) {
    const org = user.organizationId;
    const timed = async <T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; error?: string; value?: T }> => {
      const t = Date.now();
      try {
        const value = await fn();
        return { ok: true, ms: Date.now() - t, value };
      } catch (e) {
        return { ok: false, ms: Date.now() - t, error: (e as Error).message.slice(0, 120) };
      }
    };
    const db = await timed(() => this.prisma.$queryRaw`SELECT 1`);
    const redis = await timed(async () => {
      await this.redis.ensureConnected();
      return this.redis.ping();
    });
    const outbox = await timed(() => this.prisma.$queryRaw<Array<{ status: string; n: number; oldest: Date | null }>>(Prisma.sql`SELECT status::text AS status, count(*)::int AS n, min(created_at) AS oldest FROM outbox_events WHERE (organization_id = ${org}::uuid OR organization_id IS NULL) AND (status <> 'DISPATCHED' OR created_at > now() - interval '1 day') GROUP BY status`));
    const deliveries = await timed(() => this.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`SELECT status::text AS status, count(*)::int AS n FROM notification_deliveries WHERE organization_id = ${org}::uuid AND status IN ('QUEUED','FAILED','DEAD_LETTER') GROUP BY status`));
    const files = await timed(() => this.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`SELECT status::text AS status, count(*)::int AS n FROM file_assets WHERE organization_id = ${org}::uuid AND status IN ('PENDING','SCANNING','PROCESSING','FAILED') GROUP BY status`));
    const exportsQ = await timed(() => this.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`SELECT status::text AS status, count(*)::int AS n FROM report_exports WHERE organization_id = ${org}::uuid AND status IN ('QUEUED','RUNNING','FAILED') GROUP BY status`));
    const imports = await timed(() => this.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`SELECT status::text AS status, count(*)::int AS n FROM import_jobs WHERE organization_id = ${org}::uuid AND status IN ('QUEUED','RUNNING','FAILED') GROUP BY status`));
    const lastRun = await this.prisma.kpiReconciliationRun.findFirst({ where: { organizationId: user.organizationId }, orderBy: { ranAt: 'desc' }, select: { ranAt: true, passed: true, failed: true, skipped: true, totalChecks: true } });
    const counts = (r: { value?: Array<{ status: string; n: number }> }) => Object.fromEntries((r.value ?? []).map((x) => [x.status, num(x.n)]));
    const mem = process.memoryUsage();
    return {
      dashboard: 'system-health',
      generatedAt: new Date().toISOString(),
      businessData: false,
      note: 'Operational signals only. This view contains no leads, revenue, people or customer data.',
      services: { database: { ok: db.ok, latencyMs: db.ms, error: db.error }, redis: { ok: redis.ok, latencyMs: redis.ms, error: redis.error } },
      queues: {
        outbox: { ok: outbox.ok, byStatus: counts(outbox as never), oldestPendingAt: (outbox.value ?? []).find((x) => x.status === 'PENDING')?.oldest?.toISOString() ?? null },
        notificationDeliveries: { ok: deliveries.ok, byStatus: counts(deliveries) },
        fileProcessing: { ok: files.ok, byStatus: counts(files) },
        reportExports: { ok: exportsQ.ok, byStatus: counts(exportsQ) },
        imports: { ok: imports.ok, byStatus: counts(imports) },
      },
      dataQuality: lastRun ? { lastReconciliationAt: lastRun.ranAt.toISOString(), checks: lastRun.totalChecks, passed: lastRun.passed, failed: lastRun.failed, skipped: lastRun.skipped, ageMinutes: Math.round((Date.now() - lastRun.ranAt.getTime()) / 60_000) } : null,
      process: { uptimeSeconds: Math.round(process.uptime()), node: process.version, rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), env: process.env.NODE_ENV ?? 'unknown' },
    };
  }
}
