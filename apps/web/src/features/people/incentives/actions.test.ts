import { describe, expect, it } from 'vitest';
import { allowedIncentiveActions, stepIndex, type ActionContext, type ActionPerms } from './actions';
import type { IncentiveStatus } from './api';

const none: ActionPerms = { create: false, approve: false, markPaid: false };
const ctx: ActionContext = { isRecommender: false, isEmployee: false, hasOpenProposal: true };
const manager: ActionPerms = { ...none, create: true };
const founder: ActionPerms = { ...none, approve: true };
const finance: ActionPerms = { ...none, markPaid: true };

describe('allowedIncentiveActions', () => {
  it('CALCULATED: only a creator can submit', () => {
    expect(allowedIncentiveActions('CALCULATED', manager, ctx)).toEqual(['submit']);
    expect(allowedIncentiveActions('CALCULATED', founder, ctx)).toEqual([]);
    expect(allowedIncentiveActions('CALCULATED', finance, ctx)).toEqual([]);
  });
  it('SUBMITTED: creator recalculates, Founder decides (never the recommender)', () => {
    expect(allowedIncentiveActions('SUBMITTED', manager, ctx)).toEqual(['recalculate']);
    expect(allowedIncentiveActions('SUBMITTED', founder, ctx)).toEqual(['approve', 'reject']);
    expect(allowedIncentiveActions('SUBMITTED', founder, { ...ctx, isRecommender: true })).toEqual([]);
    expect(allowedIncentiveActions('SUBMITTED', { create: true, approve: true, markPaid: false }, { ...ctx, isRecommender: true })).toEqual(['recalculate']);
    expect(allowedIncentiveActions('SUBMITTED', finance, ctx)).toEqual([]);
  });
  it('APPROVED: only Finance marks paid; Founder or Finance can hold', () => {
    expect(allowedIncentiveActions('APPROVED', finance, ctx)).toEqual(['markPaid', 'hold']);
    expect(allowedIncentiveActions('APPROVED', founder, ctx)).toEqual(['hold']);
    expect(allowedIncentiveActions('APPROVED', manager, ctx)).toEqual([]);
  });
  it('ON_HOLD: Founder or Finance release', () => {
    expect(allowedIncentiveActions('ON_HOLD', founder, ctx)).toEqual(['release']);
    expect(allowedIncentiveActions('ON_HOLD', finance, ctx)).toEqual(['release']);
    expect(allowedIncentiveActions('ON_HOLD', manager, ctx)).toEqual([]);
  });
  it('CLAWBACK_PROPOSED: adjust or waive only with an open proposal', () => {
    expect(allowedIncentiveActions('CLAWBACK_PROPOSED', founder, ctx)).toEqual(['adjust', 'waive']);
    expect(allowedIncentiveActions('CLAWBACK_PROPOSED', finance, ctx)).toEqual(['adjust', 'waive']);
    expect(allowedIncentiveActions('CLAWBACK_PROPOSED', founder, { ...ctx, hasOpenProposal: false })).toEqual([]);
    expect(allowedIncentiveActions('CLAWBACK_PROPOSED', manager, ctx)).toEqual([]);
  });
  it('terminal states and PAID offer nothing; PAID -> CLAWBACK_PROPOSED is system-only', () => {
    for (const s of ['REJECTED', 'ADJUSTED', 'WAIVED', 'PAID'] as IncentiveStatus[]) {
      expect(allowedIncentiveActions(s, { create: true, approve: true, markPaid: true }, ctx)).toEqual([]);
    }
  });
  it('the employee concerned never gets actions', () => {
    for (const s of ['CALCULATED', 'SUBMITTED', 'APPROVED', 'ON_HOLD', 'CLAWBACK_PROPOSED'] as IncentiveStatus[]) {
      expect(allowedIncentiveActions(s, { create: true, approve: true, markPaid: true }, { ...ctx, isEmployee: true })).toEqual([]);
    }
  });
  it('callers without any permission get nothing in any status', () => {
    for (const s of ['CALCULATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ON_HOLD', 'PAID', 'CLAWBACK_PROPOSED', 'ADJUSTED', 'WAIVED'] as IncentiveStatus[]) {
      expect(allowedIncentiveActions(s, none, ctx)).toEqual([]);
    }
  });
  it('stepper index follows the happy path', () => {
    expect([stepIndex('CALCULATED'), stepIndex('SUBMITTED'), stepIndex('REJECTED'), stepIndex('APPROVED'), stepIndex('ON_HOLD'), stepIndex('PAID')]).toEqual([0, 1, 1, 2, 2, 3]);
  });
});
