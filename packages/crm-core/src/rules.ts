import { z } from 'zod';
import { DEFAULT_WORKING_HOURS, type WorkingHours } from './working-hours';

/**
 * Automation rule configuration (DEC-026 defaults), resolved default < organization < team.
 * Every config is a strict Zod schema; unknown keys are rejected.
 */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const pos = z.number().int().min(0).max(100000);

export const RULE_SCHEMAS = {
  WORKING_HOURS: z
    .object({
      timezone: z.string().min(1).max(64).default(DEFAULT_WORKING_HOURS.timezone),
      days: z.array(z.number().int().min(1).max(7)).min(1).max(7).default(DEFAULT_WORKING_HOURS.days),
      start: hhmm.default(DEFAULT_WORKING_HOURS.start),
      end: hhmm.default(DEFAULT_WORKING_HOURS.end),
      holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400).default([]),
    })
    .strict()
    .refine((v) => v.start < v.end, { message: 'start must be before end' }),
  NO_ANSWER: z
    .object({
      retryDelayWorkingMinutes: pos.default(180),
      maxAttemptsPerDay: pos.default(3),
      maxAttemptsTotal: pos.default(5),
    })
    .strict(),
  BUSY: z.object({ defaultDelayWorkingMinutes: pos.default(60) }).strict(),
  SWITCHED_OFF: z
    .object({ retryDelayWorkingDays: pos.default(1), consecutiveForManagerReview: pos.default(3) })
    .strict(),
  CALLBACK: z.object({ reminderMinutesBefore: pos.default(15) }).strict(),
  FAILED: z
    .object({ createRetryTask: z.boolean().default(false), retryDelayWorkingMinutes: pos.default(60) })
    .strict(),
  OVERDUE: z
    .object({
      notifyOwnerAtMinutes: pos.default(0),
      repeatOwnerAfterMinutes: pos.default(240),
      escalateManagerAfterWorkingDays: pos.default(1),
      escalateTeamLeadAfterWorkingDays: pos.default(3),
    })
    .strict(),
  UNATTENDED: z
    .object({ noActivityWorkingDays: pos.default(3), newLeadFirstContactMinutes: pos.default(60) })
    .strict(),
  FIRST_CONTACT: z.object({ enabled: z.boolean().default(true), dueWorkingMinutes: pos.default(60) }).strict(),
  WON: z.object({ onboardingDueWorkingMinutes: pos.default(600) }).strict(),
  REACTIVATION: z
    .object({ maxAttempts: pos.default(2), taskDueWorkingMinutes: pos.default(60) })
    .strict(),
} as const;

export type RuleKey = keyof typeof RULE_SCHEMAS;
export const RULE_KEYS = Object.keys(RULE_SCHEMAS) as RuleKey[];
export type RuleConfig<K extends RuleKey> = z.infer<(typeof RULE_SCHEMAS)[K]>;

export const isRuleKey = (k: string): k is RuleKey => (RULE_KEYS as string[]).includes(k);

export function defaultRule<K extends RuleKey>(key: K): RuleConfig<K> {
  return RULE_SCHEMAS[key].parse({}) as RuleConfig<K>;
}

export const RULE_DESCRIPTIONS: Record<RuleKey, string> = {
  WORKING_HOURS: 'Working days/hours and holidays used for retry delays, SLA clocks and escalation thresholds',
  NO_ANSWER: 'No-answer retry delay (working minutes) and attempt caps before manager review',
  BUSY: 'Busy: default callback delay when the client gave no time',
  SWITCHED_OFF: 'Switched off: delayed retry and consecutive failures before manager review',
  CALLBACK: 'Callback: reminder lead time for the high-visibility task',
  FAILED: 'Failed call: optional retry task',
  OVERDUE: 'Overdue tasks: owner notification, repeat, escalation to manager and team lead',
  UNATTENDED: 'Unattended-lead thresholds',
  FIRST_CONTACT: 'First-contact SLA task for newly assigned leads',
  WON: 'Onboarding/handover task after a win',
  REACTIVATION: 'Lost-lead reactivation attempts',
};

export interface StoredRule {
  teamId: string | null;
  ruleKey: string;
  config: unknown;
  isActive: boolean;
}

/** Resolve a rule: defaults < org row < team row (inactive rows are ignored). */
export function resolveRule<K extends RuleKey>(rows: StoredRule[], key: K, teamId: string | null): RuleConfig<K> {
  const schema = RULE_SCHEMAS[key] as z.ZodTypeAny;
  let merged: Record<string, unknown> = {};
  for (const level of [null, teamId]) {
    if (level === null || teamId) {
      const row = rows.find((r) => r.ruleKey === key && r.isActive && r.teamId === level);
      if (row && typeof row.config === 'object' && row.config) merged = { ...merged, ...(row.config as object) };
    }
  }
  const r = schema.safeParse(merged);
  return (r.success ? r.data : defaultRule(key)) as RuleConfig<K>;
}

export const toWorkingHours = (c: RuleConfig<'WORKING_HOURS'>): WorkingHours => ({
  timezone: c.timezone,
  days: c.days,
  start: c.start,
  end: c.end,
  holidays: c.holidays,
});
