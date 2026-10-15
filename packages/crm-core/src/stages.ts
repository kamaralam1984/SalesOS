export type StageCategory = 'OPEN' | 'WON' | 'LOST' | 'NURTURE';

export interface StageDef {
  key: string;
  label: string;
  category: StageCategory;
  sortOrder: number;
  skippable: boolean;
  canClose: boolean;
  allowedNext: string[];
  isActive?: boolean;
}

/** DEC-006 defaults. Configurable per organization; seeded lazily by ensureCrmDefaults. */
export const DEFAULT_STAGES: StageDef[] = [
  { key: 'NEW', label: 'New', category: 'OPEN', sortOrder: 10, skippable: false, canClose: false, allowedNext: ['CONTACT_ATTEMPTED'] },
  { key: 'CONTACT_ATTEMPTED', label: 'Contact attempted', category: 'OPEN', sortOrder: 20, skippable: false, canClose: false, allowedNext: ['CONNECTED', 'CONTACT_ATTEMPTED'] },
  { key: 'CONNECTED', label: 'Connected', category: 'OPEN', sortOrder: 30, skippable: false, canClose: false, allowedNext: ['QUALIFIED', 'PROPOSAL_NEGOTIATION'] },
  { key: 'QUALIFIED', label: 'Qualified', category: 'OPEN', sortOrder: 40, skippable: false, canClose: false, allowedNext: ['WEBINAR_REGISTERED', 'DEMO_SCHEDULED'] },
  { key: 'WEBINAR_REGISTERED', label: 'Webinar registered', category: 'OPEN', sortOrder: 50, skippable: true, canClose: false, allowedNext: ['WEBINAR_ATTENDED'] },
  { key: 'WEBINAR_ATTENDED', label: 'Webinar attended', category: 'OPEN', sortOrder: 60, skippable: true, canClose: false, allowedNext: ['DEMO_SCHEDULED'] },
  { key: 'DEMO_SCHEDULED', label: 'Demo scheduled', category: 'OPEN', sortOrder: 70, skippable: true, canClose: false, allowedNext: ['DEMO_ATTENDED'] },
  { key: 'DEMO_ATTENDED', label: 'Demo attended', category: 'OPEN', sortOrder: 80, skippable: true, canClose: false, allowedNext: ['PROPOSAL_NEGOTIATION'] },
  { key: 'PROPOSAL_NEGOTIATION', label: 'Proposal / negotiation', category: 'OPEN', sortOrder: 90, skippable: false, canClose: true, allowedNext: ['PAYMENT_PENDING', 'WON'] },
  { key: 'PAYMENT_PENDING', label: 'Payment pending', category: 'OPEN', sortOrder: 100, skippable: true, canClose: true, allowedNext: ['WON'] },
  { key: 'WON', label: 'Won', category: 'WON', sortOrder: 110, skippable: false, canClose: false, allowedNext: [] },
  { key: 'LOST', label: 'Lost', category: 'LOST', sortOrder: 120, skippable: false, canClose: false, allowedNext: ['NURTURE', 'CONTACT_ATTEMPTED'] },
  { key: 'NURTURE', label: 'Nurture', category: 'NURTURE', sortOrder: 130, skippable: false, canClose: false, allowedNext: ['CONTACT_ATTEMPTED'] },
];

export interface LostReasonDef {
  key: string;
  label: string;
  requiresNote: boolean;
  reactivateAfterDays: number | null;
  sortOrder: number;
}

/** DEC-006 reasons + DEC-031 reactivation windows (30/45/60 days; excluded reasons have null). */
export const DEFAULT_LOST_REASONS: LostReasonDef[] = [
  { key: 'PRICE', label: 'Price', requiresNote: false, reactivateAfterDays: 60, sortOrder: 10 },
  { key: 'NOT_INTERESTED', label: 'Not interested', requiresNote: false, reactivateAfterDays: null, sortOrder: 20 },
  { key: 'NO_RESPONSE_EXHAUSTED', label: 'No response (exhausted)', requiresNote: false, reactivateAfterDays: 45, sortOrder: 30 },
  { key: 'COMPETITOR', label: 'Chose a competitor', requiresNote: false, reactivateAfterDays: null, sortOrder: 40 },
  { key: 'BAD_TIMING', label: 'Bad timing', requiresNote: false, reactivateAfterDays: 30, sortOrder: 50 },
  { key: 'NOT_ELIGIBLE', label: 'Not eligible', requiresNote: false, reactivateAfterDays: null, sortOrder: 60 },
  { key: 'DUPLICATE_OR_INVALID', label: 'Duplicate or invalid', requiresNote: false, reactivateAfterDays: null, sortOrder: 70 },
  { key: 'LANGUAGE_MISMATCH', label: 'Language mismatch', requiresNote: false, reactivateAfterDays: null, sortOrder: 80 },
  { key: 'OTHER', label: 'Other', requiresNote: true, reactivateAfterDays: null, sortOrder: 90 },
];

export type TransitionCode =
  | 'OK'
  | 'UNKNOWN_STAGE'
  | 'TERMINAL_WON'
  | 'SAME_STAGE'
  | 'NOT_ALLOWED'
  | 'CANNOT_CLOSE_FROM_STAGE'
  | 'LOST_ONLY_FROM_OPEN'
  | 'NURTURE_ONLY_FROM_LOST'
  | 'INACTIVE_STAGE';

export interface TransitionVerdict {
  allowed: boolean;
  code: TransitionCode;
  /** a human reason must accompany the move (backward moves, reopen, lost) */
  needsReason: boolean;
  direction: 'forward' | 'backward' | 'lateral';
}

const by = (stages: StageDef[], key: string) => stages.find((s) => s.key === key);

/**
 * Pure transition check for the lead state machine (docs/state-machines.md section 1). The single place that
 * decides whether `from -> to` is legal; services call it, never set status directly.
 */
export function evaluateTransition(stages: StageDef[], fromKey: string, toKey: string): TransitionVerdict {
  const no = (code: TransitionCode): TransitionVerdict => ({ allowed: false, code, needsReason: false, direction: 'lateral' });
  const from = by(stages, fromKey);
  const to = by(stages, toKey);
  if (!from || !to) return no('UNKNOWN_STAGE');
  if (to.isActive === false) return no('INACTIVE_STAGE');
  if (from.category === 'WON') return no('TERMINAL_WON');
  if (from.key === to.key) {
    return from.allowedNext.includes(from.key) ? { allowed: true, code: 'OK', needsReason: false, direction: 'lateral' } : no('SAME_STAGE');
  }
  const dir = to.sortOrder > from.sortOrder ? 'forward' : 'backward';
  if (to.category === 'WON') {
    return from.category === 'OPEN' && (from.canClose || from.allowedNext.includes(to.key))
      ? { allowed: true, code: 'OK', needsReason: false, direction: 'forward' }
      : no('CANNOT_CLOSE_FROM_STAGE');
  }
  if (to.category === 'LOST') {
    return from.category === 'OPEN' ? { allowed: true, code: 'OK', needsReason: true, direction: 'forward' } : no('LOST_ONLY_FROM_OPEN');
  }
  if (to.category === 'NURTURE') {
    return from.category === 'LOST' ? { allowed: true, code: 'OK', needsReason: false, direction: 'forward' } : no('NURTURE_ONLY_FROM_LOST');
  }
  // to is OPEN
  if (from.category === 'LOST' || from.category === 'NURTURE') {
    return from.allowedNext.includes(to.key) ? { allowed: true, code: 'OK', needsReason: true, direction: 'forward' } : no('NOT_ALLOWED');
  }
  if (dir === 'backward') return { allowed: true, code: 'OK', needsReason: true, direction: 'backward' };
  if (from.allowedNext.includes(to.key)) return { allowed: true, code: 'OK', needsReason: false, direction: 'forward' };
  const between = stages.filter((s) => s.category === 'OPEN' && s.sortOrder > from.sortOrder && s.sortOrder < to.sortOrder && s.isActive !== false);
  if (between.every((s) => s.skippable)) return { allowed: true, code: 'OK', needsReason: false, direction: 'forward' };
  return no('NOT_ALLOWED');
}

/**
 * Shortest legal forward path from -> to (inclusive of `to`, exclusive of `from`), used by the call-disposition
 * flow so e.g. a first call that connects walks NEW -> CONTACT_ATTEMPTED -> CONNECTED with one history row per hop.
 * Returns null when no legal path of at most `maxHops` exists.
 */
export function findForwardPath(stages: StageDef[], fromKey: string, toKey: string, maxHops = 5): string[] | null {
  if (fromKey === toKey) return [];
  const queue: Array<{ key: string; path: string[] }> = [{ key: fromKey, path: [] }];
  const seen = new Set([fromKey]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.path.length >= maxHops) continue;
    for (const s of stages) {
      if (seen.has(s.key) || s.key === cur.key) continue;
      const v = evaluateTransition(stages, cur.key, s.key);
      if (!v.allowed || v.direction !== 'forward' || v.needsReason) continue;
      if (s.category !== 'OPEN' && s.key !== toKey) continue;
      const path = [...cur.path, s.key];
      if (s.key === toKey) return path;
      seen.add(s.key);
      queue.push({ key: s.key, path });
    }
  }
  return null;
}
