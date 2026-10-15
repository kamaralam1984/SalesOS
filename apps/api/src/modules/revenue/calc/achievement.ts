import { D, ROUND_HALF_UP, ZERO, allocate, money, pct1, round2, sum, type Dec, type MoneyInput } from './money';
import { addDays, daysBetweenInclusive, elapsedDays, istDate, istRange, type ProrationBasis } from './periods';

/** DEC-001: prorated target = round2(base x active working days / period working days). Stored explicitly, never recomputed. */
export function prorate(baseAmount: MoneyInput, basis: Pick<ProrationBasis, 'workingDaysPeriod' | 'workingDaysActive'>): Dec {
  if (basis.workingDaysPeriod <= 0) return ZERO;
  return round2(D(baseAmount).times(basis.workingDaysActive).div(basis.workingDaysPeriod));
}

/** Achievement % (1 dp string) or null when there is no target (UI shows a dash + "No target set"). */
export const achievementPct = (actual: MoneyInput, target: MoneyInput): string | null => pct1(actual, target);

/**
 * Pacing: where the actual should be by `asOf` on a straight line through the period, and the gap.
 * `expectedToDate` is null when there is no target.
 */
export function pacing(target: MoneyInput, actual: MoneyInput, periodStart: string, periodEnd: string, asOf: string) {
  const t = D(target);
  if (t.isZero() || t.isNegative()) return { expectedToDate: null as string | null, gap: null as string | null, onTrack: null as boolean | null, elapsedDays: 0, totalDays: 0 };
  const { elapsed, total } = elapsedDays(periodStart, periodEnd, asOf);
  const expected = round2(t.times(elapsed).div(total));
  const gap = round2(D(actual).minus(expected));
  return { expectedToDate: money(expected), gap: money(gap), onTrack: !gap.isNegative(), elapsedDays: elapsed, totalDays: total };
}

export interface TargetRevisionView {
  seq: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  newAmount: MoneyInput;
  /** YYYY-MM-DD */
  effectiveFrom: string;
}

/**
 * DEC-002 target-as-of-date: the newest APPROVED revision whose effective date is on or before `asOf` (highest seq wins).
 * Falls back to the initial (seq 0) revision. Pending/rejected revisions never count.
 */
export function targetAsOf(revisions: ReadonlyArray<TargetRevisionView>, asOf: string): Dec | null {
  const eligible = revisions.filter((r) => r.status === 'APPROVED' && r.effectiveFrom <= asOf).sort((a, b) => b.seq - a.seq);
  return eligible.length ? D(eligible[0]!.newAmount) : null;
}

export interface Dated {
  at: Date;
  amount: MoneyInput;
}
export interface DayPoint {
  date: string;
  amount: string;
  cumulative: string;
}

/** Zero-filled daily series (IST days) between startsOn and endsOn with a running cumulative. */
export function dailySeries(items: ReadonlyArray<Dated>, startsOn: string, endsOn: string): DayPoint[] {
  const byDay = new Map<string, Dec>();
  for (const it of items) {
    const day = istDate(it.at);
    byDay.set(day, (byDay.get(day) ?? ZERO).plus(D(it.amount)));
  }
  const out: DayPoint[] = [];
  let cum = ZERO;
  const n = daysBetweenInclusive(startsOn, endsOn);
  for (let i = 0; i < n; i += 1) {
    const date = addDays(startsOn, i);
    const amt = byDay.get(date) ?? ZERO;
    cum = cum.plus(amt);
    out.push({ date, amount: money(amt), cumulative: money(cum) });
  }
  return out;
}

export { istRange };

// ---------------------------------------------------------------------------------------------------------------
// Revenue / collection attribution (DEC-003, DEC-004, DEC-005)
// ---------------------------------------------------------------------------------------------------------------

export interface CreditShare {
  userId: string;
  sharePct: MoneyInput;
}
export interface SaleView {
  dealId: string;
  saleValue: MoneyInput;
  closedAt: Date;
  enrolments: number;
  credits: ReadonlyArray<{ userId: string; amount: MoneyInput; sharePct: MoneyInput }>;
  adjustments: ReadonlyArray<{ status: 'PENDING' | 'APPROVED' | 'REJECTED'; allocations: ReadonlyArray<{ userId: string; amount: MoneyInput }> }>;
}
export interface RefundView {
  dealId: string;
  status: string;
  amount: MoneyInput;
  approvedAmount?: MoneyInput | null;
  approvedAt?: Date | null;
  processedAmount?: MoneyInput | null;
  processedAt?: Date | null;
}
export interface PaymentView {
  dealId: string;
  status: string;
  amount: MoneyInput;
  verifiedAt?: Date | null;
}

const APPROVED_REFUND = new Set(['APPROVED', 'PROCESSED', 'RECONCILED']);
const PROCESSED_REFUND = new Set(['PROCESSED', 'RECONCILED']);
const COUNTED_PAYMENT = new Set(['VERIFIED', 'RECONCILED']);

/** Per-user net amounts of one sale (credit amounts + approved adjustment allocations). */
export function saleNetByUser(s: SaleView): Map<string, Dec> {
  const m = new Map<string, Dec>();
  for (const c of s.credits) m.set(c.userId, (m.get(c.userId) ?? ZERO).plus(D(c.amount)));
  for (const a of s.adjustments) {
    if (a.status !== 'APPROVED') continue;
    for (const al of a.allocations) m.set(al.userId, (m.get(al.userId) ?? ZERO).plus(D(al.amount)));
  }
  return m;
}

function shareOf(s: SaleView, amount: MoneyInput): Map<string, Dec> {
  const parts = allocate(amount, s.credits.map((c) => ({ key: c.userId, pct: c.sharePct })));
  return new Map(parts.map((p) => [p.key, p.amount]));
}

const within = (d: Date | null | undefined, from: Date, to: Date) => !!d && d >= from && d < to;

export interface PeriodWindow {
  from: Date;
  to: Date;
}

/**
 * Revenue achievement actual (KPI-REV-001, DEC-003): booked sale value (sales closed in the window, net of approved adjustments)
 * minus approved refunds (approved/processed/reconciled, dated by approval) in the window, credited per DEC-005 split.
 * `userIds === null` = whole organisation (each sale counted once even when split). Returns exact Decimals.
 */
export function revenueActual(sales: ReadonlyArray<SaleView>, refunds: ReadonlyArray<RefundView>, win: PeriodWindow, userIds: ReadonlySet<string> | null) {
  let booked = ZERO;
  let refundedApproved = ZERO;
  let enrolments = 0;
  let wonCount = 0;
  const saleByDeal = new Map(sales.map((s) => [s.dealId, s]));
  for (const s of sales) {
    if (!within(s.closedAt, win.from, win.to)) continue;
    const mine = userIds ? [...saleNetByUser(s)].filter(([u]) => userIds.has(u)) : null;
    const amt = mine ? sum(mine.map(([, v]) => v)) : sum([s.saleValue, ...s.adjustments.filter((a) => a.status === 'APPROVED').flatMap((a) => a.allocations.map((al) => al.amount))]);
    if (mine && mine.length === 0) continue;
    booked = booked.plus(amt);
    wonCount += 1;
    enrolments += s.enrolments;
  }
  for (const r of refunds) {
    if (!APPROVED_REFUND.has(r.status) || !within(r.approvedAt, win.from, win.to)) continue;
    const s = saleByDeal.get(r.dealId);
    const amt = D(r.approvedAmount ?? r.amount);
    if (!s) continue;
    if (!userIds) refundedApproved = refundedApproved.plus(amt);
    else for (const [u, v] of shareOf(s, amt)) if (userIds.has(u)) refundedApproved = refundedApproved.plus(v);
  }
  return { booked, refundedApproved, net: booked.minus(refundedApproved), wonCount, enrolments };
}

/**
 * Collection achievement actual (KPI-REV-002, DEC-004): VERIFIED/RECONCILED payments verified in the window, credited to the
 * sale's credited owners at the sale's split, minus PROCESSED/RECONCILED refunds processed in the window.
 */
export function collectionActual(sales: ReadonlyArray<SaleView>, payments: ReadonlyArray<PaymentView>, refunds: ReadonlyArray<RefundView>, win: PeriodWindow, userIds: ReadonlySet<string> | null) {
  const saleByDeal = new Map(sales.map((s) => [s.dealId, s]));
  let verified = ZERO;
  let refunded = ZERO;
  for (const p of payments) {
    if (!COUNTED_PAYMENT.has(p.status) || !within(p.verifiedAt, win.from, win.to)) continue;
    const s = saleByDeal.get(p.dealId);
    if (!s) continue;
    if (!userIds) verified = verified.plus(D(p.amount));
    else for (const [u, v] of shareOf(s, p.amount)) if (userIds.has(u)) verified = verified.plus(v);
  }
  for (const r of refunds) {
    if (!PROCESSED_REFUND.has(r.status) || !within(r.processedAt, win.from, win.to)) continue;
    const s = saleByDeal.get(r.dealId);
    if (!s) continue;
    const amt = D(r.processedAmount ?? r.approvedAmount ?? r.amount);
    if (!userIds) refunded = refunded.plus(amt);
    else for (const [u, v] of shareOf(s, amt)) if (userIds.has(u)) refunded = refunded.plus(v);
  }
  return { verified, refunded, net: verified.minus(refunded) };
}

/** Average deal value (KPI-SAL-004): net booked / won count; null when there are no won deals. */
export function averageDealValue(netBooked: MoneyInput, wonCount: number): string | null {
  if (wonCount <= 0) return null;
  return D(netBooked).div(wonCount).toDecimalPlaces(0, ROUND_HALF_UP).toFixed(0);
}
