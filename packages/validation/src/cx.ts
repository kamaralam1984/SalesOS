import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

/** Phase 7 (CX, handover, collaboration, Founder reporting). Vocabularies mirror @salesos/cx-core (asserted by a test). */
export const CX_COMPLAINT_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export const CX_COMPLAINT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED'] as const;
export const CX_COMPLAINT_CATEGORIES = ['PAYMENT_BILLING', 'PROGRAM_CONTENT', 'DELIVERY_ACCESS', 'SALES_CONDUCT', 'REFUND', 'SUPPORT_RESPONSE', 'TECHNICAL', 'OTHER'] as const;
export const CX_ROOT_CAUSES = ['EXPECTATION_MISMATCH', 'MISLEADING_PROMISE', 'PRODUCT_FIT', 'PRICING_PAYMENT', 'DELIVERY_DELAY', 'SUPPORT_QUALITY', 'TECHNICAL_ISSUE', 'PERSONAL_CIRCUMSTANCES', 'PROCESS_GAP', 'OTHER'] as const;
export const CX_LANGUAGES = ['EN', 'HI', 'MR'] as const;
export const CX_DEPARTMENTS = ['FOUNDER', 'SALES', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'] as const;
export const CX_WORK_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'ESCALATED', 'CANCELLED'] as const;
export const CX_HANDOVER_STATUSES = ['DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'ACKNOWLEDGED', 'OVERDUE', 'COMPLETED'] as const;
export const CX_SURVEY_KINDS = ['CSAT', 'NPS', 'ENROLMENT_EXPERIENCE'] as const;
export const CX_QUESTION_TYPES = ['RATING_1_5', 'NPS_0_10', 'TEXT', 'YES_NO'] as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optText = (max: number) => z.string().trim().max(max).optional();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoDateTime = z.string().datetime({ offset: true });
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

// ------------------------------------------------------------------ complaints & escalations
export const createComplaintSchema = z.object({
  leadId: uuidSchema.optional(),
  dealId: uuidSchema.optional(),
  refundId: uuidSchema.optional(),
  title: text(3, 200),
  description: text(3, 5000),
  category: z.enum(CX_COMPLAINT_CATEGORIES),
  priority: z.enum(CX_COMPLAINT_PRIORITIES),
  ownerId: uuidSchema.optional(),
});

export const listComplaintsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CX_COMPLAINT_STATUSES).optional(),
  priority: z.enum(CX_COMPLAINT_PRIORITIES).optional(),
  category: z.enum(CX_COMPLAINT_CATEGORIES).optional(),
  ownerId: uuidSchema.optional(),
  leadId: uuidSchema.optional(),
  open: bool.optional(),
  breached: bool.optional(),
  q: z.string().trim().max(100).optional(),
});

export const complaintTransitionSchema = z.object({
  to: z.enum(CX_COMPLAINT_STATUSES),
  note: optText(2000),
  reason: optText(2000),
  escalatedToId: uuidSchema.optional(),
  resolution: optText(5000),
  rootCauseCategory: z.enum(CX_ROOT_CAUSES).optional(),
  refundId: uuidSchema.optional(),
  /** OPEN -> CLOSED as invalid/duplicate */
  invalid: z.boolean().optional(),
});

export const complaintTrendsQuerySchema = z.object({
  from: isoDay.optional(),
  to: isoDay.optional(),
  bucket: z.enum(['week', 'month']).default('month'),
});

export const createEscalationSchema = z.object({
  leadId: uuidSchema,
  type: z.enum(['HIGH_VALUE', 'COMPLEX_CONVERSATION']),
  title: text(3, 200),
  context: text(3, 5000),
  blocker: optText(2000),
  requestedHelp: optText(2000),
  ownerId: uuidSchema.optional(),
  involveFounder: z.boolean().optional(),
});
export const listEscalationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'CANCELLED']).optional(),
  type: z.enum(['HIGH_VALUE', 'COMPLEX_CONVERSATION']).optional(),
  leadId: uuidSchema.optional(),
});
export const escalationTransitionSchema = z.object({
  to: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'CANCELLED']),
  note: optText(2000),
  reason: optText(2000),
  resolution: optText(5000),
  involveFounder: z.boolean().optional(),
  teamLeadId: uuidSchema.optional(),
});

export const setLearnerEarningsSchema = z.object({ earnedRevenue: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter a rupee amount like 125000 or 125000.50'), note: z.string().trim().max(500).optional() }).strict();
export const createRelationshipNoteSchema = z.object({ kind: z.enum(['NOTE', 'PROMISE', 'PREFERENCE', 'MILESTONE']).default('NOTE'), body: text(1, 4000) });
export const watchProspectSchema = z.object({ leadId: uuidSchema, reason: optText(500) });
export const listWatchlistQuerySchema = paginationQuerySchema;

// ------------------------------------------------------------------ satisfaction
export const surveyQuestionSchema = z.object({
  id: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i),
  text: text(3, 300),
  type: z.enum(CX_QUESTION_TYPES),
  required: z.boolean().default(true),
});
export const createSurveyTemplateSchema = z.object({
  key: z.string().trim().min(2).max(60).regex(/^[a-z0-9_-]+$/i),
  name: text(3, 120),
  kind: z.enum(CX_SURVEY_KINDS),
  questions: z.array(surveyQuestionSchema).min(1).max(20),
});
export const updateSurveyTemplateSchema = z.object({
  name: text(3, 120).optional(),
  questions: z.array(surveyQuestionSchema).min(1).max(20).optional(),
  isActive: z.boolean().optional(),
});
export const surveyAnswerSchema = z.object({ questionId: z.string().min(1).max(40), value: z.union([z.number(), z.string().max(2000), z.boolean()]) });
export const createSatisfactionSchema = z.object({
  templateId: uuidSchema.optional(),
  kind: z.enum(CX_SURVEY_KINDS).optional(),
  leadId: uuidSchema.optional(),
  respondentRef: optText(120),
  respondentName: optText(120),
  dealId: uuidSchema.optional(),
  complaintId: uuidSchema.optional(),
  handoverId: uuidSchema.optional(),
  programId: uuidSchema.optional(),
  /** headline score; for template-based capture the server derives it from the answers when omitted */
  score: z.number().int().min(0).max(10).optional(),
  answers: z.array(surveyAnswerSchema).max(30).default([]),
  comment: optText(3000),
  /** DPDP: the respondent must have consented to the response being stored */
  consentGiven: z.literal(true, { errorMap: () => ({ message: 'Respondent consent is required' }) }),
  respondedAt: isoDateTime.optional(),
  channel: z.enum(['MANUAL', 'PHONE', 'WHATSAPP', 'EMAIL', 'IN_PERSON']).default('MANUAL'),
});
export const listSatisfactionQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(CX_SURVEY_KINDS).optional(),
  leadId: uuidSchema.optional(),
  programId: uuidSchema.optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
});
export const satisfactionStatsQuerySchema = z.object({
  kind: z.enum(CX_SURVEY_KINDS).optional(),
  programId: uuidSchema.optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  bucket: z.enum(['week', 'month']).default('month'),
});

// ------------------------------------------------------------------ refunds view (links to the revenue domain)
export const listRefundsViewQuerySchema = paginationQuerySchema.extend({ status: z.string().max(40).optional(), dealId: uuidSchema.optional() });
export const tagRefundRootCauseSchema = z.object({ category: z.enum(CX_ROOT_CAUSES), note: optText(2000), complaintId: uuidSchema.optional() });
export const refundAnalyticsQuerySchema = z.object({ from: isoDay.optional(), to: isoDay.optional(), programId: uuidSchema.optional() });

// ------------------------------------------------------------------ handover
const consentsSchema = z.object({ dataSharing: z.boolean(), contact: z.boolean().optional(), marketing: z.boolean().optional() });
const handoverFields = {
  learnerName: optText(200),
  learnerContact: optText(200),
  languagePreference: z.enum(CX_LANGUAGES).optional(),
  programId: uuidSchema.optional(),
  programName: optText(200),
  amountPaid: z.coerce.number().min(0).max(1_000_000_000).optional(),
  amountDue: z.coerce.number().min(0).max(1_000_000_000).optional(),
  currency: z.string().length(3).optional(),
  paymentVerified: z.boolean().optional(),
  promisesMade: optText(4000),
  goals: optText(4000),
  objections: optText(4000),
  specialNotes: optText(4000),
  consents: consentsSchema.optional(),
  attachmentFileIds: z.array(uuidSchema).max(10).optional(),
};
export const createHandoverSchema = z.object({
  dealId: uuidSchema.optional(),
  leadId: uuidSchema.optional(),
  ownerId: uuidSchema.optional(),
  ...handoverFields,
}).refine((v) => v.dealId || v.leadId, { message: 'dealId or leadId is required' });
export const updateHandoverSchema = z.object({ ...handoverFields });
export const listHandoversQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CX_HANDOVER_STATUSES).optional(),
  ownerId: uuidSchema.optional(),
  pending: bool.optional(),
});
export const acknowledgeHandoverSchema = z.object({ receivingOwnerId: uuidSchema.optional(), note: optText(2000) });
export const requestHandoverInfoSchema = z.object({ questions: text(3, 4000) });
export const completeHandoverSchema = z.object({ note: text(3, 4000) });

// ------------------------------------------------------------------ cross-functional collaboration
export const createXfTaskSchema = z.object({
  title: text(3, 200),
  description: optText(4000),
  kind: z.enum(['TASK', 'HANDOFF', 'CAMPAIGN_ALIGNMENT', 'WEBINAR_PLANNING', 'INSIGHT_REQUEST']).default('TASK'),
  department: z.enum(CX_DEPARTMENTS),
  ownerId: uuidSchema.optional(),
  dueAt: isoDateTime,
  priority: z.number().int().min(1).max(4).default(3),
  programId: uuidSchema.optional(),
  eventId: uuidSchema.optional(),
  campaignId: uuidSchema.optional(),
  planLinkId: uuidSchema.optional(),
  dependsOnIds: z.array(uuidSchema).max(10).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const updateXfTaskSchema = z.object({
  title: text(3, 200).optional(),
  description: optText(4000),
  dueAt: isoDateTime.optional(),
  ownerId: uuidSchema.optional(),
  priority: z.number().int().min(1).max(4).optional(),
  /** status change goes through the state machine */
  status: z.enum(CX_WORK_STATUSES).optional(),
  completionNote: optText(4000),
  cancelReason: optText(2000),
  evidenceFileIds: z.array(uuidSchema).max(20).optional(),
});
export const listXfTasksQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CX_WORK_STATUSES).optional(),
  department: z.enum(CX_DEPARTMENTS).optional(),
  ownerId: uuidSchema.optional(),
  mine: bool.optional(),
  open: bool.optional(),
});
export const xfCommentSchema = z.object({ body: text(1, 4000) });
export const xfDependencySchema = z.object({ dependsOnId: uuidSchema });
export const createPlanLinkSchema = z.object({
  kind: z.enum(['CAMPAIGN', 'WEBINAR', 'EVENT', 'LEAD_GEN']),
  title: text(3, 200),
  programId: uuidSchema.optional(),
  eventId: uuidSchema.optional(),
  campaignId: uuidSchema.optional(),
  sourceId: uuidSchema.optional(),
  windowStart: isoDateTime,
  windowEnd: isoDateTime,
  plannedLeads: z.number().int().min(0).max(10_000_000).optional(),
  salesPlanNote: optText(4000),
  ownerId: uuidSchema.optional(),
});
export const listPlanLinksQuerySchema = paginationQuerySchema.extend({ kind: z.enum(['CAMPAIGN', 'WEBINAR', 'EVENT', 'LEAD_GEN']).optional() });
export const createInsightSchema = z.object({
  kind: z.enum(['LEARNER', 'MARKET', 'OBJECTION', 'COMPETITOR']).default('LEARNER'),
  title: text(3, 200),
  body: text(3, 5000),
  programId: uuidSchema.optional(),
  tags: z.array(text(1, 40)).max(10).default([]),
  audience: z.array(z.enum(CX_DEPARTMENTS)).max(6).default([]),
});
export const listInsightsQuerySchema = paginationQuerySchema.extend({ kind: z.enum(['LEARNER', 'MARKET', 'OBJECTION', 'COMPETITOR']).optional() });

// ------------------------------------------------------------------ Founder reporting
const reportItem = z.object({ title: text(1, 200), description: optText(2000) });
export const reportRiskSchema = z.object({ title: text(1, 200), description: optText(3000), severity: z.number().int().min(1).max(4).optional(), proposedSolution: optText(3000), riskId: uuidSchema.optional() });
export const reportSectionsSchema = z.object({
  performance: z.object({ narrative: optText(10_000), highlights: z.array(text(1, 500)).max(20).optional() }).optional(),
  risks: z.object({ items: z.array(reportRiskSchema).max(30).optional(), noneConfirmed: z.boolean().optional() }).optional(),
  opportunities: z.object({ items: z.array(reportItem).max(30).optional(), noneConfirmed: z.boolean().optional() }).optional(),
  solutions: z.object({ items: z.array(reportItem).max(30).optional() }).optional(),
  actionItems: z.object({ reviewed: z.boolean().optional() }).optional(),
});
export const createFounderReportSchema = z.object({
  type: z.enum(['WEEKLY', 'MONTHLY']),
  /** any date inside the period to report on; defaults to the most recent completed period */
  periodDate: isoDay.optional(),
  title: text(3, 200).optional(),
  sections: reportSectionsSchema.optional(),
});
export const updateFounderReportSchema = z.object({ title: text(3, 200).optional(), sections: reportSectionsSchema.optional(), version: z.number().int().optional() });
export const reviewFounderReportSchema = z.object({ rating: z.number().int().min(1).max(5).optional(), note: optText(3000) });
export const listFounderReportsQuerySchema = paginationQuerySchema.extend({ type: z.enum(['WEEKLY', 'MONTHLY']).optional(), status: z.enum(['DRAFT', 'PUBLISHED']).optional() });

export const createRiskSchema = z.object({
  title: text(3, 200),
  description: text(3, 4000),
  severity: z.number().int().min(1).max(4).default(2),
  proposedSolution: optText(3000),
  earlyWarning: z.boolean().default(false),
  ownerId: uuidSchema.optional(),
});
export const updateRiskSchema = z.object({
  title: text(3, 200).optional(),
  description: text(3, 4000).optional(),
  severity: z.number().int().min(1).max(4).optional(),
  proposedSolution: optText(3000),
  earlyWarning: z.boolean().optional(),
  status: z.enum(['OPEN', 'MITIGATING', 'RESOLVED', 'ACCEPTED']).optional(),
  resolutionNote: optText(3000),
  ownerId: uuidSchema.optional(),
});
export const listRisksQuerySchema = paginationQuerySchema.extend({ status: z.enum(['OPEN', 'MITIGATING', 'RESOLVED', 'ACCEPTED']).optional() });

export const createActionItemSchema = z.object({
  title: text(3, 200),
  description: optText(4000),
  ownerId: uuidSchema,
  dueAt: isoDateTime,
  reportId: uuidSchema.optional(),
  source: z.enum(['REVIEW', 'FOUNDER_REPORT', 'MANUAL']).default('MANUAL'),
});
export const updateActionItemSchema = z.object({
  title: text(3, 200).optional(),
  description: optText(4000),
  dueAt: isoDateTime.optional(),
  ownerId: uuidSchema.optional(),
  status: z.enum(CX_WORK_STATUSES).optional(),
  completionNote: optText(4000),
  evidence: optText(4000),
  evidenceFileIds: z.array(uuidSchema).max(20).optional(),
  cancelReason: optText(2000),
});
export const listActionItemsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CX_WORK_STATUSES).optional(),
  ownerId: uuidSchema.optional(),
  mine: bool.optional(),
  open: bool.optional(),
  reportId: uuidSchema.optional(),
});
export const metricsQuerySchema = z.object({ from: isoDay.optional(), to: isoDay.optional() });
