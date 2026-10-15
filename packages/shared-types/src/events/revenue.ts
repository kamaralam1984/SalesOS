// Owned by the revenue agent (Agent G). Event-type constants + payload contracts published through the transactional outbox.
// Consumers: Agent E (incentive clawback) subscribes to refund.approved / refund.processed; Phase 5 reads payment.verified etc.
// ALL money fields are 2-dp decimal STRINGS (never JSON numbers). Timestamps are ISO-8601 UTC.

export const REVENUE_EVENTS = {
  DEAL_CREATED: 'deal.created',
  DEAL_STATUS_CHANGED: 'deal.status_changed',
  DEAL_CLOSED: 'deal.closed',
  DEAL_ESCALATED: 'deal.escalated',
  DEAL_HIGH_VALUE: 'deal.high_value_flagged',
  DEAL_CANCELLED: 'deal.cancelled',
  DEAL_REOPENED: 'deal.reopened',
  SALE_ADJUSTED: 'sale.adjusted',
  PAYMENT_EXPECTED: 'payment.expected',
  PAYMENT_RECORDED: 'payment.recorded',
  PAYMENT_VERIFIED: 'payment.verified',
  PAYMENT_REJECTED: 'payment.rejected',
  PAYMENT_RECONCILED: 'payment.reconciled',
  PAYMENT_REVERSED: 'payment.reversed',
  REFUND_REQUESTED: 'refund.requested',
  REFUND_REVIEWED: 'refund.reviewed',
  REFUND_APPROVED: 'refund.approved',
  REFUND_REJECTED: 'refund.rejected',
  REFUND_WITHDRAWN: 'refund.withdrawn',
  REFUND_PROCESSED: 'refund.processed',
  REFUND_RECONCILED: 'refund.reconciled',
  REFUND_CANCELLED: 'refund.cancelled',
  TARGET_REVISION_PROPOSED: 'target.revision_proposed',
  TARGET_REVISION_DECIDED: 'target.revision_decided',
  FORECAST_SNAPSHOT_TAKEN: 'forecast.snapshot_taken',
  PROPOSAL_SUBMITTED: 'proposal.submitted',
  PROPOSAL_DECIDED: 'proposal.decided',
} as const;
export type RevenueEventType = (typeof REVENUE_EVENTS)[keyof typeof REVENUE_EVENTS];

export interface CreditedOwner {
  userId: string;
  /** percentage with up to 2 decimals as a string, e.g. "100.00" */
  sharePct: string;
}

export interface DealClosedPayload {
  dealId: string;
  leadId: string;
  programId: string;
  outcome: 'WON' | 'LOST';
  ownerId: string;
  /** WON only */
  saleValue: string | null;
  currency: string;
  closedAt: string;
  dealType: 'NEW' | 'UPSELL' | 'CROSS_SELL';
  creditedOwners: CreditedOwner[];
  lostReason: string | null;
}

export interface DealEscalatedPayload {
  dealId: string;
  blockerId: string;
  kind: 'BLOCKER' | 'HIGH_VALUE';
  amount: string;
  currency: string;
  escalationLevel: number;
  notifiedUserIds: string[];
}

/**
 * Published when Founder/Finance APPROVES a refund (an incentive clawback may be PROPOSED, never auto-applied; DEC-015).
 * creditedOwners are the sale's DEC-005 credit split at close time.
 */
export interface RevenueRefundApprovedPayload {
  refundId: string;
  organizationId: string;
  dealId: string;
  paymentId: string | null;
  leadId: string;
  programId: string;
  currency: string;
  requestedAmount: string;
  /** approved refund amount (2-dp decimal string) */
  amount: string;
  approvedAmount: string;
  requestedById: string;
  approvedById: string;
  approvedByRole: string | null;
  approvedAt: string;
  saleClosedAt: string | null;
  attributedUserId: string | null;
  creditedOwners: CreditedOwner[];
}

/**
 * CONTRACT with Agent E (people/incentives): a superset of people's `RefundProcessedPayload` (events/people.ts) so their
 * `refund.processed` subscriber works unchanged. `amount` = processed amount; `attributedUserId` = the credited owner with the
 * largest share (ties: the deal owner); the full split is in `creditedOwners`. Published when Finance marks PROCESSED.
 */
export interface RevenueRefundProcessedPayload {
  refundId: string;
  organizationId: string;
  dealId: string | null;
  paymentId: string | null;
  attributedUserId: string | null;
  /** processed refund amount, 2-dp decimal string */
  amount: string;
  currency: string;
  processedAt: string;
  /** when the (verified) payment being refunded was collected, if the refund is tied to one payment */
  paymentCollectedAt: string | null;
  leadId: string;
  programId: string;
  approvedAmount: string;
  processedById: string;
  processedByRole: string | null;
  externalRef: string;
  saleClosedAt: string | null;
  creditedOwners: CreditedOwner[];
}

export interface RefundStatusPayload {
  refundId: string;
  dealId: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string;
  actorRole: string | null;
  amount: string;
  currency: string;
  reason: string | null;
}

export interface PaymentEventPayload {
  paymentId: string;
  dealId: string;
  status: string;
  amount: string;
  currency: string;
  ownerId: string;
  actorId: string | null;
  externalTransactionRef: string | null;
  provider: string;
  creditedOwners: CreditedOwner[];
  at: string;
}

export interface ForecastSnapshotPayload {
  forecastId: string;
  snapshotId: string;
  periodType: 'WEEK' | 'MONTH';
  periodStart: string;
  periodEnd: string;
  total: string;
  currency: string;
  isEstimate: true;
}
