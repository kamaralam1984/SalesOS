import type { CrmContextProvider } from '@salesos/shared-types';

type Signals = Extract<Awaited<ReturnType<CrmContextProvider['listLeadSignals']>>, { available: true }>['leads'][number];

export interface PriorityFactor { rule: string; points: number; detail: string }
export interface PrioritisedLead { leadId: string; name: string | null; stage: string | null; score: number; rank: number; factors: PriorityFactor[] }

const HOT_STAGES = new Set(['NEGOTIATION', 'PROPOSAL', 'DEMO_DONE', 'QUOTED', 'FOLLOW_UP']);
const DAY = 86_400_000;

/** Explainable rule set (no model, no randomness): every point is attributable. A suggestion, never a prediction. */
export function scoreLead(l: Signals, now = new Date()): { score: number; factors: PriorityFactor[] } {
  const f: PriorityFactor[] = [];
  const add = (rule: string, points: number, detail: string) => f.push({ rule, points, detail });
  if (!l.hasOwner) add('NO_OWNER', 30, 'Lead has no owner');
  if (l.openOverdueTasks > 0) add('OVERDUE_TASKS', Math.min(40, l.openOverdueTasks * 20), `${l.openOverdueTasks} overdue follow-up task(s)`);
  if (!l.nextActionAt) add('NO_NEXT_ACTION', 20, 'No next action is scheduled');
  else if (new Date(l.nextActionAt).getTime() < now.getTime()) add('NEXT_ACTION_PAST', 10, 'Next action date has passed');
  if (l.lastContactAt) {
    const days = Math.floor((now.getTime() - new Date(l.lastContactAt).getTime()) / DAY);
    if (days >= 7) add('STALE_CONTACT', 15, `No contact for ${days} days`);
    else if (days >= 3) add('COOLING', 8, `No contact for ${days} days`);
  } else if (l.createdAt && now.getTime() - new Date(l.createdAt).getTime() < 2 * DAY) add('FRESH_UNTOUCHED', 15, 'New lead, not contacted yet');
  if (l.stage && HOT_STAGES.has(l.stage.toUpperCase())) add('LATE_STAGE', 15, `Stage ${l.stage}`);
  if ((l.valueEstimate ?? 0) >= 50_000) add('HIGH_VALUE', 10, 'Estimated value is 50,000 or more');
  return { score: Math.min(100, f.reduce((a, x) => a + x.points, 0)), factors: f };
}

export function prioritise(leads: Signals[], now = new Date()): PrioritisedLead[] {
  return leads
    .map((l) => ({ l, ...scoreLead(l, now) }))
    .sort((a, b) => b.score - a.score || a.l.leadId.localeCompare(b.l.leadId))
    .map((x, i) => ({ leadId: x.l.leadId, name: x.l.name ?? null, stage: x.l.stage ?? null, score: x.score, rank: i + 1, factors: x.factors }));
}
