import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';
import { workDaySchema } from './workforce-attendance';

const leaveTypeKey = z.string().regex(/^[A-Z_]{2,20}$/);
/** signed decimal string with at most 2 dp (leave days are never money) */
const daysAmount = z.string().regex(/^-?\d{1,4}(\.\d{1,2})?$/, 'Use a number with at most 2 decimals').refine((s) => Number(s) !== 0, 'Amount cannot be zero');

export const createLeaveRequestSchema = z
  .object({
    typeKey: leaveTypeKey,
    startDate: workDaySchema,
    endDate: workDaySchema,
    halfDay: z.enum(['NONE', 'FIRST_HALF', 'SECOND_HALF']).default('NONE'),
    reason: z.string().trim().min(3).max(500),
    /** the employee accepts that the part above the balance is unpaid (only when policy = UNPAID_WITH_CONFIRMATION) */
    confirmUnpaid: z.boolean().default(false),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'End date is before start date' })
  .refine((v) => v.halfDay === 'NONE' || v.startDate === v.endDate, { path: ['halfDay'], message: 'A half day applies to a single day' });

export const listLeaveRequestsQuerySchema = paginationQuerySchema.extend({
  view: z.enum(['mine', 'team', 'pending-me', 'all']).default('mine'),
  status: z.enum(['PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
});

export const leaveDecisionSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(500).optional() })
  .refine((v) => v.decision === 'APPROVE' || (v.comment?.length ?? 0) >= 3, { path: ['comment'], message: 'A comment is required when rejecting' });
export const cancelLeaveSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const balanceQuerySchema = z.object({ userId: uuidSchema.optional() });
export const ledgerQuerySchema = paginationQuerySchema.extend({ userId: uuidSchema.optional(), typeKey: leaveTypeKey.optional() });
export const adjustBalanceSchema = z.object({
  userId: uuidSchema,
  typeKey: leaveTypeKey,
  amount: daysAmount,
  kind: z.enum(['ADJUSTMENT', 'OPENING']).default('ADJUSTMENT'),
  reason: z.string().trim().min(5).max(500),
});
export const leaveCalendarQuerySchema = z
  .object({ from: workDaySchema, to: workDaySchema })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'End is before start' })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 92, { path: ['to'], message: 'Range is limited to 92 days' });

export const earnedLeaveProgressQuerySchema = z.object({ userId: uuidSchema.optional() });
export const earnedLeaveTransactionsQuerySchema = paginationQuerySchema.extend({ userId: uuidSchema.optional() });
export const earnedLeaveRunSchema = z.object({ userId: uuidSchema.optional() }).strict();
