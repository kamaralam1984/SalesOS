import type { DealStage, PaymentStatus, RefundStatus } from '@/lib/api/hooks/revenue';

/**
 * INR formatting that never goes through a JS float: Intl.NumberFormat accepts a decimal STRING and formats it exactly.
 * Currency is always explicit ("INR 1,25,000.00" / "₹" only where a column header already states INR).
 */
export function formatMoney(value: string | null | undefined, locale = 'en-IN', opts: { display?: 'code' | 'symbol'; fraction?: 0 | 2 } = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  const f = new Intl.NumberFormat(locale === 'en' ? 'en-IN' : locale, {
    style: 'currency',
    currency: 'INR',
    currencyDisplay: opts.display ?? 'code',
    minimumFractionDigits: opts.fraction ?? 2,
    maximumFractionDigits: opts.fraction ?? 2,
  });
  // format() takes a decimal string exactly (ES2023 Intl.NumberFormat v3). Normalise the non-breaking space after the code.
  return f.format(value as unknown as number).replace(/ /g, ' ');
}

export function formatCount(value: string | null | undefined, locale = 'en-IN'): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale === 'en' ? 'en-IN' : locale, { maximumFractionDigits: 0 }).format(value as unknown as number);
}

/** "37.5" -> "37.5%"; null -> em dash (never a fake 0%). */
export const formatPct = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** Add two 2-dp decimal strings exactly (integer paise arithmetic with BigInt). */
export function addMoney(a: string, b: string): string {
  return fromPaise(toPaise(a) + toPaise(b));
}
export function subMoney(a: string, b: string): string {
  return fromPaise(toPaise(a) - toPaise(b));
}
export function cmpMoney(a: string, b: string): -1 | 0 | 1 {
  const d = toPaise(a) - toPaise(b);
  return d === 0n ? 0 : d < 0n ? -1 : 1;
}
export function toPaise(v: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(v.trim());
  if (!m) return 0n;
  const frac = (m[3] ?? '').padEnd(2, '0');
  const n = BigInt(m[2]! + frac);
  return m[1] === '-' ? -n : n;
}
export function fromPaise(p: bigint): string {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const s = abs.toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}
/** Valid positive money input: digits with at most 2 decimals. */
export const isMoneyInput = (v: string) => /^\d{1,12}(\.\d{1,2})?$/.test(v.trim()) && /[1-9]/.test(v);
export const normalizeMoney = (v: string) => (v.includes('.') ? v.trim() : `${v.trim()}.00`);

export const DEAL_STAGES: DealStage[] = ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING', 'WON', 'LOST'];
export const OPEN_STAGES: DealStage[] = ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING'];

export type BadgeStatus = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'pending' | 'overdue';
export const stageStatus = (s: DealStage): BadgeStatus => (s === 'WON' ? 'success' : s === 'LOST' || s === 'CANCELLED' ? 'danger' : s === 'PAYMENT_PENDING' ? 'warning' : 'info');
export const paymentStatusTone = (s: PaymentStatus): BadgeStatus => ({ EXPECTED: 'pending', RECORDED: 'warning', VERIFIED: 'success', REJECTED: 'danger', RECONCILED: 'success', REVERSED: 'danger' })[s] as BadgeStatus;
export const refundStatusTone = (s: RefundStatus): BadgeStatus => ({ REQUESTED: 'pending', REVIEWED: 'info', APPROVED: 'warning', REJECTED: 'danger', WITHDRAWN: 'neutral', PROCESSED: 'success', RECONCILED: 'success', CANCELLED: 'neutral' })[s] as BadgeStatus;

/** Which workflow button applies to a refund in a given state (UI hint only; the API enforces authority). */
export const REFUND_NEXT: Record<RefundStatus, Array<{ action: 'review' | 'approve' | 'reject' | 'withdraw' | 'cancel' | 'process' | 'reconcile'; permission: string }>> = {
  REQUESTED: [{ action: 'review', permission: 'refunds:review' }, { action: 'withdraw', permission: 'refunds:request' }],
  REVIEWED: [{ action: 'approve', permission: 'refunds:approve' }, { action: 'reject', permission: 'refunds:approve' }],
  APPROVED: [{ action: 'process', permission: 'refunds:process' }, { action: 'cancel', permission: 'refunds:approve' }],
  PROCESSED: [{ action: 'reconcile', permission: 'refunds:reconcile' }],
  REJECTED: [],
  WITHDRAWN: [],
  RECONCILED: [],
  CANCELLED: [],
};

/** IST calendar date (YYYY-MM-DD) of "now". */
export const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
export const humanize = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/* ---------------------------------------------------------------- shared-credit split (close dialog) */
export interface CreditRow { userId: string; sharePct: string }
export type SplitProblem = 'EMPTY' | 'USER_MISSING' | 'DUPLICATE_USER' | 'SHARE_INVALID' | 'SUM_NOT_100';
export interface SplitState { ok: boolean; problems: SplitProblem[]; total: string; remaining: string }

/** Validates a credit split exactly like the API does (percentages with <= 2 decimals; users unique; total EXACTLY 100.00). Pure, in hundredths. */
export function splitState(rows: CreditRow[]): SplitState {
  const problems = new Set<SplitProblem>();
  if (rows.length === 0) problems.add('EMPTY');
  let total = 0n;
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.userId) problems.add('USER_MISSING');
    else if (seen.has(r.userId)) problems.add('DUPLICATE_USER');
    else seen.add(r.userId);
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(r.sharePct.trim()) || toPaise(r.sharePct) <= 0n || toPaise(r.sharePct) > 10000n) problems.add('SHARE_INVALID');
    else total += toPaise(r.sharePct);
  }
  if (rows.length > 0 && total !== 10000n) problems.add('SUM_NOT_100');
  return { ok: problems.size === 0, problems: [...problems], total: fromPaise(total), remaining: fromPaise(10000n - total) };
}

/** Equal shares that add up to exactly 100.00 (the remainder hundredths go to the first rows). */
export function equalShares(n: number): string[] {
  if (n <= 0) return [];
  const base = 10000n / BigInt(n);
  const extra = Number(10000n % BigInt(n));
  return Array.from({ length: n }, (_, i) => fromPaise(base + (i < extra ? 1n : 0n)));
}
