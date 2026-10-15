'use client';
import { useApiGet, useApiList, pk } from '../common/api';
import { useApiMutation } from '../hrkit/kit';

export const SKILL_TAGS = ['consultative-selling', 'closing', 'revenue-planning', 'negotiation', 'objection-handling', 'pipeline', 'forecasting', 'strategy', 'leadership', 'communication', 'crm', 'google-workspace', 'excel', 'dashboards'] as const;
export type AssignmentStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED';

export interface Resource {
  id: string;
  title: string;
  description: string | null;
  type: 'ARTICLE' | 'VIDEO' | 'DOCUMENT' | 'TEMPLATE' | 'LINK' | 'COURSE';
  url: string | null;
  fileId: string | null;
  skillTags: string[];
  myAssignment: { id: string; status: AssignmentStatus; dueDate: string | null; completedAt: string | null } | null;
}
export interface Assignment {
  id: string;
  resourceId: string;
  title: string;
  type: string;
  url: string | null;
  skillTags: string[];
  userId: string;
  userName: string | null;
  status: AssignmentStatus;
  dueDate: string | null;
  completedAt: string | null;
}

export const useResources = (q: { tag?: string; q?: string; page: number }) => useApiList<Resource>(pk('skills', 'library'), '/resources', { tag: q.tag, q: q.q, page: q.page, limit: 24 });
export const useAssignments = () => useApiGet<Assignment[]>(pk('skills', 'assignments'), '/resources/assignments');
export const useCreateResource = () => useApiMutation<Record<string, unknown>>('post', () => '/resources');
export const useAssignResource = (id: string) => useApiMutation<{ userIds: string[]; dueDate?: string }>('post', () => `/resources/${id}/assign`);
export const useUpdateAssignment = () => useApiMutation<{ id: string; status: AssignmentStatus }>('patch', (v) => `/resources/assignments/${v.id}`, (v) => ({ status: v.status }));
