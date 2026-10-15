export interface RankRung { key: string; label: string; minEarned: number }
export interface LearnerRank { key: string; label: string; next: { key: string; label: string; remaining: string } | null }

/** Rank for an earned-revenue amount (rupees, decimal string or number). Pure; the ladder comes from cx settings. */
export function learnerRankFor(earned: string | number | null | undefined, ladder: RankRung[]): LearnerRank | null {
  if (earned === null || earned === undefined || earned === '') return null;
  const n = Number(earned);
  if (!Number.isFinite(n) || n < 0 || ladder.length === 0) return null;
  let idx = 0;
  ladder.forEach((r, i) => { if (n >= r.minEarned) idx = i; });
  const cur = ladder[idx]!;
  const nx = ladder[idx + 1];
  return { key: cur.key, label: cur.label, next: nx ? { key: nx.key, label: nx.label, remaining: (nx.minEarned - n).toFixed(2) } : null };
}
