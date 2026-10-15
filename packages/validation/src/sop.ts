import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';

export const SOP_CATEGORIES = [
  'LEAD_HANDLING', 'FOLLOW_UP_CADENCE', 'WEBINAR_DEMO', 'OBJECTION_HANDLING', 'CLOSING_NEGOTIATION', 'PAYMENT',
  'HANDOVER_STUDENT_SUCCESS', 'CALL_SCRIPT', 'WHATSAPP_TEMPLATE', 'CRM_USAGE', 'REPORTING_FORMAT', 'OTHER',
] as const;
export const sopCategorySchema = z.enum(SOP_CATEGORIES);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const fileIds = z.array(uuidSchema).max(20).default([]);

export const createSopSchema = z.object({
  category: sopCategorySchema,
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().max(1000).optional(),
  ownerId: uuidSchema.optional(),
  isMandatory: z.boolean().default(true),
  audienceRoles: z.array(z.string().min(2).max(60)).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** initial draft (version 1) */
  body: z.string().min(1).max(200_000),
  changeSummary: z.string().trim().max(1000).optional(),
  effectiveDate: isoDate.optional(),
  attachmentFileIds: fileIds,
});

export const createSopVersionSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  body: z.string().min(1).max(200_000),
  changeSummary: z.string().trim().min(3).max(1000),
  effectiveDate: isoDate.optional(),
  attachmentFileIds: fileIds,
});

export const updateSopDraftSchema = createSopVersionSchema.partial();

export const rejectSopSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
export const approveSopSchema = z.object({ effectiveDate: isoDate.optional() });

export const listSopQuerySchema = paginationQuerySchema.extend({
  category: sopCategorySchema.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  mandatory: z.enum(['true', 'false']).optional(),
  includeRetired: z.enum(['true', 'false']).optional(),
});

export const adoptionQuerySchema = z.object({
  documentId: uuidSchema.optional(),
  teamUserId: uuidSchema.optional(),
});

export const gapStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX']);
export const createGapSchema = z.object({
  kind: z.enum(['PROCESS_GAP', 'AUTOMATION']).default('PROCESS_GAP'),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
  ownerId: uuidSchema.optional(),
  priority: z.number().int().min(1).max(5).default(3),
  linkedSopId: uuidSchema.optional(),
});
export const updateGapSchema = z
  .object({
    status: gapStatusSchema,
    resolution: z.string().trim().max(4000),
    ownerId: uuidSchema.nullable(),
    priority: z.number().int().min(1).max(5),
    description: z.string().trim().max(4000),
    linkedSopId: uuidSchema.nullable(),
  })
  .partial()
  .refine((v) => v.status !== 'RESOLVED' || !!v.resolution?.trim(), { message: 'A resolution is required to resolve a gap', path: ['resolution'] });
export const listGapsQuerySchema = paginationQuerySchema.extend({ status: gapStatusSchema.optional(), kind: z.enum(['PROCESS_GAP', 'AUTOMATION']).optional() });
