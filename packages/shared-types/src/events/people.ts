// Owned by the people agent. Event-type constants + payload interfaces for the people + SOP domains.

export const SOP_EVENTS = {
  VERSION_SUBMITTED: 'sop.version_submitted',
  VERSION_APPROVED: 'sop.version_approved',
  VERSION_REJECTED: 'sop.version_rejected',
  /** Published per user that still has to acknowledge (reminder fan-out is idempotent per user/version/day). */
  ACK_REMINDER: 'sop.acknowledgement_reminder',
} as const;

export interface SopAckReminderPayload {
  organizationId: string;
  versionId: string;
  documentId: string;
  documentTitle: string;
  userId: string;
}

export const PEOPLE_EVENTS = {
  PIP_CREATED: 'pip.created',
  PIP_SUBMITTED: 'pip.submitted',
  PIP_ACTIVATED: 'pip.activated',
  PIP_RETURNED: 'pip.returned',
  PIP_EXTENDED: 'pip.extended',
  PIP_COMPLETED: 'pip.completed',
  PIP_CANCELLED: 'pip.cancelled',
  PIP_ACK_REMINDER: 'pip.acknowledgement_reminder',
  INCENTIVE_CALCULATED: 'incentive.calculated',
  INCENTIVE_SUBMITTED: 'incentive.submitted',
  INCENTIVE_APPROVED: 'incentive.approved',
  INCENTIVE_REJECTED: 'incentive.rejected',
  INCENTIVE_RECALCULATED: 'incentive.recalculated',
  INCENTIVE_HELD: 'incentive.held',
  INCENTIVE_RELEASED: 'incentive.released',
  INCENTIVE_PAID: 'incentive.paid',
  INCENTIVE_CLAWBACK_PROPOSED: 'incentive.clawback_proposed',
  INCENTIVE_ADJUSTED: 'incentive.adjusted',
  INCENTIVE_WAIVED: 'incentive.waived',
  REVIEW_SUBMITTED: 'review.submitted_for_approval',
  REVIEW_APPROVED: 'review.approved',
  COACHING_ACTION_ASSIGNED: 'coaching.action_assigned',
  RESOURCE_ASSIGNED: 'resource.assigned',
  RECOGNITION_GRANTED: 'recognition.granted',
  PROBATION_DUE: 'probation.review_due',
} as const;

/**
 * CONTRACT for the revenue phase (Agent D / Phase 4). When a refund reaches PROCESSED the revenue module MUST publish
 * `refund.processed` through the outbox (aggregateType 'refund'). The people worker subscribes and PROPOSES a clawback
 * adjustment for any PAID incentive recommendation of `attributedUserId` whose paid_at is within the policy's
 * clawbackWindowDays of `processedAt`. Never auto-applied (DEC-015).
 */
export const REFUND_PROCESSED_EVENT = 'refund.processed';
export interface RefundProcessedPayload {
  refundId: string;
  organizationId: string;
  dealId: string | null;
  paymentId: string | null;
  /** Sales user credited for the original sale (the incentive earner). */
  attributedUserId: string | null;
  /** Refunded amount as a decimal string, e.g. "1500.00". */
  amount: string;
  currency: string;
  processedAt: string;
  /** Original payment collection time (ISO) when known. */
  paymentCollectedAt?: string | null;
}

export interface IncentiveStatusPayload {
  recommendationId: string;
  organizationId: string;
  employeeId: string;
  from: string | null;
  to: string;
  actorId: string | null;
}
export interface PipStatusPayload {
  pipId: string;
  organizationId: string;
  employeeId: string;
  from: string | null;
  to: string;
  actorId: string | null;
}
