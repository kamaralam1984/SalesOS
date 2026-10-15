import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Principal } from '../../../common/authz';
import type { PermissionKey } from '../../../common/authz/permissions.catalogue';
import { notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { forecastBounds, istDate, money, periodBounds, D, revenueActual, addDays } from '../../revenue/calc';
import { FOUNDER_SECTIONS, formatKpiValue, kpiNote } from '../founder/sections';
import { revenueFacts, revenueFor, targetWindow, collectionFacts, collectionsFor, userSet } from '../kpi/defs/revenue-facts';
import { KpiService, type KpiQuery } from '../kpi/kpi.service';
import { KPI_MAP } from '../kpi/registry';
import { leadFilters, leadScope, notDemo, notMerged, num, ownerIn, pctStr } from '../kpi/sql';
import type { KpiCtx, KpiResult } from '../kpi/types';
import { memberFacts, sumBy, sumMoney } from './members';
import type { Cell, ReportColumn, ReportDef, ReportKey, ReportParams, ReportResult, ReportRow } from './types';
import { REPORT_KEYS } from './types';

const col = (key: string, label: string, type: ReportColumn['type'] = 'text'): ReportColumn => ({ key, label, type });
export const DEFAULT_ROW_LIMIT = 500;
export const MAX_ROW_LIMIT = 100_000;

export type ReportQuery = KpiQuery & ReportParams & { limit?: number };

@Injectable()
export class ReportsService {
  private readonly defs: ReadonlyMap<ReportKey, ReportDef>;

  constructor(private readonly prisma: PrismaService, private readonly kpis: KpiService) {
    const list: ReportDef[] = [
      this.followUps(),
      this.conversions(),
      this.funnel(),
      this.revenue(),
      this.teamPerformance(),
      this.founderReport('weekly-founder', 'Weekly Founder report data', 'WEEK'),
      this.founderReport('monthly-founder', 'Monthly Founder report data', 'MONTH'),
    ];
    this.defs = new Map(list.map((d) => [d.key, d]));
  }

  catalogue() {
    return [...this.defs.values()].map((d) => ({ key: d.key, title: d.title, description: d.description, requires: d.requires, kpiIds: d.kpiIds, personLevel: d.personLevel }));
  }

  def(key: string): ReportDef {
    const d = this.defs.get(key as ReportKey);
    if (!d) throw notFound('Report');
    return d;
  }

  /** Run a report for the caller. `extraPermissions` lets exports add `reports:export` to the scope intersection. */
  async run(user: Principal, key: string, q: ReportQuery = {}, opts: { extraPermissions?: PermissionKey[]; maxLimit?: number } = {}): Promise<ReportResult> {
    const def = this.def(key);
    const maxLimit = opts.maxLimit ?? 5000;
    const limit = Math.min(Math.max(1, q.limit ?? DEFAULT_ROW_LIMIT), maxLimit);
    const withPeriod: ReportQuery = { ...q, period: q.period ?? (def.key === 'weekly-founder' ? 'WEEK' : undefined) };
    const ctx = await this.kpis.contextFor(user, [...def.requires, ...(opts.extraPermissions ?? [])], withPeriod);
    const params: ReportParams = { by: q.by };
    const out = await def.run(ctx, params, limit + 1);
    const truncated = out.rows.length > limit;
    const detailWithheld = def.personLevel && !ctx.scope.detail;
    const rows = detailWithheld ? [] : out.rows.slice(0, limit);
    const now = new Date().toISOString();
    return {
      report: def.key,
      title: def.title,
      description: def.description,
      columns: def.columns(params),
      rows,
      rowCount: rows.length,
      truncated: truncated && !detailWithheld,
      rowLimit: limit,
      summary: out.summary,
      kpis: out.kpis ?? [],
      meta: {
        dateRange: { from: ctx.window.startsOn, to: ctx.window.endsOn, timezone: 'Asia/Kolkata' },
        period: ctx.period,
        currency: 'INR',
        filters: { applied: Object.fromEntries(Object.entries(ctx.filters).filter(([, v]) => Boolean(v))) as Record<string, string>, scopeLevel: ctx.scope.level, narrowedByFilter: ctx.scope.narrowed, by: q.by },
        definitions: def.kpiIds.map((id) => ({ id, name: KPI_MAP.get(id)?.meta.name ?? id, approvalStatus: KPI_MAP.get(id)?.meta.approvalStatus ?? 'UNKNOWN' })),
        computedAt: now,
        freshness: { kind: 'LIVE', computedAt: now },
        detailWithheld,
      },
    };
  }

  /** Context + KPI results for a set of KPI ids (summary strips). Reports call the KPI layer, never their own maths. */
  private async kpiStrip(ctx: KpiCtx, ids: string[]): Promise<KpiResult[]> {
    return this.kpis.runMany(ctx.user, ids, { from: ctx.window.startsOn, to: ctx.window.endsOn, period: ctx.period.type, asOf: ctx.asOf, ...ctx.filters });
  }

  // ---------------------------------------------------------------- follow-ups
  private followUps(): ReportDef {
    return {
      key: 'follow-ups',
      title: 'Follow-up discipline',
      description: 'Per owner: tasks due, completed on time, overdue, callbacks pending, call attempts and unique clients (separate measures).',
      requires: ['reports:view', 'kpi:view'],
      kpiIds: ['KPI-PRD-002', 'KPI-EXC-005', 'KPI-EXC-003', 'KPI-PRD-006', 'KPI-PRD-008'],
      personLevel: true,
      columns: () => [col('owner', 'Owner'), col('followUpsDue', 'Follow-ups due', 'int'), col('followUpsCompleted', 'Follow-ups completed', 'int'), col('followUpsOnTime', 'Completed on time', 'int'), col('onTimePct', 'On-time %', 'pct'), col('overdueOpen', 'Overdue open tasks', 'int'), col('callbacksPending', 'Callbacks pending', 'int'), col('callAttempts', 'Call attempts', 'int'), col('uniqueClients', 'Unique clients called', 'int')],
      run: async (ctx) => {
        const members = await memberFacts(ctx);
        const cb = await ctx.prisma.$queryRaw<Array<{ uid: string; n: number }>>(Prisma.sql`SELECT t.assigned_to_id::text AS uid, count(*)::int AS n FROM tasks t WHERE t.organization_id = ${ctx.organizationId}::uuid AND t.type = 'CALLBACK' AND t.status = 'OPEN'${ownerIn(ctx.scope, 't.assigned_to_id')} GROUP BY t.assigned_to_id`);
        const cbBy = new Map(cb.map((r) => [r.uid, num(r.n)]));
        const rows: ReportRow[] = members.map((m) => ({ owner: m.name, followUpsDue: m.followUpsDue, followUpsCompleted: m.followUpsCompleted, followUpsOnTime: m.followUpsOnTime, onTimePct: m.onTimePct, overdueOpen: m.overdueOpen, callbacksPending: cbBy.get(m.userId) ?? 0, callAttempts: m.callAttempts, uniqueClients: m.uniqueClients }));
        const kpis = await this.kpiStrip(ctx, ['KPI-PRD-002', 'KPI-EXC-005', 'KPI-EXC-003', 'KPI-PRD-006', 'KPI-PRD-008']);
        return { rows, kpis, summary: { totals: { followUpsDue: sumBy(members, (m) => m.followUpsDue), followUpsCompleted: sumBy(members, (m) => m.followUpsCompleted), followUpsOnTime: sumBy(members, (m) => m.followUpsOnTime), overdueOpen: sumBy(members, (m) => m.overdueOpen), callAttempts: sumBy(members, (m) => m.callAttempts) }, note: 'Call attempts and unique clients are separate: one client called three times is 3 attempts and 1 unique client. Unique clients per row are not additive across rows.' } };
      },
    };
  }

  // ---------------------------------------------------------------- conversions
  private conversions(): ReportDef {
    return {
      key: 'conversions',
      title: 'Lead conversion',
      description: 'Lead cohort conversion (created in the range, won within the conversion window) by source, program or owner, with webinar and demo conversion.',
      requires: ['reports:view', 'kpi:view'],
      kpiIds: ['KPI-SAL-001', 'KPI-SAL-002', 'KPI-SAL-003'],
      personLevel: false,
      columns: (p) => [col('group', p.by === 'program' ? 'Program' : p.by === 'owner' ? 'Owner' : 'Source'), col('leads', 'Eligible leads', 'int'), col('won', 'Won within window', 'int'), col('conversionPct', 'Conversion %', 'pct')],
      run: async (ctx, p) => {
        const by = p.by === 'program' ? 'program' : p.by === 'owner' ? 'owner' : 'source';
        const key = by === 'program' ? 'l.program_id' : by === 'owner' ? 'l.assigned_to_id' : 'l.source_id';
        const join = by === 'program' ? Prisma.sql`LEFT JOIN programs g ON g.id = l.program_id` : by === 'owner' ? Prisma.sql`LEFT JOIN users g ON g.id = l.assigned_to_id` : Prisma.sql`LEFT JOIN lead_sources g ON g.id = l.source_id`;
        const label = by === 'program' ? Prisma.sql`coalesce(g.name, 'No program')` : by === 'owner' ? Prisma.sql`coalesce(g.name, 'Unassigned')` : Prisma.sql`coalesce(g.name, 'No source')`;
        const rows = await ctx.prisma.$queryRaw<Array<{ label: string; leads: number; won: number }>>(Prisma.sql`
          SELECT ${label} AS label, count(*)::int AS leads,
                 (count(*) FILTER (WHERE l.stage_category = 'WON' AND l.won_at IS NOT NULL AND l.won_at <= l.created_at + make_interval(days => ${ctx.config.conversionWindowDays}::int)))::int AS won
          FROM leads l ${join}
          WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.created_at >= ${ctx.window.from}::timestamptz AND l.created_at < ${ctx.window.to}::timestamptz
            AND (l.lost_reason IS NULL OR l.lost_reason NOT IN ('DUPLICATE_OR_INVALID','NOT_ELIGIBLE'))${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}
          GROUP BY ${Prisma.raw(key)}, g.name ORDER BY count(*) DESC, 1 LIMIT 5000`);
        const kpis = await this.kpiStrip(ctx, ['KPI-SAL-001', 'KPI-SAL-002', 'KPI-SAL-003']);
        const out: ReportRow[] = rows.map((r) => ({ group: by === 'owner' && !ctx.scope.detail ? 'Hidden' : r.label, leads: num(r.leads), won: num(r.won), conversionPct: pctStr(num(r.won), num(r.leads)) }));
        return { rows: out, kpis, summary: { by, conversionWindowDays: ctx.config.conversionWindowDays, totals: { leads: sumBy(rows, (r) => num(r.leads)), won: sumBy(rows, (r) => num(r.won)) } } };
      },
    };
  }

  // ---------------------------------------------------------------- funnel
  private funnel(): ReportDef {
    return {
      key: 'funnel',
      title: 'Funnel',
      description: 'Leads created in the range by current stage and how many ever reached each stage (stage history).',
      requires: ['reports:view', 'kpi:view'],
      kpiIds: ['KPI-EXC-004', 'KPI-SAL-001'],
      personLevel: false,
      columns: () => [col('stage', 'Stage'), col('category', 'Category'), col('currentLeads', 'Currently in stage', 'int'), col('everReached', 'Ever reached', 'int'), col('reachedPct', '% of cohort reached', 'pct')],
      run: async (ctx) => {
        const cohort = Prisma.sql`l.organization_id = ${ctx.organizationId}::uuid AND l.created_at >= ${ctx.window.from}::timestamptz AND l.created_at < ${ctx.window.to}::timestamptz${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}`;
        const [current, reached, config] = await Promise.all([
          ctx.prisma.$queryRaw<Array<{ status: string; category: string; n: number }>>(Prisma.sql`SELECT l.status, l.stage_category::text AS category, count(*)::int AS n FROM leads l WHERE ${cohort} GROUP BY l.status, l.stage_category`),
          ctx.prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`SELECT h.new_status AS status, count(DISTINCT h.lead_id)::int AS n FROM lead_status_history h JOIN leads l ON l.id = h.lead_id WHERE ${cohort} AND h.organization_id = ${ctx.organizationId}::uuid GROUP BY h.new_status`),
          ctx.prisma.leadStageConfig.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { sortOrder: 'asc' } }),
        ]);
        const cohortSize = sumBy(current, (r) => num(r.n));
        const curBy = new Map(current.map((r) => [r.status, r]));
        const reachBy = new Map(reached.map((r) => [r.status, num(r.n)]));
        const keys = [...new Set([...config.map((c) => c.key), ...current.map((c) => c.status), ...reached.map((r) => r.status)])];
        const order = new Map(config.map((c, i) => [c.key, i]));
        keys.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
        const catBy = new Map(config.map((c) => [c.key, c.category as string]));
        const rows: ReportRow[] = keys.map((k) => {
          const everReached = Math.max(reachBy.get(k) ?? 0, num(curBy.get(k)?.n));
          return { stage: config.find((c) => c.key === k)?.label ?? k, category: catBy.get(k) ?? (curBy.get(k)?.category as string | undefined) ?? '', currentLeads: num(curBy.get(k)?.n), everReached, reachedPct: pctStr(everReached, cohortSize) };
        });
        const kpis = await this.kpiStrip(ctx, ['KPI-EXC-004', 'KPI-SAL-001']);
        return { rows, kpis, summary: { cohortSize, note: 'Everyone in the cohort counts as having reached the stage they are in now; earlier stages come from lead_status_history.' } };
      },
    };
  }

  // ---------------------------------------------------------------- revenue
  private revenue(): ReportDef {
    return {
      key: 'revenue',
      title: 'Revenue and collections',
      description: 'Booked revenue (net of approved adjustments and refunds) and verified collections by program or owner, with enrolments and average deal value.',
      requires: ['kpi:view', 'targets:view'],
      kpiIds: ['KPI-REV-001', 'KPI-REV-002', 'KPI-SAL-004'],
      personLevel: false,
      columns: (p) => [col('group', p.by === 'owner' ? 'Owner' : 'Program'), col('booked', 'Booked', 'money'), col('refundsApproved', 'Approved refunds', 'money'), col('net', 'Net revenue', 'money'), col('enrolments', 'Enrolments', 'int'), col('wonDeals', 'Won deals', 'int'), col('collected', 'Verified collections (net)', 'money')],
      run: async (ctx, p) => {
        const by = p.by === 'owner' ? 'owner' : 'program';
        const win = targetWindow(ctx);
        const f = await revenueFacts(ctx, win);
        const cf = await collectionFacts(ctx, win);
        const ids = userSet(ctx.scope);
        const progOf = new Map<string, string>();
        const salesById = new Map([...f.sales, ...cf.sales].map((s) => [s.dealId, s]));
        const recs = await ctx.prisma.salesRecord.findMany({ where: { organizationId: ctx.organizationId, dealId: { in: [...salesById.keys()] } }, select: { dealId: true, programId: true } });
        for (const r of recs) progOf.set(r.dealId, r.programId);
        const groups = new Map<string, { label: string; sales: typeof f.sales; refunds: typeof f.refunds; csales: typeof cf.sales; payments: typeof cf.payments; crefunds: typeof cf.refunds; members?: ReadonlySet<string> }>();
        const g = (k: string, label: string) => {
          if (!groups.has(k)) groups.set(k, { label, sales: [], refunds: [], csales: [], payments: [], crefunds: [] });
          return groups.get(k)!;
        };
        let rows: ReportRow[] = [];
        if (by === 'program') {
          const programs = await ctx.prisma.program.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true } });
          const nm = new Map(programs.map((x) => [x.id, x.name]));
          for (const s of f.sales) g(progOf.get(s.dealId) ?? 'none', nm.get(progOf.get(s.dealId) ?? '') ?? 'Unknown program').sales.push(s);
          for (const r of f.refunds) g(progOf.get(r.dealId) ?? 'none', nm.get(progOf.get(r.dealId) ?? '') ?? 'Unknown program').refunds.push(r);
          for (const s of cf.sales) g(progOf.get(s.dealId) ?? 'none', nm.get(progOf.get(s.dealId) ?? '') ?? 'Unknown program').csales.push(s);
          for (const x of cf.payments) g(progOf.get(x.dealId) ?? 'none', nm.get(progOf.get(x.dealId) ?? '') ?? 'Unknown program').payments.push(x);
          for (const r of cf.refunds) g(progOf.get(r.dealId) ?? 'none', nm.get(progOf.get(r.dealId) ?? '') ?? 'Unknown program').crefunds.push(r);
          rows = [...groups.values()].map((x) => {
            const r = revenueActual(x.sales, x.refunds, win, ids);
            const c = collectionsFor({ sales: x.csales, payments: x.payments, refunds: x.crefunds }, win, ids);
            return { group: x.label, booked: money(r.booked), refundsApproved: money(r.refundedApproved), net: money(r.net), enrolments: r.enrolments, wonDeals: r.wonCount, collected: money(c.net) };
          });
        } else {
          const users = new Set<string>();
          for (const s of [...f.sales, ...cf.sales]) for (const c of s.credits) if (!ids || ids.has(c.userId)) users.add(c.userId);
          const names = users.size ? await ctx.prisma.user.findMany({ where: { id: { in: [...users] }, organizationId: ctx.organizationId }, select: { id: true, name: true } }) : [];
          const nm = new Map(names.map((x) => [x.id, x.name]));
          rows = [...users].map((u) => {
            const set = new Set([u]);
            const r = revenueFor(f, win, set);
            const c = collectionsFor(cf, win, set);
            return { group: ctx.scope.detail ? (nm.get(u) ?? u) : 'Hidden', booked: money(r.booked), refundsApproved: money(r.refundedApproved), net: money(r.net), enrolments: r.enrolments, wonDeals: r.wonCount, collected: money(c.net) };
          });
        }
        rows.sort((a, b) => D(b.net as string).comparedTo(D(a.net as string)));
        const total = revenueFor(f, win, ids);
        const totalC = collectionsFor(cf, win, ids);
        const kpis = await this.kpiStrip(ctx, ['KPI-REV-001', 'KPI-REV-002', 'KPI-SAL-004']);
        return {
          rows,
          kpis,
          summary: {
            by,
            window: { from: win.startsOn, to: win.endsOn },
            totals: { booked: money(total.booked), refundsApproved: money(total.refundedApproved), net: money(total.net), enrolments: total.enrolments, wonDeals: total.wonCount, collected: money(totalC.net) },
            rowTotals: { net: sumMoney(rows.map((r) => r.net as string)), collected: sumMoney(rows.map((r) => r.collected as string)) },
            note: by === 'owner' ? 'Credited per the sale split (DEC-005); a split sale appears under each credited owner.' : undefined,
          },
        };
      },
    };
  }

  // ---------------------------------------------------------------- team performance
  private teamPerformance(): ReportDef {
    return {
      key: 'team-performance',
      title: 'Team performance',
      description: 'Per person: revenue vs target, calls (attempts and unique clients), follow-ups, conversion and workload.',
      requires: ['reports:view', 'kpi:view'],
      kpiIds: ['KPI-REV-001', 'KPI-REV-003', 'KPI-TEA-001', 'KPI-TEA-002', 'KPI-TEA-003', 'KPI-PRD-006'],
      personLevel: true,
      columns: () => [col('name', 'Name'), col('role', 'Role'), col('revenueTarget', 'Revenue target', 'money'), col('revenueActual', 'Revenue (net)', 'money'), col('achievementPct', 'Achievement %', 'pct'), col('callAttempts', 'Call attempts', 'int'), col('uniqueClients', 'Unique clients', 'int'), col('connectedCalls', 'Connected calls', 'int'), col('followUpsCompleted', 'Follow-ups completed', 'int'), col('onTimePct', 'On-time %', 'pct'), col('overdueOpen', 'Overdue tasks', 'int'), col('activeLeads', 'Active leads', 'int'), col('leadsWon', 'Leads won', 'int'), col('conversionPct', 'Conversion %', 'pct')],
      run: async (ctx) => {
        const members = await memberFacts(ctx);
        const rows: ReportRow[] = members.map((m) => ({ name: m.name, role: m.roles.map((r) => r.replace('SALES_', '').toLowerCase()).join('/'), revenueTarget: m.revenueTarget, revenueActual: m.revenueActual, achievementPct: m.achievementPct, callAttempts: m.callAttempts, uniqueClients: m.uniqueClients, connectedCalls: m.connectedCalls, followUpsCompleted: m.followUpsCompleted, onTimePct: m.onTimePct, overdueOpen: m.overdueOpen, activeLeads: m.activeLeads, leadsWon: m.leadsWon, conversionPct: m.conversionPct }));
        const kpis = await this.kpiStrip(ctx, ['KPI-REV-001', 'KPI-REV-003', 'KPI-TEA-001', 'KPI-TEA-002', 'KPI-TEA-003', 'KPI-PRD-006']);
        return { rows, kpis, summary: { members: members.length, totals: { revenue: sumMoney(members.map((m) => m.revenueActual)), callAttempts: sumBy(members, (m) => m.callAttempts), followUpsCompleted: sumBy(members, (m) => m.followUpsCompleted) } } };
      },
    };
  }

  // ---------------------------------------------------------------- weekly / monthly founder data
  founderPeriod(type: 'WEEK' | 'MONTH', anchor?: string) {
    const a = anchor ?? new Date().toISOString().slice(0, 10);
    return type === 'WEEK' ? forecastBounds('WEEK', a) : periodBounds('MONTH', a);
  }

  private founderReport(key: 'weekly-founder' | 'monthly-founder', title: string, type: 'WEEK' | 'MONTH'): ReportDef {
    return {
      key,
      title,
      description: `${type === 'WEEK' ? 'Weekly' : 'Monthly'} Founder report numbers: every KPI with its value, window, definition and freshness.`,
      requires: ['kpi:view', 'reports:view'],
      kpiIds: FOUNDER_SECTIONS.flatMap((s) => s.kpiIds),
      personLevel: false,
      columns: () => [col('section', 'Section'), col('kpi', 'KPI'), col('kpiId', 'KPI id'), col('value', 'Value'), col('numerator', 'Numerator'), col('denominator', 'Denominator'), col('window', 'Window'), col('note', 'Notes and definition status')],
      run: async (ctx) => {
        const all = await this.kpiStrip(ctx, FOUNDER_SECTIONS.flatMap((s) => s.kpiIds));
        const byId = new Map(all.map((k) => [k.id, k]));
        const rows: ReportRow[] = [];
        const sections = FOUNDER_SECTIONS.map((s) => ({
          key: s.key,
          label: s.label,
          metrics: s.kpiIds.map((id) => {
            const k = byId.get(id)!;
            rows.push({ section: s.label, kpi: k.name, kpiId: k.id, value: formatKpiValue(k), numerator: k.numerator, denominator: k.denominator, window: `${k.dateRange.from} to ${k.dateRange.to}`, note: kpiNote(k) });
            return { kpiId: k.id, label: k.name, value: formatKpiValue(k), status: k.status, note: kpiNote(k) };
          }),
        }));
        return { rows, kpis: all, summary: { periodType: type, sections } };
      },
    };
  }

  /** Founder report sections for the CX report builder (ReportDataProvider). */
  async founderSections(user: Principal, type: 'WEEKLY' | 'MONTHLY', periodStart: string, periodEnd: string) {
    const all = await this.kpis.runMany(user, FOUNDER_SECTIONS.flatMap((s) => s.kpiIds), { from: periodStart, to: periodEnd, period: type === 'WEEKLY' ? 'WEEK' : 'MONTH', asOf: periodEnd < istDate(new Date()) ? addDays(periodEnd, 1) : undefined });
    const byId = new Map(all.map((k) => [k.id, k]));
    return FOUNDER_SECTIONS.map((s) => ({
      key: s.key,
      label: s.label,
      status: 'AVAILABLE' as const,
      metrics: s.kpiIds.map((id) => {
        const k = byId.get(id)!;
        return { kpiId: k.id, label: k.name, value: formatKpiValue(k), unit: k.unit, note: kpiNote(k) };
      }),
    }));
  }

  /** helper exposed to dashboards: members facts under the caller's scope */
  async memberRows(user: Principal, q: KpiQuery, permissions: PermissionKey[] = ['kpi:view']) {
    const ctx = await this.kpis.contextFor(user, permissions, q);
    return { ctx, members: await memberFacts(ctx) };
  }
}

export { REPORT_KEYS };
export type { Cell };
