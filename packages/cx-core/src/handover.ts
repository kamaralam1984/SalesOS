import { LANGUAGES } from './constants';
import type { HandoverFieldKey } from './config';

export interface HandoverFields {
  learnerName?: string | null;
  learnerContact?: string | null;
  languagePreference?: string | null;
  programId?: string | null;
  programName?: string | null;
  amountPaid?: { toString(): string } | string | number | null;
  amountDue?: { toString(): string } | string | number | null;
  paymentVerified?: boolean | null;
  promisesMade?: string | null;
  goals?: string | null;
  objections?: string | null;
  specialNotes?: string | null;
  consents?: unknown;
}

const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

const CHECKS: Record<HandoverFieldKey, (h: HandoverFields) => boolean> = {
  learnerName: (h) => text(h.learnerName),
  learnerContact: (h) => text(h.learnerContact),
  languagePreference: (h) => typeof h.languagePreference === 'string' && (LANGUAGES as readonly string[]).includes(h.languagePreference),
  program: (h) => !!h.programId || text(h.programName),
  amountPaid: (h) => h.amountPaid !== null && h.amountPaid !== undefined && h.amountPaid !== '',
  amountDue: (h) => h.amountDue !== null && h.amountDue !== undefined && h.amountDue !== '',
  paymentVerified: (h) => typeof h.paymentVerified === 'boolean',
  promisesMade: (h) => text(h.promisesMade),
  goals: (h) => text(h.goals),
  objections: (h) => text(h.objections),
  specialNotes: (h) => text(h.specialNotes),
  // consent to share the minimum learner data with Student Success must be explicitly recorded as given
  consents: (h) => !!h.consents && typeof h.consents === 'object' && (h.consents as Record<string, unknown>).dataSharing === true,
};

/** The checklist: every required field with done/missing. A field is "done" only when meaningfully filled (not blank). */
export function handoverChecklist(h: HandoverFields, required: readonly HandoverFieldKey[]) {
  return required.map((key) => ({ key, done: CHECKS[key](h) }));
}

export function missingHandoverFields(h: HandoverFields, required: readonly HandoverFieldKey[]): HandoverFieldKey[] {
  return handoverChecklist(h, required).filter((i) => !i.done).map((i) => i.key);
}
