import { z } from 'zod';
import { ROLE_KEYS } from '@salesos/shared-types';
import { paginationQuerySchema, uuidSchema } from './common';
import { passwordWeakness } from './password-policy';

export const roleKeySchema = z.enum(ROLE_KEYS);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Password needs upper case, lower case and a digit',
  })
  .superRefine((v, ctx) => {
    const weak = passwordWeakness(v);
    if (weak) ctx.addIssue({ code: 'custom', message: weak });
  });

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export const acceptInviteSchema = resetPasswordSchema;

export const createUserSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  roles: z.array(roleKeySchema).min(1).max(6),
  managerId: uuidSchema.nullish(),
  department: z.string().trim().max(80).nullish(),
  teamIds: z.array(uuidSchema).max(20).optional(),
});
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    managerId: uuidSchema.nullable().optional(),
    department: z.string().trim().max(80).nullable().optional(),
  })
  .strict();
export const setUserRolesSchema = z.object({ roles: z.array(roleKeySchema).min(1).max(6) });
export const deactivateUserSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(120),
  leadUserId: uuidSchema.optional(),
});
export const addTeamMemberSchema = z.object({
  userId: uuidSchema,
  membershipRole: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
});

export const orgSettingsSchema = z
  .object({
    teamSoftLimit: z.number().int().min(1).max(50),
    businessTimezone: z.string().min(1).max(64),
    defaultCurrency: z.string().length(3),
    sessionIdleMinutes: z.number().int().min(5).max(1440),
  })
  .strict();
export const updateOrgSettingsSchema = orgSettingsSchema.partial().strict();
export type OrgSettings = z.infer<typeof orgSettingsSchema>;
export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  teamSoftLimit: 5,
  businessTimezone: 'Asia/Kolkata',
  defaultCurrency: 'INR',
  sessionIdleMinutes: 30,
};

export const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  actorId: uuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const createDelegationSchema = z.object({
  delegatorId: uuidSchema,
  delegateId: uuidSchema,
  endsAt: z.coerce.date(),
  startsAt: z.coerce.date().optional(),
});
