import { z } from 'zod';
import type { Review } from './api';

export interface ReviewActions {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canAcknowledge: boolean;
}

/** Pure: which review actions the viewer may attempt (UI hiding only; the API enforces). */
export function reviewActions(r: Pick<Review, 'status' | 'reviewerId' | 'employeeId'>, meId: string | undefined, can: (p: string) => boolean): ReviewActions {
  const reviewer = !!meId && r.reviewerId === meId;
  const employee = !!meId && r.employeeId === meId;
  return {
    canEdit: r.status === 'DRAFT' && reviewer && can('reviews:create'),
    canSubmit: r.status === 'DRAFT' && reviewer && can('reviews:create'),
    canApprove: r.status === 'SUBMITTED' && !reviewer && !employee && can('reviews:approve'),
    canAcknowledge: r.status === 'APPROVED' && employee,
  };
}

export const REVIEW_STEPS = ['DRAFT', 'SUBMITTED', 'APPROVED', 'ACKNOWLEDGED'] as const;

const actionRow = z.object({ title: z.string().trim().min(3, 'actionTitle').max(300, 'tooLong'), ownerId: z.string().min(1, 'required'), dueDate: z.string().optional() });
export const reviewFormSchema = z.object({
  employeeId: z.string(),
  periodStart: z.string().min(1, 'required'),
  periodEnd: z.string().min(1, 'required'),
  competencyScores: z.record(z.string(), z.number().int().min(1).max(5)),
  rating: z.number().int().min(1, 'ratingRange').max(5, 'ratingRange').optional(),
  strengths: z.string().max(4000, 'tooLong').optional(),
  improvements: z.string().max(4000, 'tooLong').optional(),
  goals: z.string().max(4000, 'tooLong').optional(),
  actions: z.array(actionRow).max(10),
});
export type ReviewFormValues = z.infer<typeof reviewFormSchema>;

const blank = (v?: string) => (v && v.trim() ? v.trim() : undefined);

export function buildReviewPayload(v: ReviewFormValues, mode: 'create' | 'edit') {
  const common = {
    competencyScores: v.competencyScores,
    ...(v.rating ? { rating: v.rating } : {}),
    ...(blank(v.strengths) ? { strengths: blank(v.strengths) } : {}),
    ...(blank(v.improvements) ? { improvements: blank(v.improvements) } : {}),
    ...(blank(v.goals) ? { goals: blank(v.goals) } : {}),
  };
  if (mode === 'edit') return common;
  return {
    employeeId: v.employeeId,
    periodStart: v.periodStart,
    periodEnd: v.periodEnd,
    ...common,
    actions: v.actions.map((a) => ({ title: a.title.trim(), ownerId: a.ownerId, ...(a.dueDate ? { dueDate: a.dueDate } : {}) })),
  };
}

/** First and last day of the previous calendar month (UTC), YYYY-MM-DD. */
export function previousMonth(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
