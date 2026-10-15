import { D, type Dec, type MoneyInput } from './money';

/** DEC-027. Configured threshold wins (program, then org); otherwise top 10% of open deal value in the last 90 days. */
export type ThresholdSource = 'PROGRAM' | 'ORG_DEFAULT' | 'TOP_10_PERCENT' | 'NONE';

export interface ThresholdResolution {
  threshold: Dec | null;
  source: ThresholdSource;
}

export const MIN_SAMPLE_FOR_PERCENTILE = 10;

/** Nearest-rank 90th percentile of the sample (ascending); needs MIN_SAMPLE_FOR_PERCENTILE values. */
export function percentile90(amounts: ReadonlyArray<MoneyInput>): Dec | null {
  if (amounts.length < MIN_SAMPLE_FOR_PERCENTILE) return null;
  const sorted = amounts.map(D).sort((a, b) => a.comparedTo(b));
  const rank = Math.ceil(0.9 * sorted.length);
  return sorted[rank - 1]!;
}

export function resolveThreshold(i: { program?: MoneyInput | null; orgDefault?: MoneyInput | null; recentOpenAmounts: ReadonlyArray<MoneyInput> }): ThresholdResolution {
  if (i.program !== null && i.program !== undefined) return { threshold: D(i.program), source: 'PROGRAM' };
  if (i.orgDefault !== null && i.orgDefault !== undefined) return { threshold: D(i.orgDefault), source: 'ORG_DEFAULT' };
  const p = percentile90(i.recentOpenAmounts);
  return p ? { threshold: p, source: 'TOP_10_PERCENT' } : { threshold: null, source: 'NONE' };
}

export interface HighValueVerdict {
  isHighValue: boolean;
  /** 0 none, 1 Team Lead, 2 Founder (strictly above 2x threshold) */
  escalationLevel: 0 | 1 | 2;
  threshold: Dec | null;
  source: ThresholdSource;
}

/** Configured thresholds flag when amount > threshold; the percentile rule flags when amount >= the P90 value. */
export function evaluateHighValue(amount: MoneyInput, r: ThresholdResolution): HighValueVerdict {
  const a = D(amount);
  if (!r.threshold) return { isHighValue: false, escalationLevel: 0, threshold: null, source: r.source };
  const flagged = r.source === 'TOP_10_PERCENT' ? a.greaterThanOrEqualTo(r.threshold) : a.greaterThan(r.threshold);
  if (!flagged) return { isHighValue: false, escalationLevel: 0, threshold: r.threshold, source: r.source };
  return { isHighValue: true, escalationLevel: a.greaterThan(r.threshold.times(2)) ? 2 : 1, threshold: r.threshold, source: r.source };
}
