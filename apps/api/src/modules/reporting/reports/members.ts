import { Prisma } from '@prisma/client';
import { achievementPct, D, money, ZERO } from '../../revenue/calc';
import type { KpiCtx } from '../kpi/types';
import { num, ownerIn, pctStr } from '../kpi/sql';
import { loadTargets, revenueFacts, revenueFor, targetWindow } from '../kpi/defs/revenue-facts';
import { leadFilters } from '../kpi/sql';

export interface MemberRow {
  userId: string;
  name: string;
  roles: string[];
  managerId: string | null;
  revenueTarget: string | null;
  revenueActual: string;
  achievementPct: string | null;
  callAttempts: number;
  callsCompleted: number;
  connectedCalls: number;
  uniqueClients: number;
  followUpsCompleted: number;
  followUpsDue: number;
  followUpsOnTime: number;
  onTimePct: string | null;
  overdueOpen: number;
  openTasks: number;
  activeLeads: number;
  leadsCreated: number;
  leadsWon: number;
  conversionPct: string | null;
  wonDeals: number;
}

const CONNECTED = Prisma.sql`('CONNECTED','WON','LOST','CALLBACK')`;

/**
 * Per-person facts for scorecards / rosters / team-performance. Every figure uses the same predicates as the KPI definitions
 * (calls: PRD-001/006/007/008, follow-ups: PRD-002/EXC-005, conversion: SAL-001, revenue: REV-001 via revenue/calc) so rows sum to the KPI totals.
 */
export async function memberFacts(ctx: KpiCtx, opts: { includeAllUsers?: boolean } = {}): Promise<MemberRow[]> {
  const org = ctx.organizationId;
  const users = await ctx.prisma.$queryRaw<Array<{ id: string; name: string; manager_id: string | null; roles: string[] }>>(Prisma.sql`
    SELECT u.id::text, u.name, u.manager_id::text, coalesce(array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles
    FROM users u LEFT JOIN user_role_assignments a ON a.user_id = u.id LEFT JOIN roles r ON r.id = a.role_id
    WHERE u.organization_id = ${org}::uuid AND u.is_active${ownerIn(ctx.scope, 'u.id')}
    GROUP BY u.id ORDER BY u.name LIMIT 2000`);
  const needLead = Boolean(ctx.filters.programId || ctx.filters.sourceId);
  const [calls, tasks, leads, active, won] = await Promise.all([
    ctx.prisma.$queryRaw<Array<Record<string, number | string>>>(Prisma.sql`
      SELECT c.user_id::text AS uid, count(*)::int AS attempts, (count(*) FILTER (WHERE c.outcome <> 'FAILED'))::int AS completed,
             (count(*) FILTER (WHERE c.outcome IN ${CONNECTED}))::int AS connected, count(DISTINCT c.lead_id)::int AS uniq
      FROM call_logs c ${needLead ? Prisma.sql`JOIN leads l ON l.id = c.lead_id` : Prisma.empty}
      WHERE c.organization_id = ${org}::uuid AND c.started_at >= ${ctx.window.from}::timestamptz AND c.started_at < ${ctx.window.to}::timestamptz${ownerIn(ctx.scope, 'c.user_id')}${needLead ? leadFilters(ctx.filters) : Prisma.empty}
      GROUP BY c.user_id`),
    ctx.prisma.$queryRaw<Array<Record<string, number | string>>>(Prisma.sql`
      SELECT t.assigned_to_id::text AS uid,
        (count(*) FILTER (WHERE t.type IN ('FOLLOW_UP','CALLBACK','DEMO','EMAIL') AND t.status = 'DONE' AND t.completed_at >= ${ctx.window.from}::timestamptz AND t.completed_at < ${ctx.window.to}::timestamptz))::int AS completed,
        (count(*) FILTER (WHERE t.type IN ('FOLLOW_UP','CALLBACK','DEMO','EMAIL') AND t.due_at >= ${ctx.window.from}::timestamptz AND t.due_at < ${ctx.window.to}::timestamptz AND t.status <> 'CANCELLED' AND (t.status = 'DONE' OR t.due_at < ${ctx.now}::timestamptz)))::int AS due,
        (count(*) FILTER (WHERE t.type IN ('FOLLOW_UP','CALLBACK','DEMO','EMAIL') AND t.due_at >= ${ctx.window.from}::timestamptz AND t.due_at < ${ctx.window.to}::timestamptz AND t.status = 'DONE' AND t.completed_at <= t.due_at))::int AS on_time,
        (count(*) FILTER (WHERE t.status = 'OPEN' AND t.due_at < ${ctx.now}::timestamptz))::int AS overdue,
        (count(*) FILTER (WHERE t.status = 'OPEN'))::int AS open_tasks
      FROM tasks t ${needLead ? Prisma.sql`JOIN leads l ON l.id = t.lead_id` : Prisma.empty}
      WHERE t.organization_id = ${org}::uuid AND (t.status = 'OPEN' OR (t.due_at >= ${ctx.window.from}::timestamptz AND t.due_at < ${ctx.window.to}::timestamptz) OR (t.completed_at >= ${ctx.window.from}::timestamptz AND t.completed_at < ${ctx.window.to}::timestamptz))${ownerIn(ctx.scope, 't.assigned_to_id')}${needLead ? leadFilters(ctx.filters) : Prisma.empty}
      GROUP BY t.assigned_to_id`),
    ctx.prisma.$queryRaw<Array<Record<string, number | string>>>(Prisma.sql`
      SELECT l.assigned_to_id::text AS uid, count(*)::int AS created,
             (count(*) FILTER (WHERE l.stage_category = 'WON' AND l.won_at IS NOT NULL AND l.won_at <= l.created_at + make_interval(days => ${ctx.config.conversionWindowDays}::int)))::int AS won_in_window
      FROM leads l WHERE l.organization_id = ${org}::uuid AND l.assigned_to_id IS NOT NULL AND l.created_at >= ${ctx.window.from}::timestamptz AND l.created_at < ${ctx.window.to}::timestamptz AND l.merged_into_id IS NULL
        AND (l.lost_reason IS NULL OR l.lost_reason NOT IN ('DUPLICATE_OR_INVALID','NOT_ELIGIBLE'))${ownerIn(ctx.scope, 'l.assigned_to_id')}${leadFilters(ctx.filters)}
      GROUP BY l.assigned_to_id`),
    ctx.prisma.$queryRaw<Array<Record<string, number | string>>>(Prisma.sql`
      SELECT l.assigned_to_id::text AS uid, count(*)::int AS active FROM leads l
      WHERE l.organization_id = ${org}::uuid AND l.assigned_to_id IS NOT NULL AND l.stage_category = 'OPEN' AND l.merged_into_id IS NULL${ownerIn(ctx.scope, 'l.assigned_to_id')}${leadFilters(ctx.filters)} GROUP BY l.assigned_to_id`),
    ctx.prisma.$queryRaw<Array<Record<string, number | string>>>(Prisma.sql`
      SELECT l.assigned_to_id::text AS uid, count(*)::int AS won FROM leads l
      WHERE l.organization_id = ${org}::uuid AND l.assigned_to_id IS NOT NULL AND l.stage_category = 'WON' AND l.won_at >= ${ctx.window.from}::timestamptz AND l.won_at < ${ctx.window.to}::timestamptz AND l.merged_into_id IS NULL${ownerIn(ctx.scope, 'l.assigned_to_id')}${leadFilters(ctx.filters)} GROUP BY l.assigned_to_id`),
  ]);
  const by = (rows: Array<Record<string, number | string>>) => new Map(rows.map((r) => [String(r.uid), r]));
  const callsBy = by(calls);
  const tasksBy = by(tasks);
  const leadsBy = by(leads);
  const activeBy = by(active);
  const wonBy = by(won);

  const win = targetWindow(ctx);
  const facts = await revenueFacts(ctx, win);
  const targets = await loadTargets(ctx, 'REVENUE', win.endsOn);
  const tgtBy = new Map(targets.map((t) => [t.ownerUserId, t.asOfAmount]));

  const rows: MemberRow[] = [];
  for (const u of users) {
    const c = callsBy.get(u.id);
    const t = tasksBy.get(u.id);
    const l = leadsBy.get(u.id);
    const isSales = u.roles.some((r) => r === 'SALES_MANAGER' || r === 'SALES_EXECUTIVE' || r === 'SALES_TEAM_LEAD');
    const rev = revenueFor(facts, win, new Set([u.id]));
    const hasActivity = Boolean(c || t || l || activeBy.get(u.id) || wonBy.get(u.id)) || rev.wonCount > 0;
    if (!isSales && !hasActivity && !opts.includeAllUsers) continue;
    const target = tgtBy.get(u.id) ?? null;
    const created = num(l?.created);
    rows.push({
      userId: u.id,
      name: u.name,
      roles: u.roles,
      managerId: u.manager_id,
      revenueTarget: target ? money(target) : null,
      revenueActual: money(rev.net),
      achievementPct: target ? achievementPct(rev.net, target) : null,
      callAttempts: num(c?.attempts),
      callsCompleted: num(c?.completed),
      connectedCalls: num(c?.connected),
      uniqueClients: num(c?.uniq),
      followUpsCompleted: num(t?.completed),
      followUpsDue: num(t?.due),
      followUpsOnTime: num(t?.on_time),
      onTimePct: pctStr(num(t?.on_time), num(t?.due)),
      overdueOpen: num(t?.overdue),
      openTasks: num(t?.open_tasks),
      activeLeads: num(activeBy.get(u.id)?.active),
      leadsCreated: created,
      leadsWon: num(wonBy.get(u.id)?.won),
      conversionPct: pctStr(num(l?.won_in_window), created),
      wonDeals: rev.wonCount,
    });
  }
  return rows;
}

export const sumBy = <T>(rows: T[], f: (r: T) => number): number => rows.reduce((a, r) => a + f(r), 0);
export const sumMoney = (rows: string[]): string => money(rows.reduce((a, v) => a.plus(D(v)), ZERO));
