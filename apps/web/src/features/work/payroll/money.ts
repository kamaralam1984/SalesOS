/**
 * Display helpers for money held as decimal STRINGS ("12500.50"). No float arithmetic anywhere: amounts are only grouped and
 * prefixed for display; sums are done by the API in exact decimals.
 */
const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

const group = (digits: string, indian: boolean): string => {
  if (digits.length <= 3) return digits;
  if (!indian) return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
};

/** "1250000.5" -> "₹12,50,000.50" (INR uses lakh grouping). Non-numeric input is returned as an em dash, never "NaN". */
export function formatMoney(amount: string | null | undefined, currency = 'INR'): string {
  if (amount === null || amount === undefined || !/^-?\d+(\.\d+)?$/.test(amount)) return '—';
  const neg = amount.startsWith('-');
  const [whole = '0', frac = ''] = amount.replace('-', '').split('.');
  const body = `${group(whole.replace(/^0+(?=\d)/, ''), currency === 'INR')}.${frac.padEnd(2, '0').slice(0, 2)}`;
  const sym = SYMBOL[currency] ?? `${currency} `;
  return `${neg ? '-' : ''}${sym}${body}`;
}

/** Month "2026-08" -> "August 2026" in the given locale (no timezone shifting: pure calendar label). */
export function formatMonth(month: string, locale = 'en'): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** True for "12.50", "12", but not "0", "1.234", "-3", "1e3" (mirrors the API's payrollMoneySchema). */
export const isPositiveMoney = (v: string): boolean => /^\d{1,12}(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0;
