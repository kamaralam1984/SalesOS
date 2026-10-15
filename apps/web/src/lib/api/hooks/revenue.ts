'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { PaginationMeta } from '../types';

/* ------------------------------------------------------------------ wire types (mirror apps/api revenue serializers)
 * ALL money values are 2-decimal STRINGS ("12500.00"); never parse them into JS numbers for arithmetic. */
export type Money = string;
export type DealStage = 'OPEN' | 'NEGOTIATION' | 'PAYMENT_PENDING' | 'WON' | 'LOST' | 'CANCELLED';
export type PaymentStatus = 'EXPECTED' | 'RECORDED' | 'VERIFIED' | 'REJECTED' | 'RECONCILED' | 'REVERSED';
export type RefundStatus = 'REQUESTED' | 'REVIEWED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'PROCESSED' | 'RECONCILED' | 'CANCELLED';
export type TargetMetric = 'REVENUE' | 'COLLECTION' | 'ENROLMENT';
export type TargetLevel = 'FOUNDER' | 'TEAM_LEAD' | 'MANAGER' | 'EXECUTIVE';
export type PaymentMethod = 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'CASH' | 'CHEQUE' | 'GATEWAY' | 'OTHER';

export interface DealMoney {
  currency: string;
  saleValue: Money;
  originalSaleValue: Money;
  adjustmentsTotal: Money;
  collected: Money;
  pendingVerification: Money;
  amountDue: Money;
  overCollected: Money;
  refunded: Money;
  refundApprovedNotProcessed: Money;
  refundOpenRequests: Money;
  netCollections: Money;
  refundable: Money;
  collectionPct: string | null;
}

export interface Deal {
  id: string;
  leadId: string;
  leadName: string | null;
  leadStatus: string | null;
  programId: string;
  programName: string | null;
  programCode: string | null;
  fromProgramId: string | null;
  fromProgramName: string | null;
  ownerId: string;
  ownerName: string | null;
  teamId: string | null;
  stage: DealStage;
  dealType: 'NEW' | 'UPSELL' | 'CROSS_SELL';
  amount: Money | null;
  currency: string;
  enrolments: number;
  expectedCloseOn: string | null;
  isHighValue: boolean;
  highValueThreshold: Money | null;
  escalationLevel: number;
  closedAt: string | null;
  lostReason: string | null;
  note: string | null;
  money: DealMoney | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  replayed?: boolean;
}

export interface Blocker {
  id: string;
  kind: 'BLOCKER' | 'HIGH_VALUE';
  note: string;
  requestedHelp: string | null;
  raisedByName: string | null;
  escalatedToIds: string[];
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolution: string | null;
  createdAt: string;
}

export interface DealDetail extends Deal {
  history: { id: string; oldStage: DealStage | null; newStage: DealStage; reason: string | null; changedByName: string | null; at: string }[];
  blockers: Blocker[];
  salesRecord: null | {
    id: string;
    saleValue: Money;
    currency: string;
    closedAt: string;
    credits: { userId: string; userName: string | null; sharePct: string; amount: Money }[];
    adjustments: { id: string; kind: string; delta: Money; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; createdByName: string | null; createdAt: string; approvedByName: string | null; approvedAt: string | null; decisionNote: string | null }[];
  };
  payments: null | DealPayment[];
  refunds: null | { id: string; status: RefundStatus; amount: Money; approvedAmount: Money | null; processedAmount: Money | null; reasonCategory: string; requestedAt: string }[];
}

export interface DealPayment {
  id: string;
  status: PaymentStatus;
  amount: Money;
  expectedAmount: Money | null;
  dueDate: string | null;
  method: PaymentMethod | null;
  provider: string;
  externalTransactionRef: string | null;
  paidAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface PipelineStage {
  stage: DealStage;
  count: number;
  amount: Money | null;
  currency: string;
  highValueCount: number;
}

export interface Payment extends Omit<DealPayment, 'createdAt'> {
  dealId: string;
  ownerId: string;
  teamId: string | null;
  currency: string;
  note: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
  verifiedByName: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  reconciledAt: string | null;
  statementRef: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
  createdAt: string;
  version: number;
  leadName?: string | null;
  programName?: string | null;
  replayed?: boolean;
  events?: { id: string; fromStatus: PaymentStatus | null; toStatus: PaymentStatus; actorName: string | null; actorRole: string | null; reason: string | null; at: string }[];
}

export interface ReconciliationTotals {
  currency: string;
  bookedSales: Money;
  collectedVerified: Money;
  reconciled: Money;
  verifiedAwaitingReconciliation: Money;
  pendingVerification: Money;
  expected: Money;
  reversed: Money;
  refundedProcessed: Money;
  netCollections: Money;
  outstandingDue: Money;
  collectionPct: string | null;
  saleCount: number;
}
export type ReconciliationView = 'unreconciled' | 'deal-mismatch' | 'duplicates';
export interface Reconciliation {
  totals: ReconciliationTotals;
  view: ReconciliationView;
  items: Array<Record<string, unknown>>;
}
export interface ReconcileResult {
  statementRef: string;
  matched: { paymentId: string; externalTransactionRef: string | null; amount: Money }[];
  unmatched: { externalTransactionRef: string | null; paymentId?: string; amount?: Money; reason: string }[];
  matchedCount: number;
  unmatchedCount: number;
}

export interface Actor {
  id: string;
  name: string | null;
  role: string | null;
  at: string | null;
}
export interface Refund {
  id: string;
  dealId: string;
  paymentId?: string | null;
  leadName?: string | null;
  ownerId?: string;
  status: RefundStatus;
  amount?: Money;
  approvedAmount?: Money | null;
  processedAmount?: Money | null;
  currency: string;
  reasonCategory: string;
  reason?: string;
  recommendation?: string | null;
  requested?: Actor | null;
  reviewed?: Actor | null;
  reviewNote?: string | null;
  approved?: Actor | null;
  approvalReason?: string | null;
  rejected?: Actor | null;
  rejectionReason?: string | null;
  processed?: Actor | null;
  processMethod?: string | null;
  externalRef?: string | null;
  reconciled?: Actor | null;
  statementRef?: string | null;
  closedReason?: string | null;
  requestedAt?: string;
  createdAt?: string;
  events?: { id: string; fromStatus: RefundStatus | null; toStatus: RefundStatus; actorId: string; actorName: string | null; actorRole: string | null; reason: string | null; at: string }[];
}

export interface TargetPeriod {
  id: string;
  type: 'MONTH' | 'QUARTER' | 'YEAR';
  label: string;
  startsOn: string;
  endsOn: string;
}
export interface Target {
  id: string;
  periodId: string;
  period: TargetPeriod;
  metric: TargetMetric;
  level: TargetLevel;
  unit: string;
  ownerUserId: string | null;
  ownerName: string | null;
  parentId: string | null;
  amount: string;
  originalAmount: string;
  currency: string;
  prorationBasis: { workingDaysPeriod: number; workingDaysActive: number; baseAmount: string; joinOn: string | null; leaveOn: string | null } | null;
  note: string | null;
  version: number;
  pendingRevision: null | { id: string; newAmount: string; proposedAt: string };
}
export interface BreakdownNode {
  id: string;
  level: TargetLevel;
  ownerUserId: string | null;
  ownerName: string | null;
  amount: string;
  originalAmount: string;
  childrenSum: string;
  unallocated: string;
  hasChildren: boolean;
  hiddenChildren: number;
  consistency: 'CONSISTENT' | 'UNDER_ALLOCATED' | 'OVER_ALLOCATED' | 'NO_BREAKDOWN';
  children: BreakdownNode[];
}
export interface TargetRevision {
  id: string;
  seq: number;
  oldAmount: string | null;
  newAmount: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  effectiveFrom: string;
  proposedByName: string | null;
  proposedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}
export interface Achievement {
  targetId: string;
  metric: TargetMetric;
  level: TargetLevel;
  currency: string;
  asOf: string;
  target: string;
  originalTarget: string;
  currentTarget: string;
  actual: string;
  achievementPct: string | null;
  noTargetSet: boolean;
  pacing: { expectedToDate: string | null; gap: string | null; onTrack: boolean | null; elapsedDays: number; totalDays: number };
  detail: Record<string, string | number>;
  daily: { date: string; amount: string; cumulative: string }[];
  definition: string;
}

export interface ForecastSnapshot {
  id: string;
  kind: 'PERIOD_START' | 'ADHOC';
  takenAt: string;
  takenByName?: string | null;
  isEstimate: true;
  label: string;
  total: Money;
  bookedToDate: Money;
  weightedPipeline: Money;
  unweightedPipeline: Money;
  byStage: { stage: string; count: number; amount: Money; probability: string; weighted: Money }[];
  byOwner: { ownerId: string; weighted: Money; unweighted: Money; dealCount: number }[];
  unscheduled: { count: number; amount: Money } | null;
  overdue: { count: number; amount: Money } | null;
}
export interface ForecastAccuracy {
  periodClosed: boolean;
  basis: string | null;
  forecast: Money | null;
  actual: Money | null;
  accuracyPct: string | null;
  biasPct: string | null;
  errorMetric: string;
  note?: string | null;
}
export interface ForecastRow {
  id: string;
  periodType: 'WEEK' | 'MONTH';
  periodStart: string;
  periodEnd: string;
  scope: 'ORG' | 'TEAM';
  snapshotCount: number;
  latest: ForecastSnapshot | null;
  accuracy: ForecastAccuracy | null;
}
export interface ForecastPreview {
  method: string;
  isEstimate: true;
  label: string;
  periodType: 'WEEK' | 'MONTH';
  periodStart: string;
  periodEnd: string;
  asOf: string;
  scope: 'ORG' | 'TEAM';
  currency: string;
  total: Money;
  bookedToDate: Money;
  weightedPipeline: Money;
  unweightedPipeline: Money;
  byStage: ForecastSnapshot['byStage'];
  byOwner: ForecastSnapshot['byOwner'];
  unscheduled: { count: number; amount: Money };
  overdue: { count: number; amount: Money };
  dealCount: number;
  methodNote: string;
}
export interface AccuracySummary {
  periodType: string;
  wapePct: string | null;
  periods: (ForecastAccuracy & { forecastId: string; periodStart: string; periodEnd: string })[];
  count: number;
}

export interface Program {
  id: string;
  code: string;
  name: string;
  kind: string;
  highValueThreshold?: Money | null;
}
export interface ProgramPrice {
  programId: string;
  programName: string;
  programCode: string;
  id: string;
  amount: Money;
  currency: string;
  taxInclusive: boolean;
  effectiveFrom: string;
  proposalId: string | null;
}
export interface Proposal {
  id: string;
  type: 'PRICE_CHANGE' | 'OFFER' | 'DISCOUNT' | 'BUNDLE';
  programId: string | null;
  programName: string | null;
  title: string;
  rationale: string;
  currentAmount: Money | null;
  proposedAmount: Money | null;
  currency: string;
  effectiveFrom: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  createdByName: string | null;
  submittedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  history?: { id: string; fromStatus: string | null; toStatus: string; actorName: string | null; actorRole: string | null; note: string | null; at: string }[];
  feedback?: { id: string; kind: string; title: string; category: string }[];
}
export interface FeedbackEntry {
  id: string;
  kind: 'MARKET' | 'COMPETITOR' | 'LEARNER';
  category: string;
  source: string | null;
  title: string;
  notes: string;
  competitor: string | null;
  evidenceUrl: string | null;
  proposalId: string | null;
  status: 'NEW' | 'REVIEWED' | 'ACTIONED' | 'DISMISSED';
  createdByName: string | null;
  createdAt: string;
}
export interface GrowthOpportunity {
  id: string;
  type: 'CHANNEL' | 'SEGMENT' | 'OTHER';
  title: string;
  description: string;
  estimatedValue: Money | null;
  currency: string;
  ownerName: string | null;
  status: 'IDEA' | 'EVALUATING' | 'PILOT' | 'ADOPTED' | 'DROPPED';
  createdAt: string;
}
export interface RevenueSettings {
  fiscalYearStartMonth: number;
  stageProbabilities: Record<string, string>;
  stageProbabilitiesAreDefaults: boolean;
  defaultHighValueThreshold: Money | null;
  refundFounderThreshold: Money | null;
  paymentTolerance: Money;
  defaultPaymentDueDays: number;
}

export interface Page<T> {
  items: T[];
  pagination?: PaginationMeta;
}

/* ------------------------------------------------------------------ keys */
export const rk = {
  all: ['revenue'] as const,
  deals: (q?: object) => ['revenue', 'deals', q ?? {}] as const,
  deal: (id: string) => ['revenue', 'deal', id] as const,
  pipeline: ['revenue', 'pipeline'] as const,
  payments: (q?: object) => ['revenue', 'payments', q ?? {}] as const,
  reconciliation: (v: string) => ['revenue', 'reconciliation', v] as const,
  refunds: (q?: object) => ['revenue', 'refunds', q ?? {}] as const,
  refund: (id: string) => ['revenue', 'refund', id] as const,
  periods: ['revenue', 'periods'] as const,
  targets: (q?: object) => ['revenue', 'targets', q ?? {}] as const,
  breakdown: (id: string) => ['revenue', 'breakdown', id] as const,
  revisions: (id: string) => ['revenue', 'revisions', id] as const,
  achievement: (id: string) => ['revenue', 'achievement', id] as const,
  forecasts: ['revenue', 'forecasts'] as const,
  forecastPreview: (t: string) => ['revenue', 'forecast-preview', t] as const,
  forecastSnapshots: (id: string) => ['revenue', 'forecast-snapshots', id] as const,
  accuracy: (t: string) => ['revenue', 'accuracy', t] as const,
  programs: ['revenue', 'programs'] as const,
  prices: ['revenue', 'prices'] as const,
  proposals: (q?: object) => ['revenue', 'proposals', q ?? {}] as const,
  proposal: (id: string) => ['revenue', 'proposal', id] as const,
  feedback: (q?: object) => ['revenue', 'feedback', q ?? {}] as const,
  growth: (q?: object) => ['revenue', 'growth', q ?? {}] as const,
  settings: ['revenue', 'settings'] as const,
  leadSearch: (q: string) => ['revenue', 'lead-search', q] as const,
};

type Q = Record<string, string | number | boolean | undefined>;
const listFn = <T>(path: string, q: Q) => async () => {
  const r = await api.get<T[]>(path, q);
  return { items: r.data, pagination: r.meta.pagination } as Page<T>;
};
const idemKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: rk.all });
}

/* ------------------------------------------------------------------ deals */
export const useDeals = (q: Q = {}) => useQuery({ queryKey: rk.deals(q), placeholderData: keepPreviousData, queryFn: listFn<Deal>('/deals', q) });
export const usePipeline = () => useQuery({ queryKey: rk.pipeline, queryFn: async () => (await api.get<PipelineStage[]>('/deals/pipeline')).data });
export const useDeal = (id: string) => useQuery({ queryKey: rk.deal(id), queryFn: async () => (await api.get<DealDetail>(`/deals/${id}`)).data });
export const usePrograms = () => useQuery({ queryKey: rk.programs, staleTime: 60_000, queryFn: async () => (await api.get<Program[]>('/revenue/programs')).data });
export const useLeadSearch = (q: string) =>
  useQuery({
    queryKey: rk.leadSearch(q),
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const r = await api.get<Array<{ id: string; fullName: string; status: string; stageCategory: string; program?: { name: string | null } | null }>>('/leads', { q, limit: 8 });
      return r.data;
    },
  });

export function useCreateDeal() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async ({ leadId, ...body }: { leadId: string; programId: string; amount: string; dealType?: string; fromProgramId?: string; expectedCloseOn?: string; enrolments?: number; note?: string }) =>
      (await api.post<Deal>(`/leads/${leadId}/deals`, { currency: 'INR', ...body }, { headers: { 'Idempotency-Key': idemKey() } })).data,
    onSuccess: inv,
  });
}
export function useUpdateDeal() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, ...body }: { id: string; stage?: string; amount?: string; expectedCloseOn?: string | null; note?: string | null; reason?: string; version?: number }) => (await api.patch<Deal>(`/deals/${id}`, body)).data, onSuccess: inv });
}
export type CloseBody =
  | { outcome: 'WON'; finalAmount: string; paymentPlan?: { amount: string; dueDate: string }[]; credits?: { userId: string; sharePct: string }[]; note?: string }
  | { outcome: 'LOST'; lostReason: string; lostNote?: string };
export function useCloseDeal() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, body }: { id: string; body: CloseBody }) => (await api.post<Deal>(`/deals/${id}/close`, body, { headers: { 'Idempotency-Key': idemKey() } })).data, onSuccess: inv });
}
export function useEscalateDeal() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, ...body }: { id: string; note: string; requestedHelp?: string; escalateToFounder?: boolean }) => (await api.post<Blocker>(`/deals/${id}/escalate`, body)).data, onSuccess: inv });
}
export function useResolveBlocker() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, blockerId, resolution }: { id: string; blockerId: string; resolution: string }) => (await api.post<Blocker>(`/deals/${id}/blockers/${blockerId}/resolve`, { resolution })).data, onSuccess: inv });
}
export function useReopenDeal() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, reason }: { id: string; reason: string }) => (await api.post<DealDetail>(`/deals/${id}/reopen`, { reason })).data, onSuccess: inv });
}
export function useAdjustSale() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, ...body }: { id: string; kind: string; delta?: string; reason: string }) => (await api.post<{ id: string; status: string }>(`/deals/${id}/adjustments`, body)).data, onSuccess: inv });
}
export function useDecideAdjustment() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, adjustmentId, decision, note }: { id: string; adjustmentId: string; decision: 'approve' | 'reject'; note?: string }) => (await api.post(`/deals/${id}/adjustments/${adjustmentId}/decision`, { decision, note })).data, onSuccess: inv });
}

/* ------------------------------------------------------------------ collections */
export const usePayments = (q: Q = {}) => useQuery({ queryKey: rk.payments(q), placeholderData: keepPreviousData, queryFn: listFn<Payment>('/collections', q) });
export const useReconciliation = (view: ReconciliationView, enabled = true) =>
  useQuery({ queryKey: rk.reconciliation(view), enabled, queryFn: async () => (await api.get<Reconciliation['items']>('/collections/reconciliation', { view })).data as unknown as Reconciliation });
export function useRecordPayment() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (body: { dealId: string; amount: string; method: PaymentMethod; externalTransactionRef: string; paidAt: string; provider?: string; expectedPaymentId?: string; note?: string }) =>
      (await api.post<Payment>('/collections', { currency: 'INR', provider: 'MANUAL', ...body }, { headers: { 'Idempotency-Key': idemKey() } })).data,
    onSuccess: inv,
  });
}
export function useVerifyPayment() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, confirmedAmount, note }: { id: string; confirmedAmount?: string; note?: string }) => (await api.post<Payment>(`/collections/${id}/verify`, { confirmedAmount, note })).data, onSuccess: inv });
}
export function useRejectPayment() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, reason }: { id: string; reason: string }) => (await api.post<Payment>(`/collections/${id}/reject`, { reason })).data, onSuccess: inv });
}
export function useReversePayment() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, reason }: { id: string; reason: string }) => (await api.post<Payment>(`/collections/${id}/reverse`, { reason })).data, onSuccess: inv });
}
export function useRunReconciliation() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (body: { statementRef: string; lines?: { externalTransactionRef: string; amount: string }[]; paymentIds?: string[] }) => (await api.post<ReconcileResult>('/collections/reconciliation/run', body)).data,
    onSuccess: inv,
  });
}

/* ------------------------------------------------------------------ refunds */
export const useRefunds = (q: Q = {}) => useQuery({ queryKey: rk.refunds(q), placeholderData: keepPreviousData, queryFn: listFn<Refund>('/refunds', q) });
export const useRefund = (id: string | null) => useQuery({ queryKey: rk.refund(id ?? ''), enabled: Boolean(id), queryFn: async () => (await api.get<Refund>(`/refunds/${id}`)).data });
export function useRequestRefund() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (body: { dealId: string; paymentId?: string; amount: string; reasonCategory: string; reason: string }) => (await api.post<Refund>('/refunds', body, { headers: { 'Idempotency-Key': idemKey() } })).data,
    onSuccess: inv,
  });
}
export type RefundAction = 'review' | 'approve' | 'reject' | 'withdraw' | 'cancel' | 'process' | 'reconcile';
export function useRefundAction() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, action, body }: { id: string; action: RefundAction; body: Record<string, unknown> }) => (await api.post<Refund>(`/refunds/${id}/${action}`, body)).data, onSuccess: inv });
}

/* ------------------------------------------------------------------ targets */
export const useTargetPeriods = () => useQuery({ queryKey: rk.periods, queryFn: async () => (await api.get<TargetPeriod[]>('/targets/periods')).data });
export const useTargets = (q: Q = {}, enabled = true) => useQuery({ queryKey: rk.targets(q), enabled, placeholderData: keepPreviousData, queryFn: listFn<Target>('/targets', { limit: 100, ...q }) });
export const useBreakdown = (id: string | null) => useQuery({ queryKey: rk.breakdown(id ?? ''), enabled: Boolean(id), queryFn: async () => (await api.get<{ periodId: string; metric: TargetMetric; currency: string; root: BreakdownNode }>(`/targets/${id}/breakdown`)).data });
export const useRevisions = (id: string | null) => useQuery({ queryKey: rk.revisions(id ?? ''), enabled: Boolean(id), queryFn: async () => (await api.get<TargetRevision[]>(`/targets/${id}/revisions`)).data });
export const useAchievement = (id: string | null) => useQuery({ queryKey: rk.achievement(id ?? ''), enabled: Boolean(id), queryFn: async () => (await api.get<Achievement>(`/targets/${id}/achievement`)).data });
export function useCreatePeriod() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async (body: { type: string; anchor: string }) => (await api.post<TargetPeriod>('/targets/periods', body)).data, onSuccess: inv });
}
export function useCreateTarget() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (body: { periodId: string; metric: string; level: string; ownerUserId: string; parentId?: string; amount: string; proration?: { joinOn?: string; leaveOn?: string }; note?: string }) => (await api.post<Target>('/targets', body)).data,
    onSuccess: inv,
  });
}
export function useReviseTarget() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, ...body }: { id: string; newAmount: string; reason: string; effectiveFrom?: string }) => (await api.patch<TargetRevision>(`/targets/${id}`, body)).data, onSuccess: inv });
}
export function useDecideRevision() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, revisionId, decision, note }: { id: string; revisionId: string; decision: 'approve' | 'reject'; note?: string }) => (await api.post<Target>(`/targets/${id}/approve`, { revisionId, decision, note })).data, onSuccess: inv });
}
export const useAssignableOwners = (enabled: boolean) =>
  useQuery({ queryKey: ['revenue', 'owners'], enabled, staleTime: 60_000, queryFn: async () => (await api.get<Array<{ id: string; name: string; roles: string[]; isActive: boolean }>>('/users', { limit: 100 })).data });

/* ------------------------------------------------------------------ forecasts */
export const useForecasts = () => useQuery({ queryKey: rk.forecasts, queryFn: listFn<ForecastRow>('/forecasts', { limit: 30 }) });
export const useForecastPreview = (periodType: 'WEEK' | 'MONTH', enabled: boolean) => useQuery({ queryKey: rk.forecastPreview(periodType), enabled, queryFn: async () => (await api.get<ForecastPreview>('/forecasts/preview', { periodType })).data });
export const useForecastSnapshots = (id: string | null) => useQuery({ queryKey: rk.forecastSnapshots(id ?? ''), enabled: Boolean(id), queryFn: async () => (await api.get<{ snapshots: ForecastSnapshot[]; accuracy: ForecastAccuracy | null }>(`/forecasts/${id}/snapshots`)).data });
export const useAccuracy = (periodType: 'WEEK' | 'MONTH') => useQuery({ queryKey: rk.accuracy(periodType), queryFn: async () => (await api.get<AccuracySummary>('/forecasts/accuracy', { periodType, last: 6 })).data });
export function useTakeSnapshot() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async (body: { periodType: 'WEEK' | 'MONTH'; kind: 'PERIOD_START' | 'ADHOC' }) => (await api.post<{ forecast: { id: string }; snapshot: ForecastSnapshot }>('/forecasts', body)).data, onSuccess: inv });
}

/* ------------------------------------------------------------------ pricing */
export const usePrices = (enabled = true) => useQuery({ queryKey: rk.prices, enabled, queryFn: async () => (await api.get<ProgramPrice[]>('/pricing/prices')).data });
export const useProposals = (q: Q = {}) => useQuery({ queryKey: rk.proposals(q), placeholderData: keepPreviousData, queryFn: listFn<Proposal>('/proposals', q) });
export const useProposal = (id: string | null) => useQuery({ queryKey: rk.proposal(id ?? ''), enabled: Boolean(id), queryFn: async () => (await api.get<Proposal>(`/proposals/${id}`)).data });
export function useCreateProposal() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async (body: { type: string; programId?: string; title: string; rationale: string; proposedAmount?: string; submit: boolean }) => (await api.post<Proposal>('/proposals', body)).data, onSuccess: inv });
}
export function useProposalAction() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: 'submit' | 'withdraw' | 'decision'; body?: Record<string, unknown> }) => (await api.post<Proposal>(`/proposals/${id}/${action}`, body ?? {})).data,
    onSuccess: inv,
  });
}

/* ------------------------------------------------------------------ market intel */
export const useFeedback = (q: Q = {}) => useQuery({ queryKey: rk.feedback(q), placeholderData: keepPreviousData, queryFn: listFn<FeedbackEntry>('/feedback', q) });
export const useGrowth = (q: Q = {}) => useQuery({ queryKey: rk.growth(q), placeholderData: keepPreviousData, queryFn: listFn<GrowthOpportunity>('/growth-opportunities', q) });
export function useCreateFeedback() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async (body: { kind: string; category: string; title: string; notes: string; source?: string; competitor?: string; evidenceUrl?: string }) => (await api.post<FeedbackEntry>('/feedback', body)).data, onSuccess: inv });
}
export function useUpdateFeedback() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, ...body }: { id: string; status?: string; proposalId?: string | null }) => (await api.patch<FeedbackEntry>(`/feedback/${id}`, body)).data, onSuccess: inv });
}
export function useCreateGrowth() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async (body: { type: string; title: string; description: string; estimatedValue?: string }) => (await api.post<GrowthOpportunity>('/growth-opportunities', body)).data, onSuccess: inv });
}
export function useUpdateGrowth() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, ...body }: { id: string; status?: string }) => (await api.patch<GrowthOpportunity>(`/growth-opportunities/${id}`, body)).data, onSuccess: inv });
}
export const useRevenueSettings = () => useQuery({ queryKey: rk.settings, queryFn: async () => (await api.get<RevenueSettings>('/revenue/settings')).data });

/* ------------------------------------------------------------------ strategy plans (JD-STRAT-001) */
export interface StrategyInitiative { id: string; title: string; notes: string | null; ownerId: string; ownerName: string | null; status: 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'DROPPED'; dueOn: string | null }
export interface StrategyPlan { id: string; title: string; summary: string; status: 'DRAFT' | 'ACTIVE' | 'CLOSED'; ownerId: string; ownerName: string | null; periodId: string | null; periodLabel: string | null; createdAt: string; initiatives: StrategyInitiative[] }
export const useStrategyPlans = () => useQuery({ queryKey: ['revenue', 'strategy-plans'] as const, queryFn: async () => (await api.get<StrategyPlan[]>('/strategy-plans')).data });
export function useCreatePlan() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async (body: { title: string; summary: string; status?: StrategyPlan['status'] }) => (await api.post<StrategyPlan>('/strategy-plans', body)).data, onSuccess: inv });
}
export function useUpdatePlan() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, ...body }: { id: string; title?: string; summary?: string; status?: StrategyPlan['status'] }) => (await api.patch<StrategyPlan>(`/strategy-plans/${id}`, body)).data, onSuccess: inv });
}
export function useAddInitiative() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ planId, ...body }: { planId: string; title: string; notes?: string; dueOn?: string }) => (await api.post<StrategyPlan>(`/strategy-plans/${planId}/initiatives`, body)).data, onSuccess: inv });
}
export function useUpdateInitiative() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: async ({ id, ...body }: { id: string; status?: StrategyInitiative['status']; notes?: string; dueOn?: string | null }) => (await api.patch<StrategyPlan>(`/strategy-initiatives/${id}`, body)).data, onSuccess: inv });
}
