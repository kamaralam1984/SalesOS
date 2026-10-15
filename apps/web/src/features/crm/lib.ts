import { z } from 'zod';
import type { CallOutcome, TaskType } from '@/lib/api/hooks/crm';

/** DEC-020 default business timezone: Asia/Kolkata (UTC+05:30, no DST). Datetime inputs are interpreted in it. */
const IST_OFFSET_MIN = 330;

const pad = (n: number) => String(n).padStart(2, '0');

/** Date -> `YYYY-MM-DDTHH:mm` wall clock in IST (value for <input type="datetime-local">). */
export function toIstInput(d: Date): string {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` (IST wall clock) -> ISO instant, or null when empty/invalid. */
export function fromIstInput(v: string | undefined | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - IST_OFFSET_MIN * 60_000;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export type QuickPick = 'plus3h' | 'tomorrow10' | 'plus2d';

/** Next-action quick picks (docs/ux-design-system.md): +3 hours, tomorrow 10:00 IST, in 2 days 10:00 IST. */
export function quickPick(pick: QuickPick, now = new Date()): string {
  if (pick === 'plus3h') return toIstInput(new Date(now.getTime() + 3 * 3600_000));
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const days = pick === 'tomorrow10' ? 1 : 2;
  const t = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, 10, 0));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T10:00`;
}

export const humanize = (k: string) => k.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export const dispositionSchema = (opts: { lostNoteRequired: (reason: string) => boolean; now?: () => number }) =>
  z
    .object({
      outcome: z.enum(['CONNECTED', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'CALLBACK', 'FAILED', 'WON', 'LOST']),
      notes: z.string().max(4000, 'tooLong').optional(),
      interestLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional().or(z.literal('')),
      objectionCategory: z.string().optional(),
      nextActionAt: z.string().optional(),
      nextActionType: z.string().optional(),
      callbackAt: z.string().optional(),
      lostReason: z.string().optional(),
      lostNote: z.string().max(1000, 'tooLong').optional(),
      wonValue: z.string().optional(),
    })
    .superRefine((v, ctx) => {
      const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
      const now = (opts.now ?? Date.now)();
      const past = (local?: string) => {
        const iso = fromIstInput(local);
        return iso !== null && new Date(iso).getTime() < now - 5 * 60_000;
      };
      if (v.outcome === 'CONNECTED') {
        if (!v.interestLevel) add('interestLevel', 'crmInterestRequired');
        if (!fromIstInput(v.nextActionAt)) add('nextActionAt', 'crmNextActionRequired');
      }
      if (v.outcome === 'CALLBACK' && !fromIstInput(v.callbackAt)) add('callbackAt', 'crmCallbackRequired');
      if (v.outcome === 'LOST') {
        if (!v.lostReason) add('lostReason', 'crmLostReasonRequired');
        else if (opts.lostNoteRequired(v.lostReason) && !v.lostNote?.trim()) add('lostNote', 'crmLostNoteRequired');
      }
      if (v.outcome === 'WON' && !(Number(v.wonValue) > 0)) add('wonValue', 'crmWonValueRequired');
      if (past(v.nextActionAt)) add('nextActionAt', 'crmPast');
      if (past(v.callbackAt)) add('callbackAt', 'crmPast');
    });

export type DispositionValues = z.infer<ReturnType<typeof dispositionSchema>>;

/** Translate form values to the API body (server re-validates; source is never sent: calls are MANUAL). */
export function toCallBody(v: DispositionValues, taskId?: string) {
  const body: Record<string, unknown> = { outcome: v.outcome as CallOutcome };
  if (v.notes?.trim()) body.notes = v.notes.trim();
  if (v.interestLevel) body.interestLevel = v.interestLevel;
  if (v.objectionCategory) body.objectionCategory = v.objectionCategory;
  const next = v.outcome === 'LOST' || v.outcome === 'WON' ? null : fromIstInput(v.nextActionAt);
  if (next) body.nextActionAt = next;
  if (v.nextActionType && next) body.nextActionType = v.nextActionType as TaskType;
  const cb = fromIstInput(v.callbackAt);
  if (cb && (v.outcome === 'CALLBACK' || v.outcome === 'BUSY')) body.callbackAt = cb;
  if (v.outcome === 'LOST') {
    body.lostReason = v.lostReason;
    if (v.lostNote?.trim()) body.lostNote = v.lostNote.trim();
  }
  if (v.outcome === 'WON') body.wonValue = Number(v.wonValue);
  if (taskId) body.taskId = taskId;
  return body;
}

/** Outcomes that need a "next action" section in the form. */
export const needsNextAction = (o: CallOutcome) => o === 'CONNECTED' || o === 'NO_ANSWER' || o === 'SWITCHED_OFF' || o === 'FAILED';

export const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export const toTel = (phone?: string | null) => (phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null);

export const money = (v?: string | null, cur = 'INR') =>
  v == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(v));

/** True when the ISO instant is more than 5 minutes in the past (same tolerance as the API). */
export const isPast = (iso: string, now = Date.now()) => new Date(iso).getTime() < now - 5 * 60_000;
