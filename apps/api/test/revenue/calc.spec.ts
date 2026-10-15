import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  D, ZERO, achievementPct, allocate, averageDealValue, canDealTransition, canPaymentTransition, canRefundTransition, collectionActual, dailySeries, dealMoney, evaluateHighValue, forecastAccuracy, forecastBias, forecastBounds,
  istDate, istRange, money, pacing, percentile90, periodBounds, prorate, prorationBasis, resolveThreshold, revenueActual, round2, stageWeightedForecast, sum, targetAsOf, wape, workingDays, childLevel, revisionApproverRoles, probabilityFor, DEFAULT_STAGE_PROBABILITIES, type SaleView,
} from '../../src/modules/revenue/calc';

describe('money: Decimal precision and rounding', () => {
  it('adds exactly (no binary float drift)', () => {
    expect(sum(['0.10', '0.20']).toFixed(2)).toBe('0.30');
    expect(D('0.1').plus(D('0.2')).equals(D('0.3'))).toBe(true);
    expect(sum(Array.from({ length: 1000 }, () => '0.01')).toFixed(2)).toBe('10.00');
  });
  it('rounds half-up to 2dp, including negatives away from zero on ties', () => {
    expect(round2('1.005').toFixed(2)).toBe('1.01');
    expect(round2('2.675').toFixed(2)).toBe('2.68');
    expect(round2('1.004').toFixed(2)).toBe('1.00');
    expect(round2('-1.005').toFixed(2)).toBe('-1.01');
    expect(money('999999999999.99')).toBe('999999999999.99');
  });
  it('percentages are 1dp strings and null (not 0%) when the denominator is not positive', () => {
    expect(achievementPct('50000', '200000')).toBe('25.0');
    expect(achievementPct('1', '3')).toBe('33.3');
    expect(achievementPct('2', '3')).toBe('66.7');
    expect(achievementPct('10', '0')).toBeNull();
    expect(achievementPct('150', '100')).toBe('150.0');
  });
  it('allocate splits with the largest-remainder rule and always sums exactly', () => {
    const parts = allocate('100.00', [{ key: 'a', pct: '33.33' }, { key: 'b', pct: '33.33' }, { key: 'c', pct: '33.34' }]);
    expect(sum(parts.map((p) => p.amount)).toFixed(2)).toBe('100.00');
    expect(parts.map((p) => p.amount.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
    const odd = allocate('0.05', [{ key: 'a', pct: '50' }, { key: 'b', pct: '50' }]);
    expect(sum(odd.map((p) => p.amount)).toFixed(2)).toBe('0.05');
    const neg = allocate('-100.01', [{ key: 'a', pct: '60' }, { key: 'b', pct: '40' }]);
    expect(sum(neg.map((p) => p.amount)).toFixed(2)).toBe('-100.01');
    expect(allocate('10.00', [{ key: 'solo', pct: '100' }])[0]!.amount.toFixed(2)).toBe('10.00');
  });
  it('ZERO and sums of empty sets are exact zero', () => {
    expect(sum([]).equals(ZERO)).toBe(true);
    expect(D(null).isZero()).toBe(true);
  });
});

describe('deal money: sale / due / collected / refunded / net stay separate', () => {
  const base = { saleValue: '100000.00', payments: [], refunds: [] };
  it('Closed-Won without payments: collected 0, due = sale value', () => {
    const m = dealMoney(base);
    expect(money(m.saleValue)).toBe('100000.00');
    expect(money(m.collected)).toBe('0.00');
    expect(money(m.amountDue)).toBe('100000.00');
    expect(money(m.netCollections)).toBe('0.00');
  });
  it('only VERIFIED and RECONCILED payments count as collected; RECORDED is pending, EXPECTED/REJECTED/REVERSED never', () => {
    const m = dealMoney({ ...base, payments: [{ status: 'VERIFIED', amount: '30000' }, { status: 'RECONCILED', amount: '20000' }, { status: 'RECORDED', amount: '10000' }, { status: 'EXPECTED', amount: '40000' }, { status: 'REJECTED', amount: '5000' }, { status: 'REVERSED', amount: '7000' }] });
    expect(money(m.collected)).toBe('50000.00');
    expect(money(m.pendingVerification)).toBe('10000.00');
    expect(money(m.expected)).toBe('40000.00');
    expect(money(m.amountDue)).toBe('50000.00');
  });
  it('adjustments change the sale value but never the stored original', () => {
    const m = dealMoney({ ...base, approvedAdjustmentDeltas: ['-5000.00', '1000.50'] });
    expect(money(m.saleValue)).toBe('96000.50');
    expect(money(m.originalSaleValue)).toBe('100000.00');
    expect(money(m.adjustmentsTotal)).toBe('-3999.50');
  });
  it('refunds: only PROCESSED/RECONCILED reduce net collections; approved-not-processed and requested are shown separately', () => {
    const m = dealMoney({
      saleValue: '100000', payments: [{ status: 'VERIFIED', amount: '100000' }],
      refunds: [{ status: 'PROCESSED', amount: '10000', approvedAmount: '9000', processedAmount: '9000' }, { status: 'APPROVED', amount: '5000', approvedAmount: '5000' }, { status: 'REQUESTED', amount: '2000' }, { status: 'REJECTED', amount: '3000' }],
    });
    expect(money(m.refunded)).toBe('9000.00');
    expect(money(m.refundApprovedNotProcessed)).toBe('5000.00');
    expect(money(m.refundOpenRequests)).toBe('2000.00');
    expect(money(m.netCollections)).toBe('91000.00');
    expect(money(m.refundable)).toBe('84000.00'); // 100000 - (9000 + 5000 + 2000)
  });
  it('over-collection is reported, never a negative due', () => {
    const m = dealMoney({ saleValue: '100', payments: [{ status: 'VERIFIED', amount: '150' }], refunds: [] });
    expect(money(m.amountDue)).toBe('0.00');
    expect(money(m.overCollected)).toBe('50.00');
  });
});

describe('periods and proration (DEC-001)', () => {
  it('calendar month and quarter', () => {
    expect(periodBounds('MONTH', '2026-02-10')).toMatchObject({ startsOn: '2026-02-01', endsOn: '2026-02-28', label: 'Feb 2026' });
    expect(periodBounds('MONTH', '2028-02-10').endsOn).toBe('2028-02-29');
    expect(periodBounds('QUARTER', '2026-11-30')).toMatchObject({ startsOn: '2026-10-01', endsOn: '2026-12-31', label: 'Q4 2026' });
  });
  it('year = Indian fiscal year Apr-Mar by default, configurable', () => {
    expect(periodBounds('YEAR', '2026-10-15')).toMatchObject({ startsOn: '2026-04-01', endsOn: '2027-03-31', label: 'FY 2026-27' });
    expect(periodBounds('YEAR', '2027-02-01').startsOn).toBe('2026-04-01');
    expect(periodBounds('YEAR', '2026-10-15', 1)).toMatchObject({ startsOn: '2026-01-01', endsOn: '2026-12-31' });
  });
  it('weeks run Monday to Sunday', () => {
    expect(forecastBounds('WEEK', '2026-10-15')).toMatchObject({ startsOn: '2026-10-12', endsOn: '2026-10-18' });
    expect(forecastBounds('WEEK', '2026-10-18').startsOn).toBe('2026-10-12');
    expect(forecastBounds('WEEK', '2026-10-12').startsOn).toBe('2026-10-12');
  });
  it('working days are Mon-Sat', () => {
    expect(workingDays('2026-10-01', '2026-10-31')).toBe(27); // 31 days minus 4 Sundays
    expect(workingDays('2026-10-04', '2026-10-04')).toBe(0);
  });
  it('mid-period joiner is prorated by working days and the basis is explicit', () => {
    const b = prorationBasis('2026-10-01', '2026-10-31', '2026-10-16', null);
    expect(b).toMatchObject({ workingDaysPeriod: 27, joinOn: '2026-10-16' });
    expect(b.workingDaysActive).toBe(workingDays('2026-10-16', '2026-10-31'));
    expect(prorate('270000', b).toFixed(2)).toBe(D('270000').times(b.workingDaysActive).div(27).toDecimalPlaces(2).toFixed(2));
    const full = prorationBasis('2026-10-01', '2026-10-31', null, null);
    expect(prorate('270000', full).toFixed(2)).toBe('270000.00');
    const none = prorationBasis('2026-10-01', '2026-10-31', '2026-11-05', null);
    expect(none.workingDaysActive).toBe(0);
  });
  it('IST day conversion', () => {
    expect(istDate(new Date('2026-10-14T20:00:00.000Z'))).toBe('2026-10-15'); // 01:30 IST next day
    const r = istRange('2026-10-01', '2026-10-01');
    expect(r.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-01T18:30:00.000Z');
  });
});

describe('achievement, pacing, target as-of-date', () => {
  it('pacing is linear over the period', () => {
    const p = pacing('310000', '100000', '2026-10-01', '2026-10-31', '2026-10-15');
    expect(p.expectedToDate).toBe('150000.00'); // 15/31 of 310000
    expect(p.gap).toBe('-50000.00');
    expect(p.onTrack).toBe(false);
    expect(pacing('0', '5', '2026-10-01', '2026-10-31', '2026-10-15').expectedToDate).toBeNull();
  });
  it('target as-of-date uses the newest APPROVED revision effective on or before the date', () => {
    const revs = [
      { seq: 0, status: 'APPROVED' as const, newAmount: '1000000', effectiveFrom: '2026-10-01' },
      { seq: 1, status: 'APPROVED' as const, newAmount: '1200000', effectiveFrom: '2026-10-10' },
      { seq: 2, status: 'PENDING' as const, newAmount: '9999999', effectiveFrom: '2026-10-12' },
      { seq: 3, status: 'REJECTED' as const, newAmount: '1', effectiveFrom: '2026-10-12' },
    ];
    expect(targetAsOf(revs, '2026-10-05')!.toFixed(0)).toBe('1000000');
    expect(targetAsOf(revs, '2026-10-10')!.toFixed(0)).toBe('1200000');
    expect(targetAsOf(revs, '2026-10-31')!.toFixed(0)).toBe('1200000');
    expect(targetAsOf(revs, '2026-09-30')).toBeNull();
  });
  it('daily series is zero-filled with a running cumulative', () => {
    const s = dailySeries([{ at: new Date('2026-10-01T05:00:00Z'), amount: '100.50' }, { at: new Date('2026-10-03T05:00:00Z'), amount: '50.25' }], '2026-10-01', '2026-10-04');
    expect(s.map((x) => x.amount)).toEqual(['100.50', '0.00', '50.25', '0.00']);
    expect(s.map((x) => x.cumulative)).toEqual(['100.50', '100.50', '150.75', '150.75']);
  });
  it('average deal value is whole rupees and null with no deals', () => {
    expect(averageDealValue('100000', 3)).toBe('33333');
    expect(averageDealValue('0', 0)).toBeNull();
  });
});

describe('revenue and collection attribution (DEC-003/004/005)', () => {
  const win = istRange('2026-10-01', '2026-10-31');
  const sale = (dealId: string, value: string, closedAt: string, credits: Array<[string, string]>, adjustments: SaleView['adjustments'] = []): SaleView => ({
    dealId, saleValue: value, closedAt: new Date(closedAt), enrolments: 1,
    credits: allocate(value, credits.map(([k, p]) => ({ key: k, pct: p }))).map((a, i) => ({ userId: a.key, amount: a.amount, sharePct: credits[i]![1] })), adjustments,
  });
  const sales = [
    sale('d1', '100000.00', '2026-10-05T06:00:00Z', [['u1', '100']]),
    sale('d2', '60000.00', '2026-10-07T06:00:00Z', [['u1', '50'], ['u2', '50']]),
    sale('d3', '40000.00', '2026-09-20T06:00:00Z', [['u2', '100']]), // outside the window
    sale('d4', '20000.00', '2026-10-09T06:00:00Z', [['u2', '100']], [{ status: 'APPROVED', allocations: [{ userId: 'u2', amount: '-2000.00' }] }, { status: 'PENDING', allocations: [{ userId: 'u2', amount: '-9999.00' }] }]),
  ];
  const refunds = [
    { dealId: 'd1', status: 'APPROVED', amount: '10000', approvedAmount: '10000', approvedAt: new Date('2026-10-12T06:00:00Z') },
    { dealId: 'd2', status: 'REQUESTED', amount: '1000', approvedAmount: null, approvedAt: null },
    { dealId: 'd3', status: 'PROCESSED', amount: '4000', approvedAmount: '4000', approvedAt: new Date('2026-10-13T06:00:00Z'), processedAmount: '4000', processedAt: new Date('2026-10-14T06:00:00Z') },
  ];
  it('org revenue counts each sale once, nets approved adjustments and approved refunds only', () => {
    const r = revenueActual(sales, refunds, win, null);
    expect(money(r.booked)).toBe('178000.00'); // 100000 + 60000 + (20000 - 2000)
    expect(money(r.refundedApproved)).toBe('14000.00'); // d1 10000 + d3 4000 (approved in window), requested excluded
    expect(money(r.net)).toBe('164000.00');
    expect(r.wonCount).toBe(3);
  });
  it('per-user revenue follows the credit split and the per-user totals add up to the org total', () => {
    const u1 = revenueActual(sales, refunds, win, new Set(['u1']));
    const u2 = revenueActual(sales, refunds, win, new Set(['u2']));
    expect(money(u1.net)).toBe('120000.00'); // 100000 + 30000 - 10000
    expect(money(u2.net)).toBe('44000.00'); // 30000 + 18000 - 4000
    expect(money(u1.net.plus(u2.net))).toBe(money(revenueActual(sales, refunds, win, null).net));
  });
  it('collections: verified payments in the window net of processed refunds, credited per split', () => {
    const payments = [
      { dealId: 'd1', status: 'VERIFIED', amount: '60000', verifiedAt: new Date('2026-10-06T06:00:00Z') },
      { dealId: 'd2', status: 'RECONCILED', amount: '30000', verifiedAt: new Date('2026-10-08T06:00:00Z') },
      { dealId: 'd2', status: 'RECORDED', amount: '30000', verifiedAt: null },
      { dealId: 'd1', status: 'REVERSED', amount: '5000', verifiedAt: new Date('2026-10-06T06:00:00Z') },
    ];
    const org = collectionActual(sales, payments, refunds, win, null);
    expect(money(org.verified)).toBe('90000.00');
    expect(money(org.refunded)).toBe('4000.00');
    expect(money(org.net)).toBe('86000.00');
    const u1 = collectionActual(sales, payments, refunds, win, new Set(['u1']));
    const u2 = collectionActual(sales, payments, refunds, win, new Set(['u2']));
    expect(money(u1.verified)).toBe('75000.00'); // 60000 + 15000
    expect(money(u2.verified)).toBe('15000.00');
    expect(money(u1.verified.plus(u2.verified))).toBe(money(org.verified));
  });
});

describe('forecast: stage-weighted method (DEC-030)', () => {
  const deals = [
    { id: 'a', ownerId: 'u1', amount: '100000', stage: 'NEGOTIATION', expectedCloseOn: '2026-10-20' },
    { id: 'b', ownerId: 'u1', amount: '50000', stage: 'PAYMENT_PENDING', expectedCloseOn: '2026-10-18' },
    { id: 'c', ownerId: 'u2', amount: '80000', stage: 'OPEN', leadStatus: 'DEMO_ATTENDED', expectedCloseOn: '2026-10-25' },
    { id: 'd', ownerId: 'u2', amount: '70000', stage: 'OPEN', leadStatus: 'NEW', expectedCloseOn: '2026-11-02' }, // outside the period
    { id: 'e', ownerId: 'u2', amount: '30000', stage: 'NEGOTIATION', expectedCloseOn: null }, // unscheduled
    { id: 'f', ownerId: 'u2', amount: '20000', stage: 'NEGOTIATION', expectedCloseOn: '2026-10-03' }, // overdue
  ];
  const input = { periodStart: '2026-10-01', periodEnd: '2026-10-31', asOf: '2026-10-15', bookedToDate: '200000.00', deals };
  it('weights each open deal by its stage probability and adds booked-to-date', () => {
    const r = stageWeightedForecast(input);
    // a 60% = 60000 ; b 85% = 42500 ; c 35% (lead stage refines OPEN) = 28000
    expect(money(r.weightedPipeline)).toBe('130500.00');
    expect(money(r.total)).toBe('330500.00');
    expect(money(r.unweightedPipeline)).toBe('230000.00');
    expect(r.isEstimate).toBe(true);
    expect(r.includedDealIds.sort()).toEqual(['a', 'b', 'c']);
  });
  it('reports (does not silently include) unscheduled and overdue deals', () => {
    const r = stageWeightedForecast(input);
    expect(r.unscheduled).toEqual({ count: 1, amount: '30000.00' });
    expect(r.overdue).toEqual({ count: 1, amount: '20000.00' });
    expect(r.byStage.find((x) => x.stage === 'NEGOTIATION')).toMatchObject({ count: 1, probability: '0.60', weighted: '60000.00' });
  });
  it('probabilities are configurable and validated', () => {
    const r = stageWeightedForecast({ ...input, probabilities: { NEGOTIATION: '0.5' } });
    expect(money(r.weightedPipeline)).toBe('120500.00');
    expect(() => probabilityFor('X', { X: '1.5' })).toThrow(RangeError);
    expect(DEFAULT_STAGE_PROBABILITIES).toMatchObject({ NEW: '0.05', QUALIFIED: '0.15', DEMO_ATTENDED: '0.35', NEGOTIATION: '0.60', PAYMENT_PENDING: '0.85' });
  });
  it('deals expected before asOf are overdue even inside the period', () => {
    const r = stageWeightedForecast({ ...input, asOf: '2026-10-19' });
    expect(r.includedDealIds.sort()).toEqual(['a', 'c']);
    expect(r.overdue.count).toBe(2);
  });
});

describe('forecast accuracy (named error metrics)', () => {
  it('accuracy = max(0, 1 - |F-A|/A)', () => {
    expect(forecastAccuracy('90', '100')).toBe('90.0');
    expect(forecastAccuracy('110', '100')).toBe('90.0');
    expect(forecastAccuracy('250', '100')).toBe('0.0');
    expect(forecastAccuracy('100', '100')).toBe('100.0');
  });
  it('A <= 0 gives null (never 100%)', () => {
    expect(forecastAccuracy('100', '0')).toBeNull();
    expect(forecastBias('100', '0')).toBeNull();
  });
  it('bias is signed and WAPE aggregates over periods', () => {
    expect(forecastBias('110', '100')).toBe('10.0');
    expect(forecastBias('80', '100')).toBe('-20.0');
    expect(wape([{ forecast: '90', actual: '100' }, { forecast: '300', actual: '200' }])).toBe('36.7'); // (10+100)/300
    expect(wape([{ forecast: '5', actual: '0' }])).toBeNull();
  });
});

describe('high-value threshold (DEC-027)', () => {
  it('configured program threshold wins over org default; flags strictly above', () => {
    const r = resolveThreshold({ program: '100000', orgDefault: '50000', recentOpenAmounts: [] });
    expect(r.source).toBe('PROGRAM');
    expect(evaluateHighValue('100000', r).isHighValue).toBe(false);
    expect(evaluateHighValue('100000.01', r)).toMatchObject({ isHighValue: true, escalationLevel: 1 });
  });
  it('escalates to the Founder strictly above 2x the threshold', () => {
    const r = resolveThreshold({ program: '100000', recentOpenAmounts: [] });
    expect(evaluateHighValue('200000', r).escalationLevel).toBe(1);
    expect(evaluateHighValue('200000.01', r).escalationLevel).toBe(2);
  });
  it('falls back to the top 10% of recent open deals (needs 10 deals) and otherwise flags nothing', () => {
    const amounts = Array.from({ length: 20 }, (_, i) => String((i + 1) * 1000));
    expect(percentile90(amounts)!.toFixed(0)).toBe('18000');
    const r = resolveThreshold({ recentOpenAmounts: amounts });
    expect(r.source).toBe('TOP_10_PERCENT');
    expect(evaluateHighValue('18000', r).isHighValue).toBe(true);
    expect(evaluateHighValue('17999', r).isHighValue).toBe(false);
    const few = resolveThreshold({ recentOpenAmounts: ['1', '2'] });
    expect(few.source).toBe('NONE');
    expect(evaluateHighValue('9999999', few).isHighValue).toBe(false);
  });
});

describe('state machines', () => {
  it('deal', () => {
    expect(canDealTransition('OPEN', 'WON')).toBe(true);
    expect(canDealTransition('NEGOTIATION', 'PAYMENT_PENDING')).toBe(true);
    expect(canDealTransition('WON', 'OPEN')).toBe(false); // WON cannot be reopened
    expect(canDealTransition('WON', 'CANCELLED')).toBe(true);
    expect(canDealTransition('LOST', 'OPEN')).toBe(true);
    expect(canDealTransition('LOST', 'WON')).toBe(false);
  });
  it('payment', () => {
    expect(canPaymentTransition('RECORDED', 'VERIFIED')).toBe(true);
    expect(canPaymentTransition('EXPECTED', 'VERIFIED')).toBe(false);
    expect(canPaymentTransition('REJECTED', 'RECORDED')).toBe(true);
    expect(canPaymentTransition('RECONCILED', 'REVERSED')).toBe(false);
    expect(canPaymentTransition('VERIFIED', 'RECONCILED')).toBe(true);
  });
  it('refund: requested -> reviewed -> approved/rejected -> processed -> reconciled', () => {
    const ok = [['REQUESTED', 'REVIEWED'], ['REQUESTED', 'WITHDRAWN'], ['REVIEWED', 'APPROVED'], ['REVIEWED', 'REJECTED'], ['APPROVED', 'PROCESSED'], ['APPROVED', 'CANCELLED'], ['PROCESSED', 'RECONCILED']] as const;
    for (const [a, b] of ok) expect(canRefundTransition(a, b)).toBe(true);
    const bad = [['REQUESTED', 'APPROVED'], ['REQUESTED', 'PROCESSED'], ['REVIEWED', 'PROCESSED'], ['PROCESSED', 'CANCELLED'], ['REJECTED', 'APPROVED'], ['RECONCILED', 'PROCESSED'], ['APPROVED', 'REJECTED']] as const;
    for (const [a, b] of bad) expect(canRefundTransition(a, b)).toBe(false);
  });
  it('target hierarchy and revision approvers (DEC-002)', () => {
    expect(childLevel('FOUNDER')).toBe('TEAM_LEAD');
    expect(childLevel('EXECUTIVE')).toBeNull();
    expect(revisionApproverRoles('TEAM_LEAD')).toEqual(['FOUNDER_CEO']);
    expect(revisionApproverRoles('MANAGER')).toContain('SALES_TEAM_LEAD');
  });
  it('Prisma.Decimal is the money type', () => {
    expect(D('1.5')).toBeInstanceOf(Prisma.Decimal);
  });
});
