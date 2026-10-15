import { Prisma } from '@prisma/client';
import type { KpiCtx, KpiScope, FilterInput } from './types';

/** `col = ANY(ids)` for an owner column, or nothing for organisation-wide scope. Column names are internal constants. */
export function ownerIn(scope: KpiScope, col: string): Prisma.Sql {
  if (scope.userIds === null) return Prisma.empty;
  return Prisma.sql` AND ${Prisma.raw(col)} = ANY(${scope.userIds}::uuid[])`;
}

/**
 * Lead visibility, mirroring AccessService.scopedWhere: org = every lead (incl. unassigned); team = owned by the visible users OR
 * in a led team (only while no team/owner filter narrowed the scope); own = owned by self.
 */
export function leadScope(scope: KpiScope, alias = 'l'): Prisma.Sql {
  if (scope.userIds === null) return Prisma.empty;
  if (scope.level === 'team' && scope.teamIds.length > 0 && !scope.narrowed) {
    return Prisma.sql` AND (${Prisma.raw(alias)}.assigned_to_id = ANY(${scope.userIds}::uuid[]) OR ${Prisma.raw(alias)}.team_id = ANY(${scope.teamIds}::uuid[]))`;
  }
  return Prisma.sql` AND ${Prisma.raw(alias)}.assigned_to_id = ANY(${scope.userIds}::uuid[])`;
}

/** program / source filters on a lead alias */
export function leadFilters(f: FilterInput, alias = 'l'): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`${f.programId ? Prisma.sql` AND ${a}.program_id = ${f.programId}::uuid` : Prisma.empty}${f.sourceId ? Prisma.sql` AND ${a}.source_id = ${f.sourceId}::uuid` : Prisma.empty}`;
}

/** [DEMO] exclusion (production reports, DEC kpi dictionary global exclusions) */
export function notDemo(ctx: KpiCtx, alias = 'l'): Prisma.Sql {
  return ctx.config.excludeDemo ? Prisma.sql` AND ${Prisma.raw(alias)}.full_name NOT LIKE '[DEMO]%'` : Prisma.empty;
}

/** active, de-duplicated lead (not merged away) */
export const notMerged = (alias = 'l'): Prisma.Sql => Prisma.sql` AND ${Prisma.raw(alias)}.merged_into_id IS NULL`;

/** Postgres bigint/numeric -> JS number for counts (counts are always far below 2^53). */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export const round1 = (v: number): number => Math.round(v * 10) / 10;

export function pctStr(numerator: number, denominator: number): string | null {
  if (!(denominator > 0)) return null;
  return (Math.round((numerator / denominator) * 1000) / 10).toFixed(1);
}

export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}
