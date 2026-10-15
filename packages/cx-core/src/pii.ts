import { PII_KEY_PATTERN } from './constants';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// 8+ digits, allowing spaces / dashes / parentheses / leading + between them
const PHONE = /(?:\+?\d[\s().-]?){8,}/;

/** True when free text appears to contain an e-mail address or phone number. */
export function looksLikeContactDetails(text: string): boolean {
  return EMAIL.test(text) || PHONE.test(text);
}

/** Paths of keys (recursively) whose NAME suggests personal data. Used to keep minimum data in shared payloads. */
export function piiKeyPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (PII_KEY_PATTERN.test(k)) out.push(p);
    out.push(...piiKeyPaths(v, p));
  }
  return out;
}

/** Paths of string values (recursively) that look like contact details. */
export function piiValuePaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return looksLikeContactDetails(value) ? [prefix || '$'] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => piiValuePaths(v, prefix ? `${prefix}.${k}` : k));
}
