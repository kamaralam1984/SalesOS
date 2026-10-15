import { z } from 'zod';
import { numStr } from '../hrkit/kit';
import type { PolicyStructure } from './api';

const num = z.string().refine((v) => v.trim() === '' || numStr(v) !== undefined, 'invalidNumber');
const posNum = z.string().refine((v) => numStr(v) !== undefined && Number(v) >= 0, 'invalidNumber');

export const policyFormSchema = z.object({
  name: z.string().trim().min(3, 'minLength3').max(160, 'maxLength'),
  basis: z.enum(['REVENUE', 'COLLECTION']),
  periodType: z.enum(['MONTH', 'QUARTER']),
  slabMode: z.enum(['FLAT_ON_TOTAL', 'MARGINAL']),
  netOfRefunds: z.boolean(),
  slabs: z.array(
    z.object({
      minPct: posNum,
      maxPct: num,
      kind: z.enum(['rate', 'fixed']),
      value: posNum,
    }),
  ),
  gates: z.array(z.object({ metric: z.string().trim().min(1, 'required'), op: z.enum(['>=', '>', '<=', '<']), value: z.string().refine((v) => numStr(v) !== undefined, 'invalidNumber') })),
  cap: num,
  clawbackWindowDays: num,
  currency: z.string().trim().length(3, 'currency3'),
  notes: z.string().max(2000),
});
export type PolicyFormValues = z.infer<typeof policyFormSchema>;

/** Empty form: NO default amounts, rates, percentages or caps (DEC-015). */
export const emptyPolicyForm = (): PolicyFormValues => ({
  name: '', basis: 'COLLECTION', periodType: 'MONTH', slabMode: 'FLAT_ON_TOTAL', netOfRefunds: true, slabs: [], gates: [], cap: '', clawbackWindowDays: '', currency: 'INR', notes: '',
});

export function policyToForm(name: string, s: PolicyStructure, notes: string | null): PolicyFormValues {
  return {
    name, basis: s.basis, periodType: s.periodType, slabMode: s.slabMode, netOfRefunds: s.netOfRefunds,
    slabs: s.slabs.map((x) => ({ minPct: String(x.minPct), maxPct: x.maxPct === null ? '' : String(x.maxPct), kind: x.ratePct !== undefined ? 'rate' : 'fixed', value: String(x.ratePct ?? x.fixedAmount ?? 0) })),
    gates: s.gates.map((g) => ({ metric: g.metric, op: g.op, value: String(g.value) })),
    cap: s.cap === null ? '' : String(s.cap), clawbackWindowDays: String(s.clawbackWindowDays), currency: s.currency, notes: notes ?? '',
  };
}

/** Form values -> API payload. Blank optional numbers are omitted (server applies its own documented default for the clawback window). */
export function buildPolicyPayload(v: PolicyFormValues) {
  const structure: Record<string, unknown> = {
    basis: v.basis, periodType: v.periodType, slabMode: v.slabMode, netOfRefunds: v.netOfRefunds, currency: v.currency.toUpperCase(),
    slabs: v.slabs.map((s) => ({
      minPct: Number(s.minPct), maxPct: numStr(s.maxPct) === undefined ? null : Number(s.maxPct),
      ...(s.kind === 'rate' ? { ratePct: Number(s.value) } : { fixedAmount: Number(s.value) }),
    })),
    gates: v.gates.map((g) => ({ metric: g.metric, op: g.op, value: Number(g.value) })),
    cap: numStr(v.cap) === undefined ? null : Number(v.cap),
  };
  if (numStr(v.clawbackWindowDays) !== undefined) structure.clawbackWindowDays = Number(v.clawbackWindowDays);
  return { name: v.name, structure, ...(v.notes.trim() ? { notes: v.notes.trim() } : {}) };
}
