import type { KpiDefinition, KpiItem, ScorecardInput } from './api';

/** Monday (YYYY-MM-DD, UTC arithmetic) of the week containing the given date string. */
export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const delta = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - delta);
  return d.toISOString().slice(0, 10);
}
export const addDaysYmd = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface Selection {
  [definitionId: string]: { selected: boolean; target: string };
}

/** Pure: selected definitions + targets -> API items (KRAs carry no numeric target). */
export function buildAssignmentItems(defs: KpiDefinition[], sel: Selection): KpiItem[] {
  return defs
    .filter((d) => sel[d.id]?.selected)
    .map((d) => {
      const raw = sel[d.id]!.target.trim();
      const n = raw === '' ? NaN : Number(raw);
      return { definitionId: d.id, key: d.key, name: d.name, kind: d.kind, ...(Number.isFinite(n) ? { target: n } : {}), ...(d.unit ? { unit: d.unit } : {}) };
    });
}

export interface ScoreRow { target: string; actual: string }
/** Pure: scorecard input rows (MANUAL source). Rows with neither target nor actual are dropped. */
export function buildScorecardInputs(defs: KpiDefinition[], rows: Record<string, ScoreRow>): ScorecardInput[] {
  const out: ScorecardInput[] = [];
  for (const d of defs) {
    const r = rows[d.id];
    if (!r) continue;
    const target = r.target.trim() === '' ? undefined : Number(r.target);
    const actual = r.actual.trim() === '' ? undefined : Number(r.actual);
    if (target === undefined && actual === undefined) continue;
    out.push({ key: d.key, name: d.name, ...(Number.isFinite(target) ? { target } : {}), ...(Number.isFinite(actual) ? { actual } : {}), ...(d.unit ? { unit: d.unit } : {}), source: 'MANUAL' });
  }
  return out;
}
