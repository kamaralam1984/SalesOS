'use client';
import { useApiGet, useApiList, pk } from '../common/api';
import { useApiMutation } from '../hrkit/kit';

export type IncentiveStatus = 'CALCULATED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ON_HOLD' | 'PAID' | 'CLAWBACK_PROPOSED' | 'ADJUSTED' | 'WAIVED';

export interface IncentiveInputs {
  target: number;
  revenue: number;
  collections: number;
  refunds: number;
  metrics: Record<string, number>;
}
export interface GateResult { metric: string; op: string; value: number; actual: number | null; passed: boolean; label?: string }
export interface CalcBreakdown {
  eligible: boolean;
  reasons: string[];
  gateResults: GateResult[];
  basisAmount: string;
  netBasisAmount: string;
  achievementPct: string | null;
  slab: { minPct: number; maxPct: number | null; ratePct?: number; fixedAmount?: number } | null;
  rawAmount: string;
  capApplied: boolean;
  amount: string;
  currency: string;
}
export interface Adjustment {
  id: string;
  refundId: string;
  proposedAmount: string;
  decidedAmount: string | null;
  status: 'PROPOSED' | 'APPLIED' | 'WAIVED';
  reason: string | null;
  createdAt: string;
  currency?: string;
  recommendationId?: string;
  employeeName?: string | null;
}
interface Base {
  id: string;
  employeeId: string;
  employeeName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: IncentiveStatus;
  paidAt: string | null;
  currency: string;
}
export interface IncentiveStatusOnly extends Base { statusOnly: true }
export interface IncentiveFull extends Base {
  statusOnly: false;
  policyId: string;
  snapshotVersion: number;
  inputs: IncentiveInputs;
  inputSource: string;
  breakdown: CalcBreakdown;
  computedAmount: string;
  approvedAmount: string | null;
  overrideReason: string | null;
  recommendedById: string;
  recommendedByName: string | null;
  submitComments: string | null;
  submittedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  holdReason: string | null;
  paymentReference: string | null;
  version: number;
  createdAt: string;
  adjustments: Adjustment[];
  history?: Array<{ from: string | null; to: string; actorName: string | null; note: string | null; at: string }>;
}
export type Incentive = IncentiveFull | IncentiveStatusOnly;

export interface PolicyStructure {
  basis: 'REVENUE' | 'COLLECTION';
  periodType: 'MONTH' | 'QUARTER';
  slabMode: 'FLAT_ON_TOTAL' | 'MARGINAL';
  netOfRefunds: boolean;
  slabs: Array<{ minPct: number; maxPct: number | null; ratePct?: number; fixedAmount?: number }>;
  gates: Array<{ metric: string; op: '>=' | '>' | '<=' | '<'; value: number; label?: string }>;
  cap: number | null;
  clawbackWindowDays: number;
  currency: string;
}
export interface Policy {
  id: string;
  versionNumber: number;
  name: string;
  status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
  structure: PolicyStructure;
  effectiveFrom: string | null;
  notes: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  configured: boolean;
}
export interface PolicyList { policies: Policy[]; activePolicyId: string | null; state: 'CONFIGURED' | 'POLICY_NOT_CONFIGURED' }

export const useIncentives = (q: { status?: string; page: number }) =>
  useApiList<Incentive>(pk('incentives', 'list'), '/incentives/recommendations', { status: q.status, page: q.page, limit: 20 });
export const useIncentive = (id: string) => useApiGet<Incentive & { history?: IncentiveFull['history'] }>(pk('incentives', 'detail', id), `/incentives/recommendations/${id}`);
export const usePolicies = () => useApiGet<PolicyList>(pk('incentives', 'policies'), '/incentives/policies');
export const useAdjustments = () => useApiGet<Adjustment[]>(pk('incentives', 'adjustments'), '/incentives/adjustments');

export const useCreateRecommendation = () =>
  useApiMutation<{ employeeId: string; periodStart: string; periodEnd: string; inputs: IncentiveInputs }, Incentive>('post', () => '/incentives/recommendations');
export const useIncentiveTransition = (id: string) => useApiMutation<Record<string, unknown>, Incentive>('post', () => `/incentives/recommendations/${id}/transition`);
export const useMarkPaid = (id: string) => useApiMutation<{ reference: string }, Incentive>('post', () => `/incentives/recommendations/${id}/mark-paid`);
export const useCreatePolicy = () => useApiMutation<Record<string, unknown>, Policy>('post', () => '/incentives/policies');
export const useUpdatePolicy = (id: string) => useApiMutation<Record<string, unknown>, Policy>('patch', () => `/incentives/policies/${id}`);
export const useApprovePolicy = () => useApiMutation<string, unknown>('post', (id) => `/incentives/policies/${id}/approve`, () => ({}));
