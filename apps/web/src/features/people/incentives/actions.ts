import type { IncentiveStatus } from './api';

export type IncentiveAction = 'submit' | 'recalculate' | 'approve' | 'reject' | 'hold' | 'release' | 'markPaid' | 'adjust' | 'waive';

export interface ActionPerms {
  /** incentives:recommendation:create */
  create: boolean;
  /** incentives:recommendation:approve */
  approve: boolean;
  /** incentives:recommendation:mark-paid */
  markPaid: boolean;
}
export interface ActionContext {
  /** the signed-in user is the recommender (segregation of duties) */
  isRecommender: boolean;
  /** the signed-in user is the employee the incentive is for */
  isEmployee: boolean;
  /** there is at least one PROPOSED clawback adjustment */
  hasOpenProposal: boolean;
}

/**
 * Which actions the UI offers. Mirrors docs/state-machines.md section 10 and the server rules; the server is the authority.
 * PAID -> CLAWBACK_PROPOSED is system-only and never offered.
 */
export function allowedIncentiveActions(status: IncentiveStatus, perms: ActionPerms, ctx: ActionContext): IncentiveAction[] {
  if (ctx.isEmployee) return [];
  const finOrFounder = perms.approve || perms.markPaid;
  const out: IncentiveAction[] = [];
  switch (status) {
    case 'CALCULATED':
      if (perms.create) out.push('submit');
      break;
    case 'SUBMITTED':
      if (perms.create) out.push('recalculate');
      if (perms.approve && !ctx.isRecommender) out.push('approve', 'reject');
      break;
    case 'APPROVED':
      if (perms.markPaid) out.push('markPaid');
      if (finOrFounder) out.push('hold');
      break;
    case 'ON_HOLD':
      if (finOrFounder) out.push('release');
      break;
    case 'CLAWBACK_PROPOSED':
      if (finOrFounder && ctx.hasOpenProposal) out.push('adjust', 'waive');
      break;
    default:
      break;
  }
  return out;
}

/** Happy-path stepper order (REJECTED / ON_HOLD / clawback branches are shown as notes on the current step). */
export const INCENTIVE_STEPS: IncentiveStatus[] = ['CALCULATED', 'SUBMITTED', 'APPROVED', 'PAID'];

export function stepIndex(status: IncentiveStatus): number {
  switch (status) {
    case 'CALCULATED': return 0;
    case 'SUBMITTED': return 1;
    case 'REJECTED': return 1;
    case 'APPROVED': case 'ON_HOLD': return 2;
    default: return 3;
  }
}
