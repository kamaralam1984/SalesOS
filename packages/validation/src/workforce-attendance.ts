import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';
import { ATTENDANCE_STATUS_KEYS } from './workforce-config';

/** `YYYY-MM-DD` calendar day in the business timezone (validated as a real date). */
export const workDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'Not a valid date');
export const workMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const checkInSchema = z.object({ mode: z.enum(['OFFICE', 'WFH']).default('OFFICE') }).strict();
export const checkOutSchema = z.object({}).strict();

export const attendanceMonthQuerySchema = z.object({ userId: uuidSchema.optional(), month: workMonthSchema.optional() });
export const teamSummaryQuerySchema = z.object({ date: workDaySchema.optional() });
export const daySheetQuerySchema = z.object({ date: workDaySchema.optional() });

export const attendanceCorrectionSchema = z
  .object({
    userId: uuidSchema,
    date: workDaySchema,
    status: z.enum(ATTENDANCE_STATUS_KEYS),
    checkInAt: z.coerce.date().nullable().optional(),
    checkOutAt: z.coerce.date().nullable().optional(),
    reason: z.string().trim().min(5).max(500),
    /** optional optimistic concurrency: the record version the corrector saw */
    version: z.number().int().min(1).optional(),
  })
  .refine((v) => !v.checkInAt || !v.checkOutAt || v.checkOutAt > v.checkInAt, { path: ['checkOutAt'], message: 'Check-out must be after check-in' });

export const correctionsQuerySchema = paginationQuerySchema.extend({ userId: uuidSchema.optional(), from: workDaySchema.optional(), to: workDaySchema.optional() });

export const HOLIDAY_KINDS = ['NATIONAL', 'REGIONAL', 'COMPANY', 'OPTIONAL', 'RESTRICTED'] as const;
export const holidaysQuerySchema = paginationQuerySchema.extend({ year: z.coerce.number().int().min(2000).max(2100).optional(), status: z.enum(['SUGGESTED', 'APPROVED']).optional() });
export const createHolidaySchema = z.object({
  date: workDaySchema,
  name: z.string().trim().min(2).max(120),
  kind: z.enum(HOLIDAY_KINDS),
  location: z.string().trim().min(1).max(60).nullable().optional(),
  /** HR-entered holidays are APPROVED by default; pass SUGGESTED to keep one out of the calendar until reviewed */
  status: z.enum(['SUGGESTED', 'APPROVED']).default('APPROVED'),
});
export const updateHolidaySchema = z
  .object({ date: workDaySchema, name: z.string().trim().min(2).max(120), kind: z.enum(HOLIDAY_KINDS), location: z.string().trim().min(1).max(60).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export const suggestHolidaysSchema = z.object({ year: z.number().int().min(2000).max(2100) });
