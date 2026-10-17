'use client';
import { useApiGet, useApiList, pk } from '../common/api';
import { useApiMutation } from '../hrkit/kit';

export interface ChecklistItem {
  id: string;
  title: string;
  category: 'ONBOARDING' | 'TRAINING' | 'TOOLS' | 'CULTURE';
  description: string | null;
  dueDate: string | null;
  status: 'PENDING' | 'DONE' | 'SKIPPED';
  completedAt: string | null;
  notes: string | null;
  overdue: boolean;
}
export interface Progress { total: number; done: number; skipped: number; pct: number | null }
export interface Plan {
  id: string;
  employeeId: string;
  employeeName: string | null;
  startDate: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  progress: Progress;
  items: ChecklistItem[];
}
export interface Template { id: string; roleKey: string; name: string; items: Array<{ title: string; category?: string; dueDay?: number }>; probationDays: number[] }
export interface ProbationReview {
  id: string;
  employeeId: string;
  employeeName: string | null;
  checkpointDay: number;
  dueDate: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'WAIVED';
  outcome: string | null;
  notes: string | null;
  overdue: boolean;
}
export interface Expectation { id: string; roleKey: string; kind: 'OWNERSHIP' | 'ACCOUNTABILITY' | 'CULTURE'; title: string; body: string; acknowledgedByMe?: boolean; acknowledgedAt?: string | null; mustAcknowledge?: boolean }
export interface ExpectationAdoption { id: string; roleKey: string; kind: Expectation['kind']; title: string; audience: number; acknowledged: number; pending: Array<{ id: string; name: string }> }

export const usePlans = () => useApiList<Plan>(pk('onboarding', 'plans'), '/people/onboarding', { limit: 50 });
export const useTemplates = () => useApiGet<Template[]>(pk('onboarding', 'templates'), '/people/onboarding/templates');
export const useProbation = () => useApiList<ProbationReview>(pk('onboarding', 'probation'), '/people/probation', { limit: 100 });
export const useExpectations = (roleKey: string) => useApiGet<Expectation[]>(pk('onboarding', 'expectations'), '/people/expectations', { roleKey: roleKey || undefined });

export const useCreatePlan = () => useApiMutation<Record<string, unknown>, Plan>('post', () => '/people/onboarding');
export const useUpdateItem = () => useApiMutation<{ id: string; status: 'PENDING' | 'DONE' | 'SKIPPED' }>('patch', (v) => `/people/onboarding/items/${v.id}`, (v) => ({ status: v.status }));
export const useCreateTemplate = () => useApiMutation<Record<string, unknown>>('post', () => '/people/onboarding/templates');
export const useUpdateTemplate = () => useApiMutation<{ id: string; body: Record<string, unknown> }>('patch', (v) => `/people/onboarding/templates/${v.id}`, (v) => v.body);
export const useDeleteTemplate = () => useApiMutation<{ id: string }>('delete', (v) => `/people/onboarding/templates/${v.id}`);
export const useCompleteProbation = (id: string) => useApiMutation<Record<string, unknown>>('post', () => `/people/probation/${id}/complete`);
export const useCreateExpectation = () => useApiMutation<Record<string, unknown>>('post', () => '/people/expectations');

export const useAcknowledgeExpectation = () => useApiMutation<{ id: string }>('post', (v) => `/people/expectations/${v.id}/acknowledge`, () => ({}));
export const useExpectationAdoption = (enabled: boolean) => useApiGet<ExpectationAdoption[]>(pk('onboarding', 'expectation-adoption'), '/people/expectations/adoption', {}, enabled);
