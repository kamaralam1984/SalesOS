import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date');
const text = (max: number) => z.string().trim().max(max);
/** non-negative decimal as number or string, max 2 decimals */
const amount = z.union([z.number(), z.string().trim()]).transform((v) => String(v)).refine((s) => /^\d{1,12}(\.\d{1,2})?$/.test(s), 'Use a non-negative number with up to 2 decimals');

export const GOAL_STATUSES = ['ACTIVE', 'PENDING_VERIFICATION', 'COMPLETED', 'CANCELLED'] as const;
export const GOAL_RISKS = ['ON_TRACK', 'AT_RISK', 'COMPLETED', 'OVERDUE'] as const;

export const createGoalSchema = z.object({
  ownerId: uuidSchema.optional(),
  reviewerId: uuidSchema.nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: text(4000).optional(),
  startDate: day.optional(),
  /** default = startDate + cycleDays - 1 */
  targetDate: day.optional(),
  cycleDays: z.number().int().min(7).max(366).optional(),
  targetValue: amount.optional(),
  unit: text(30).optional(),
  milestones: z.array(z.object({ title: z.string().trim().min(2).max(200), dueDate: day.optional() })).max(30).default([]),
});

export const updateGoalSchema = z
  .object({
    version: z.number().int().min(1),
    title: z.string().trim().min(3).max(200).optional(),
    description: text(4000).nullable().optional(),
    targetDate: day.optional(),
    targetValue: amount.nullable().optional(),
    unit: text(30).nullable().optional(),
    reviewerId: uuidSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update');

export const listGoalsQuerySchema = paginationQuerySchema.extend({
  view: z.enum(['mine', 'team', 'reviewing', 'all']).default('mine'),
  status: z.enum(GOAL_STATUSES).optional(),
  risk: z.enum(GOAL_RISKS).optional(),
  ownerId: uuidSchema.optional(),
});

/** Owner progress update: currentValue for measurable goals, progressPct for the others. */
export const goalProgressSchema = z
  .object({
    version: z.number().int().min(1).optional(),
    currentValue: amount.optional(),
    progressPct: z.number().int().min(0).max(100).optional(),
    note: text(2000).optional(),
  })
  .refine((v) => v.currentValue !== undefined || v.progressPct !== undefined, 'Provide currentValue or progressPct');

export const createMilestoneSchema = z.object({ title: z.string().trim().min(2).max(200), dueDate: day.optional() });
export const updateMilestoneSchema = z
  .object({ title: z.string().trim().min(2).max(200).optional(), dueDate: day.nullable().optional(), done: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const goalCommentSchema = z.object({ note: z.string().trim().min(1).max(2000) });
export const goalSubmitSchema = z.object({ version: z.number().int().min(1).optional(), note: text(2000).optional() });
export const goalVerifySchema = z.object({ version: z.number().int().min(1).optional(), note: text(2000).optional() });
export const goalReturnSchema = z.object({ version: z.number().int().min(1).optional(), note: z.string().trim().min(3).max(2000) });
export const goalCancelSchema = z.object({ version: z.number().int().min(1).optional(), reason: z.string().trim().min(3).max(1000) });
