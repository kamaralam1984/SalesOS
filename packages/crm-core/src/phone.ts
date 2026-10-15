import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export interface NormalizedPhone {
  raw: string;
  /** E.164 (+919876543210) when valid */
  e164: string | null;
  valid: boolean;
  /** why it could not be normalised (flagged raw) */
  reason?: 'EMPTY' | 'UNPARSEABLE' | 'INVALID_NUMBER';
}

/** Normalise to E.164 using a default region (India). Invalid numbers are kept raw and flagged, never rejected here. */
export function normalizePhone(input: string | null | undefined, defaultRegion: CountryCode = 'IN'): NormalizedPhone {
  const raw = (input ?? '').trim();
  if (!raw) return { raw, e164: null, valid: false, reason: 'EMPTY' };
  const parsed = parsePhoneNumberFromString(raw, defaultRegion);
  if (!parsed) return { raw, e164: null, valid: false, reason: 'UNPARSEABLE' };
  if (!parsed.isValid()) return { raw, e164: null, valid: false, reason: 'INVALID_NUMBER' };
  return { raw, e164: parsed.number, valid: true };
}

/** Last 10 digits for fuzzy "possible duplicate" matching. */
export function phoneSuffix(value: string | null | undefined, n = 10): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= n ? digits.slice(-n) : null;
}

export const normalizeEmail = (e: string | null | undefined): string | null => {
  const v = (e ?? '').trim().toLowerCase();
  return v.length ? v : null;
};
