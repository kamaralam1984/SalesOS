/**
 * PII minimisation before ANY text leaves the server for an external model. Conservative regex redaction (it cannot find
 * every name or address - the docs say so); known lead/contact names passed by the caller are masked as well.
 */
export interface RedactionResult {
  text: string;
  count: number;
  kinds: Record<string, number>;
}

const RULES: Array<{ kind: string; re: RegExp; token: string }> = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, token: '[EMAIL]' },
  { kind: 'url', re: /\bhttps?:\/\/[^\s)]+/gi, token: '[URL]' },
  { kind: 'pan', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, token: '[ID_NUMBER]' },
  { kind: 'card', re: /\b(?:\d[ -]?){13,19}\b/g, token: '[CARD_OR_ACCOUNT]' },
  { kind: 'aadhaar', re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b(?![ -]?\d)/g, token: '[ID_NUMBER]' },
  { kind: 'ifsc', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, token: '[BANK_CODE]' },
  { kind: 'phone', re: /(?<!\d)(?:\+?\d{1,3}[ -]?)?(?:\(?\d{3,5}\)?[ -]?)?\d{3,5}[ -]?\d{4,5}(?!\d)/g, token: '[PHONE]' },
];

export function redactPii(input: string, knownNames: string[] = []): RedactionResult {
  let text = input;
  let count = 0;
  const kinds: Record<string, number> = {};
  for (const name of knownNames.filter((n) => n && n.trim().length >= 2)) {
    const re = new RegExp(`\\b${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    text = text.replace(re, () => { count++; kinds.name = (kinds.name ?? 0) + 1; return '[NAME]'; });
  }
  for (const r of RULES) {
    text = text.replace(r.re, (m) => {
      // a short number inside ordinary prose (e.g. "3 days", "5000") is not a phone: require 8+ digits for phone/card
      const digits = m.replace(/\D/g, '').length;
      if ((r.kind === 'phone' && digits < 8) || (r.kind === 'card' && digits < 13)) return m;
      count++;
      kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
      return r.token;
    });
  }
  return { text, count, kinds };
}
