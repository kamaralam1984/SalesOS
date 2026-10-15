import { Injectable } from '@nestjs/common';
import { PrismaService, type Tx } from '../../../common/prisma';
import { dealMoney, type DealMoney } from '../calc';

/** Batch loader for the five distinct deal numbers (sale / due / collected / refunded / net). Single source of truth. */
@Injectable()
export class DealMoneyService {
  constructor(private readonly prisma: PrismaService) {}

  async forDeals(organizationId: string, dealIds: string[], db: PrismaService | Tx = this.prisma): Promise<Map<string, DealMoney>> {
    const out = new Map<string, DealMoney>();
    if (!dealIds.length) return out;
    const [records, payments, refunds] = await Promise.all([
      db.salesRecord.findMany({ where: { organizationId, dealId: { in: dealIds } }, select: { dealId: true, saleValue: true, adjustments: { where: { status: 'APPROVED' }, select: { delta: true } } } }),
      db.payment.findMany({ where: { organizationId, dealId: { in: dealIds } }, select: { dealId: true, status: true, amount: true } }),
      db.refund.findMany({ where: { organizationId, dealId: { in: dealIds } }, select: { dealId: true, status: true, amount: true, approvedAmount: true, processedAmount: true } }),
    ]);
    for (const r of records) {
      out.set(
        r.dealId,
        dealMoney({
          saleValue: r.saleValue,
          approvedAdjustmentDeltas: r.adjustments.map((a) => a.delta),
          payments: payments.filter((p) => p.dealId === r.dealId),
          refunds: refunds.filter((x) => x.dealId === r.dealId),
        }),
      );
    }
    return out;
  }
}
