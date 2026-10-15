import type { KpiResult, KpiUnit, NullReason } from '@/lib/api/hooks/analytics';

const locale = (l: string) => (l === 'en' ? 'en-IN' : l);

/** Money string ("212000.00") -> "₹2,12,000" (fractions only when present). Never goes through binary float arithmetic. */
export function formatMoney(v: string | null | undefined, lc = 'en', currency = 'INR'): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const hasFraction = !/^-?\d+(\.0+)?$/.test(v);
  return new Intl.NumberFormat(locale(lc), { style: 'currency', currency, minimumFractionDigits: hasFraction ? 2 : 0, maximumFractionDigits: 2 }).format(n);
}

/** Keeps the precision the server rounded to ("62.0" stays "62.0"): the UI never re-rounds a KPI. */
export function formatNumber(v: string | number | null | undefined, lc = 'en'): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const decimals = typeof v === 'string' && v.includes('.') ? Math.min(4, v.length - v.indexOf('.') - 1) : 0;
  return new Intl.NumberFormat(locale(lc), { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, typeof v === 'number' ? 2 : 0) }).format(n);
}

/** Value with its unit. `null` is always an em dash: never 0, NaN or Infinity. */
export function formatKpiValue(k: Pick<KpiResult, 'value' | 'unit' | 'currency'>, lc = 'en'): string {
  if (k.value === null || k.value === undefined) return '—';
  switch (k.unit as KpiUnit) {
    case 'PERCENT':
      return `${formatNumber(k.value, lc)}%`;
    case 'CURRENCY':
      return formatMoney(k.value, lc, k.currency ?? 'INR');
    case 'MINUTES':
      return `${formatNumber(k.value, lc)} min`;
    case 'HOURS':
      return `${formatNumber(k.value, lc)} h`;
    case 'DAYS':
      return `${formatNumber(k.value, lc)} d`;
    default:
      return formatNumber(k.value, lc);
  }
}

/** numerator of denominator, when both exist and make sense for the unit. */
export function formatFraction(k: KpiResult, lc = 'en'): string | null {
  if (k.numerator === null || k.denominator === null) return null;
  const money = k.currency === 'INR' && /\.\d\d$/.test(k.numerator);
  const f = (v: string) => (money ? formatMoney(v, lc) : formatNumber(v, lc));
  return `${f(k.numerator)} / ${f(k.denominator)}`;
}

/** Calendar date (YYYY-MM-DD, IST business date) -> "1 Jul 2026". Rendered in UTC so it never shifts a day. */
export function formatDay(day: string | null | undefined, lc = 'en'): string {
  if (!day) return '—';
  return new Intl.DateTimeFormat(locale(lc), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
}

export function formatRange(from: string, to: string, lc = 'en'): string {
  return from === to ? formatDay(from, lc) : `${formatDay(from, lc)} – ${formatDay(to, lc)}`;
}

export function formatTime(iso: string | null | undefined, lc = 'en'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale(lc), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

export const NULL_REASON_KEYS: Record<NullReason, string> = {
  ZERO_DENOMINATOR: 'zeroDenominator',
  NO_TARGET: 'noTarget',
  NO_DATA: 'noData',
  NO_SNAPSHOT: 'noSnapshot',
  INSUFFICIENT_RESPONSES: 'insufficientResponses',
  NOT_COMPUTABLE: 'notComputable',
};

/** Whole-number chart value (display only). All arithmetic stays on the server; this is for plotting. */
export const chartNumber = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Compact rupees for chart axes: 2,12,000 -> "2.1L" */
export function compactMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

export const progressPct = (k: Pick<KpiResult, 'value' | 'unit'>): number | null => {
  if (k.unit !== 'PERCENT' || k.value === null) return null;
  const n = Number(k.value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};
