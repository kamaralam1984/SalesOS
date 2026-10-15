import { z } from 'zod';
import { uuidSchema } from './common';
import { isoDate } from './sop';

/** Workforce reports and exports (DEC-048 area D2). */
export const WORKFORCE_REPORTS = ['attendance', 'leave', 'earned-leave', 'tasks', 'goals', 'holidays', 'probation', 'birthdays', 'department-performance'] as const;
export type WorkforceReportKey = (typeof WORKFORCE_REPORTS)[number];
export const workforceReportKeySchema = z.enum(WORKFORCE_REPORTS);

export const workforceReportQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    /** department label (users.department is a free-text label) */
    departmentId: z.string().trim().min(1).max(120).optional(),
    userId: uuidSchema.optional(),
    /** department-performance only */
    groupBy: z.enum(['department', 'manager']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must not be after to', path: ['to'] })
  .refine((v) => !v.from || !v.to || (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 <= 400, { message: 'The date range may span at most 400 days', path: ['to'] });
export type WorkforceReportQuery = z.infer<typeof workforceReportQuerySchema>;

export const workforceReportExportQuerySchema = z
  .object({
    format: z.enum(['csv', 'xlsx']).default('csv'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    departmentId: z.string().trim().min(1).max(120).optional(),
    userId: uuidSchema.optional(),
    groupBy: z.enum(['department', 'manager']).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must not be after to', path: ['to'] })
  .refine((v) => !v.from || !v.to || (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 <= 400, { message: 'The date range may span at most 400 days', path: ['to'] });
export type WorkforceReportExportQuery = z.infer<typeof workforceReportExportQuerySchema>;
