import { Prisma } from '@prisma/client';

/**
 * Incentive calculation engine: PURE functions, no I/O. Inputs are supplied by the caller (or an InputProvider).
 * No rates, slabs or amounts are defined in code: everything comes from the Founder-approved policy structure (DEC-015).
 */
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface Slab { minPct: number; maxPct: number | null; ratePct?: number; fixedAmount?: number }
export interface Gate { metric: string; op: '>=' | '>' | '<=' | '<'; value: number; label?: string }
export interface IncentiveStructure {
  basis: 'REVENUE' | 'COLLECTION';
  periodType: 'MONTH' | 'QUARTER';
  slabMode: 'FLAT_ON_TOTAL' | 'MARGINAL';
  netOfRefunds: boolean;
  slabs: Slab[];
  gates: Gate[];
  cap: number | null;
  clawbackWindowDays: number;
  currency: string;
}
export interface IncentiveInputs { target: number; revenue: number; collections: number; refunds: number; metrics: Record<string, number> }

export interface GateResult { metric: string; op: Gate['op']; value: number; actual: number | null; passed: boolean; label?: string }
export interface CalcResult {
  eligible: boolean;
  reasons: string[];
  gateResults: GateResult[];
  basisAmount: string; // gross basis
  netBasisAmount: string; // after refunds when policy says so
  achievementPct: string | null;
  slab: Slab | null;
  rawAmount: string;
  capApplied: boolean;
  amount: string;
  currency: string;
}

export function validateSlabs(slabs: Slab[]): string[] {
  const errors: string[] = [];
  if (slabs.length === 0) return ['At least one slab is required'];
  const sorted = [...slabs].sort((a, b) => a.minPct - b.minPct);
  sorted.forEach((s, i) => {
    if ((s.ratePct === undefined) === (s.fixedAmount === undefined)) errors.push(`Slab ${i + 1}: provide exactly one of ratePct or fixedAmount`);
    if (s.maxPct !== null && s.maxPct <= s.minPct) errors.push(`Slab ${i + 1}: maxPct must exceed minPct`);
    const next = sorted[i + 1];
    if (next) {
      if (s.maxPct === null) errors.push(`Slab ${i + 1}: an open-ended slab must be the last one`);
      else if (s.maxPct > next.minPct) errors.push(`Slabs ${i + 1} and ${i + 2} overlap`);
    }
  });
  return errors;
}

const cmp = (actual: number, op: Gate['op'], value: number) => (op === '>=' ? actual >= value : op === '>' ? actual > value : op === '<=' ? actual <= value : actual < value);

export function evaluateGates(gates: Gate[], values: Record<string, number>): GateResult[] {
  return gates.map((g) => {
    const actual = Object.prototype.hasOwnProperty.call(values, g.metric) ? values[g.metric]! : null;
    return { metric: g.metric, op: g.op, value: g.value, actual, passed: actual !== null && cmp(actual, g.op, g.value), ...(g.label ? { label: g.label } : {}) };
  });
}

export function calculateIncentive(structure: IncentiveStructure, inputs: IncentiveInputs): CalcResult {
  const reasons: string[] = [];
  const gross = D(structure.basis === 'REVENUE' ? inputs.revenue : inputs.collections);
  const net = structure.netOfRefunds ? Prisma.Decimal.max(D(0), gross.minus(inputs.refunds)) : gross;
  const target = D(inputs.target);
  const base = { basisAmount: round2(gross).toFixed(2), netBasisAmount: round2(net).toFixed(2), currency: structure.currency };
  const zero = (extra: Partial<CalcResult>): CalcResult => ({
    eligible: false, reasons, gateResults: [], ...base, achievementPct: null, slab: null, rawAmount: '0.00', capApplied: false, amount: '0.00', ...extra,
  });

  if (structure.slabs.length === 0) {
    reasons.push('POLICY_HAS_NO_SLABS');
    return zero({});
  }
  if (target.lte(0)) {
    reasons.push('NO_TARGET');
    return zero({});
  }
  const ach = net.div(target).times(100);
  const achievementPct = ach.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
  const gateResults = evaluateGates(structure.gates, { achievementPct: Number(ach.toFixed(4)), ...inputs.metrics });
  const failed = gateResults.filter((g) => !g.passed);
  if (failed.length) {
    reasons.push(...failed.map((g) => `GATE_FAILED:${g.metric}`));
    return zero({ gateResults, achievementPct });
  }

  const slabs = [...structure.slabs].sort((a, b) => a.minPct - b.minPct);
  let raw = D(0);
  let matched: Slab | null = null;
  if (structure.slabMode === 'FLAT_ON_TOTAL') {
    matched = slabs.find((s) => ach.gte(s.minPct) && (s.maxPct === null || ach.lt(s.maxPct))) ?? null;
    if (!matched) reasons.push('BELOW_FIRST_SLAB');
    else raw = matched.ratePct !== undefined ? net.times(matched.ratePct).div(100) : D(matched.fixedAmount ?? 0);
  } else {
    for (const s of slabs) {
      if (ach.lt(s.minPct)) continue;
      matched = s;
      if (s.ratePct !== undefined) {
        const upper = s.maxPct === null ? ach : Prisma.Decimal.min(ach, D(s.maxPct));
        const bandRevenue = upper.minus(s.minPct).div(100).times(target);
        raw = raw.plus(bandRevenue.times(s.ratePct).div(100));
      } else raw = raw.plus(s.fixedAmount ?? 0);
    }
    if (!matched) reasons.push('BELOW_FIRST_SLAB');
  }
  raw = round2(raw);
  const capApplied = structure.cap !== null && raw.gt(structure.cap);
  const amount = capApplied ? D(structure.cap!) : raw;
  return {
    eligible: true, reasons, gateResults, ...base, achievementPct, slab: matched, rawAmount: raw.toFixed(2), capApplied, amount: round2(amount).toFixed(2),
  };
}
