import { z } from 'zod';
import { httpUrlSchema, paginationQuerySchema } from './common';

/** Money on the wire: a positive decimal with at most 2 fraction digits, as string (or integer/short number, converted via string). */
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const moneyStr = (what = 'amount') =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
    .refine((v) => MONEY_RE.test(v), { message: `${what} must be a decimal with at most 2 fraction digits` });
export const positiveMoney = (what = 'amount') => moneyStr(what).refine((v) => /[1-9]/.test(v), { message: `${what} must be greater than zero` }).transform((v) => (v.includes('.') ? v : `${v}.00`));
export const nonNegativeMoney = (what = 'amount') => moneyStr(what).transform((v) => (v.includes('.') ? v : `${v}.00`));
/** Signed delta for adjustments (never zero). */
const SIGNED_RE = /^-?\d{1,12}(\.\d{1,2})?$/;
export const signedMoney = (what = 'delta') =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
    .refine((v) => SIGNED_RE.test(v), { message: `${what} must be a decimal with at most 2 fraction digits` })
    .refine((v) => /[1-9]/.test(v), { message: `${what} must not be zero` });

export const inrCurrency = z.literal('INR').default('INR');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuid = z.string().uuid();
const text = (min = 1, max = 2000) => z.string().trim().min(min).max(max);

// ---- settings ----
export const patchRevenueSettingsSchema = z.object({
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  stageProbabilities: z.record(z.string().min(1).max(60), z.string().regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, 'Probability must be 0..1')).optional(),
  defaultHighValueThreshold: nonNegativeMoney('threshold').nullable().optional(),
  refundFounderThreshold: nonNegativeMoney('threshold').nullable().optional(),
  paymentTolerance: nonNegativeMoney('tolerance').optional(),
  defaultPaymentDueDays: z.number().int().min(0).max(365).optional(),
});
export const programThresholdSchema = z.object({ highValueThreshold: nonNegativeMoney('threshold').nullable() });

// ---- targets ----
export const targetPeriodTypeSchema = z.enum(['MONTH', 'QUARTER', 'YEAR']);
export const targetMetricSchema = z.enum(['REVENUE', 'COLLECTION', 'ENROLMENT']);
export const targetLevelSchema = z.enum(['FOUNDER', 'TEAM_LEAD', 'MANAGER', 'EXECUTIVE']);

export const createPeriodSchema = z.object({ type: targetPeriodTypeSchema, anchor: isoDate });
export const listPeriodsQuerySchema = z.object({ type: targetPeriodTypeSchema.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() });

export const createTargetSchema = z.object({
  periodId: uuid,
  metric: targetMetricSchema,
  level: targetLevelSchema,
  ownerUserId: uuid,
  parentId: uuid.optional(),
  /** For ENROLMENT this is a whole-number count. When `proration` is given it is the FULL-period base amount. */
  amount: nonNegativeMoney('target'),
  proration: z.object({ joinOn: isoDate.optional(), leaveOn: isoDate.optional() }).optional(),
  note: text(1, 1000).optional(),
});
export const reviseTargetSchema = z.object({
  newAmount: nonNegativeMoney('target'),
  reason: text(10, 1000),
  effectiveFrom: isoDate.optional(),
});
export const decideRevisionSchema = z.object({ revisionId: uuid, decision: z.enum(['approve', 'reject']), note: text(1, 1000).optional() });
export const listTargetsQuerySchema = paginationQuerySchema.extend({
  periodId: uuid.optional(),
  metric: targetMetricSchema.optional(),
  level: targetLevelSchema.optional(),
  ownerUserId: uuid.optional(),
  parentId: uuid.optional(),
  roots: z.coerce.boolean().optional(),
});
export const asOfQuerySchema = z.object({ asOf: isoDate.optional() });

// ---- deals ----
export const dealStageSchema = z.enum(['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING', 'WON', 'LOST', 'CANCELLED']);
export const dealTypeSchema = z.enum(['NEW', 'UPSELL', 'CROSS_SELL']);
export const createDealSchema = z
  .object({
    programId: uuid,
    amount: positiveMoney('deal amount'),
    currency: inrCurrency,
    dealType: dealTypeSchema.default('NEW'),
    fromProgramId: uuid.optional(),
    expectedCloseOn: isoDate.optional(),
    enrolments: z.number().int().min(1).max(1000).default(1),
    ownerId: uuid.optional(),
    note: text(1, 2000).optional(),
  })
  .refine((v) => v.dealType !== 'UPSELL' || !!v.fromProgramId, { message: 'An upsell needs the program the learner is moving from', path: ['fromProgramId'] });
export const updateDealSchema = z
  .object({
    amount: positiveMoney('deal amount').optional(),
    stage: z.enum(['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING']).optional(),
    expectedCloseOn: isoDate.nullable().optional(),
    note: text(1, 2000).nullable().optional(),
    reason: text(1, 500).optional(),
    version: z.number().int().min(1).optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version' && k !== 'reason'), { message: 'Nothing to update' });
export const listDealsQuerySchema = paginationQuerySchema.extend({
  stage: z.string().optional(),
  ownerId: uuid.optional(),
  teamId: uuid.optional(),
  programId: uuid.optional(),
  leadId: uuid.optional(),
  dealType: dealTypeSchema.optional(),
  highValue: z.enum(['true', 'false']).optional(),
  expectedFrom: isoDate.optional(),
  expectedTo: isoDate.optional(),
  closedFrom: isoDate.optional(),
  closedTo: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
});
export const paymentPlanItemSchema = z.object({ amount: positiveMoney('installment'), dueDate: isoDate });
export const closeDealSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('WON'),
    finalAmount: positiveMoney('final amount'),
    closedAt: z.string().datetime().optional(),
    paymentPlan: z.array(paymentPlanItemSchema).max(24).optional(),
    credits: z.array(z.object({ userId: uuid, sharePct: z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v), 'share must be a percentage') })).max(10).optional(),
    note: text(1, 1000).optional(),
  }),
  z.object({ outcome: z.literal('LOST'), lostReason: text(1, 80), lostNote: text(1, 1000).optional() }),
]);
export const escalateDealSchema = z.object({ note: text(3, 2000), requestedHelp: text(1, 1000).optional(), escalateToFounder: z.boolean().optional() });
export const resolveBlockerSchema = z.object({ resolution: text(3, 2000) });
export const reopenDealSchema = z.object({ reason: text(3, 500) });
export const adjustmentSchema = z.object({ kind: z.enum(['CORRECTION', 'DISCOUNT', 'CANCELLATION']).default('CORRECTION'), delta: signedMoney().optional(), reason: text(5, 1000) });
export const decideAdjustmentSchema = z.object({ decision: z.enum(['approve', 'reject']), note: text(1, 1000).optional() });

// ---- collections ----
export const paymentMethodSchema = z.enum(['UPI', 'BANK_TRANSFER', 'CARD', 'CASH', 'CHEQUE', 'GATEWAY', 'OTHER']);
export const paymentStatusSchema = z.enum(['EXPECTED', 'RECORDED', 'VERIFIED', 'REJECTED', 'RECONCILED', 'REVERSED']);
export const recordPaymentSchema = z.object({
  dealId: uuid,
  expectedPaymentId: uuid.optional(),
  amount: positiveMoney('payment amount'),
  currency: inrCurrency,
  method: paymentMethodSchema,
  provider: z.string().trim().min(1).max(40).default('MANUAL'),
  externalTransactionRef: z.string().trim().min(3).max(120),
  paidAt: z.string().datetime(),
  note: text(1, 500).optional(),
  proofFileId: uuid.optional(),
});
export const verifyPaymentSchema = z.object({ confirmedAmount: positiveMoney('confirmed amount').optional(), note: text(1, 500).optional() });
export const rejectPaymentSchema = z.object({ reason: text(3, 500) });
export const reversePaymentSchema = z.object({ reason: text(5, 500) });
export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  status: z.string().optional(),
  dealId: uuid.optional(),
  ownerId: uuid.optional(),
  teamId: uuid.optional(),
  programId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export const dailyCollectionsQuerySchema = z.object({ from: isoDate, to: isoDate });
export const reconcileRunSchema = z.object({
  statementRef: z.string().trim().min(2).max(120),
  lines: z.array(z.object({ externalTransactionRef: z.string().trim().min(1).max(120), amount: positiveMoney('statement amount'), provider: z.string().trim().min(1).max(40).optional() })).max(500).optional(),
  paymentIds: z.array(uuid).max(500).optional(),
}).refine((v) => (v.lines?.length ?? 0) + (v.paymentIds?.length ?? 0) > 0, { message: 'Provide statement lines or payment ids' });
export const reconciliationQuerySchema = paginationQuerySchema.extend({ view: z.enum(['unreconciled', 'deal-mismatch', 'duplicates']).default('unreconciled') });

// ---- refunds ----
export const refundStatusSchema = z.enum(['REQUESTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'PROCESSED', 'RECONCILED', 'CANCELLED']);
export const createRefundSchema = z.object({
  dealId: uuid,
  paymentId: uuid.optional(),
  amount: positiveMoney('refund amount'),
  reasonCategory: z.enum(['LEARNER_REQUEST', 'DUPLICATE_PAYMENT', 'PROGRAM_CANCELLED', 'MISSELLING', 'TECHNICAL', 'OTHER']),
  reason: text(5, 1000),
});
export const reviewRefundSchema = z.object({ note: text(3, 1000), recommendation: z.enum(['APPROVE', 'REJECT', 'PARTIAL']) });
export const approveRefundSchema = z.object({ approvedAmount: positiveMoney('approved amount').optional(), reason: text(3, 1000) });
export const rejectRefundSchema = z.object({ reason: text(3, 1000) });
export const processRefundSchema = z.object({ externalRef: z.string().trim().min(3).max(120), method: paymentMethodSchema, processedAt: z.string().datetime().optional() });
export const reconcileRefundSchema = z.object({ statementRef: z.string().trim().min(2).max(120) });
export const closeRefundSchema = z.object({ reason: text(3, 1000) });
export const listRefundsQuerySchema = paginationQuerySchema.extend({ status: z.string().optional(), dealId: uuid.optional(), ownerId: uuid.optional() });

// ---- forecasts ----
export const createForecastSchema = z.object({ periodType: z.enum(['WEEK', 'MONTH']), anchor: isoDate.optional(), kind: z.enum(['PERIOD_START', 'ADHOC']).default('ADHOC') });
export const previewForecastQuerySchema = z.object({ periodType: z.enum(['WEEK', 'MONTH']), anchor: isoDate.optional() });
export const listForecastsQuerySchema = paginationQuerySchema.extend({ periodType: z.enum(['WEEK', 'MONTH']).optional() });

// ---- pricing ----
export const proposalTypeSchema = z.enum(['PRICE_CHANGE', 'OFFER', 'DISCOUNT', 'BUNDLE']);
export const createProposalSchema = z
  .object({
    type: proposalTypeSchema,
    programId: uuid.optional(),
    title: text(3, 200),
    rationale: text(10, 4000),
    proposedAmount: positiveMoney('proposed price').optional(),
    effectiveFrom: z.string().datetime().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    submit: z.boolean().default(false),
  })
  .refine((v) => v.type !== 'PRICE_CHANGE' || (!!v.programId && !!v.proposedAmount), { message: 'A price change needs a program and proposed price', path: ['proposedAmount'] });
export const decideProposalSchema = z.object({ decision: z.enum(['approve', 'reject']), note: text(1, 1000).optional() });
export const withdrawProposalSchema = z.object({ note: text(1, 1000).optional() });
export const listProposalsQuerySchema = paginationQuerySchema.extend({ status: z.string().optional(), programId: uuid.optional() });

// ---- market intel ----
export const feedbackKindSchema = z.enum(['MARKET', 'COMPETITOR', 'LEARNER']);
export const createFeedbackSchema = z.object({
  kind: feedbackKindSchema,
  category: text(2, 60),
  source: text(1, 120).optional(),
  title: text(3, 200),
  notes: text(3, 4000),
  competitor: text(1, 120).optional(),
  evidenceUrl: httpUrlSchema.optional(),
  programId: uuid.optional(),
  leadId: uuid.optional(),
});
export const updateFeedbackSchema = z.object({ status: z.enum(['NEW', 'REVIEWED', 'ACTIONED', 'DISMISSED']).optional(), proposalId: uuid.nullable().optional() }).refine((v) => v.status !== undefined || v.proposalId !== undefined, { message: 'Nothing to update' });
export const listFeedbackQuerySchema = paginationQuerySchema.extend({ kind: feedbackKindSchema.optional(), status: z.string().optional(), programId: uuid.optional() });
export const createGrowthSchema = z.object({
  type: z.enum(['CHANNEL', 'SEGMENT', 'OTHER']),
  title: text(3, 200),
  description: text(3, 4000),
  estimatedValue: nonNegativeMoney('estimate').optional(),
  ownerId: uuid.optional(),
});
export const updateGrowthSchema = z.object({ status: z.enum(['IDEA', 'EVALUATING', 'PILOT', 'ADOPTED', 'DROPPED']).optional(), estimatedValue: nonNegativeMoney('estimate').nullable().optional(), description: text(3, 4000).optional(), ownerId: uuid.optional() }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export const listGrowthQuerySchema = paginationQuerySchema.extend({ status: z.string().optional(), type: z.enum(['CHANNEL', 'SEGMENT', 'OTHER']).optional() });

// ---- strategy ----
export const createPlanSchema = z.object({ title: text(3, 200), summary: text(3, 4000), periodId: uuid.optional(), status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']).default('DRAFT') });
export const updatePlanSchema = z.object({ title: text(3, 200).optional(), summary: text(3, 4000).optional(), status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']).optional() }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export const createInitiativeSchema = z.object({ title: text(3, 200), notes: text(1, 2000).optional(), ownerId: uuid.optional(), dueOn: isoDate.optional() });
export const updateInitiativeSchema = z.object({ status: z.enum(['PLANNED', 'IN_PROGRESS', 'DONE', 'DROPPED']).optional(), notes: text(1, 2000).optional(), dueOn: isoDate.nullable().optional() }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export const forecastAccuracyQuerySchema = z.object({ periodType: z.enum(['WEEK', 'MONTH']).default('MONTH'), last: z.coerce.number().int().min(1).max(24).default(6) });
