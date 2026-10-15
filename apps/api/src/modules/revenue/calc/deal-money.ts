import { D, max0, money, pct1, sum, type Dec, type MoneyInput } from './money';

/**
 * The five distinct numbers of a deal (state-machines.md section 3). Closed-Won NEVER implies paid:
 *   saleValue       booked, net of APPROVED adjustments
 *   collected       VERIFIED + RECONCILED payments only (RECORDED is pending verification, never credited)
 *   amountDue       saleValue - collected (never negative)
 *   refunded        PROCESSED + RECONCILED refunds (money actually paid out)
 *   netCollections  collected - refunded
 */
export interface DealMoneyInput {
  saleValue: MoneyInput;
  approvedAdjustmentDeltas?: ReadonlyArray<MoneyInput>;
  payments: ReadonlyArray<{ status: string; amount: MoneyInput }>;
  refunds: ReadonlyArray<{ status: string; amount: MoneyInput; approvedAmount?: MoneyInput | null; processedAmount?: MoneyInput | null }>;
}

export interface DealMoney {
  saleValue: Dec;
  originalSaleValue: Dec;
  adjustmentsTotal: Dec;
  collected: Dec;
  pendingVerification: Dec;
  expected: Dec;
  amountDue: Dec;
  overCollected: Dec;
  refunded: Dec;
  refundApprovedNotProcessed: Dec;
  refundOpenRequests: Dec;
  netCollections: Dec;
  /** collected - refund amounts committed in any live state: the cap for a NEW refund request */
  refundable: Dec;
}

const LIVE_REFUND = new Set(['REQUESTED', 'REVIEWED', 'APPROVED', 'PROCESSED', 'RECONCILED']);

export function dealMoney(i: DealMoneyInput): DealMoney {
  const adjustmentsTotal = sum(i.approvedAdjustmentDeltas ?? []);
  const saleValue = D(i.saleValue).plus(adjustmentsTotal);
  const by = (status: string[]) => sum(i.payments.filter((p) => status.includes(p.status)).map((p) => p.amount));
  const collected = by(['VERIFIED', 'RECONCILED']);
  const pendingVerification = by(['RECORDED']);
  const expected = by(['EXPECTED']);
  const refunded = sum(i.refunds.filter((r) => r.status === 'PROCESSED' || r.status === 'RECONCILED').map((r) => r.processedAmount ?? r.approvedAmount ?? r.amount));
  const refundApprovedNotProcessed = sum(i.refunds.filter((r) => r.status === 'APPROVED').map((r) => r.approvedAmount ?? r.amount));
  const refundOpenRequests = sum(i.refunds.filter((r) => r.status === 'REQUESTED' || r.status === 'REVIEWED').map((r) => r.amount));
  const committed = sum(i.refunds.filter((r) => LIVE_REFUND.has(r.status)).map((r) => r.processedAmount ?? r.approvedAmount ?? r.amount));
  return {
    saleValue,
    originalSaleValue: D(i.saleValue),
    adjustmentsTotal,
    collected,
    pendingVerification,
    expected,
    amountDue: max0(saleValue.minus(collected)),
    overCollected: max0(collected.minus(saleValue)),
    refunded,
    refundApprovedNotProcessed,
    refundOpenRequests,
    netCollections: collected.minus(refunded),
    refundable: max0(collected.minus(committed)),
  };
}

/** Wire format (money as 2-dp strings; collection % as a 1-dp string or null). */
export function serializeDealMoney(m: DealMoney, currency = 'INR') {
  return {
    currency,
    saleValue: money(m.saleValue),
    originalSaleValue: money(m.originalSaleValue),
    adjustmentsTotal: money(m.adjustmentsTotal),
    collected: money(m.collected),
    pendingVerification: money(m.pendingVerification),
    amountDue: money(m.amountDue),
    overCollected: money(m.overCollected),
    refunded: money(m.refunded),
    refundApprovedNotProcessed: money(m.refundApprovedNotProcessed),
    refundOpenRequests: money(m.refundOpenRequests),
    netCollections: money(m.netCollections),
    refundable: money(m.refundable),
    collectionPct: pct1(m.collected, m.saleValue),
  };
}
