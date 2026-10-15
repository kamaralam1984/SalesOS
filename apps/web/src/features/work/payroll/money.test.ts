import { describe, expect, it } from 'vitest';
import { formatMoney, formatMonth, isPositiveMoney } from './money';

describe('formatMoney', () => {
  it('groups INR in lakhs and keeps exact decimals', () => {
    expect(formatMoney('1250000.5')).toBe('₹12,50,000.50');
    expect(formatMoney('999.00')).toBe('₹999.00');
    expect(formatMoney('1000')).toBe('₹1,000.00');
    expect(formatMoney('0.05')).toBe('₹0.05');
    expect(formatMoney('24038.46')).toBe('₹24,038.46');
  });
  it('uses western grouping for other currencies and shows negatives', () => {
    expect(formatMoney('1250000.5', 'USD')).toBe('$1,250,000.50');
    expect(formatMoney('10', 'AED')).toBe('AED 10.00');
    expect(formatMoney('-4000.00')).toBe('-₹4,000.00');
  });
  it('never renders NaN: junk, null and undefined become a dash', () => {
    for (const v of [null, undefined, '', 'abc', '1e3', 'NaN', 'Infinity']) expect(formatMoney(v as string)).toBe('—');
  });
  it('does not lose precision on very large amounts (string based)', () => {
    expect(formatMoney('123456789012.99')).toBe('₹1,23,45,67,89,012.99');
  });
});

describe('formatMonth / isPositiveMoney', () => {
  it('formats a calendar month without timezone drift', () => {
    expect(formatMonth('2026-08')).toBe('August 2026');
    expect(formatMonth('2026-01')).toBe('January 2026');
    expect(formatMonth('bad')).toBe('bad');
  });
  it('mirrors the API money rule', () => {
    for (const ok of ['1', '12.5', '12.50', '0.01']) expect(isPositiveMoney(ok)).toBe(true);
    for (const bad of ['0', '0.00', '-1', '1.234', '1e3', '', 'abc', '1,000']) expect(isPositiveMoney(bad)).toBe(false);
  });
});
