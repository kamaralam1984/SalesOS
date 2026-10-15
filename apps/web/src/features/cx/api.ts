'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/** Query-key helper for every Phase 7 query: ['cx', ...parts]. Invalidate with ['cx'] or a prefix. */
export const ck = (...parts: Array<string | number | object | undefined>) => ['cx', ...parts] as const;

export interface PageInfo {
  hasMore: boolean;
  nextCursor?: string | null;
  page?: number;
  limit: number;
}
type Q = Record<string, string | number | boolean | undefined | null>;

export function useList<T>(key: readonly unknown[], path: string, query: Q = {}, enabled = true) {
  return useQuery({
    queryKey: [...key, query] as const,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await api.get<T[]>(path, query);
      return { items: r.data, pagination: r.meta.pagination as PageInfo | undefined };
    },
  });
}

export function useOne<T>(key: readonly unknown[], path: string, query: Q = {}, enabled = true) {
  return useQuery({ queryKey: [...key, query] as const, enabled, queryFn: async () => (await api.get<T>(path, query)).data });
}

/** POST/PATCH/DELETE helper that invalidates the whole cx namespace (counts and lists stay consistent). */
export function useAction<TIn, TOut = unknown>(method: 'post' | 'patch' | 'delete', path: string | ((input: TIn) => string), extraInvalidate: Array<readonly unknown[]> = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TIn) => {
      const p = typeof path === 'function' ? path(input) : path;
      const r = method === 'delete' ? await api.delete<TOut>(p) : method === 'patch' ? await api.patch<TOut>(p, input) : await api.post<TOut>(p, input);
      return r.data;
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['cx'] }), qc.invalidateQueries({ queryKey: ['collab'] }), ...extraInvalidate.map((k) => qc.invalidateQueries({ queryKey: k as unknown[] }))]);
    },
  });
}

// ------------------------------------------------------------------ wire types (mirror apps/api/src/modules/cx)
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type ComplaintStatus = 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED' | 'REOPENED';
export type WorkStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'ESCALATED' | 'CANCELLED';
export type HandoverStatus = 'DRAFT' | 'SUBMITTED' | 'INFO_REQUESTED' | 'ACKNOWLEDGED' | 'OVERDUE' | 'COMPLETED';

export interface HistoryEntry { from: string | null; to: string; actorName: string | null; note: string | null; at: string }

export interface Complaint {
  id: string; title: string; description: string; category: string; priority: Priority; status: ComplaintStatus;
  learner: { id: string; name: string } | null; leadId: string | null; dealId: string | null; refundId: string | null;
  ownerId: string; ownerName: string | null; createdByName: string | null; autoAssigned: boolean; isHighValue: boolean;
  sla: { startedAt: string; firstResponseDueAt: string; resolutionDueAt: string; firstResponseBreachedAt: string | null; resolutionBreachedAt: string | null; breachLevel: number; firstResponseRemainingMs: number | null; resolutionRemainingMs: number | null; resolvedWithinSla: boolean | null };
  acknowledgedAt: string | null; firstResponseNote: string | null; escalatedAt: string | null; escalatedToName: string | null; escalationReason: string | null;
  resolvedAt: string | null; resolution: string | null; rootCauseCategory: string | null; closedAt: string | null; closeReason: string | null; closedAsInvalid: boolean; reopenCount: number;
  version: number; createdAt: string; updatedAt: string; history?: HistoryEntry[];
}

export interface ComplaintTrends {
  from: string; to: string; bucket: string;
  totals: { opened: number; excludedInvalid: number; resolved: number; resolutionRatePct: number | null; slaAdherencePct: number | null; meanHoursToResolve: number | null; medianHoursToResolve: number | null };
  series: Array<{ bucket: string; opened: number; resolved: number; resolvedWithinSla: number; breached: number }>;
  byRootCause: Array<{ key: string; count: number }>; byCategory: Array<{ key: string; count: number }>; byPriority: Array<{ key: string; count: number }>;
}

export interface Escalation {
  id: string; leadId: string; learnerName: string | null; type: 'HIGH_VALUE' | 'COMPLEX_CONVERSATION'; title: string; context: string; blocker: string | null; requestedHelp: string | null;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CANCELLED'; ownerId: string; ownerName: string | null; createdByName: string | null; teamLeadName: string | null; founderInvolved: boolean;
  resolution: string | null; resolvedAt: string | null; version: number; createdAt: string; history?: HistoryEntry[];
}

export interface TimelineEntry { at: string; type: string; title: string; detail?: string | null; actorName?: string | null; ref?: { type: string; id: string } }
export interface RelationshipView {
  mode: 'full' | 'summary';
  lead: { id: string; fullName: string; status: string; stageCategory: string; programName: string | null; preferredLanguage: string | null; isKeyProspect: boolean; watching: boolean; learnerRank?: { key: string; label: string } | null; learnerEarnedRevenue?: string | null; learnerEarnedAt?: string | null; nextRank?: { key: string; label: string; remaining: string } | null; ownerName?: string | null; email?: string | null; phone?: string | null; nextActionAt?: string | null; lastActivityAt?: string | null; estimatedValue?: string | null; currency?: string };
  handover?: { id: string; status: string } | null; notice?: string;
  counts?: { calls: number; openComplaints: number; openEscalations: number; openTasks: number };
  deals?: { available: boolean; summary: { wonAt: string; wonValue: string | null; currency: string } | null; note: string };
  timeline: TimelineEntry[];
}
export interface WatchRow { id: string; fullName: string; status: string; stageCategory: string; isKeyProspect: boolean; watching: boolean; watchReason: string | null; ownerName: string | null; nextActionAt: string | null; lastActivityAt: string | null; stale: boolean; estimatedValue: string | null; currency: string }

export interface SurveyQuestion { id: string; text: string; type: 'RATING_1_5' | 'NPS_0_10' | 'TEXT' | 'YES_NO'; required: boolean }
export interface SurveyTemplate { id: string | null; key: string; name: string; kind: 'CSAT' | 'NPS' | 'ENROLMENT_EXPERIENCE'; questions: SurveyQuestion[]; version: number; isActive: boolean; builtin: boolean }
export interface SatisfactionRow { id: string; kind: 'CSAT' | 'NPS' | 'ENROLMENT_EXPERIENCE'; score: number; comment: string | null; leadId: string | null; respondentRef: string | null; respondentName: string | null; consentGiven: boolean; consentAt: string; channel: string; respondedAt: string; capturedByName: string | null; outsideWindow: boolean; templateVersion: number | null }
export interface SatisfactionStats {
  from: string; to: string; summaries: Array<{ kind: string; n: number; mean: number | null; lowSample: boolean; satisfiedPct?: number | null; nps?: number | null; promoters?: number; detractors?: number; excludedOutsideWindow: number }>;
  series: Array<{ kind: string; bucket: string; n: number; mean: number }>; note: string;
}

export interface RefundRow {
  id: string; dealId: string; status: string; reasonCategory: string; learnerName: string | null; programName: string | null; minimumData: boolean; reason?: string; currency?: string; recommendation?: string | null;
  rootCause: { category: string; note: string | null; complaintId: string | null } | null;
  requested: { at: string; amount?: string; byName?: string | null }; reviewed?: { at: string | null }; approved: { at: string | null; amount?: string | null; byName?: string | null }; rejected?: { at: string | null; reason: string | null }; processed: { at: string | null; amount?: string | null; byName?: string | null };
}
export interface RefundAnalytics {
  method: string; cells: Array<{ programId: string; month: string; wonEnrolments: number; refundsRequested: number; refundsApproved: number; approvedValue: string; rate: number | null; cohortRate: number | null; cohortApproved: number }>;
  rootCauses: Array<{ category: string; count: number }>; untaggedApproved: number;
}

export interface ChecklistItem { key: string; done: boolean }
export interface Handover {
  id: string; status: HandoverStatus; programName: string | null; ownerName: string | null; submittedAt: string | null; ackDueAt: string | null; overdueAt: string | null; acknowledgedAt: string | null; completedAt: string | null; createdAt: string; pending: boolean; minimumData: boolean;
  dealId?: string | null; leadId?: string | null; programId?: string | null; ownerId?: string; receivingOwnerName?: string | null;
  learnerName?: string | null; learnerContact?: string | null; languagePreference?: string | null; amountPaid?: string | null; amountDue?: string | null; currency?: string; paymentVerified?: boolean | null;
  promisesMade?: string | null; goals?: string | null; objections?: string | null; specialNotes?: string | null; consents?: { dataSharing?: boolean; contact?: boolean; marketing?: boolean } | null;
  infoRequest?: string | null; completionNote?: string | null; overdueLevel?: number; checklist?: ChecklistItem[]; missing?: string[]; complete?: boolean; version?: number; history?: HistoryEntry[];
}

export interface ReportRisk { title: string; description?: string; severity?: number; proposedSolution?: string; riskId?: string }
export interface ReportSections {
  performance?: { narrative?: string; highlights?: string[] };
  risks?: { items?: ReportRisk[]; noneConfirmed?: boolean };
  opportunities?: { items?: Array<{ title: string; description?: string }>; noneConfirmed?: boolean };
  solutions?: { items?: Array<{ title: string; description?: string }> };
  actionItems?: { reviewed?: boolean };
}
export interface FounderReport {
  id: string; type: 'WEEKLY' | 'MONTHLY'; periodStart: string; periodEnd: string; versionNumber: number; supersedesId: string | null; status: 'DRAFT' | 'PUBLISHED'; title: string; sections: ReportSections;
  authorName: string | null; dueAt: string; publishedAt: string | null; publishedByName: string | null; contentHash: string | null; onTime: boolean | null; completenessPct: number | null; rating: number | null; reviewNote: string | null; reviewedByName: string | null;
  overdue: boolean; version: number;
  dataSections?: Array<{ key: string; label: string; status: string; metrics: Array<{ kpiId: string; label: string; value: string | null; unit?: string }>; note?: string }> | null;
  actionItems?: Array<{ id: string; title: string; ownerId: string; dueAt: string; status: string }> | null;
  versions?: Array<{ id: string; versionNumber: number; status: string; publishedAt: string | null }>;
}
export interface ReportSnapshot { id: string; reportId: string; versionNumber: number; content: Record<string, unknown>; contentHash: string; integrityVerified: boolean; dueAt: string; publishedAt: string; onTime: boolean }
export interface ReportMetrics {
  timeliness: { due: number; onTime: number; late: number; missing: number; pct: number | null };
  quality: { published: number; meanCompletenessPct: number | null; meanRating: number | null; rated: number };
}
export interface Risk { id: string; title: string; description: string; severity: number; status: 'OPEN' | 'MITIGATING' | 'RESOLVED' | 'ACCEPTED'; proposedSolution: string | null; hasSolution: boolean; earlyWarning: boolean; ownerName: string | null; raisedByName: string | null; raisedAt: string; resolvedAt: string | null; resolutionNote: string | null }
export interface ActionItem {
  id: string; reportId: string | null; source: string; title: string; description: string | null; ownerId: string; ownerName: string | null; createdByName: string | null; dueAt: string; status: WorkStatus; overdue: boolean;
  completedAt: string | null; completionNote: string | null; evidence: string | null; completedOnTime: boolean | null; cancelReason: string | null; escalatedAt: string | null; version: number; history?: HistoryEntry[];
}
export interface ActionItemMetrics { due: number; onTime: number; pct: number | null; open: number; overdue: number; byOwner: Array<{ ownerId: string; ownerName: string | null; due: number; onTime: number; pct: number | null }> }

export interface Person { id: string; name: string }
