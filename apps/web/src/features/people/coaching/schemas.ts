import { z } from 'zod';

export const actionRowSchema = z.object({
  title: z.string().trim().min(3, 'actionTitle').max(300, 'tooLong'),
  ownerId: z.string().min(1, 'required'),
  dueDate: z.string().optional(),
});
export type ActionRow = z.infer<typeof actionRowSchema>;

export const sessionFormSchema = z.object({
  kind: z.enum(['COACHING', 'SCORECARD_REVIEW', 'CALL_REVIEW', 'ROLE_PLAY']),
  sessionDate: z.string().min(1, 'required'),
  durationMin: z.number({ error: 'integer' }).int('integer').min(5, 'min5').max(480, 'maxDuration'),
  topics: z.array(z.string()).min(1, 'topicsRequired').max(6, 'topicsMax'),
  participantIds: z.array(z.string()).min(1, 'participantsRequired').max(20, 'participantsMax'),
  notes: z.string().max(10000, 'tooLong').optional(),
  noteVisibility: z.enum(['COACH_ONLY', 'PARTICIPANTS', 'MANAGEMENT']),
  callRef: z.string().max(120, 'tooLong').optional(),
  actions: z.array(actionRowSchema).max(20),
});
export type SessionFormValues = z.infer<typeof sessionFormSchema>;

const blank = (v?: string) => (v && v.trim() ? v.trim() : undefined);

/** Pure: form values -> POST /coaching/sessions body. Facts only (no scores). */
export function buildSessionPayload(v: SessionFormValues) {
  return {
    kind: v.kind,
    sessionDate: new Date(v.sessionDate).toISOString(),
    durationMin: v.durationMin,
    topics: v.topics,
    participantIds: v.participantIds,
    notes: blank(v.notes),
    noteVisibility: v.noteVisibility,
    callRef: blank(v.callRef),
    actions: v.actions.map((a) => ({ title: a.title.trim(), ownerId: a.ownerId, ...(a.dueDate ? { dueDate: a.dueDate } : {}) })),
  };
}

export const oneOnOneFormSchema = z.object({
  employeeId: z.string().min(1, 'required'),
  status: z.enum(['SCHEDULED', 'HELD']),
  scheduledFor: z.string().min(1, 'required'),
  durationMin: z.number({ error: 'integer' }).int('integer').min(5, 'min5').max(240, 'maxDuration1on1'),
  agenda: z.string().max(2000, 'tooLong').optional(),
  sharedNotes: z.string().max(10000, 'tooLong').optional(),
  privateNotes: z.string().max(10000, 'tooLong').optional(),
  actions: z.array(actionRowSchema).max(20),
});
export type OneOnOneFormValues = z.infer<typeof oneOnOneFormSchema>;

export function buildOneOnOnePayload(v: OneOnOneFormValues) {
  return {
    employeeId: v.employeeId,
    status: v.status,
    scheduledFor: new Date(v.scheduledFor).toISOString(),
    durationMin: v.durationMin,
    agenda: blank(v.agenda),
    sharedNotes: blank(v.sharedNotes),
    privateNotes: blank(v.privateNotes),
    actions: v.actions.map((a) => ({ title: a.title.trim(), ownerId: a.ownerId, ...(a.dueDate ? { dueDate: a.dueDate } : {}) })),
  };
}

/** Period presets for the coaching-hours card. */
export type HoursPeriod = 'week' | 'month' | 'last30';
export function periodRange(p: HoursPeriod, now = new Date()): { from: string; to: string } {
  const end = new Date(now);
  let start: Date;
  if (p === 'week') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  } else if (p === 'month') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else {
    start = new Date(now.getTime() - 30 * 86_400_000);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

/** `datetime-local` default value (local time, minute precision). */
export function localNow(now = new Date()): string {
  const off = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - off).toISOString().slice(0, 16);
}
