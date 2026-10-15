import { z } from 'zod';
import { DEFAULT_WORKING_HOURS, type WorkingHours } from '@salesos/crm-core';
import type { ComplaintPriorityKey } from './constants';

const slaEntry = z.object({ firstResponseHours: z.number().positive().max(24 * 30), resolveDays: z.number().positive().max(365) });

/** Handover fields that can be required by the checklist template. */
export const HANDOVER_FIELD_KEYS = [
  'learnerName',
  'learnerContact',
  'languagePreference',
  'program',
  'amountPaid',
  'amountDue',
  'paymentVerified',
  'promisesMade',
  'goals',
  'objections',
  'specialNotes',
  'consents',
] as const;
export type HandoverFieldKey = (typeof HANDOVER_FIELD_KEYS)[number];

/** Learner revenue-rank ladder (JD: Warrior, Mavala Rs 1 lakh, Sardar 10 lakh, Senapati 50 lakh, Chhatrapati 1 crore). minEarned is a rupee amount; first rung must be 0. */
export const rankLadderSchema = z
  .array(z.object({ key: z.string().regex(/^[A-Z_]{2,30}$/), label: z.string().min(1).max(60), minEarned: z.number().min(0).max(1e12) }))
  .min(1)
  .max(12)
  .refine((r) => r[0]!.minEarned === 0 && r.every((x, i) => i === 0 || x.minEarned > r[i - 1]!.minEarned), 'First rung must start at 0 and thresholds must strictly increase');

export const cxConfigSchema = z.object({
  learnerRanks: rankLadderSchema,
  /** DEC-017 complaint priority + SLA defaults (business hours / days per DEC-020). */
  complaintSla: z.object({ P1: slaEntry, P2: slaEntry, P3: slaEntry, P4: slaEntry }),
  /** breach escalation: owner at breach, team lead after N minutes, Founder (P1 only) after M minutes */
  complaintEscalation: z.object({ teamLeadAfterMinutes: z.number().int().min(0), founderAfterMinutes: z.number().int().min(0), founderPriorities: z.array(z.enum(['P1', 'P2', 'P3', 'P4'])) }),
  /** RESOLVED -> CLOSED automatically after N days without a reopen */
  autoCloseResolvedDays: z.number().int().min(1).max(60),
  handover: z.object({
    /** pending-handover alert timer: acknowledge within N hours of submission (default 24) */
    ackSlaHours: z.number().positive().max(24 * 14),
    /** team lead is alerted N hours after the manager */
    teamLeadAfterHours: z.number().positive().max(24 * 14),
    requiredFields: z.array(z.enum(HANDOVER_FIELD_KEYS)).min(1),
  }),
  workItems: z.object({
    /** OVERDUE -> ESCALATED after N hours overdue (action items notify Founder; xf tasks notify manager/TL) */
    escalateAfterHours: z.number().positive().max(24 * 30),
  }),
  reports: z.object({
    timezone: z.string().min(1),
    /** weekly: due on this ISO weekday (1=Monday) after the week ends, at HH:MM */
    weeklyDueWeekday: z.number().int().min(1).max(7),
    /** monthly: due on the Nth working day of the next month, at HH:MM */
    monthlyDueWorkingDay: z.number().int().min(1).max(15),
    dueTime: z.string().regex(/^\d{2}:\d{2}$/),
    /** Founder is alerted N hours after the due time if still unpublished */
    founderAlertAfterHours: z.number().positive().max(24 * 14),
  }),
  workingHours: z.object({
    timezone: z.string(),
    days: z.array(z.number().int().min(1).max(7)).min(1),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    holidays: z.array(z.string()),
  }),
});
export type CxConfig = z.infer<typeof cxConfigSchema>;

export const DEFAULT_RANK_LADDER = [
  { key: 'WARRIOR', label: 'Warrior', minEarned: 0 },
  { key: 'MAVALA', label: 'Mavala', minEarned: 100_000 },
  { key: 'SARDAR', label: 'Sardar', minEarned: 1_000_000 },
  { key: 'SENAPATI', label: 'Senapati', minEarned: 5_000_000 },
  { key: 'CHHATRAPATI', label: 'Chhatrapati', minEarned: 10_000_000 },
];

export const DEFAULT_CX_CONFIG: CxConfig = {
  learnerRanks: DEFAULT_RANK_LADDER,
  complaintSla: {
    P1: { firstResponseHours: 4, resolveDays: 2 },
    P2: { firstResponseHours: 8, resolveDays: 3 },
    P3: { firstResponseHours: 10, resolveDays: 5 },
    P4: { firstResponseHours: 20, resolveDays: 10 },
  },
  complaintEscalation: { teamLeadAfterMinutes: 240, founderAfterMinutes: 480, founderPriorities: ['P1'] },
  autoCloseResolvedDays: 7,
  handover: {
    ackSlaHours: 24,
    teamLeadAfterHours: 24,
    requiredFields: ['learnerName', 'learnerContact', 'languagePreference', 'program', 'amountPaid', 'amountDue', 'paymentVerified', 'promisesMade', 'goals', 'objections', 'specialNotes', 'consents'],
  },
  workItems: { escalateAfterHours: 24 },
  reports: { timezone: DEFAULT_WORKING_HOURS.timezone, weeklyDueWeekday: 1, monthlyDueWorkingDay: 3, dueTime: '10:00', founderAlertAfterHours: 24 },
  workingHours: { ...DEFAULT_WORKING_HOURS },
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merge a stored partial config over the defaults (arrays replace). Invalid stored values fall back to defaults. */
export function resolveCxConfig(stored: unknown): CxConfig {
  const merge = (base: unknown, over: unknown): unknown => {
    if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
    const out: Json = { ...base };
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
    return out;
  };
  const merged = merge(DEFAULT_CX_CONFIG, stored ?? {});
  const parsed = cxConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_CX_CONFIG;
}

export const partialCxConfigSchema = cxConfigSchema.deepPartial();

export function toWorkingHours(cfg: CxConfig, orgTimezone?: string | null): WorkingHours {
  return { ...cfg.workingHours, timezone: orgTimezone || cfg.workingHours.timezone };
}

export function slaFor(cfg: CxConfig, p: ComplaintPriorityKey) {
  return cfg.complaintSla[p];
}
