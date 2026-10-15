import { describe, expect, it } from 'vitest';
import { chartNumber, compactMoney, formatDay, formatFraction, formatKpiValue, formatMoney, formatRange, formatNumber, progressPct } from './format';
import type { KpiResult } from '@/lib/api/hooks/analytics';

const base = { id: 'KPI-X', name: 'x', unit: 'PERCENT', currency: null, value: '70.7', numerator: '212000.00', denominator: '300000.00' } as unknown as KpiResult;

describe('KPI formatting', () => {
  it('a null value is always an em dash: never 0, NaN or Infinity', () => {
    for (const unit of ['PERCENT', 'COUNT', 'CURRENCY', 'MINUTES', 'HOURS', 'DAYS', 'SCORE', 'RATIO'] as const) {
      expect(formatKpiValue({ value: null, unit, currency: null })).toBe('—');
    }
    expect(formatNumber('NaN')).toBe('—');
    expect(formatNumber('Infinity')).toBe('—');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('abc')).toBe('—');
    expect(chartNumber('NaN')).toBe(0);
    expect(chartNumber(null)).toBe(0);
  });
  it('keeps the precision the server rounded to', () => {
    expect(formatNumber('62.0')).toBe('62.0');
    expect(formatNumber('70.7')).toBe('70.7');
    expect(formatNumber('11')).toBe('11');
    expect(formatNumber('1234567.5')).toBe('12,34,567.5');
    expect(formatKpiValue({ value: '62.0', unit: 'PERCENT', currency: null })).toBe('62.0%');
  });
  it('shows units: percent, minutes, hours and INR with Indian grouping', () => {
    expect(formatKpiValue({ value: '70.7', unit: 'PERCENT', currency: null })).toBe('70.7%');
    expect(formatKpiValue({ value: '20', unit: 'MINUTES', currency: null })).toBe('20 min');
    expect(formatKpiValue({ value: '3.3', unit: 'HOURS', currency: null })).toBe('3.3 h');
    expect(formatKpiValue({ value: '212000.00', unit: 'CURRENCY', currency: 'INR' })).toBe('₹2,12,000');
    expect(formatMoney('1250.50')).toBe('₹1,250.50');
  });
  it('fractions show numerator / denominator and are hidden when either is missing', () => {
    expect(formatFraction({ ...base, currency: 'INR' })).toBe('₹2,12,000 / ₹3,00,000');
    expect(formatFraction({ ...base, denominator: null })).toBeNull();
    expect(formatFraction({ ...base, numerator: '2', denominator: '10', currency: null })).toBe('2 / 10');
  });
  it('dates are IST calendar days and never shift', () => {
    expect(formatDay('2026-07-01')).toBe('1 Jul 2026');
    expect(formatRange('2026-07-01', '2026-07-31')).toBe('1 Jul 2026 – 31 Jul 2026');
    expect(formatRange('2026-07-05', '2026-07-05')).toBe('5 Jul 2026');
  });
  it('progress is clamped to 0..100 and only for percent KPIs', () => {
    expect(progressPct({ value: '137.5', unit: 'PERCENT' })).toBe(100);
    expect(progressPct({ value: '-5', unit: 'PERCENT' })).toBe(0);
    expect(progressPct({ value: null, unit: 'PERCENT' })).toBeNull();
    expect(progressPct({ value: '5', unit: 'COUNT' })).toBeNull();
  });
  it('compact rupees for chart axes', () => {
    expect(compactMoney(212000)).toBe('2.1L');
    expect(compactMoney(25000000)).toBe('2.5Cr');
    expect(compactMoney(900)).toBe('900');
  });
});
