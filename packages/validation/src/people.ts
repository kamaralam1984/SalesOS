import { z } from 'zod';
import { httpUrlSchema, paginationQuerySchema, uuidSchema } from './common';
import { isoDate } from './sop';

const iso = z.string().datetime({ offset: true });
const text = (max = 4000) => z.string().trim().max(max);

// ------------------------------------------------------------------ coaching
export const COACHING_TOPICS = [
  'CALL_QUALITY', 'OBJECTION_HANDLING', 'CONSULTATIVE_SELLING', 'CLOSING', 'NEGOTIATION',
  'PIPELINE_MANAGEMENT', 'FORECASTING', 'CRM_USAGE', 'LEADERSHIP', 'OTHER',
] as const;
export const coachingTopicSchema = z.enum(COACHING_TOPICS);

export const actionInputSchema = z.object({
  title: z.string().trim().min(3).max(300),
  ownerId: uuidSchema,
  dueDate: isoDate.optional(),
});
export const createCoachingSessionSchema = z.object({
  kind: z.enum(['COACHING', 'SCORECARD_REVIEW', 'CALL_REVIEW', 'ROLE_PLAY']).default('COACHING'),
  sessionDate: iso,
  durationMin: z.number().int().min(5).max(480),
  topics: z.array(coachingTopicSchema).min(1).max(6),
  participantIds: z.array(uuidSchema).min(1).max(20),
  notes: text(10000).optional(),
  noteVisibility: z.enum(['COACH_ONLY', 'PARTICIPANTS', 'MANAGEMENT']).default('PARTICIPANTS'),
  callRef: z.string().trim().max(120).optional(),
  actions: z.array(actionInputSchema).max(20).default([]),
});
export const updateCoachingSessionSchema = z.object({
  durationMin: z.number().int().min(5).max(480).optional(),
  topics: z.array(coachingTopicSchema).min(1).max(6).optional(),
  notes: text(10000).nullable().optional(),
  noteVisibility: z.enum(['COACH_ONLY', 'PARTICIPANTS', 'MANAGEMENT']).optional(),
  addActions: z.array(actionInputSchema).max(20).optional(),
  updateActions: z.array(z.object({ id: uuidSchema, status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(), dueDate: isoDate.nullable().optional(), title: z.string().trim().min(3).max(300).optional() })).max(30).optional(),
});
export const listCoachingQuerySchema = paginationQuerySchema.extend({
  from: iso.optional(), to: iso.optional(), coachId: uuidSchema.optional(), participantId: uuidSchema.optional(), topic: coachingTopicSchema.optional(),
});
export const coachingHoursQuerySchema = z.object({ from: iso, to: iso });

export const createOneOnOneSchema = z.object({
  employeeId: uuidSchema,
  status: z.enum(['SCHEDULED', 'HELD']).default('HELD'),
  scheduledFor: iso,
  durationMin: z.number().int().min(5).max(240).default(30),
  agenda: text(2000).optional(),
  sharedNotes: text(10000).optional(),
  privateNotes: text(10000).optional(),
  actions: z.array(actionInputSchema).max(20).default([]),
});
export const listOneOnOnesQuerySchema = paginationQuerySchema.extend({ employeeId: uuidSchema.optional(), status: z.enum(['SCHEDULED', 'HELD', 'CANCELLED']).optional() });
export const updateActionSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
  dueDate: isoDate.nullable().optional(),
  title: z.string().trim().min(3).max(300).optional(),
});
export const listActionsQuerySchema = paginationQuerySchema.extend({ ownerId: uuidSchema.optional(), status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional() });

// ------------------------------------------------------------------ KPI/KRA, scorecards, reviews
export const createKpiDefinitionSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{1,59}$/, 'lowercase key'),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['KPI', 'KRA']).default('KPI'),
  description: text(1000).optional(),
  unit: z.string().trim().max(30).optional(),
  dictionaryKey: z.string().trim().max(80).optional(),
  roleKeys: z.array(z.string().max(60)).max(12).default([]),
});
export const kpiItemSchema = z.object({
  definitionId: uuidSchema.optional(),
  key: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['KPI', 'KRA']).default('KPI'),
  target: z.number().finite().optional(),
  unit: z.string().trim().max(30).optional(),
  notes: text(500).optional(),
});
export const upsertKpiAssignmentSchema = z.object({
  assigneeId: uuidSchema,
  weekStart: isoDate,
  items: z.array(kpiItemSchema).min(1).max(30),
});
export const listKpiAssignmentsQuerySchema = paginationQuerySchema.extend({ assigneeId: uuidSchema.optional(), weekStart: isoDate.optional() });

export const scorecardInputSchema = z.object({
  key: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  target: z.number().finite().optional(),
  actual: z.number().finite().optional(),
  unit: z.string().trim().max(30).optional(),
  /** KPI dictionary id (e.g. KPI-PRD-006): the server fills `actual` from the KPI engine and marks the input PHASE5 unless it is typed in by hand. */
  dictionaryKey: z.string().trim().max(80).optional(),
  /** MANUAL = typed by the manager (kept as is); PHASE5 = computed by the KPI engine at save time. */
  source: z.enum(['MANUAL', 'PHASE5']).default('MANUAL'),
  /** why an auto value is missing (zero denominator, no data...), shown instead of a number */
  note: z.string().trim().max(200).optional(),
});
export const upsertScorecardSchema = z.object({
  subjectId: uuidSchema,
  periodType: z.enum(['WEEK', 'MONTH']).default('WEEK'),
  periodStart: isoDate,
  periodEnd: isoDate,
  inputs: z.array(scorecardInputSchema).min(1).max(40),
  comments: text(4000).optional(),
});
export const listScorecardsQuerySchema = paginationQuerySchema.extend({ subjectId: uuidSchema.optional(), periodType: z.enum(['WEEK', 'MONTH']).optional() });

export const competencyScoresSchema = z.record(z.string().max(60), z.number().int().min(1).max(5));
export const createReviewSchema = z.object({
  employeeId: uuidSchema,
  periodStart: isoDate,
  periodEnd: isoDate,
  kpiSummary: z.array(z.object({ key: z.string().max(60), name: z.string().max(120), target: z.number().optional(), actual: z.number().optional(), note: text(500).optional() })).max(40).default([]),
  competencyScores: competencyScoresSchema.default({}),
  rating: z.number().int().min(1).max(5).optional(),
  strengths: text().optional(),
  improvements: text().optional(),
  goals: text().optional(),
  actions: z.array(actionInputSchema).max(10).default([]),
});
export const updateReviewSchema = createReviewSchema.omit({ employeeId: true, periodStart: true, periodEnd: true, actions: true }).partial();
export const acknowledgeReviewSchema = z.object({ comment: text(2000).optional() });
export const listReviewsQuerySchema = paginationQuerySchema.extend({ employeeId: uuidSchema.optional(), status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'ACKNOWLEDGED']).optional() });

// ------------------------------------------------------------------ PIP
export const PIP_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXTENDED', 'COMPLETED_SUCCESS', 'COMPLETED_NOT_IMPROVED', 'CANCELLED'] as const;
const goalSchema = z.object({ title: z.string().trim().min(3).max(300), measure: text(300).optional() });
export const createPipSchema = z.object({
  employeeId: uuidSchema,
  reason: z.string().trim().min(10).max(4000),
  kpiGaps: z.array(z.object({ key: z.string().max(60), name: z.string().max(120), target: z.number().optional(), actual: z.number().optional() })).min(1).max(20),
  evidence: text(8000).optional(),
});
export const updatePipDraftSchema = z.object({
  reason: z.string().trim().min(10).max(4000).optional(),
  evidence: text(8000).optional(),
  goals: z.array(goalSchema).max(15).optional(),
  measures: z.array(z.string().trim().min(3).max(300)).max(15).optional(),
  durationDays: z.number().int().min(7).max(120).optional(),
  checkpoints: z.array(z.object({ dueDate: isoDate, title: z.string().trim().min(3).max(200) })).max(12).optional(),
});
export const pipTransitionSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('PENDING_APPROVAL') }),
  z.object({ to: z.literal('EXTENDED'), reason: z.string().trim().min(5).max(2000), newEndDate: isoDate }),
  z.object({ to: z.literal('COMPLETED_SUCCESS'), finalReview: z.string().trim().min(10).max(8000), evidence: text(8000).optional() }),
  z.object({ to: z.literal('COMPLETED_NOT_IMPROVED'), finalReview: z.string().trim().min(10).max(8000), evidence: text(8000).optional(), recommendedAction: z.string().trim().min(5).max(2000) }),
  z.object({ to: z.literal('CANCELLED'), reason: z.string().trim().min(5).max(2000) }),
]);
export const pipApproveSchema = z.object({
  decision: z.enum(['APPROVE', 'RETURN']).default('APPROVE'),
  startDate: isoDate.optional(),
  note: text(1000).optional(),
});
export const updateCheckpointSchema = z.object({ status: z.enum(['PENDING', 'DONE', 'MISSED']), notes: text(2000).optional() });
export const listPipsQuerySchema = paginationQuerySchema.extend({ employeeId: uuidSchema.optional(), status: z.enum(PIP_STATUSES).optional() });

// ------------------------------------------------------------------ recognition
export const createRecognitionProgramSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  name: z.string().trim().min(2).max(120),
  description: text(1000).optional(),
  kind: z.enum(['TOP_PERFORMER', 'CULTURE', 'MILESTONE', 'AWARD']).default('AWARD'),
  criteria: text(1000).optional(),
});
export const createRecognitionSchema = z.object({
  programId: uuidSchema,
  recipientId: uuidSchema,
  reason: z.string().trim().min(5).max(1000),
  periodLabel: z.string().trim().max(40).optional(),
  competencyKey: z.string().trim().max(60).optional(),
  isPublic: z.boolean().default(false),
});
export const listRecognitionsQuerySchema = paginationQuerySchema.extend({ recipientId: uuidSchema.optional(), wall: z.enum(['true', 'false']).optional() });

// ------------------------------------------------------------------ incentives
export const incentiveSlabSchema = z
  .object({
    minPct: z.number().min(0),
    maxPct: z.number().min(0).nullable().default(null),
    /** percent of the basis amount, e.g. 2.5 means 2.5% */
    ratePct: z.number().min(0).max(100).optional(),
    fixedAmount: z.number().min(0).optional(),
  })
  .refine((s) => (s.ratePct === undefined) !== (s.fixedAmount === undefined), { message: 'Provide exactly one of ratePct or fixedAmount' })
  .refine((s) => s.maxPct === null || s.maxPct > s.minPct, { message: 'maxPct must be greater than minPct' });
export const incentiveGateSchema = z.object({
  metric: z.string().trim().min(1).max(60),
  op: z.enum(['>=', '>', '<=', '<']),
  value: z.number().finite(),
  label: z.string().trim().max(120).optional(),
});
/**
 * Policy structure. Amounts/rates are NOT defaulted anywhere: the Founder supplies them (DEC-015). `slabs` may be empty
 * while the policy is DRAFT, but an APPROVED policy must have at least one slab.
 */
export const incentiveStructureSchema = z.object({
  basis: z.enum(['REVENUE', 'COLLECTION']),
  periodType: z.enum(['MONTH', 'QUARTER']).default('MONTH'),
  slabMode: z.enum(['FLAT_ON_TOTAL', 'MARGINAL']).default('FLAT_ON_TOTAL'),
  netOfRefunds: z.boolean().default(true),
  slabs: z.array(incentiveSlabSchema).max(20).default([]),
  gates: z.array(incentiveGateSchema).max(10).default([]),
  cap: z.number().min(0).nullable().default(null),
  clawbackWindowDays: z.number().int().min(0).max(365).default(30),
  currency: z.string().length(3).default('INR'),
});
export type IncentiveStructureInput = z.infer<typeof incentiveStructureSchema>;
export const createIncentivePolicySchema = z.object({
  name: z.string().trim().min(3).max(160),
  structure: incentiveStructureSchema,
  effectiveFrom: isoDate.optional(),
  notes: text(2000).optional(),
});
export const updateIncentivePolicySchema = createIncentivePolicySchema.partial();

export const incentiveInputsSchema = z.object({
  /** target for the period; achievement % = basisAmount / target */
  target: z.number().min(0),
  revenue: z.number().min(0).default(0),
  collections: z.number().min(0).default(0),
  refunds: z.number().min(0).default(0),
  metrics: z.record(z.string().max(60), z.number().finite()).default({}),
});
export const createIncentiveRecommendationSchema = z.object({
  employeeId: uuidSchema,
  periodStart: isoDate,
  periodEnd: isoDate,
  /** Optional: if omitted the registered InputProvider is asked; the default provider requires explicit inputs. */
  inputs: incentiveInputsSchema.optional(),
});
export const incentiveTransitionSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('SUBMITTED'), comments: text(2000).optional() }),
  z.object({ to: z.literal('CALCULATED'), reason: z.string().trim().min(5).max(1000), inputs: incentiveInputsSchema.optional() }),
  z.object({ to: z.literal('APPROVED'), approvedAmount: z.number().min(0).optional(), overrideReason: text(1000).optional() }),
  z.object({ to: z.literal('REJECTED'), reason: z.string().trim().min(5).max(1000) }),
  z.object({ to: z.literal('ON_HOLD'), reason: z.string().trim().min(5).max(1000) }),
  z.object({ to: z.literal('RELEASED') }),
  z.object({ to: z.literal('ADJUSTED'), adjustmentId: uuidSchema, decidedAmount: z.number().min(0), reason: text(1000).optional() }),
  z.object({ to: z.literal('WAIVED'), adjustmentId: uuidSchema, reason: z.string().trim().min(5).max(1000) }),
]);
export const markPaidSchema = z.object({ paidAt: iso.optional(), reference: z.string().trim().min(2).max(120) });
export const listIncentivesQuerySchema = paginationQuerySchema.extend({ employeeId: uuidSchema.optional(), status: z.string().optional() });

// ------------------------------------------------------------------ hiring / HR
export const upsertRoleProfileSchema = z.object({
  roleKey: z.string().trim().min(2).max(60),
  title: z.string().trim().min(2).max(160),
  minEducation: z.string().trim().max(200).optional(),
  preferredEducation: z.string().trim().max(200).optional(),
  minExperienceYears: z.number().int().min(0).max(50).optional(),
  maxExperienceYears: z.number().int().min(0).max(60).optional(),
  minTeamMgmtYears: z.number().int().min(0).max(50).optional(),
  preferredIndustries: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  requiredBackgrounds: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  additionalCriteria: z.array(z.string().trim().min(3).max(200)).max(20).default([]),
  competencyKeys: z.array(z.string().max(60)).max(20).default([]),
  notes: text(2000).optional(),
});
export const createRequisitionSchema = z.object({
  title: z.string().trim().min(3).max(160),
  roleKey: z.string().trim().min(2).max(60),
  profileId: uuidSchema.optional(),
  hiringManagerId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  headcount: z.number().int().min(1).max(50).default(1),
  targetDate: isoDate.optional(),
  notes: text(2000).optional(),
});
export const updateRequisitionSchema = z.object({
  status: z.enum(['OPEN', 'ON_HOLD', 'FILLED', 'CANCELLED']).optional(),
  headcount: z.number().int().min(1).max(50).optional(),
  targetDate: isoDate.nullable().optional(),
  notes: text(2000).nullable().optional(),
});
export const CANDIDATE_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'] as const;
export const createCandidateSchema = z.object({
  requisitionId: uuidSchema,
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  source: z.string().trim().max(80).optional(),
  educationLevel: z.string().trim().max(120).optional(),
  experienceYears: z.number().int().min(0).max(60).optional(),
  teamMgmtYears: z.number().int().min(0).max(50).optional(),
  industries: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  resumeFileId: uuidSchema.optional(),
});
export const moveCandidateSchema = z.object({ stage: z.enum(CANDIDATE_STAGES), reason: text(1000).optional() }).refine((v) => !['REJECTED', 'WITHDRAWN'].includes(v.stage) || !!v.reason, { message: 'A reason is required', path: ['reason'] });
export const createInterviewFeedbackSchema = z.object({
  interviewAt: iso,
  round: z.number().int().min(1).max(10).default(1),
  recommendation: z.enum(['STRONG_YES', 'YES', 'NO', 'STRONG_NO']),
  competencyScores: competencyScoresSchema.default({}),
  notes: text(8000).optional(),
});
export const listRequisitionsQuerySchema = paginationQuerySchema.extend({ status: z.enum(['OPEN', 'ON_HOLD', 'FILLED', 'CANCELLED']).optional() });
export const upsertEmployeeProfileSchema = z.object({
  employmentType: z.string().trim().max(40).default('FULL_TIME'),
  positionTitle: z.string().trim().max(160).optional(),
  joinDate: isoDate.optional(),
  probationEndDate: isoDate.nullable().optional(),
  exitDate: isoDate.nullable().optional(),
  exitType: z.enum(['VOLUNTARY', 'INVOLUNTARY', 'PROBATION_FAILURE', 'TRANSFER']).nullable().optional(),
  exitReason: text(2000).nullable().optional(),
  // workforce HR fields (DEC-048); validated strictly by hrProfilePatchSchema on /workforce/hr/profiles/:userId
  probationMonths: z.number().int().min(1).max(12).nullable().optional(),
  dateOfBirth: isoDate.nullable().optional(),
  shareBirthday: z.boolean().optional(),
  employeeCode: z.string().trim().min(1).max(40).nullable().optional(),
  workLocation: z.string().trim().min(1).max(120).nullable().optional(),
  hrContactId: uuidSchema.nullable().optional(),
});

// ------------------------------------------------------------------ onboarding, probation, succession
const checklistItemSchema = z.object({
  title: z.string().trim().min(3).max(200),
  category: z.enum(['ONBOARDING', 'TRAINING', 'TOOLS', 'CULTURE']).default('ONBOARDING'),
  dueDay: z.number().int().min(0).max(365).default(7),
  description: text(1000).optional(),
  resourceId: uuidSchema.optional(),
});
export const createOnboardingTemplateSchema = z.object({
  roleKey: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(160),
  items: z.array(checklistItemSchema).min(1).max(60),
  probationDays: z.array(z.number().int().min(7).max(365)).min(1).max(6).default([30, 60, 90]),
});
export const updateOnboardingTemplateSchema = createOnboardingTemplateSchema.partial().refine((v) => Object.keys(v).length > 0, 'nothing to change');
export const createOnboardingPlanSchema = z.object({
  employeeId: uuidSchema,
  templateId: uuidSchema,
  startDate: isoDate,
  scheduleProbation: z.boolean().default(true),
});
export const updateOnboardingItemSchema = z.object({ status: z.enum(['PENDING', 'DONE', 'SKIPPED']), notes: text(1000).optional() });
export const completeProbationReviewSchema = z.object({
  outcome: z.enum(['ON_TRACK', 'CONCERNS', 'CONFIRM', 'EXTEND', 'NOT_CONFIRMED']),
  competencyScores: competencyScoresSchema.default({}),
  notes: text(4000).optional(),
});
export const listOnboardingQuerySchema = paginationQuerySchema.extend({ employeeId: uuidSchema.optional(), status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional() });
export const createSuccessionPositionSchema = z.object({
  title: z.string().trim().min(3).max(160),
  roleKey: z.string().trim().min(2).max(60),
  incumbentId: uuidSchema.optional(),
  notes: text(2000).optional(),
});
export const upsertSuccessionCandidateSchema = z.object({
  positionId: uuidSchema,
  userId: uuidSchema,
  readiness: z.enum(['READY_NOW', 'READY_LATER']),
  developmentActions: z.array(z.object({ title: z.string().trim().min(3).max(200), dueDate: isoDate.optional(), status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).default('OPEN') })).max(15).default([]),
  notes: text(2000).optional(),
});
export const createExpectationSchema = z.object({
  roleKey: z.string().trim().min(2).max(60),
  kind: z.enum(['OWNERSHIP', 'ACCOUNTABILITY', 'CULTURE']),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(5).max(4000),
});

// ------------------------------------------------------------------ engagement
export const createSurveySchema = z.object({
  title: z.string().trim().min(3).max(160),
  questions: z.array(z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(3).max(300), type: z.enum(['SCALE_5', 'TEXT']) })).min(1).max(20),
  closesAt: iso.optional(),
});
export const submitSurveyResponseSchema = z.object({
  surveyId: uuidSchema,
  answers: z.record(z.string().max(40), z.union([z.number().int().min(1).max(5), z.string().max(2000)])),
});
export const engagementResultsQuerySchema = z.object({ surveyId: uuidSchema.optional() });

// ------------------------------------------------------------------ resources
export const RESOURCE_TYPES = ['ARTICLE', 'VIDEO', 'DOCUMENT', 'TEMPLATE', 'LINK', 'COURSE'] as const;
export const createResourceSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: text(2000).optional(),
  type: z.enum(RESOURCE_TYPES).default('ARTICLE'),
  url: httpUrlSchema.optional(),
  fileId: uuidSchema.optional(),
  skillTags: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
});
export const assignResourceSchema = z.object({ userIds: z.array(uuidSchema).min(1).max(50), dueDate: isoDate.optional() });
export const updateAssignmentSchema = z.object({ status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED']) });
export const listResourcesQuerySchema = paginationQuerySchema.extend({ tag: z.string().trim().max(40).optional(), q: z.string().trim().min(2).max(100).optional(), type: z.enum(RESOURCE_TYPES).optional() });
