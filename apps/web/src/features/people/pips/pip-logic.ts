import { z } from 'zod';

export type PipStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'EXTENDED' | 'COMPLETED_SUCCESS' | 'COMPLETED_NOT_IMPROVED' | 'CANCELLED';
export const PIP_STATUSES: PipStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXTENDED', 'COMPLETED_SUCCESS', 'COMPLETED_NOT_IMPROVED', 'CANCELLED'];
export const PIP_TERMINAL: PipStatus[] = ['COMPLETED_SUCCESS', 'COMPLETED_NOT_IMPROVED', 'CANCELLED'];
/** Main path shown in the stepper (EXTENDED is a sub-state of the active period; CANCELLED is off-path). */
export const PIP_STEPS = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED'] as const;

export function stepIndex(s: PipStatus): number {
  if (s === 'DRAFT') return 0;
  if (s === 'PENDING_APPROVAL') return 1;
  if (s === 'ACTIVE' || s === 'EXTENDED') return 2;
  if (s === 'COMPLETED_SUCCESS' || s === 'COMPLETED_NOT_IMPROVED') return 3;
  return -1;
}

export interface PipLike {
  status: PipStatus;
  employeeId: string;
  extensionCount: number;
  employeeAcknowledgedAt: string | null;
  goals: unknown;
  measures: unknown;
  checkpoints: unknown[];
}
export interface PipActor {
  meId: string | undefined;
  roles: readonly string[];
  can: (permission: string) => boolean;
}
export interface PipActions {
  editDraft: boolean;
  submit: boolean;
  /** Draft is complete enough to submit (goals, measures and >=1 checkpoint). */
  submitReady: boolean;
  requestExtension: boolean;
  completeSuccess: boolean;
  completeNotImproved: boolean;
  cancel: boolean;
  approveStart: boolean;
  returnToDraft: boolean;
  decideExtension: boolean;
  acknowledge: boolean;
  updateCheckpoints: boolean;
}

const hasAny = (roles: readonly string[], ...r: string[]) => r.some((x) => roles.includes(x));
const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0;

/**
 * PURE: which actions are offered for a PIP (docs/state-machines.md section 9). UI hiding only: the API re-checks
 * state, role, permission and scope. Nobody acts on their own plan except to acknowledge it.
 */
export function allowedPipActions(p: PipLike, a: PipActor): PipActions {
  const none: PipActions = { editDraft: false, submit: false, submitReady: false, requestExtension: false, completeSuccess: false, completeNotImproved: false, cancel: false, approveStart: false, returnToDraft: false, decideExtension: false, acknowledge: false, updateCheckpoints: false };
  const self = !!a.meId && p.employeeId === a.meId;
  const acknowledge = self && ['PENDING_APPROVAL', 'ACTIVE', 'EXTENDED'].includes(p.status) && !p.employeeAcknowledgedAt;
  if (self) return { ...none, acknowledge };
  const tlOrHr = hasAny(a.roles, 'SALES_TEAM_LEAD', 'HR');
  const approver = hasAny(a.roles, 'FOUNDER_CEO', 'HR') && a.can('pip:approve');
  const mayTransition = a.can('pip:update') || a.can('pip:approve');
  const s = p.status;
  return {
    editDraft: s === 'DRAFT' && a.can('pip:update'),
    submit: s === 'DRAFT' && tlOrHr && mayTransition,
    submitReady: nonEmpty(p.goals) && nonEmpty(p.measures) && p.checkpoints.length > 0,
    requestExtension: s === 'ACTIVE' && tlOrHr && mayTransition && p.extensionCount < 1,
    completeSuccess: s === 'ACTIVE' && tlOrHr && mayTransition,
    completeNotImproved: s === 'ACTIVE' && hasAny(a.roles, 'SALES_TEAM_LEAD', 'HR', 'FOUNDER_CEO') && mayTransition,
    cancel: (s === 'DRAFT' || s === 'ACTIVE') && hasAny(a.roles, 'FOUNDER_CEO', 'HR') && mayTransition,
    approveStart: s === 'PENDING_APPROVAL' && approver,
    returnToDraft: s === 'PENDING_APPROVAL' && approver,
    decideExtension: s === 'EXTENDED' && approver,
    acknowledge: false,
    updateCheckpoints: (s === 'ACTIVE' || s === 'EXTENDED') && a.can('pip:update'),
  };
}

// ----------------------------------------------------------------------------- transition forms
export type TransitionKind = 'PENDING_APPROVAL' | 'EXTENDED' | 'COMPLETED_SUCCESS' | 'COMPLETED_NOT_IMPROVED' | 'CANCELLED';
export interface TransitionValues {
  reason?: string;
  newEndDate?: string;
  finalReview?: string;
  evidence?: string;
  recommendedAction?: string;
}
const s = (min: number, max: number) => z.string({ error: 'required' }).trim().min(min, 'tooShort').max(max, 'tooLong');
const schemas = {
  PENDING_APPROVAL: z.object({}),
  EXTENDED: z.object({ reason: s(5, 2000), newEndDate: z.string({ error: 'required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'required') }),
  COMPLETED_SUCCESS: z.object({ finalReview: s(10, 8000), evidence: z.string().max(8000).optional() }),
  COMPLETED_NOT_IMPROVED: z.object({ finalReview: s(10, 8000), recommendedAction: s(5, 2000), evidence: z.string().max(8000).optional() }),
  CANCELLED: z.object({ reason: s(5, 2000) }),
} as const;

/** PURE: validate a transition form and build the POST /people/pips/:id/transition body. */
export function buildTransition(kind: TransitionKind, v: TransitionValues): { ok: true; body: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const r = schemas[kind].safeParse(v);
  if (!r.success) {
    const errors: Record<string, string> = {};
    for (const i of r.error.issues) errors[String(i.path[0] ?? '_')] = String(i.message);
    return { ok: false, errors };
  }
  const data = r.data as Record<string, string | undefined>;
  const body: Record<string, unknown> = { to: kind };
  for (const [k, val] of Object.entries(data)) if (val !== undefined && val !== '') body[k] = typeof val === 'string' ? val.trim() : val;
  return { ok: true, body };
}

export const slug = (name: string) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'kpi';
