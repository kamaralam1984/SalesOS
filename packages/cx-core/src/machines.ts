/**
 * State machines for Phase 7 (docs/state-machines.md sections 6, 7, 8 + escalation). One rule table per aggregate; the API
 * services and the worker sweeps both go through `findRule` - there is no other way to change a status.
 * Actors: OWNER = the record owner, MANAGER = Sales Manager / Team Lead / Founder, TEAM_LEAD = Team Lead / Founder,
 * FOUNDER = Founder, STUDENT_SUCCESS = Student Success group, REQUESTER = who created it, SYSTEM = workers only.
 */
export type Actor = 'OWNER' | 'MANAGER' | 'TEAM_LEAD' | 'FOUNDER' | 'STUDENT_SUCCESS' | 'REQUESTER' | 'SYSTEM';

export interface Rule<S extends string> {
  from: readonly S[];
  to: S;
  actors: readonly Actor[];
  /** request fields that must be present (non-empty) */
  required: readonly string[];
  audit: string;
}

export function findRule<S extends string>(rules: readonly Rule<S>[], from: S, to: S): Rule<S> | undefined {
  return rules.find((r) => r.to === to && r.from.includes(from));
}

// ------------------------------------------------------------------ complaints (section 7)
export type ComplaintState = 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED' | 'REOPENED';
export const COMPLAINT_RULES: readonly Rule<ComplaintState>[] = [
  { from: ['OPEN'], to: 'ACKNOWLEDGED', actors: ['OWNER', 'MANAGER'], required: ['note'], audit: 'complaint.acknowledged' },
  { from: ['ACKNOWLEDGED'], to: 'IN_PROGRESS', actors: ['OWNER', 'MANAGER'], required: ['note'], audit: 'complaint.updated' },
  { from: ['IN_PROGRESS'], to: 'ESCALATED', actors: ['OWNER', 'MANAGER'], required: ['reason', 'escalatedToId'], audit: 'complaint.escalated' },
  { from: ['ESCALATED'], to: 'IN_PROGRESS', actors: ['TEAM_LEAD'], required: ['note'], audit: 'complaint.updated' },
  { from: ['REOPENED'], to: 'IN_PROGRESS', actors: ['OWNER', 'MANAGER'], required: ['note'], audit: 'complaint.updated' },
  { from: ['IN_PROGRESS'], to: 'RESOLVED', actors: ['OWNER', 'MANAGER'], required: ['resolution', 'rootCauseCategory'], audit: 'complaint.resolved' },
  { from: ['RESOLVED'], to: 'CLOSED', actors: ['OWNER', 'SYSTEM'], required: [], audit: 'complaint.closed' },
  { from: ['RESOLVED'], to: 'REOPENED', actors: ['OWNER', 'MANAGER'], required: ['reason'], audit: 'complaint.reopened' },
  { from: ['OPEN'], to: 'CLOSED', actors: ['MANAGER'], required: ['reason'], audit: 'complaint.closed' },
];
export const COMPLAINT_TERMINAL: readonly ComplaintState[] = ['CLOSED'];

// ------------------------------------------------------------------ handover (section 6)
export type HandoverState = 'DRAFT' | 'SUBMITTED' | 'INFO_REQUESTED' | 'ACKNOWLEDGED' | 'OVERDUE' | 'COMPLETED';
export const HANDOVER_RULES: readonly Rule<HandoverState>[] = [
  { from: ['DRAFT', 'INFO_REQUESTED'], to: 'SUBMITTED', actors: ['OWNER', 'MANAGER'], required: [], audit: 'handover.submitted' },
  { from: ['SUBMITTED'], to: 'ACKNOWLEDGED', actors: ['STUDENT_SUCCESS'], required: [], audit: 'handover.acknowledged' },
  { from: ['OVERDUE'], to: 'ACKNOWLEDGED', actors: ['STUDENT_SUCCESS'], required: [], audit: 'handover.acknowledged' },
  { from: ['SUBMITTED'], to: 'INFO_REQUESTED', actors: ['STUDENT_SUCCESS'], required: ['questions'], audit: 'handover.info_requested' },
  { from: ['SUBMITTED'], to: 'OVERDUE', actors: ['SYSTEM'], required: [], audit: 'handover.overdue' },
  { from: ['ACKNOWLEDGED'], to: 'COMPLETED', actors: ['STUDENT_SUCCESS'], required: ['note'], audit: 'handover.completed' },
];
export const HANDOVER_TERMINAL: readonly HandoverState[] = ['COMPLETED'];

// ------------------------------------------------------------------ task / action item (section 8)
export type WorkState = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'ESCALATED' | 'CANCELLED';
/**
 * Section 8, with ONE documented extension: IN_PROGRESS -> OVERDUE (otherwise a started item that passes its due date
 * would never alert). COMPLETED is terminal (no reopen: create a new item).
 */
export const WORK_RULES: readonly Rule<WorkState>[] = [
  { from: ['OPEN'], to: 'IN_PROGRESS', actors: ['OWNER', 'MANAGER'], required: [], audit: 'updated' },
  { from: ['OPEN', 'IN_PROGRESS', 'OVERDUE', 'ESCALATED'], to: 'COMPLETED', actors: ['OWNER', 'MANAGER'], required: ['completionNote'], audit: 'completed' },
  { from: ['OPEN', 'IN_PROGRESS'], to: 'OVERDUE', actors: ['SYSTEM'], required: [], audit: 'overdue' },
  { from: ['OVERDUE'], to: 'ESCALATED', actors: ['SYSTEM'], required: [], audit: 'escalated' },
  { from: ['OPEN', 'OVERDUE'], to: 'CANCELLED', actors: ['OWNER', 'MANAGER'], required: ['reason'], audit: 'cancelled' },
];
export const WORK_TERMINAL: readonly WorkState[] = ['COMPLETED', 'CANCELLED'];

// ------------------------------------------------------------------ relationship escalation
export type EscalationState = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CANCELLED';
export const ESCALATION_RULES: readonly Rule<EscalationState>[] = [
  { from: ['OPEN'], to: 'IN_REVIEW', actors: ['TEAM_LEAD', 'MANAGER'], required: [], audit: 'escalation.updated' },
  { from: ['OPEN', 'IN_REVIEW'], to: 'RESOLVED', actors: ['TEAM_LEAD', 'MANAGER', 'OWNER'], required: ['resolution'], audit: 'escalation.resolved' },
  { from: ['OPEN', 'IN_REVIEW'], to: 'CANCELLED', actors: ['OWNER', 'MANAGER'], required: ['reason'], audit: 'escalation.cancelled' },
];
export const ESCALATION_TERMINAL: readonly EscalationState[] = ['RESOLVED', 'CANCELLED'];
