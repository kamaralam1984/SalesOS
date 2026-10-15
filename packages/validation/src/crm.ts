import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

export const interestLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const consentStatusSchema = z.enum(['UNKNOWN', 'GRANTED', 'WITHDRAWN', 'DND']);
export const taskTypeSchema = z.enum(['CALL', 'CALLBACK', 'FOLLOW_UP', 'DEMO', 'EMAIL', 'WEBINAR_REMINDER', 'ONBOARDING', 'MANAGER_REVIEW', 'OTHER']);
export const taskPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const objectionSchema = z.enum(['PRICE', 'TIMING', 'TRUST', 'COMPETITOR', 'NEED_APPROVAL', 'NO_TIME', 'LANGUAGE', 'NOT_RELEVANT', 'OTHER']);
export const callOutcomeSchema = z.enum(['CONNECTED', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'CALLBACK', 'FAILED', 'WON', 'LOST']);

const optStr = (max: number) => z.string().trim().max(max).optional().nullable();
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
const money = z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,2})?$/)]);

// ---- leads ----------------------------------------------------------------------------------------------------
export const createLeadSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    phone: optStr(40),
    email: z.string().trim().email().max(254).optional().nullable(),
    sourceId: uuidSchema.optional().nullable(),
    campaignId: uuidSchema.optional().nullable(),
    programId: uuidSchema.optional().nullable(),
    assignedToId: uuidSchema.optional().nullable(),
    autoAssign: z.enum(['round_robin', 'none']).default('none'),
    interestLevel: interestLevelSchema.optional().nullable(),
    estimatedValue: money.optional().nullable(),
    preferredLanguage: optStr(40),
    consentStatus: consentStatusSchema.default('UNKNOWN'),
    consentSource: optStr(120),
    isKeyProspect: z.boolean().default(false),
    note: optStr(4000),
  })
  .strict()
  .refine((v) => !!(v.phone?.trim() || v.email?.trim()), { message: 'A phone number or an email is required', path: ['phone'] });
export type CreateLeadBody = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    phone: optStr(40),
    email: z.string().trim().email().max(254).optional().nullable(),
    sourceId: uuidSchema.optional().nullable(),
    campaignId: uuidSchema.optional().nullable(),
    programId: uuidSchema.optional().nullable(),
    interestLevel: interestLevelSchema.optional().nullable(),
    estimatedValue: money.optional().nullable(),
    preferredLanguage: optStr(40),
    consentStatus: consentStatusSchema.optional(),
    consentSource: optStr(120),
    isKeyProspect: z.boolean().optional(),
    /** optimistic concurrency */
    version: z.number().int().positive().optional(),
  })
  .strict();

export const listLeadsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.string().max(400).optional(),
  category: z.enum(['OPEN', 'WON', 'LOST', 'NURTURE']).optional(),
  assignedToId: z.union([uuidSchema, z.literal('unassigned')]).optional(),
  teamId: uuidSchema.optional(),
  sourceId: uuidSchema.optional(),
  programId: uuidSchema.optional(),
  interestLevel: interestLevelSchema.optional(),
  consentStatus: consentStatusSchema.optional(),
  duplicate: bool.optional(),
  overdue: bool.optional(),
  mine: bool.optional(),
  keyProspect: bool.optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  noActivityDays: z.coerce.number().int().min(1).max(3650).optional(),
  sort: z.enum(['createdAt', 'nextActionAt', 'lastActivityAt', 'priority']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export const assignLeadSchema = z
  .object({
    toUserId: uuidSchema.nullable().optional(),
    mode: z.enum(['user', 'round_robin']).default('user'),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((v) => v.mode === 'round_robin' || !!v.toUserId, { message: 'toUserId is required', path: ['toUserId'] });

export const changeStatusSchema = z
  .object({
    status: z.string().trim().min(1).max(60),
    reason: optStr(500),
    lostReason: optStr(60),
    lostNote: optStr(1000),
    wonValue: money.optional().nullable(),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const createNoteSchema = z.object({ body: z.string().trim().min(1).max(4000), visibility: z.enum(['SHARED', 'PRIVATE']).default('SHARED') }).strict();

export const timelineQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.coerce.date().optional() });

// ---- calls ----------------------------------------------------------------------------------------------------
const futureish = (d: Date) => d.getTime() > Date.now() - 5 * 60_000;

/** Disposition form. `source` is intentionally absent: calls created here are always MANUAL (strict schema rejects it). */
export const logCallSchema = z
  .object({
    outcome: callOutcomeSchema,
    direction: z.enum(['OUTBOUND', 'INBOUND']).default('OUTBOUND'),
    startedAt: z.coerce.date().optional(),
    durationSeconds: z.number().int().min(0).max(86400).optional().nullable(),
    notes: optStr(4000),
    interestLevel: interestLevelSchema.optional().nullable(),
    objectionCategory: objectionSchema.optional().nullable(),
    nextActionAt: z.coerce.date().optional().nullable(),
    nextActionType: taskTypeSchema.optional().nullable(),
    callbackAt: z.coerce.date().optional().nullable(),
    taskId: uuidSchema.optional().nullable(),
    lostReason: optStr(60),
    lostNote: optStr(1000),
    wonValue: money.optional().nullable(),
    wonAt: z.coerce.date().optional().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.outcome === 'CONNECTED') {
      if (!v.interestLevel) add('interestLevel', 'Interest level is required for a connected call');
      if (!v.nextActionAt) add('nextActionAt', 'A next action date is required for a connected call');
    }
    if (v.outcome === 'CALLBACK' && !v.callbackAt) add('callbackAt', 'Callback date/time is required');
    if (v.outcome === 'LOST' && !v.lostReason) add('lostReason', 'A lost reason is required');
    if (v.outcome === 'WON' && (v.wonValue === undefined || v.wonValue === null || Number(v.wonValue) <= 0)) add('wonValue', 'A positive won value is required');
    if (v.nextActionAt && !futureish(v.nextActionAt)) add('nextActionAt', 'Next action cannot be in the past');
    if (v.callbackAt && !futureish(v.callbackAt)) add('callbackAt', 'Callback time cannot be in the past');
  });
export type LogCallBody = z.infer<typeof logCallSchema>;

// ---- tasks ----------------------------------------------------------------------------------------------------
export const createTaskSchema = z
  .object({
    leadId: uuidSchema.optional().nullable(),
    assignedToId: uuidSchema.optional(),
    type: taskTypeSchema.default('FOLLOW_UP'),
    title: z.string().trim().min(1).max(200),
    description: optStr(2000),
    dueAt: z.coerce.date().refine(futureish, 'Due date cannot be in the past'),
    priority: taskPrioritySchema.default('NORMAL'),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: optStr(2000),
    dueAt: z.coerce.date().refine(futureish, 'Due date cannot be in the past').optional(),
    priority: taskPrioritySchema.optional(),
    type: taskTypeSchema.optional(),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const completeTaskSchema = z.object({ completionNote: optStr(2000), version: z.number().int().positive().optional() }).strict();
export const reassignTaskSchema = z.object({ assignedToId: uuidSchema, reason: z.string().trim().min(3).max(500) }).strict();

export const listTasksQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'DONE', 'CANCELLED', 'ALL']).default('OPEN'),
  assignedToId: uuidSchema.optional(),
  leadId: uuidSchema.optional(),
  type: taskTypeSchema.optional(),
  overdue: bool.optional(),
  mine: bool.optional(),
  pinned: bool.optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
});

export const calendarQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  assignedToId: uuidSchema.optional(),
  mine: bool.optional(),
});

// ---- duplicates / queues ----------------------------------------------------------------------------------------
export const mergeDuplicateSchema = z
  .object({
    /** which lead survives: the candidate's lead or its counterpart */
    winnerLeadId: uuidSchema,
    /** per-field choices for the survivor: take the value from the loser */
    takeFromLoser: z.array(z.enum(['fullName', 'email', 'phone', 'programId', 'sourceId', 'interestLevel', 'estimatedValue', 'preferredLanguage'])).default([]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const dismissDuplicateSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const bulkAssignSchema = z
  .object({
    entryIds: z.array(uuidSchema).min(1).max(200),
    toUserId: uuidSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const listQueueQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'RESOLVED', 'CANCELLED']).default('OPEN'),
  kind: z.string().max(40).optional(),
  teamId: uuidSchema.optional(),
});

export const resolveExceptionSchema = z.object({ note: z.string().trim().min(3).max(500) }).strict();
export const reactivateSchema = z.object({ toUserId: uuidSchema.optional(), reason: z.string().trim().min(3).max(500) }).strict();

// ---- imports ----------------------------------------------------------------------------------------------------
export const importFieldSchema = z.enum(['fullName', 'phone', 'email', 'source', 'program', 'interestLevel', 'consentStatus', 'estimatedValue', 'preferredLanguage', 'ownerEmail', 'note']);
export const importOptionsInputSchema = z
  .object({
    mapping: z.record(importFieldSchema, z.string().min(1).max(120)).default({}),
    sourceId: uuidSchema.nullish(),
    programId: uuidSchema.nullish(),
    assignment: z.enum(['none', 'round_robin', 'user']).default('none'),
    assigneeId: uuidSchema.nullish(),
    template: z.enum(['GENERIC', 'LEADSQUARED', 'ZOHO', 'HUBSPOT']).default('GENERIC'),
    defaultRegion: z.string().length(2).default('IN'),
    consentStatus: consentStatusSchema.default('UNKNOWN'),
  })
  .strict();
export const importJsonBodySchema = z.object({ fileName: optStr(200), csv: z.string().min(1).max(5 * 1024 * 1024), options: importOptionsInputSchema.default({}) }).strict();
export const importRawQuerySchema = z.object({ fileName: z.string().max(200).optional(), options: z.string().max(4000).optional() });
export const importErrorsQuerySchema = paginationQuerySchema.extend({ format: z.enum(['json', 'csv']).default('json'), includeWarnings: bool.optional() });

// ---- configuration ----------------------------------------------------------------------------------------------
export const createSourceSchema = z
  .object({ name: z.string().trim().min(1).max(120), type: z.enum(['MANUAL', 'IMPORT', 'CAMPAIGN', 'WEBINAR', 'REFERRAL', 'WEBSITE', 'OTHER']).default('OTHER') })
  .strict();
export const updateSourceSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), type: createSourceSchema.shape.type.optional(), isActive: z.boolean().optional() }).strict();
export const createCampaignSchema = z.object({ sourceId: uuidSchema, name: z.string().trim().min(1).max(160), startsAt: z.coerce.date().optional().nullable(), endsAt: z.coerce.date().optional().nullable() }).strict();

export const createProgramSchema = z
  .object({
    code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, - and _ only'),
    name: z.string().trim().min(1).max(160),
    kind: z.enum(['PROGRAM', 'EVENT', 'APP']).default('PROGRAM'),
    description: optStr(1000),
    sortOrder: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const updateProgramSchema = z
  .object({ name: z.string().trim().min(1).max(160).optional(), kind: createProgramSchema.shape.kind.optional(), description: optStr(1000), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(10000).optional() })
  .strict();

export const createStageSchema = z
  .object({
    key: z.string().trim().min(2).max(60).regex(/^[A-Z0-9_]+$/, 'UPPER_SNAKE_CASE'),
    label: z.string().trim().min(1).max(100),
    category: z.enum(['OPEN', 'WON', 'LOST', 'NURTURE']).default('OPEN'),
    sortOrder: z.number().int().min(0).max(10000),
    skippable: z.boolean().default(false),
    canClose: z.boolean().default(false),
    allowedNext: z.array(z.string().max(60)).max(30).default([]),
  })
  .strict();
export const updateStageSchema = z
  .object({ label: z.string().trim().min(1).max(100).optional(), sortOrder: z.number().int().min(0).max(10000).optional(), skippable: z.boolean().optional(), canClose: z.boolean().optional(), allowedNext: z.array(z.string().max(60)).max(30).optional(), isActive: z.boolean().optional() })
  .strict();
export const createLostReasonSchema = z
  .object({ key: z.string().trim().min(2).max(60).regex(/^[A-Z0-9_]+$/, 'UPPER_SNAKE_CASE'), label: z.string().trim().min(1).max(100), requiresNote: z.boolean().default(false), reactivateAfterDays: z.number().int().min(1).max(3650).nullable().default(null), sortOrder: z.number().int().min(0).max(1000).default(0) })
  .strict();
export const updateLostReasonSchema = z
  .object({ label: z.string().trim().min(1).max(100).optional(), requiresNote: z.boolean().optional(), reactivateAfterDays: z.number().int().min(1).max(3650).nullable().optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional() })
  .strict();

export const upsertAutomationRuleSchema = z.object({ ruleKey: z.string().min(2).max(40), teamId: uuidSchema.nullish(), config: z.record(z.unknown()), isActive: z.boolean().default(true) }).strict();
export const updateAutomationRuleSchema = z.object({ config: z.record(z.unknown()).optional(), isActive: z.boolean().optional() }).strict();
export const upsertAssignmentRuleSchema = z
  .object({ teamId: uuidSchema, isEnabled: z.boolean(), dailyCap: z.number().int().min(1).max(1000).nullable().default(null), excludedUserIds: z.array(uuidSchema).max(100).default([]), sourceIds: z.array(uuidSchema).max(50).default([]), programIds: z.array(uuidSchema).max(50).default([]) })
  .strict();

// ---- events -----------------------------------------------------------------------------------------------------
export const createEventSchema = z
  .object({
    type: z.enum(['WEBINAR', 'DEMO', 'EVENT']),
    title: z.string().trim().min(1).max(200),
    programId: uuidSchema.optional().nullable(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional().nullable(),
    hostId: uuidSchema.optional().nullable(),
    capacity: z.number().int().min(1).max(100000).optional().nullable(),
    location: optStr(300),
  })
  .strict();
export const updateEventSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional(), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional().nullable(), hostId: uuidSchema.optional().nullable(), capacity: z.number().int().min(1).max(100000).optional().nullable(), location: optStr(300), status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional() })
  .strict();
export const listEventsQuerySchema = paginationQuerySchema.extend({ type: z.enum(['WEBINAR', 'DEMO', 'EVENT']).optional(), status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(), programId: uuidSchema.optional(), upcoming: bool.optional() });
export const attendanceSchema = z
  .object({
    leadId: uuidSchema,
    status: z.enum(['INVITED', 'REGISTERED', 'ATTENDED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED', 'FOLLOWED_UP', 'CONVERTED', 'NOT_CONVERTED']),
    joinedAt: z.coerce.date().optional().nullable(),
    durationMinutes: z.number().int().min(0).max(1440).optional().nullable(),
    reason: optStr(500),
    /** RESCHEDULED: the new event the lead is moved to */
    newEventId: uuidSchema.optional().nullable(),
  })
  .strict();

export const savedViewSchema = z.object({ name: z.string().trim().min(1).max(80), filters: z.record(z.unknown()) }).strict();
export const streamQuerySchema = z.object({ since: z.coerce.date().optional() });
export const dlqQuerySchema = paginationQuerySchema;
