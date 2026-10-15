import { Prisma } from '@prisma/client';

/**
 * Money helpers. ALL money in the revenue domain is a Prisma Decimal (decimal.js). Floats are never used:
 * inputs are Decimal | string | integer-valued `bigint`; arithmetic is exact; rounding is explicit ROUND_HALF_UP to 2 dp.
 */
export type Dec = Prisma.Decimal;
export type MoneyInput = Prisma.Decimal | string | bigint;

export const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
export const ZERO = new Prisma.Decimal(0);
export const ONE = new Prisma.Decimal(1);

export function D(v: MoneyInput | null | undefined): Dec {
  if (v === null || v === undefined) return ZERO;
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(typeof v === 'bigint' ? v.toString() : v);
}

/** Round to 2 decimal places, half-up (the only rounding used for persisted money). */
export const round2 = (v: MoneyInput): Dec => D(v).toDecimalPlaces(2, ROUND_HALF_UP);

export const sum = (values: ReadonlyArray<MoneyInput | null | undefined>): Dec => values.reduce<Dec>((a, v) => a.plus(D(v)), ZERO);

export const max0 = (v: MoneyInput): Dec => (D(v).isNegative() ? ZERO : D(v));

/** Fixed 2-dp string, the wire format for money (never a JSON number). */
export const money = (v: MoneyInput | null | undefined): string => round2(D(v)).toFixed(2);

/** Percentage with 1 decimal place as a string, or null when the denominator is not positive (no fake 0%/100%). */
export function pct1(numerator: MoneyInput, denominator: MoneyInput): string | null {
  const den = D(denominator);
  if (!den.isPositive() || den.isZero()) return null;
  return D(numerator).div(den).times(100).toDecimalPlaces(1, ROUND_HALF_UP).toFixed(1);
}

export interface Share {
  key: string;
  /** percentage 0..100 (2 dp) */
  pct: MoneyInput;
}

/**
 * Largest-remainder allocation of `total` over `shares` in whole paise. The parts always sum EXACTLY to `total`
 * (rounded to 2 dp); the remaining paise go to the largest fractional remainders, ties broken by input order.
 * Negative totals are allocated on the absolute value and negated.
 */
export function allocate(total: MoneyInput, shares: ReadonlyArray<Share>): Array<{ key: string; amount: Dec }> {
  if (shares.length === 0) return [];
  const t = round2(total);
  const negative = t.isNegative();
  const paise = t.abs().times(100); // integer
  const exact = shares.map((s) => paise.times(D(s.pct)).div(100));
  const floors = exact.map((e) => e.floor());
  let remainder = paise.minus(floors.reduce<Dec>((a, f) => a.plus(f), ZERO)).toNumber();
  const order = exact.map((e, i) => ({ i, frac: e.minus(floors[i]!) })).sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const parts = floors.slice();
  for (let k = 0; remainder > 0 && k < order.length; k = (k + 1) % order.length) {
    parts[order[k]!.i] = parts[order[k]!.i]!.plus(1);
    remainder -= 1;
  }
  return shares.map((s, i) => {
    const amt = parts[i]!.div(100);
    return { key: s.key, amount: negative ? amt.negated() : amt };
  });
}
