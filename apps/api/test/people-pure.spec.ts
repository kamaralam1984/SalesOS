import { describe, expect, it } from 'vitest';
import { calculateIncentive, evaluateGates, validateSlabs, type IncentiveInputs, type IncentiveStructure } from '../src/modules/people/incentives/engine';
import { findIncentiveRule, INCENTIVE_RULES } from '../src/modules/people/incentives/incentive-machine';
import { findPipRule, PIP_RULES } from '../src/modules/people/pip/pip-machine';
import { computeAdoption, pct } from '../src/modules/sop/adoption';
import { matchProfile } from '../src/modules/people/hiring/profile-match';
import { checklistProgress } from '../src/modules/people/onboarding/onboarding.service';
import { aggregateResponses } from '../src/modules/people/engagement/engagement.service';
import { incentiveStructureSchema } from '@salesos/validation';

// NOTE: every number below is a TEST FIXTURE used to exercise the engine. None is a business rule or a default.
const structure = (over: Partial<IncentiveStructure> = {}): IncentiveStructure => ({
  basis: 'COLLECTION', periodType: 'MONTH', slabMode: 'FLAT_ON_TOTAL', netOfRefunds: true,
  slabs: [{ minPct: 80, maxPct: 100, ratePct: 1 }, { minPct: 100, maxPct: 120, ratePct: 2 }, { minPct: 120, maxPct: null, ratePct: 3 }],
  gates: [], cap: null, clawbackWindowDays: 30, currency: 'INR', ...over,
});
const inputs = (over: Partial<IncentiveInputs> = {}): IncentiveInputs => ({ target: 1000, revenue: 0, collections: 1000, refunds: 0, metrics: {}, ...over });

describe('incentive engine (pure)', () => {
  it('FLAT_ON_TOTAL applies the matched slab rate to the whole net basis', () => {
    const r = calculateIncentive(structure(), inputs({ collections: 1100 }));
    expect(r.achievementPct).toBe('110.00');
    expect(r.slab?.ratePct).toBe(2);
    expect(r.amount).toBe('22.00');
    expect(r.eligible).toBe(true);
  });
  it('slab boundaries are min-inclusive, max-exclusive', () => {
    expect(calculateIncentive(structure(), inputs({ collections: 1000 })).slab?.ratePct).toBe(2); // exactly 100%
    expect(calculateIncentive(structure(), inputs({ collections: 800 })).slab?.ratePct).toBe(1); // exactly 80%
    expect(calculateIncentive(structure(), inputs({ collections: 799 })).amount).toBe('0.00');
    expect(calculateIncentive(structure(), inputs({ collections: 799 })).reasons).toContain('BELOW_FIRST_SLAB');
  });
  it('subtracts refunds from the basis when netOfRefunds is set, and not otherwise', () => {
    const net = calculateIncentive(structure(), inputs({ collections: 1100, refunds: 200 }));
    expect(net.netBasisAmount).toBe('900.00');
    expect(net.slab?.ratePct).toBe(1);
    expect(net.amount).toBe('9.00');
    const gross = calculateIncentive(structure({ netOfRefunds: false }), inputs({ collections: 1100, refunds: 200 }));
    expect(gross.netBasisAmount).toBe('1100.00');
    expect(gross.amount).toBe('22.00');
  });
  it('REVENUE basis uses revenue, COLLECTION basis uses collections', () => {
    expect(calculateIncentive(structure({ basis: 'REVENUE' }), inputs({ revenue: 1000, collections: 0 })).amount).toBe('20.00');
    expect(calculateIncentive(structure({ basis: 'COLLECTION' }), inputs({ revenue: 1000, collections: 0 })).eligible).toBe(true);
    expect(calculateIncentive(structure({ basis: 'COLLECTION' }), inputs({ revenue: 1000, collections: 0 })).amount).toBe('0.00');
  });
  it('fixed-amount slabs and the cap', () => {
    const s = structure({ slabs: [{ minPct: 100, maxPct: null, fixedAmount: 500 }], cap: 300 });
    const r = calculateIncentive(s, inputs());
    expect(r.rawAmount).toBe('500.00');
    expect(r.capApplied).toBe(true);
    expect(r.amount).toBe('300.00');
  });
  it('MARGINAL mode pays each band only on the revenue inside the band', () => {
    const s = structure({ slabMode: 'MARGINAL', slabs: [{ minPct: 0, maxPct: 100, ratePct: 1 }, { minPct: 100, maxPct: null, ratePct: 2 }] });
    const r = calculateIncentive(s, inputs({ collections: 1200 }));
    // band 0-100% of target 1000 at 1% = 10 ; band 100-120% = 200 at 2% = 4
    expect(r.amount).toBe('14.00');
  });
  it('gates make the result ineligible and report which gate failed', () => {
    const s = structure({ gates: [{ metric: 'crmCompliance', op: '>=', value: 90 }, { metric: 'achievementPct', op: '>=', value: 80 }] });
    const bad = calculateIncentive(s, inputs({ collections: 1100, metrics: { crmCompliance: 70 } }));
    expect(bad.eligible).toBe(false);
    expect(bad.amount).toBe('0.00');
    expect(bad.reasons).toEqual(['GATE_FAILED:crmCompliance']);
    const good = calculateIncentive(s, inputs({ collections: 1100, metrics: { crmCompliance: 95 } }));
    expect(good.eligible).toBe(true);
    expect(good.amount).toBe('22.00');
    expect(evaluateGates([{ metric: 'x', op: '>', value: 1 }], {})[0]!.passed).toBe(false); // missing metric fails closed
  });
  it('empty slabs (policy not yet filled in by the Founder) and zero target yield zero with a reason', () => {
    const none = calculateIncentive(structure({ slabs: [] }), inputs());
    expect(none.amount).toBe('0.00');
    expect(none.reasons).toContain('POLICY_HAS_NO_SLABS');
    expect(calculateIncentive(structure(), inputs({ target: 0 })).reasons).toContain('NO_TARGET');
  });
  it('rounds half up to 2 decimals and never produces float drift', () => {
    const s = structure({ slabs: [{ minPct: 0, maxPct: null, ratePct: 0.1 }] });
    expect(calculateIncentive(s, inputs({ collections: 1001.05, target: 1000 })).amount).toBe('1.00'); // 1.00105 -> 1.00
    expect(calculateIncentive(s, inputs({ collections: 1005, target: 1000 })).amount).toBe('1.01'); // 1.005 -> 1.01 (half up)
  });
  it('validateSlabs detects overlaps, bad shapes and open-ended slabs that are not last', () => {
    expect(validateSlabs([])).toEqual(['At least one slab is required']);
    expect(validateSlabs([{ minPct: 0, maxPct: 100, ratePct: 1 }, { minPct: 90, maxPct: null, ratePct: 2 }])).toContain('Slabs 1 and 2 overlap');
    expect(validateSlabs([{ minPct: 0, maxPct: null, ratePct: 1 }, { minPct: 100, maxPct: null, ratePct: 2 }])[0]).toMatch(/open-ended/);
    expect(validateSlabs([{ minPct: 0, maxPct: 50 }])[0]).toMatch(/exactly one/);
    expect(validateSlabs(structure().slabs)).toEqual([]);
  });
  it('policy structure schema defines NO default rates or slabs', () => {
    const parsed = incentiveStructureSchema.parse({ basis: 'REVENUE' });
    expect(parsed.slabs).toEqual([]);
    expect(parsed.cap).toBeNull();
  });
});

describe('state machine tables', () => {
  it('incentive machine matches docs/state-machines.md section 10', () => {
    const allowed = new Set(INCENTIVE_RULES.flatMap((r) => r.from.map((f) => `${f}->${r.to}`)));
    expect(allowed).toEqual(new Set([
      'CALCULATED->SUBMITTED', 'SUBMITTED->APPROVED', 'SUBMITTED->REJECTED', 'SUBMITTED->CALCULATED', 'APPROVED->PAID', 'APPROVED->ON_HOLD', 'ON_HOLD->APPROVED',
      'PAID->CLAWBACK_PROPOSED', 'CLAWBACK_PROPOSED->ADJUSTED', 'CLAWBACK_PROPOSED->WAIVED',
    ]));
    expect(findIncentiveRule('PAID', 'CLAWBACK_PROPOSED')?.system).toBe(true);
    for (const illegal of [['CALCULATED', 'APPROVED'], ['REJECTED', 'SUBMITTED'], ['PAID', 'APPROVED'], ['APPROVED', 'REJECTED'], ['ADJUSTED', 'PAID'], ['CALCULATED', 'PAID']] as const) {
      expect(findIncentiveRule(illegal[0], illegal[1])).toBeUndefined();
    }
  });
  it('PIP machine matches docs/state-machines.md section 9', () => {
    const allowed = new Set(PIP_RULES.flatMap((r) => r.from.map((f) => `${f}->${r.to}`)));
    expect(allowed).toEqual(new Set([
      'DRAFT->PENDING_APPROVAL', 'PENDING_APPROVAL->DRAFT', 'PENDING_APPROVAL->ACTIVE', 'ACTIVE->EXTENDED', 'EXTENDED->ACTIVE', 'ACTIVE->COMPLETED_SUCCESS', 'ACTIVE->COMPLETED_NOT_IMPROVED', 'ACTIVE->CANCELLED', 'DRAFT->CANCELLED',
    ]));
    for (const illegal of [['DRAFT', 'ACTIVE'], ['COMPLETED_SUCCESS', 'ACTIVE'], ['CANCELLED', 'DRAFT'], ['PENDING_APPROVAL', 'COMPLETED_SUCCESS'], ['EXTENDED', 'COMPLETED_SUCCESS']] as const) {
      expect(findPipRule(illegal[0], illegal[1])).toBeUndefined();
    }
  });
});

describe('SOP adoption maths', () => {
  it('computes per-document, per-user and overall rates from acknowledgements of the EFFECTIVE version only', () => {
    const reqs = [
      { documentId: 'd1', documentTitle: 'A', versionId: 'v1', versionNumber: 2, requiredUserIds: ['u1', 'u2', 'u3', 'u4'] },
      { documentId: 'd2', documentTitle: 'B', versionId: 'v2', versionNumber: 1, requiredUserIds: ['u1', 'u2'] },
    ];
    const acked = new Map([['v1', new Set(['u1', 'u2'])], ['v2', new Set(['u1'])], ['old-version', new Set(['u3', 'u4'])]]);
    const r = computeAdoption(reqs, acked);
    expect(r.byDocument.map((d) => [d.documentId, d.required, d.acknowledged, d.ratePct])).toEqual([['d1', 4, 2, 50], ['d2', 2, 1, 50]]);
    expect(r.overall).toEqual({ required: 6, acknowledged: 3, ratePct: 50 });
    const u1 = r.byUser.find((u) => u.userId === 'u1')!;
    expect(u1).toMatchObject({ required: 2, acknowledged: 2, ratePct: 100 });
    expect(r.byUser.find((u) => u.userId === 'u3')).toMatchObject({ required: 1, acknowledged: 0, ratePct: 0, pendingDocumentIds: ['d1'] });
    expect(r.byDocument[0]!.pendingUserIds).toEqual(['u3', 'u4']);
  });
  it('returns null (not 0 or 100) when nobody is required', () => {
    expect(computeAdoption([], new Map()).overall).toEqual({ required: 0, acknowledged: 0, ratePct: null });
    expect(pct(0, 0)).toBeNull();
    expect(pct(1, 3)).toBe(33.33);
  });
  it('deduplicates required users', () => {
    const r = computeAdoption([{ documentId: 'd', documentTitle: 'x', versionId: 'v', versionNumber: 1, requiredUserIds: ['u1', 'u1'] }], new Map());
    expect(r.overall.required).toBe(1);
  });
});

describe('hiring profile match, checklist progress, engagement anonymity', () => {
  const profile = { minEducation: 'Bachelor', minExperienceYears: 8, minTeamMgmtYears: 3, preferredIndustries: ['EdTech', 'Coaching'] };
  it('reports facts per criterion', () => {
    expect(matchProfile(profile, { experienceYears: 9, teamMgmtYears: 3, industries: ['edtech'], educationLevel: 'MBA' })).toMatchObject({ experience: 'MET', teamManagement: 'MET', industry: 'MET', education: 'UNKNOWN', matchedIndustries: ['edtech'] });
    expect(matchProfile(profile, { experienceYears: 5, teamMgmtYears: 1, industries: ['retail'] })).toMatchObject({ experience: 'NOT_MET', teamManagement: 'NOT_MET', industry: 'NOT_MET' });
    expect(matchProfile(profile, { industries: [] })).toMatchObject({ experience: 'UNKNOWN', teamManagement: 'UNKNOWN', industry: 'UNKNOWN' });
    expect(matchProfile({ preferredIndustries: [] }, { industries: [] })).toMatchObject({ experience: 'NOT_REQUIRED', industry: 'NOT_REQUIRED', education: 'NOT_REQUIRED' });
  });
  it('checklist progress ignores skipped items', () => {
    expect(checklistProgress([{ status: 'DONE' }, { status: 'PENDING' }, { status: 'SKIPPED' }, { status: 'DONE' }])).toEqual({ total: 4, done: 2, skipped: 1, pct: 67 });
    expect(checklistProgress([])).toEqual({ total: 0, done: 0, skipped: 0, pct: null });
  });
  it('suppresses engagement aggregates below the anonymity floor', () => {
    const qs = [{ id: 'q1', text: 'x', type: 'SCALE_5' as const }];
    expect(aggregateResponses(qs, [{ q1: 5 }, { q1: 4 }])).toBeNull();
    const agg = aggregateResponses(qs, [{ q1: 5 }, { q1: 4 }, { q1: 3 }, { q1: 4 }, { q1: 4 }])!;
    expect(agg[0]).toMatchObject({ responses: 5, average: 4, distribution: { '3': 1, '4': 3, '5': 1 } });
  });
});
