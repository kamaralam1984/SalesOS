import { z } from 'zod';
import { uuidSchema } from './common';
import { emailSchema, roleKeySchema } from './identity';
import { workDaySchema } from './workforce-attendance';

/** A new employee joining: account + HR record + the 90-day training plan + the first tasks, in one step (HR and the Boss). */
export const newJoinerTaskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  /** day of the 90 (counting the joining day as day 1) the task is due */
  dueDay: z.number().int().min(1).max(90).default(7),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
});
export const newJoinerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  roles: z.array(roleKeySchema).min(1).max(6),
  managerId: uuidSchema.nullish(),
  department: z.string().trim().max(80).nullish(),
  /** the post / designation, e.g. "Sales Executive (Telecaller)" */
  positionTitle: z.string().trim().min(2).max(120),
  joinDate: workDaySchema.optional(),
  /** training template; empty = the organisation's 90-day template for the role (created on first use) */
  templateId: uuidSchema.optional(),
  tasks: z.array(newJoinerTaskSchema).max(30).default([]),
});
export type NewJoinerInput = z.infer<typeof newJoinerSchema>;
