'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { pk, useApiGet, useApiList } from '../common/api';
import type { CoachingAction } from '../coaching/api';

export interface KpiDefinition {
  id: string;
  key: string;
  name: string;
  kind: 'KPI' | 'KRA';
  description: string | null;
  unit: string | null;
  dictionaryKey: string | null;
  roleKeys: string[];
}
export interface KpiItem {
  definitionId?: string;
  key: string;
  name: string;
  kind: 'KPI' | 'KRA';
  target?: number;
  unit?: string;
  notes?: string;
}
export interface KpiAssignment {
  id: string;
  assigneeId: string;
  assigneeName: string | null;
  weekStart: string;
  items: KpiItem[];
  setByName: string | null;
  updatedAt: string;
}
export interface ScorecardInput {
  key: string;
  name: string;
  target?: number;
  actual?: number;
  unit?: string;
  source: 'MANUAL' | 'PHASE5';
}
export interface Scorecard {
  id: string;
  subjectId: string;
  subjectName: string | null;
  periodType: 'WEEK' | 'MONTH';
  periodStart: string;
  periodEnd: string;
  inputs: ScorecardInput[];
  comments: string | null;
  createdByName: string | null;
}
export interface Competency {
  id: string;
  key: string;
  name: string;
  description: string | null;
  indicators: Record<string, string>;
  isActive: boolean;
}
export type ReviewStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'ACKNOWLEDGED';
export interface Review {
  id: string;
  employeeId: string;
  employeeName: string | null;
  reviewerId: string;
  reviewerName: string | null;
  periodStart: string;
  periodEnd: string;
  status: ReviewStatus;
  kpiSummary: Array<{ key: string; name: string; target?: number; actual?: number; note?: string }>;
  competencyScores: Record<string, number>;
  rating: number | null;
  strengths: string | null;
  improvements: string | null;
  goals: string | null;
  employeeComment: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  acknowledgedAt: string | null;
  canEdit: boolean;
}

type Q = Record<string, string | number | undefined>;
export const useKpiDefinitions = (enabled = true) => useApiGet<KpiDefinition[]>(pk('kpi-definitions'), '/people/kpi-definitions', {}, enabled);
export const useKpiAssignments = (q: Q) => useApiList<KpiAssignment>(pk('kpi-assignments'), '/people/kpi-assignments', q);
export const useScorecards = (q: Q) => useApiList<Scorecard>(pk('scorecards'), '/people/scorecards', q);
export const useCompetencies = (enabled = true) => useApiGet<Competency[]>(pk('competencies'), '/people/competencies', {}, enabled);
export const useReviews = (q: Q) => useApiList<Review>(pk('reviews'), '/people/reviews', q);
export const useReview = (id: string) => useApiGet<Review>(pk('reviews', id), `/people/reviews/${id}`);

function useInvalidating<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }) });
}
export const useCreateKpiDefinition = () => useInvalidating(async (b: unknown) => (await api.post<KpiDefinition>('/people/kpi-definitions', b)).data);
export const useSaveAssignment = () => useInvalidating(async (b: unknown) => (await api.post<KpiAssignment>('/people/kpi-assignments', b)).data);
export const useSaveScorecard = () => useInvalidating(async (b: unknown) => (await api.post<{ id: string }>('/people/scorecards', b)).data);
export const useCreateReview = () => useInvalidating(async (b: unknown) => (await api.post<Review>('/people/reviews', b)).data);
export const useUpdateReview = (id: string) => useInvalidating(async (b: unknown) => (await api.patch<Review>(`/people/reviews/${id}`, b)).data);
export const useReviewAction = (id: string) =>
  useInvalidating(async (v: { action: 'submit' | 'approve' | 'acknowledge'; comment?: string }) =>
    (await api.post<Review>(`/people/reviews/${id}/${v.action}`, v.action === 'acknowledge' ? { comment: v.comment } : {})).data);
export type { CoachingAction };
