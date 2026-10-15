import type { PermissionKey } from '../../../common/authz';

export type IncentiveState = 'CALCULATED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ON_HOLD' | 'PAID' | 'CLAWBACK_PROPOSED' | 'ADJUSTED' | 'WAIVED';

export interface IncentiveTransitionRule {
  from: IncentiveState[];
  to: IncentiveState;
  /** caller must hold ANY of these permissions (server-side) */
  anyOf: PermissionKey[];
  audit: string;
  event: string;
  /** system-only transitions cannot be requested through the API */
  system?: boolean;
}

/** docs/state-machines.md section 10, implemented exactly. Terminal: REJECTED, ADJUSTED, WAIVED. */
export const INCENTIVE_RULES: IncentiveTransitionRule[] = [
  { from: ['CALCULATED'], to: 'SUBMITTED', anyOf: ['incentives:recommendation:create'], audit: 'incentive.submitted', event: 'incentive.submitted' },
  { from: ['SUBMITTED'], to: 'APPROVED', anyOf: ['incentives:recommendation:approve'], audit: 'incentive.approved', event: 'incentive.approved' },
  { from: ['SUBMITTED'], to: 'REJECTED', anyOf: ['incentives:recommendation:approve'], audit: 'incentive.rejected', event: 'incentive.rejected' },
  { from: ['SUBMITTED'], to: 'CALCULATED', anyOf: ['incentives:recommendation:create'], audit: 'incentive.recalculated', event: 'incentive.recalculated' },
  { from: ['APPROVED'], to: 'PAID', anyOf: ['incentives:recommendation:mark-paid'], audit: 'incentive.paid', event: 'incentive.paid' },
  { from: ['APPROVED'], to: 'ON_HOLD', anyOf: ['incentives:recommendation:approve', 'incentives:recommendation:mark-paid'], audit: 'incentive.held', event: 'incentive.held' },
  { from: ['ON_HOLD'], to: 'APPROVED', anyOf: ['incentives:recommendation:approve', 'incentives:recommendation:mark-paid'], audit: 'incentive.released', event: 'incentive.released' },
  { from: ['PAID'], to: 'CLAWBACK_PROPOSED', anyOf: [], audit: 'incentive.clawback_proposed', event: 'incentive.clawback_proposed', system: true },
  { from: ['CLAWBACK_PROPOSED'], to: 'ADJUSTED', anyOf: ['incentives:recommendation:approve', 'incentives:recommendation:mark-paid'], audit: 'incentive.adjusted', event: 'incentive.adjusted' },
  { from: ['CLAWBACK_PROPOSED'], to: 'WAIVED', anyOf: ['incentives:recommendation:approve', 'incentives:recommendation:mark-paid'], audit: 'incentive.waived', event: 'incentive.waived' },
];

export const findIncentiveRule = (from: string, to: string) => INCENTIVE_RULES.find((r) => r.to === to && (r.from as string[]).includes(from));
export const INCENTIVE_TERMINAL: IncentiveState[] = ['REJECTED', 'ADJUSTED', 'WAIVED'];
