import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma';
import { D, collectionActual, dailySeries, revenueActual, saleNetByUser, ZERO, allocate, type Dated, type PaymentView, type PeriodWindow, type RefundView, type SaleView } from './calc';

type SaleRow = Prisma.SalesRecordGetPayload<{ include: { credits: true; adjustments: true } }>;

export const toSaleView = (r: SaleRow): SaleView => ({
  dealId: r.dealId,
  saleValue: r.saleValue,
  closedAt: r.closedAt,
  enrolments: r.enrolments,
  credits: r.credits.map((c) => ({ userId: c.userId, amount: c.amount, sharePct: c.sharePct })),
  adjustments: r.adjustments.map((a) => ({ status: a.status, allocations: (a.creditAllocations as Array<{ userId: string; amount: string }>) ?? [] })),
});

/** Loads revenue facts for a window and runs the pure calc functions. Shared by targets, forecasts and (Phase 5) KPIs. */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  private async sales(organizationId: string, where: Prisma.SalesRecordWhereInput): Promise<SaleView[]> {
    const rows = await this.prisma.salesRecord.findMany({ where: { organizationId, ...where }, include: { credits: true, adjustments: true } });
    return rows.map(toSaleView);
  }

  private refundViews(rows: Array<{ dealId: string; status: string; amount: Prisma.Decimal; approvedAmount: Prisma.Decimal | null; approvedAt: Date | null; processedAmount: Prisma.Decimal | null; processedAt: Date | null }>): RefundView[] {
    return rows.map((r) => ({ dealId: r.dealId, status: r.status, amount: r.amount, approvedAmount: r.approvedAmount, approvedAt: r.approvedAt, processedAmount: r.processedAmount, processedAt: r.processedAt }));
  }

  /** Revenue facts: sales closed in the window + the sales behind refunds approved in the window. */
  async revenueFacts(organizationId: string, win: PeriodWindow) {
    const refunds = await this.prisma.refund.findMany({
      where: { organizationId, status: { in: ['APPROVED', 'PROCESSED', 'RECONCILED'] }, approvedAt: { gte: win.from, lt: win.to } },
      select: { dealId: true, status: true, amount: true, approvedAmount: true, approvedAt: true, processedAmount: true, processedAt: true },
    });
    const refundDealIds = [...new Set(refunds.map((r) => r.dealId))];
    const sales = await this.sales(organizationId, { OR: [{ closedAt: { gte: win.from, lt: win.to } }, ...(refundDealIds.length ? [{ dealId: { in: refundDealIds } }] : [])] });
    return { sales, refunds: this.refundViews(refunds) };
  }

  async revenue(organizationId: string, win: PeriodWindow, userIds: ReadonlySet<string> | null) {
    const { sales, refunds } = await this.revenueFacts(organizationId, win);
    return { ...revenueActual(sales, refunds, win, userIds), sales, refunds };
  }

  async collections(organizationId: string, win: PeriodWindow, userIds: ReadonlySet<string> | null) {
    const [payments, refunds] = await Promise.all([
      this.prisma.payment.findMany({ where: { organizationId, status: { in: ['VERIFIED', 'RECONCILED'] }, verifiedAt: { gte: win.from, lt: win.to } }, select: { dealId: true, status: true, amount: true, verifiedAt: true } }),
      this.prisma.refund.findMany({
        where: { organizationId, status: { in: ['PROCESSED', 'RECONCILED'] }, processedAt: { gte: win.from, lt: win.to } },
        select: { dealId: true, status: true, amount: true, approvedAmount: true, approvedAt: true, processedAmount: true, processedAt: true },
      }),
    ]);
    const dealIds = [...new Set([...payments.map((p) => p.dealId), ...refunds.map((r) => r.dealId)])];
    const sales = dealIds.length ? await this.sales(organizationId, { dealId: { in: dealIds } }) : [];
    const pv: PaymentView[] = payments.map((p) => ({ dealId: p.dealId, status: p.status, amount: p.amount, verifiedAt: p.verifiedAt }));
    const rv = this.refundViews(refunds);
    return { ...collectionActual(sales, pv, rv, win, userIds), sales, payments: pv, refunds: rv };
  }

  /** Daily revenue (booked net of approved refunds) in IST days. */
  async revenueDaily(organizationId: string, win: PeriodWindow, startsOn: string, endsOn: string, userIds: ReadonlySet<string> | null) {
    const { sales, refunds } = await this.revenueFacts(organizationId, win);
    const items: Dated[] = [];
    const byDeal = new Map(sales.map((s) => [s.dealId, s]));
    for (const s of sales) {
      if (s.closedAt < win.from || s.closedAt >= win.to) continue;
      const net = saleNetByUser(s);
      const amt = userIds ? [...net].filter(([u]) => userIds.has(u)).reduce((a, [, v]) => a.plus(v), ZERO) : [...net].reduce((a, [, v]) => a.plus(v), ZERO);
      items.push({ at: s.closedAt, amount: amt });
    }
    for (const r of refunds) {
      const s = byDeal.get(r.dealId);
      if (!s || !r.approvedAt) continue;
      const amt = D(r.approvedAmount ?? r.amount);
      const parts = allocate(amt, s.credits.map((c) => ({ key: c.userId, pct: c.sharePct })));
      const mine = userIds ? parts.filter((p) => userIds.has(p.key)).reduce((a, p) => a.plus(p.amount), ZERO) : amt;
      items.push({ at: r.approvedAt, amount: mine.negated() });
    }
    return dailySeries(items, startsOn, endsOn);
  }

  async collectionsDaily(organizationId: string, win: PeriodWindow, startsOn: string, endsOn: string, userIds: ReadonlySet<string> | null) {
    const { payments, sales, refunds } = await this.collections(organizationId, win, userIds);
    const byDeal = new Map(sales.map((s) => [s.dealId, s]));
    const items: Dated[] = [];
    for (const p of payments) {
      const s = byDeal.get(p.dealId);
      if (!s || !p.verifiedAt) continue;
      const parts = allocate(p.amount, s.credits.map((c) => ({ key: c.userId, pct: c.sharePct })));
      const amt = userIds ? parts.filter((x) => userIds.has(x.key)).reduce((a, x) => a.plus(x.amount), ZERO) : D(p.amount);
      items.push({ at: p.verifiedAt, amount: amt });
    }
    for (const r of refunds) {
      const s = byDeal.get(r.dealId);
      if (!s || !r.processedAt) continue;
      const amt = D(r.processedAmount ?? r.approvedAmount ?? r.amount);
      const parts = allocate(amt, s.credits.map((c) => ({ key: c.userId, pct: c.sharePct })));
      const mine = userIds ? parts.filter((x) => userIds.has(x.key)).reduce((a, x) => a.plus(x.amount), ZERO) : amt;
      items.push({ at: r.processedAt, amount: mine.negated() });
    }
    return dailySeries(items, startsOn, endsOn);
  }
}
