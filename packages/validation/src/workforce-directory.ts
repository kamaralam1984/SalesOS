import { z } from 'zod';
import { ROLE_KEYS } from '@salesos/shared-types';
import { paginationQuerySchema, uuidSchema } from './common';

/** Workforce directory, Employee 360, organisation chart, dashboard, announcements (area D1, DEC-048). */

export const DIRECTORY_STATUSES = ['ACTIVE', 'PROBATION', 'EXITED'] as const;
export const directoryStatusSchema = z.enum(DIRECTORY_STATUSES);
export type DirectoryStatus = z.infer<typeof directoryStatusSchema>;

export const listDirectoryQuerySchema = paginationQuerySchema.extend({
  /** matches name, employee code, department, designation or manager name (case-insensitive contains; never interpreted as a pattern) */
  search: z.string().trim().max(100).optional(),
  department: z.string().trim().min(1).max(100).optional(),
  managerId: uuidSchema.optional(),
  status: directoryStatusSchema.optional(),
});
export type ListDirectoryQuery = z.infer<typeof listDirectoryQuerySchema>;

export const ORG_CHART_VIEWS = ['organisation', 'department', 'team'] as const;
export const orgChartQuerySchema = z.object({
  view: z.enum(ORG_CHART_VIEWS).default('organisation'),
  department: z.string().trim().min(1).max(100).optional(),
  teamId: uuidSchema.optional(),
});
export type OrgChartQuery = z.infer<typeof orgChartQuerySchema>;

export const listAnnouncementsQuerySchema = paginationQuerySchema.extend({
  /** `all` (managers only) also lists expired announcements */
  include: z.enum(['active', 'all']).default('active'),
});

export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(1).max(4000),
    /** role keys the announcement is for; empty = everyone */
    audienceRoles: z.array(z.enum(ROLE_KEYS)).max(ROLE_KEYS.length).default([]),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((v) => !v.expiresAt || new Date(v.expiresAt).getTime() > Date.now(), { path: ['expiresAt'], message: 'expiryInPast' });
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
