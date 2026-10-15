'use client';
export { useList, useOne, useAction } from '@/features/cx/api';
export type { PageInfo, Person } from '@/features/cx/api';

export const cb = (...parts: Array<string | number | object | undefined>) => ['collab', ...parts] as const;

export type Department = 'FOUNDER' | 'SALES' | 'MARKETING' | 'COMMUNITY' | 'OPERATIONS' | 'STUDENT_SUCCESS';
export const DEPARTMENTS: Department[] = ['FOUNDER', 'SALES', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'];
export type WorkStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'ESCALATED' | 'CANCELLED';

export interface XfTask {
  id: string; title: string; description: string | null; kind: string; department: Department; requesterDepartment: Department; priority: number; status: WorkStatus; dueAt: string; overdue: boolean;
  ownerId: string; ownerName: string | null; requesterId: string; requesterName: string | null; programId: string | null; eventId: string | null; campaignId: string | null; planLinkId: string | null; payload: Record<string, unknown>;
  completedAt: string | null; completionNote: string | null; confirmedAt: string | null; confirmedByName: string | null; cancelReason: string | null; overdueLevel: number; escalatedAt: string | null; version: number; createdAt: string;
  comments?: Array<{ id: string; body: string; authorName: string | null; createdAt: string }>;
  dependencies?: Array<{ id: string; title: string; status: WorkStatus; department: Department }>; blockedBy?: number;
  history?: Array<{ from: string | null; to: string; actorName: string | null; note: string | null; at: string }>;
}

export interface PlanLink {
  id: string; kind: 'CAMPAIGN' | 'WEBINAR' | 'EVENT' | 'LEAD_GEN'; title: string; programName: string | null; event: { id: string; title: string; startsAt: string; status: string; type: string } | null;
  windowStart: string; windowEnd: string; plannedLeads: number | null; actualLeads: number | null; salesPlanNote: string | null; status: string; attendance: Record<string, number>; ownerName: string | null; createdByName: string | null;
}

export interface Insight { id: string; kind: string; title: string; body: string; tags: string[]; audience: string[]; programId: string | null; authorName: string | null; createdAt: string }
