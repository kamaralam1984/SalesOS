import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuid = z.string().uuid();

/** Window + filters shared by every dashboard, KPI, report and export. Filters can only narrow the server-side scope. */
export const analyticsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    period: z.enum(['WEEK', 'MONTH', 'QUARTER', 'YEAR']).optional(),
    asOf: isoDate.optional(),
    teamId: uuid.optional(),
    programId: uuid.optional(),
    sourceId: uuid.optional(),
    ownerId: uuid.optional(),
  })
  .strict();
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const kpiListQuerySchema = analyticsQuerySchema.extend({
  ids: z
    .string()
    .max(2000)
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)),
  group: z.enum(['REV', 'SAL', 'PRD', 'TEA', 'PRO', 'CX', 'FND', 'EXC']).optional(),
});

export const REPORT_KEYS = ['follow-ups', 'conversions', 'funnel', 'revenue', 'team-performance', 'weekly-founder', 'monthly-founder'] as const;
export type ReportKeyDto = (typeof REPORT_KEYS)[number];

export const reportQuerySchema = analyticsQuerySchema.extend({
  by: z.enum(['source', 'program', 'owner']).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});
export type ReportQueryDto = z.infer<typeof reportQuerySchema>;

export const createExportSchema = z
  .object({
    report: z.enum(REPORT_KEYS),
    format: z.enum(['CSV', 'XLSX']),
    params: analyticsQuerySchema.extend({ by: z.enum(['source', 'program', 'owner']).optional() }).default({}),
    maxRows: z.coerce.number().int().min(1).max(100_000).optional(),
  })
  .strict();
export type CreateExportDto = z.infer<typeof createExportSchema>;

export const exportListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();

export const savedFilterSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    target: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes'),
    filters: analyticsQuerySchema.extend({ by: z.enum(['source', 'program', 'owner']).optional() }),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type SavedFilterDto = z.infer<typeof savedFilterSchema>;

export const savedFilterQuerySchema = z.object({ target: z.string().trim().max(60).optional() }).strict();
