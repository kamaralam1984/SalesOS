import { Prisma } from '@prisma/client';
import { toSaleView } from '../../../revenue/metrics.service';
import { D, collectionActual, istRange, revenueActual, ZERO, type PaymentView, type PeriodWindow, type RefundView, type SaleView, type TargetRevisionView, targetAsOf } from '../../../revenue/calc';
import type { KpiCtx, KpiScope } from '../types';

/** Set used by the calc functions: null = whole organisation. */
export const userSet = (scope: KpiScope): ReadonlySet<string> | null => (scope.userIds === null ? null : new Set(scope.userIds));

function dealFilter(ctx: KpiCtx): Prisma.DealWhereInput {
  const { programId, sourceId } = ctx.filters;
  return { ...(programId ? { programId } : {}), ...(sourceId ? { lead: { sourceId } } : {}) };
}

function saleFilter(ctx: KpiCtx): Prisma.SalesRecordWhereInput {
  const { programId, sourceId } = ctx.filters;
  return { ...(programId ? { programId } : {}), ...(sourceId ? { deal: { lead: { sourceId } } } : {}) };
}

export interface RevenueFacts {
  sales: SaleView[];
  refunds: RefundView[];
}

const refundSelect = { dealId: true, status: true, amount: true, approvedAmount: true, approvedAt: true, processedAmount: true, processedAt: true } as const;

/** Booked sales in the window + the sales behind refunds approved in the window (same loading rule as revenue MetricsService, plus program/source filters). */
export async function revenueFacts(ctx: KpiCtx, win: PeriodWindow): Promise<RevenueFacts> {
  const organizationId = ctx.organizationId;
  const refunds = await ctx.prisma.refund.findMany({
    where: { organizationId, status: { in: ['APPROVED', 'PROCESSED', 'RECONCILED'] }, approvedAt: { gte: win.from, lt: win.to }, ...(Object.keys(dealFilter(ctx)).length ? { deal: dealFilter(ctx) } : {}) },
    select: refundSelect,
  });
  const dealIds = [...new Set(refunds.map((r) => r.dealId))];
  const rows = await ctx.prisma.salesRecord.findMany({
    where: { organizationId, ...saleFilter(ctx), OR: [{ closedAt: { gte: win.from, lt: win.to } }, ...(dealIds.length ? [{ dealId: { in: dealIds } }] : [])] },
    include: { credits: true, adjustments: true },
  });
  return { sales: rows.map(toSaleView), refunds };
}

export interface CollectionFacts {
  sales: SaleView[];
  payments: PaymentView[];
  refunds: RefundView[];
}

export async function collectionFacts(ctx: KpiCtx, win: PeriodWindow): Promise<CollectionFacts> {
  const organizationId = ctx.organizationId;
  const df = dealFilter(ctx);
  const dealWhere = Object.keys(df).length ? { deal: df } : {};
  const [payments, refunds] = await Promise.all([
    ctx.prisma.payment.findMany({ where: { organizationId, status: { in: ['VERIFIED', 'RECONCILED'] }, verifiedAt: { gte: win.from, lt: win.to }, ...dealWhere }, select: { dealId: true, status: true, amount: true, verifiedAt: true } }),
    ctx.prisma.refund.findMany({ where: { organizationId, status: { in: ['PROCESSED', 'RECONCILED'] }, processedAt: { gte: win.from, lt: win.to }, ...dealWhere }, select: refundSelect }),
  ]);
  const dealIds = [...new Set([...payments.map((p) => p.dealId), ...refunds.map((r) => r.dealId)])];
  const rows = dealIds.length ? await ctx.prisma.salesRecord.findMany({ where: { organizationId, dealId: { in: dealIds } }, include: { credits: true, adjustments: true } }) : [];
  return { sales: rows.map(toSaleView), payments: payments.map((p) => ({ dealId: p.dealId, status: p.status, amount: p.amount, verifiedAt: p.verifiedAt })), refunds };
}

export const revenueFor = (f: RevenueFacts, win: PeriodWindow, ids: ReadonlySet<string> | null) => revenueActual(f.sales, f.refunds, win, ids);
export const collectionsFor = (f: CollectionFacts, win: PeriodWindow, ids: ReadonlySet<string> | null) => collectionActual(f.sales, f.payments, f.refunds, win, ids);

/** Window the target KPIs measure: target period start up to min(asOf, period end) (month-to-date). */
export function targetWindow(ctx: KpiCtx): PeriodWindow & { startsOn: string; endsOn: string } {
  const startsOn = ctx.period.startsOn;
  const endsOn = ctx.asOf < ctx.period.endsOn ? (ctx.asOf < startsOn ? startsOn : ctx.asOf) : ctx.period.endsOn;
  return { ...istRange(startsOn, endsOn), startsOn, endsOn };
}

export interface TargetNode {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  level: string;
  amount: Prisma.Decimal;
  asOfAmount: Prisma.Decimal;
  revisions: TargetRevisionView[];
}

/** All targets of a period + metric with their as-of amounts. Empty when the period has no targets (or the period type has none, e.g. WEEK). */
export async function loadTargets(ctx: KpiCtx, metric: 'REVENUE' | 'COLLECTION' | 'ENROLMENT', asOfDate: string): Promise<TargetNode[]> {
  if (ctx.period.type === 'WEEK') return [];
  const period = await ctx.prisma.targetPeriod.findFirst({ where: { organizationId: ctx.organizationId, type: ctx.period.type, startsOn: new Date(`${ctx.period.startsOn}T00:00:00.000Z`) } });
  if (!period) return [];
  const rows = await ctx.prisma.target.findMany({ where: { organizationId: ctx.organizationId, periodId: period.id, metric }, include: { revisions: { where: { status: 'APPROVED' } } } });
  return rows.map((t) => {
    const revisions: TargetRevisionView[] = t.revisions.map((r) => ({ seq: r.seq, status: r.status, newAmount: r.newAmount, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10) }));
    return { id: t.id, ownerUserId: t.ownerUserId, parentId: t.parentId, level: t.level, amount: t.amount, asOfAmount: targetAsOf(revisions, asOfDate) ?? D(t.amount), revisions };
  });
}

/**
 * Targets that represent the viewer's scope without double counting: nodes whose owner is in scope and whose parent is not.
 * Organisation scope = root nodes.
 */
export function scopeTopTargets(all: TargetNode[], scope: KpiScope): TargetNode[] {
  if (scope.userIds === null) return all.filter((t) => t.parentId === null);
  const ids = new Set(scope.userIds);
  const byId = new Map(all.map((t) => [t.id, t]));
  return all.filter((t) => ids.has(t.ownerUserId) && !(t.parentId && ids.has(byId.get(t.parentId)?.ownerUserId ?? '')));
}

export const sumTargets = (nodes: TargetNode[]): Prisma.Decimal => nodes.reduce((a, t) => a.plus(t.asOfAmount), ZERO);

/** user -> subtree (self + transitive reports) for a set of roots, intersected with the scope. */
export async function subtrees(ctx: KpiCtx, roots: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (roots.length === 0) return out;
  const rows = await ctx.prisma.$queryRaw<Array<{ root: string; id: string }>>(Prisma.sql`
    WITH RECURSIVE t(root, id) AS (
      SELECT u.id, u.id FROM users u WHERE u.organization_id = ${ctx.organizationId}::uuid AND u.id = ANY(${roots}::uuid[])
      UNION
      SELECT t.root, u.id FROM users u JOIN t ON u.manager_id = t.id WHERE u.organization_id = ${ctx.organizationId}::uuid
    ) SELECT root::text, id::text FROM t`);
  const allowed = ctx.scope.userIds ? new Set(ctx.scope.userIds) : null;
  for (const r of rows) {
    if (allowed && !allowed.has(r.id)) continue;
    const list = out.get(r.root) ?? [];
    list.push(r.id);
    out.set(r.root, list);
  }
  return out;
}

export async function userNames(ctx: KpiCtx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.prisma.user.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}
