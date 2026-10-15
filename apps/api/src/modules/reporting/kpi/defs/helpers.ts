import { Prisma } from '@prisma/client';
import { APPROVAL_STATUS, type KpiMeta } from '../types';

type MetaInput = Omit<KpiMeta, 'approvalStatus' | 'requires' | 'minScope' | 'filters' | 'usesWindow' | 'decisions'> &
  Partial<Pick<KpiMeta, 'requires' | 'minScope' | 'filters' | 'usesWindow' | 'decisions' | 'cacheTtlSeconds' | 'isEstimate'>>;

/** Fill dictionary defaults. Every KPI starts as a proposed default awaiting owner approval (decision log). */
export function meta(m: MetaInput): KpiMeta {
  return { requires: null, minScope: 'own', filters: ['teamId', 'ownerId', 'programId', 'sourceId'], usesWindow: 'RANGE', decisions: [], ...m, approvalStatus: APPROVAL_STATUS };
}

export const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
export const dec = (v: Prisma.Decimal.Value, dp: number): string => new Prisma.Decimal(v).toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP).toFixed(dp);
export const count = (n: number): string => String(Math.round(n));

/** mean helper that returns null for an empty list */
export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export const DATE_ONLY = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
export const isoDay = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
