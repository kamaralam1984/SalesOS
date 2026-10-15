import { z } from 'zod';
import { uuidSchema } from './common';
import { isoDate } from './sop';

/** Workforce HR automation (DEC-048 area D2): HR profile fields, birthdays, probation decisions. */

const today = () => new Date().toISOString().slice(0, 10);

/** PATCH /workforce/hr/profiles/:userId. Every field optional; `null` clears. dateOfBirth is HR data (never echoed to non-HR). */
export const hrProfilePatchSchema = z
  .object({
    joinDate: isoDate.optional(),
    probationMonths: z.number().int().min(1).max(12).nullable().optional(),
    dateOfBirth: isoDate
      .refine((d) => d < today(), { message: 'Date of birth must be in the past' })
      .refine((d) => d >= '1900-01-01', { message: 'Date of birth is out of range' })
      .nullable()
      .optional(),
    shareBirthday: z.boolean().optional(),
    employeeCode: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._\-/]+$/, 'Letters, digits and . _ - / only').nullable().optional(),
    workLocation: z.string().trim().min(1).max(120).nullable().optional(),
    hrContactId: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
export type HrProfilePatch = z.infer<typeof hrProfilePatchSchema>;

export const birthdaysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const PROBATION_LIST_STATUSES = ['ACTIVE', 'IN_PROBATION', 'ENDING_SOON', 'DECISION_DUE', 'UNDER_REVIEW', 'CONFIRMED', 'ALL'] as const;
export const probationListQuerySchema = z.object({
  status: z.enum(PROBATION_LIST_STATUSES).default('ACTIVE'),
  /** "ending soon" horizon in days */
  days: z.coerce.number().int().min(1).max(180).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

export const PROBATION_DECISIONS = ['CONFIRM', 'EXTEND', 'MARK_FOR_REVIEW'] as const;
/** POST /workforce/hr/probation/:userId/decision. EXTEND needs months; EXTEND and MARK_FOR_REVIEW need a note (kept in the decision history). */
export const probationDecisionSchema = z
  .object({
    decision: z.enum(PROBATION_DECISIONS),
    months: z.number().int().min(1).max(6).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === 'EXTEND' && v.months === undefined) ctx.addIssue({ code: 'custom', path: ['months'], message: 'Months are required to extend probation' });
    if (v.decision !== 'EXTEND' && v.months !== undefined) ctx.addIssue({ code: 'custom', path: ['months'], message: 'Months apply only to EXTEND' });
    if (v.decision !== 'CONFIRM' && (v.note?.length ?? 0) < 3) ctx.addIssue({ code: 'custom', path: ['note'], message: 'A note of at least 3 characters is required' });
  });
export type ProbationDecisionInput = z.infer<typeof probationDecisionSchema>;
