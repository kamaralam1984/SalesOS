/**
 * SOP adoption maths (pure). Adoption = acknowledged required (user, effective mandatory version) pairs / required pairs.
 * This is the data contract behind the "SOP adoption rate" KPI (docs/people-report.md).
 */
export interface AdoptionRequirement {
  documentId: string;
  documentTitle: string;
  versionId: string;
  versionNumber: number;
  /** users that must acknowledge this version (already filtered by audience roles and active status) */
  requiredUserIds: string[];
}

export interface AdoptionDocRow {
  documentId: string;
  documentTitle: string;
  versionId: string;
  versionNumber: number;
  required: number;
  acknowledged: number;
  ratePct: number | null;
  pendingUserIds: string[];
}
export interface AdoptionUserRow { userId: string; required: number; acknowledged: number; ratePct: number | null; pendingDocumentIds: string[] }
export interface AdoptionResult { overall: { required: number; acknowledged: number; ratePct: number | null }; byDocument: AdoptionDocRow[]; byUser: AdoptionUserRow[] }

export const pct = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 10000) / 100);

/** ackedByVersion: versionId -> set of user ids that acknowledged that exact version. */
export function computeAdoption(reqs: AdoptionRequirement[], ackedByVersion: Map<string, Set<string>>): AdoptionResult {
  const byUser = new Map<string, AdoptionUserRow>();
  const byDocument: AdoptionDocRow[] = reqs.map((r) => {
    const acked = ackedByVersion.get(r.versionId) ?? new Set<string>();
    const required = [...new Set(r.requiredUserIds)];
    const pending: string[] = [];
    let a = 0;
    for (const uid of required) {
      const row = byUser.get(uid) ?? { userId: uid, required: 0, acknowledged: 0, ratePct: null, pendingDocumentIds: [] };
      row.required += 1;
      if (acked.has(uid)) {
        a += 1;
        row.acknowledged += 1;
      } else {
        pending.push(uid);
        row.pendingDocumentIds.push(r.documentId);
      }
      byUser.set(uid, row);
    }
    return { documentId: r.documentId, documentTitle: r.documentTitle, versionId: r.versionId, versionNumber: r.versionNumber, required: required.length, acknowledged: a, ratePct: pct(a, required.length), pendingUserIds: pending };
  });
  const users = [...byUser.values()].map((u) => ({ ...u, ratePct: pct(u.acknowledged, u.required) }));
  const required = byDocument.reduce((s, d) => s + d.required, 0);
  const acknowledged = byDocument.reduce((s, d) => s + d.acknowledged, 0);
  return { overall: { required, acknowledged, ratePct: pct(acknowledged, required) }, byDocument, byUser: users };
}
