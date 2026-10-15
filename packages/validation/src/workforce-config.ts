import { z } from 'zod';

/**
 * Workforce policy (DEC-048). Everything the PDF calls "configurable" lives here; defaults are PROPOSED (awaiting owner approval):
 * Earned Leave 1 day per 20 eligible working days (from the feature document), 45-day goal cycle, 3-month probation, Manager -> HR leave chain.
 * Stored as JSON in workforce_settings (one row per organisation); every change bumps `version` and is audited.
 */
export const ATTENDANCE_STATUS_KEYS = ['PRESENT', 'ABSENT', 'HALF_DAY', 'WFH', 'LATE', 'HOLIDAY', 'WEEKLY_OFF', 'ON_LEAVE', 'UNPAID_LEAVE'] as const;
export type AttendanceStatusKey = (typeof ATTENDANCE_STATUS_KEYS)[number];

/** how a day with a given status counts toward the Earned Leave "eligible working days" counter */
export const ELIGIBILITY = z.enum(['COUNT', 'HALF', 'SKIP']);
export type Eligibility = z.infer<typeof ELIGIBILITY>;

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export const leaveTypeSchema = z.object({
  key: z.string().regex(/^[A-Z_]{2,20}$/),
  name: z.string().min(1).max(60),
  /** unpaid types never need a balance and become loss-of-pay in payroll */
  isPaid: z.boolean(),
  /** a balance must cover the request (UNPAID does not) */
  needsBalance: z.boolean(),
  maxConsecutiveDays: z.number().int().min(1).max(366).nullable().default(null),
  active: z.boolean().default(true),
});

export const workforceConfigSchema = z.object({
  timezone: z.string().min(1),
  /** ISO weekdays (1=Mon..7=Sun) that are weekly offs. Default Sunday (Mon-Sat working week, DEC-020). */
  weeklyOffDays: z.array(z.number().int().min(1).max(7)).max(6),
  attendance: z.object({
    selfCheckIn: z.boolean(),
    /** check-in after this local time is LATE */
    lateAfter: hhmm,
    /** self check-in allowed up to and including this local time (default '11:00'); later records are made by HR/manager corrections */
    checkInCutoff: hhmm,
    /** ONE org-wide meeting link (https only, null = none); the server only returns it to employees marked PRESENT/LATE/WFH/HALF_DAY today */
    meetingUrl: z
      .string()
      .trim()
      .max(500)
      .url()
      .refine((u) => u.toLowerCase().startsWith('https://'), 'Meeting link must start with https://')
      .nullable(),
    fullDayMinutes: z.number().int().min(60).max(1440),
    /** worked minutes at check-out: >= fullDayMinutes = PRESENT, >= halfDayMinutes = HALF_DAY, less = HALF_DAY flagged for review (never silently ABSENT) */
    halfDayMinutes: z.number().int().min(30).max(720),
    /** nightly job writes ABSENT for a working day with no record (never overwrites existing records, holidays, leave) */
    autoMarkAbsent: z.boolean(),
    /** HR/manager corrections allowed for dates up to N days back (HR: unlimited) */
    managerCorrectionWindowDays: z.number().int().min(0).max(366),
  }),
  leave: z.object({
    types: z.array(leaveTypeSchema).min(1).max(20),
    /** approval chain; a step is skipped when nobody can act (e.g. no manager) and the next step takes over */
    approvalChain: z.array(z.enum(['MANAGER', 'HR'])).min(1).max(2),
    /** when the request exceeds the balance: BLOCK it, or allow the excess as unpaid after explicit confirmation by the employee */
    balanceExceeded: z.enum(['BLOCK', 'UNPAID_WITH_CONFIRMATION']),
    /** applying for dates in the past is allowed up to N days back */
    backdateDays: z.number().int().min(0).max(90),
    allowHalfDay: z.boolean(),
  }),
  earnedLeave: z.object({
    enabled: z.boolean(),
    /** credit `creditDays` Earned Leave after this many eligible working days */
    requiredEligibleDays: z.number().int().min(1).max(366),
    creditDays: z.number().min(0.5).max(30),
    /** treatment of each daily status for the counter; weekly offs/holidays are skipped (they are not working days) */
    treatment: z.record(z.enum(ATTENDANCE_STATUS_KEYS), ELIGIBILITY),
    /** days before the joining date are never counted; the first counted day is the joining date */
    countFromJoiningDate: z.boolean(),
    leaveTypeKey: z.string().regex(/^[A-Z_]{2,20}$/),
    /** balance above this is not credited further (null = unlimited accumulation) */
    maxBalance: z.number().min(0).nullable(),
    /** carry-forward at year end: when disabled the Earned Leave balance above `carryForwardMax` expires on 1 January (null = all carries) */
    carryForwardEnabled: z.boolean(),
    carryForwardMax: z.number().min(0).nullable(),
  }),
  holidays: z.object({
    /** locations (country/state/branch labels) the organisation observes; suggestions are generated for them */
    locations: z.array(z.string().min(1).max(60)).max(20),
    /** fixed-date national holidays are suggested for review; moveable festivals are always entered by HR */
    suggestFixedNational: z.boolean(),
    /** OPTIONAL / RESTRICTED holidays are not days off unless the employee takes them as leave */
    optionalCountAsOff: z.boolean(),
  }),
  goals: z.object({
    cycleDays: z.number().int().min(7).max(366),
    /** AT_RISK when progress is more than this many percentage points behind the elapsed share of the cycle */
    atRiskGapPct: z.number().int().min(1).max(100),
    /** goals must be verified by the reviewer (manager) before they count as COMPLETED */
    requireVerification: z.boolean(),
    reminderDaysBeforeTarget: z.array(z.number().int().min(0).max(60)).max(5),
  }),
  tasks: z.object({
    /** the assignee moves work to REVIEW and the assigner completes it; when false the assignee may complete directly */
    requireReview: z.boolean(),
    reminderHoursBeforeDue: z.number().int().min(0).max(240),
  }),
  hr: z.object({
    probationDefaultMonths: z.number().int().min(1).max(12),
    probationReminderDays: z.array(z.number().int().min(0).max(60)).max(5),
    birthdayReminderDays: z.array(z.number().int().min(0).max(30)).max(5),
  }),
  payroll: z.object({
    currency: z.string().length(3),
    /** unpaid leave and ABSENT days reduce pay; HALF_DAY counts this share as loss of pay (0 = paid) */
    absentIsLossOfPay: z.boolean(),
    halfDayLossOfPay: z.number().min(0).max(1),
    /** divisor for the per-day rate: working days of the month (calendar-aware) */
    perDayBasis: z.enum(['WORKING_DAYS']),
  }),
});
export type WorkforceConfig = z.infer<typeof workforceConfigSchema>;

export const DEFAULT_WORKFORCE_CONFIG: WorkforceConfig = {
  timezone: 'Asia/Kolkata',
  weeklyOffDays: [7],
  attendance: { selfCheckIn: true, lateAfter: '10:15', checkInCutoff: '11:00', meetingUrl: null, fullDayMinutes: 480, halfDayMinutes: 240, autoMarkAbsent: true, managerCorrectionWindowDays: 7 },
  leave: {
    types: [
      { key: 'CASUAL', name: 'Casual leave', isPaid: true, needsBalance: true, maxConsecutiveDays: null, active: true },
      { key: 'SICK', name: 'Sick leave', isPaid: true, needsBalance: true, maxConsecutiveDays: null, active: true },
      { key: 'EARNED', name: 'Earned leave', isPaid: true, needsBalance: true, maxConsecutiveDays: null, active: true },
      { key: 'UNPAID', name: 'Unpaid leave', isPaid: false, needsBalance: false, maxConsecutiveDays: null, active: true },
    ],
    approvalChain: ['MANAGER', 'HR'],
    balanceExceeded: 'UNPAID_WITH_CONFIRMATION',
    backdateDays: 7,
    allowHalfDay: true,
  },
  earnedLeave: {
    enabled: true,
    requiredEligibleDays: 20,
    creditDays: 1,
    treatment: { PRESENT: 'COUNT', LATE: 'COUNT', WFH: 'COUNT', HALF_DAY: 'HALF', ABSENT: 'SKIP', HOLIDAY: 'SKIP', WEEKLY_OFF: 'SKIP', ON_LEAVE: 'SKIP', UNPAID_LEAVE: 'SKIP' },
    countFromJoiningDate: true,
    leaveTypeKey: 'EARNED',
    maxBalance: null,
    carryForwardEnabled: true,
    carryForwardMax: null,
  },
  holidays: { locations: ['India'], suggestFixedNational: true, optionalCountAsOff: false },
  goals: { cycleDays: 45, atRiskGapPct: 20, requireVerification: true, reminderDaysBeforeTarget: [7, 3] },
  tasks: { requireReview: true, reminderHoursBeforeDue: 24 },
  hr: { probationDefaultMonths: 3, probationReminderDays: [7], birthdayReminderDays: [7, 3, 1] },
  payroll: { currency: 'INR', absentIsLossOfPay: true, halfDayLossOfPay: 0.5, perDayBasis: 'WORKING_DAYS' },
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out: Json = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
}

/** Deep-merge a stored (possibly partial / older) config over the defaults (arrays replace). Invalid stored values fall back to defaults. */
/** Settings saved before the `paid` -> `isPaid` rename carry the old key; read them as isPaid. */
function upgradeStoredConfig(stored: unknown): unknown {
  const leave = (stored as { leave?: { types?: unknown } } | null)?.leave;
  if (!leave || !Array.isArray(leave.types)) return stored;
  const types = leave.types.map((t: unknown) => {
    if (!t || typeof t !== 'object' || !('paid' in t) || 'isPaid' in t) return t;
    const { paid, ...rest } = t as { paid: unknown };
    return { ...rest, isPaid: paid };
  });
  return { ...(stored as object), leave: { ...leave, types } };
}

export function resolveWorkforceConfig(stored: unknown): WorkforceConfig {
  const parsed = workforceConfigSchema.safeParse(merge(DEFAULT_WORKFORCE_CONFIG, upgradeStoredConfig(stored ?? {})));
  return parsed.success ? parsed.data : DEFAULT_WORKFORCE_CONFIG;
}

export const partialWorkforceConfigSchema = workforceConfigSchema.deepPartial();
