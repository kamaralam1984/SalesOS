import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

export const WORK_TASK_STATUSES = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
export const WORK_TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const iso = z.string().datetime({ offset: true });

export const createWorkTaskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(WORK_TASK_PRIORITIES).default('MEDIUM'),
  /** default: yourself */
  assigneeId: uuidSchema.optional(),
  dueAt: iso.optional(),
  goalId: uuidSchema.optional(),
  project: z.string().trim().max(120).optional(),
});

export const updateWorkTaskSchema = z
  .object({
    version: z.number().int().min(1),
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    priority: z.enum(WORK_TASK_PRIORITIES).optional(),
    dueAt: iso.nullable().optional(),
    assigneeId: uuidSchema.optional(),
    goalId: uuidSchema.nullable().optional(),
    project: z.string().trim().max(120).nullable().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update');

export const listWorkTasksQuerySchema = paginationQuerySchema.extend({
  view: z.enum(['mine', 'assigned', 'team', 'all']).default('mine'),
  status: z.enum(WORK_TASK_STATUSES).optional(),
  overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  goalId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
});

export const workTaskTransitionSchema = z.object({
  to: z.enum(WORK_TASK_STATUSES),
  note: z.string().trim().max(2000).optional(),
  evidence: z.string().trim().max(2000).optional(),
  version: z.number().int().min(1).optional(),
});
export const workTaskCommentSchema = z.object({ note: z.string().trim().min(1).max(2000) });
