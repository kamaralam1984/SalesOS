/**
 * Pure state machines (docs/state-machines.md sections 3, 4, 5). The services call these before touching the DB so the
 * rules live in one tested place. Authority (who may do it) is enforced by the services with the permission keys.
 */
export type DealStage = 'OPEN' | 'NEGOTIATION' | 'PAYMENT_PENDING' | 'WON' | 'LOST' | 'CANCELLED';
export const DEAL_TRANSITIONS: Readonly<Record<DealStage, readonly DealStage[]>> = {
  OPEN: ['NEGOTIATION', 'PAYMENT_PENDING', 'WON', 'LOST'],
  NEGOTIATION: ['PAYMENT_PENDING', 'WON', 'LOST'],
  PAYMENT_PENDING: ['WON', 'LOST'],
  WON: ['CANCELLED'],
  LOST: ['OPEN'],
  CANCELLED: [],
};
export const OPEN_DEAL_STAGES: readonly DealStage[] = ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING'];
export const canDealTransition = (from: DealStage, to: DealStage) => DEAL_TRANSITIONS[from].includes(to);

export type PaymentStatus = 'EXPECTED' | 'RECORDED' | 'VERIFIED' | 'REJECTED' | 'RECONCILED' | 'REVERSED';
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  EXPECTED: ['RECORDED'],
  RECORDED: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['RECONCILED', 'REVERSED'],
  REJECTED: ['RECORDED'],
  RECONCILED: [],
  REVERSED: [],
};
export const canPaymentTransition = (from: PaymentStatus, to: PaymentStatus) => PAYMENT_TRANSITIONS[from].includes(to);

export type RefundStatus = 'REQUESTED' | 'REVIEWED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'PROCESSED' | 'RECONCILED' | 'CANCELLED';
export const REFUND_TRANSITIONS: Readonly<Record<RefundStatus, readonly RefundStatus[]>> = {
  REQUESTED: ['REVIEWED', 'WITHDRAWN'],
  REVIEWED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSED', 'CANCELLED'],
  PROCESSED: ['RECONCILED'],
  REJECTED: [],
  WITHDRAWN: [],
  RECONCILED: [],
  CANCELLED: [],
};
export const canRefundTransition = (from: RefundStatus, to: RefundStatus) => REFUND_TRANSITIONS[from].includes(to);
export const REFUND_TERMINAL: readonly RefundStatus[] = ['REJECTED', 'WITHDRAWN', 'RECONCILED', 'CANCELLED'];

export type ProposalStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export const PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'WITHDRAWN'],
  APPROVED: [],
  REJECTED: [],
  WITHDRAWN: [],
};
export const canProposalTransition = (from: ProposalStatus, to: ProposalStatus) => PROPOSAL_TRANSITIONS[from].includes(to);

/** Hierarchy of the target breakdown: a child is exactly one level below its parent. */
export type TargetLevel = 'FOUNDER' | 'TEAM_LEAD' | 'MANAGER' | 'EXECUTIVE';
export const TARGET_LEVELS: readonly TargetLevel[] = ['FOUNDER', 'TEAM_LEAD', 'MANAGER', 'EXECUTIVE'];
export const LEVEL_ROLE: Readonly<Record<TargetLevel, string>> = { FOUNDER: 'FOUNDER_CEO', TEAM_LEAD: 'SALES_TEAM_LEAD', MANAGER: 'SALES_MANAGER', EXECUTIVE: 'SALES_EXECUTIVE' };
export const childLevel = (l: TargetLevel): TargetLevel | null => TARGET_LEVELS[TARGET_LEVELS.indexOf(l) + 1] ?? null;
/** DEC-002: Founder approves org/team-lead level targets; Team Lead (or Founder) approves manager/executive level. */
export const revisionApproverRoles = (l: TargetLevel): readonly string[] => (l === 'FOUNDER' || l === 'TEAM_LEAD' ? ['FOUNDER_CEO'] : ['FOUNDER_CEO', 'SALES_TEAM_LEAD']);
