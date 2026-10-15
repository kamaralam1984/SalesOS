import { z } from 'zod';
import { NOTIFICATION_TYPES } from '@salesos/shared-types';
import { paginationQuerySchema } from './common';

// ───────── notifications ─────────
const channel = z.enum(['IN_APP', 'EMAIL', 'WHATSAPP', 'SMS', 'CALENDAR']);
const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const notificationType = z.enum(NOTIFICATION_TYPES);

export const notificationListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['UNREAD', 'READ', 'DISMISSED', 'ALL']).default('ALL'),
  type: notificationType.optional(),
  /** polling fallback: only notifications raised/updated after this instant */
  since: z.coerce.date().optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationPreferencesSchema = z.object({
  preferences: z
    .array(z.object({ type: z.union([notificationType, z.literal('*')]), channel, enabled: z.boolean() }))
    .max(200)
    .default([]),
  /** null clears the personal override (organisation hours apply) */
  quietHours: z
    .object({ quietStart: hhmm, quietEnd: hhmm, timezone: z.string().min(1).max(64) })
    .nullable()
    .optional(),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

export const notificationRulesPatchSchema = z.object({
  rules: z
    .array(
      z.object({
        type: notificationType,
        enabled: z.boolean().optional(),
        channels: z.array(channel).max(5).optional(),
        severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).nullable().optional(),
        bypassQuietHours: z.boolean().optional(),
      }),
    )
    .max(60)
    .optional(),
  orgConfig: z
    .object({
      quietStart: hhmm.optional(),
      quietEnd: hhmm.optional(),
      timezone: z.string().min(1).max(64).optional(),
      workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
      digestThreshold: z.number().int().min(2).max(100).optional(),
      digestWindowMinutes: z.number().int().min(5).max(1440).optional(),
    })
    .optional(),
});
export type NotificationRulesPatch = z.infer<typeof notificationRulesPatchSchema>;

// ───────── integrations ─────────
export const integrationPatchSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['SANDBOX', 'LIVE']).optional(),
  settings: z.record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
  /** write-only; stored encrypted (AES-256-GCM); never returned */
  secret: z.string().min(1).max(2000).nullable().optional(),
  webhookSecret: z.string().min(16).max(500).nullable().optional(),
});
export type IntegrationPatch = z.infer<typeof integrationPatchSchema>;

export const deliveryListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'DEAD_LETTER', 'SUPPRESSED', 'CANCELLED']).optional(),
  channel: channel.optional(),
});

export const integrationTestSchema = z.object({ to: z.string().min(3).max(320), subject: z.string().max(200).optional(), body: z.string().min(1).max(2000) });

export const consentUpsertSchema = z.object({
  channel: z.enum(['EMAIL', 'WHATSAPP', 'SMS']),
  address: z.string().min(3).max(320),
  status: z.enum(['OPTED_IN', 'OPTED_OUT']),
  subjectType: z.string().max(40).optional(),
  subjectId: z.string().uuid().optional(),
  source: z.string().min(2).max(80).default('admin_entry'),
});

// ───────── files ─────────
export const fileAttachSchema = z.object({ entityType: z.string().min(1).max(40).regex(/^[a-z_]+$/), entityId: z.string().uuid() });
export const fileListQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().max(40).regex(/^[a-z_]+$/).optional(),
  entityId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'SCANNING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED']).optional(),
});
export const filesSettingsPatchSchema = z.object({
  maxBytesByCategory: z.object({ image: z.number().int().min(1024).max(50_000_000), document: z.number().int().min(1024).max(50_000_000), csv: z.number().int().min(1024).max(50_000_000) }).partial().optional(),
  userQuotaBytes: z.number().int().min(1_000_000).max(10_000_000_000).optional(),
  orgQuotaBytes: z.number().int().min(1_000_000).max(1_000_000_000_000).optional(),
  signedUrlTtlSeconds: z.number().int().min(5).max(300).optional(),
  purgeAfterDays: z.number().int().min(1).max(3650).optional(),
  maxImagePixels: z.number().int().min(100_000).max(100_000_000).optional(),
});

// ───────── ai ─────────
export const aiTextInputSchema = z
  .object({
    leadId: z.string().uuid().optional(),
    /** rep-entered notes; client-supplied text inside is treated as untrusted */
    text: z.string().min(1).max(8000).optional(),
  })
  .refine((v) => v.leadId || v.text, { message: 'Provide leadId or text' });
export const aiDraftInputSchema = z
  .object({
    leadId: z.string().uuid().optional(),
    text: z.string().min(1).max(8000).optional(),
    channel: z.enum(['EMAIL', 'WHATSAPP', 'SMS', 'CALL_SCRIPT']).default('EMAIL'),
    intent: z.string().max(200).optional(),
  })
  .refine((v) => v.leadId || v.text, { message: 'Provide leadId or text' });
export const aiConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['fake', 'openai', 'gemini', 'anthropic']).optional(),
  model: z.string().min(1).max(100).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(120).optional(),
  redactPii: z.boolean().optional(),
});
export const aiSuggestionReviewSchema = z.object({
  action: z.enum(['ACCEPT', 'EDIT', 'REJECT']),
  editedOutput: z.record(z.unknown()).optional(),
});
export const aiUsageQuerySchema = paginationQuerySchema.extend({ days: z.coerce.number().int().min(1).max(90).default(30) });

// ───────── devices ─────────
export const deviceRegisterSchema = z.object({
  deviceId: z.string().min(8).max(200),
  label: z.string().min(1).max(80),
  platform: z.literal('ANDROID').default('ANDROID'),
  osVersion: z.string().max(40).optional(),
  appVersion: z.string().max(40).optional(),
  disclosureVersion: z.string().min(1).max(40),
  disclosureAccepted: z.literal(true, { errorMap: () => ({ message: 'The on-device disclosure must be accepted' }) }),
});
export type DeviceRegisterInput = z.infer<typeof deviceRegisterSchema>;
