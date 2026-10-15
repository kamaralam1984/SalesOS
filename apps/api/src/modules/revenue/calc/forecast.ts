import { D, ONE, ROUND_HALF_UP, ZERO, money, round2, sum, type Dec, type MoneyInput } from './money';

/**
 * Forecast method STAGE_WEIGHTED_V1 (DEC-030, documented in docs/revenue-report.md):
 *   forecast = booked-to-date (net revenue actual in the period) + sum(open deal amount x stage probability)
 *   over open deals whose expected close date falls in [max(period start, as-of date), period end].
 * Deals without an expected close date, or with one already in the past, are NOT in the number: they are reported
 * separately (`unscheduled`, `overdue`). The result is an ESTIMATE, never a fact.
 */
export const FORECAST_METHOD = 'STAGE_WEIGHTED_V1';

/** DEC-030 defaults (configurable per org in revenue_settings.stage_probabilities). Decimal strings in 0..1. */
export const DEFAULT_STAGE_PROBABILITIES: Readonly<Record<string, string>> = {
  NEW: '0.05',
  QUALIFIED: '0.15',
  DEMO_ATTENDED: '0.35',
  OPEN: '0.15',
  NEGOTIATION: '0.60',
  PROPOSAL_NEGOTIATION: '0.60',
  PAYMENT_PENDING: '0.85',
};

export interface PipelineDeal {
  id: string;
  ownerId: string;
  amount: MoneyInput;
  /** deal stage (OPEN/NEGOTIATION/PAYMENT_PENDING) */
  stage: string;
  /** the lead's current stage key, refines probability while the deal is OPEN */
  leadStatus?: string | null;
  /** YYYY-MM-DD or null */
  expectedCloseOn: string | null;
}

/** Probability key: while OPEN the lead stage (NEW/QUALIFIED/DEMO_ATTENDED...) refines it; otherwise the deal stage. */
export function stageKeyFor(d: Pick<PipelineDeal, 'stage' | 'leadStatus'>, probs: Readonly<Record<string, string>>): string {
  if (d.stage === 'OPEN' && d.leadStatus && probs[d.leadStatus] !== undefined) return d.leadStatus;
  return d.stage;
}

export function probabilityFor(key: string, probs: Readonly<Record<string, string>>): Dec {
  const p = probs[key] ?? DEFAULT_STAGE_PROBABILITIES[key];
  if (p === undefined) return ZERO;
  const d = D(p);
  if (d.isNegative() || d.greaterThan(1)) throw new RangeError(`Stage probability for ${key} must be within 0..1`);
  return d;
}

export interface ForecastInput {
  periodStart: string;
  periodEnd: string;
  asOf: string;
  bookedToDate: MoneyInput;
  deals: ReadonlyArray<PipelineDeal>;
  probabilities?: Readonly<Record<string, string>>;
}

export interface StageLine {
  stage: string;
  count: number;
  amount: string;
  probability: string;
  weighted: string;
}
export interface ForecastResult {
  method: typeof FORECAST_METHOD;
  isEstimate: true;
  total: Dec;
  bookedToDate: Dec;
  weightedPipeline: Dec;
  unweightedPipeline: Dec;
  byStage: StageLine[];
  byOwner: Array<{ ownerId: string; weighted: string; unweighted: string; dealCount: number }>;
  unscheduled: { count: number; amount: string };
  overdue: { count: number; amount: string };
  includedDealIds: string[];
}

export function stageWeightedForecast(i: ForecastInput): ForecastResult {
  const probs = { ...DEFAULT_STAGE_PROBABILITIES, ...(i.probabilities ?? {}) };
  const windowStart = i.asOf > i.periodStart ? i.asOf : i.periodStart;
  const stages = new Map<string, { count: number; amount: Dec; weighted: Dec; p: Dec }>();
  const owners = new Map<string, { weighted: Dec; unweighted: Dec; count: number }>();
  let unsched = { count: 0, amount: ZERO };
  let late = { count: 0, amount: ZERO };
  let weightedTotal = ZERO;
  let unweightedTotal = ZERO;
  const included: string[] = [];
  for (const d of i.deals) {
    const amt = D(d.amount);
    if (!d.expectedCloseOn) {
      unsched = { count: unsched.count + 1, amount: unsched.amount.plus(amt) };
      continue;
    }
    if (d.expectedCloseOn < windowStart) {
      late = { count: late.count + 1, amount: late.amount.plus(amt) };
      continue;
    }
    if (d.expectedCloseOn > i.periodEnd) continue;
    const key = stageKeyFor(d, probs);
    const p = probabilityFor(key, probs);
    const w = amt.times(p);
    const s = stages.get(key) ?? { count: 0, amount: ZERO, weighted: ZERO, p };
    stages.set(key, { count: s.count + 1, amount: s.amount.plus(amt), weighted: s.weighted.plus(w), p });
    const o = owners.get(d.ownerId) ?? { weighted: ZERO, unweighted: ZERO, count: 0 };
    owners.set(d.ownerId, { weighted: o.weighted.plus(w), unweighted: o.unweighted.plus(amt), count: o.count + 1 });
    weightedTotal = weightedTotal.plus(w);
    unweightedTotal = unweightedTotal.plus(amt);
    included.push(d.id);
  }
  const weightedPipeline = round2(weightedTotal);
  const booked = round2(i.bookedToDate);
  return {
    method: FORECAST_METHOD,
    isEstimate: true,
    total: booked.plus(weightedPipeline),
    bookedToDate: booked,
    weightedPipeline,
    unweightedPipeline: round2(unweightedTotal),
    byStage: [...stages].map(([stage, s]) => ({ stage, count: s.count, amount: money(s.amount), probability: s.p.toFixed(2), weighted: money(s.weighted) })),
    byOwner: [...owners].map(([ownerId, o]) => ({ ownerId, weighted: money(o.weighted), unweighted: money(o.unweighted), dealCount: o.count })),
    unscheduled: { count: unsched.count, amount: money(unsched.amount) },
    overdue: { count: late.count, amount: money(late.amount) },
    includedDealIds: included,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Accuracy (DEC-030, KPI-SAL-005): named error metrics.
// ---------------------------------------------------------------------------------------------------------------

/** Forecast accuracy % = max(0, 1 - |F - A| / A) x 100 (1 dp string). A <= 0 -> null (never 100%). */
export function forecastAccuracy(forecast: MoneyInput, actual: MoneyInput): string | null {
  const a = D(actual);
  if (!a.isPositive() || a.isZero()) return null;
  const acc = ONE.minus(D(forecast).minus(a).abs().div(a));
  return (acc.isNegative() ? ZERO : acc).times(100).toDecimalPlaces(1, ROUND_HALF_UP).toFixed(1);
}

/** Bias % = (F - A) / A x 100 (1 dp). Positive = over-forecast. */
export function forecastBias(forecast: MoneyInput, actual: MoneyInput): string | null {
  const a = D(actual);
  if (!a.isPositive() || a.isZero()) return null;
  return D(forecast).minus(a).div(a).times(100).toDecimalPlaces(1, ROUND_HALF_UP).toFixed(1);
}

/** WAPE = sum|F_i - A_i| / sum A_i (as a 1-dp percentage string); lower is better. null if sum A <= 0. */
export function wape(pairs: ReadonlyArray<{ forecast: MoneyInput; actual: MoneyInput }>): string | null {
  const denom = sum(pairs.map((p) => p.actual));
  if (!denom.isPositive() || denom.isZero()) return null;
  const num = pairs.reduce<Dec>((a, p) => a.plus(D(p.forecast).minus(D(p.actual)).abs()), ZERO);
  return num.div(denom).times(100).toDecimalPlaces(1, ROUND_HALF_UP).toFixed(1);
}
