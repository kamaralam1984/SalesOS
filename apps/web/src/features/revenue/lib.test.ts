import { describe, expect, it } from 'vitest';
import { addMoney, cmpMoney, formatCount, formatMoney, formatPct, fromPaise, isMoneyInput, normalizeMoney, subMoney, toPaise, REFUND_NEXT } from './lib';

describe('money formatting never goes through a float', () => {
  it('formats INR with an explicit currency code and Indian grouping', () => {
    expect(formatMoney('123456.78')).toBe('INR 1,23,456.78');
    expect(formatMoney('0.00')).toBe('INR 0.00');
    expect(formatMoney('1000000.00')).toBe('INR 10,00,000.00');
    expect(formatMoney('12345678901.99')).toBe('INR 12,34,56,78,901.99');
  });
  it('keeps digits a float would lose', () => {
    // 2^53 + 1 is not representable as a JS number; the string path keeps it
    expect(formatMoney('9007199254740993.00').replace(/[^\d]/g, '')).toBe('900719925474099300');
  });
  it('shows a dash for a missing value, never zero', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatPct(null)).toBe('—');
    expect(formatPct('37.5')).toBe('37.5%');
    expect(formatCount('120')).toBe('120');
  });
  it('supports the symbol form where a header already says INR', () => {
    expect(formatMoney('2500.50', 'en-IN', { display: 'symbol' })).toBe('₹2,500.50');
  });
});

describe('paise arithmetic is exact', () => {
  it('adds and subtracts decimal strings without drift', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('99999999999.99', '0.01')).toBe('100000000000.00');
    expect(subMoney('100.00', '33.33')).toBe('66.67');
    expect(subMoney('10.00', '10.01')).toBe('-0.01');
  });
  it('compares', () => {
    expect(cmpMoney('10.00', '10')).toBe(0);
    expect(cmpMoney('10.01', '10.00')).toBe(1);
    expect(cmpMoney('9.99', '10.00')).toBe(-1);
  });
  it('round-trips', () => {
    for (const v of ['0.00', '0.05', '12.30', '123456789.01', '-5.50']) expect(fromPaise(toPaise(v))).toBe(v);
  });
  it('validates and normalises input', () => {
    expect(isMoneyInput('100')).toBe(true);
    expect(isMoneyInput('100.5')).toBe(true);
    expect(isMoneyInput('100.55')).toBe(true);
    for (const bad of ['', '0', '0.00', '-1', '1.234', 'abc', '1e5', '1,000']) expect(isMoneyInput(bad), bad).toBe(false);
    expect(normalizeMoney('100')).toBe('100.00');
    expect(normalizeMoney('100.5')).toBe('100.5');
  });
});

describe('refund workflow hints', () => {
  it('follow the state machine: nothing after a terminal state, process only after approval', () => {
    expect(REFUND_NEXT.REQUESTED.map((x) => x.action)).toEqual(['review', 'withdraw']);
    expect(REFUND_NEXT.REVIEWED.map((x) => x.action)).toEqual(['approve', 'reject']);
    expect(REFUND_NEXT.APPROVED.map((x) => x.action)).toEqual(['process', 'cancel']);
    expect(REFUND_NEXT.PROCESSED.map((x) => x.action)).toEqual(['reconcile']);
    for (const s of ['REJECTED', 'WITHDRAWN', 'RECONCILED', 'CANCELLED'] as const) expect(REFUND_NEXT[s]).toEqual([]);
    expect(REFUND_NEXT.APPROVED.find((x) => x.action === 'process')!.permission).toBe('refunds:process');
  });
});
