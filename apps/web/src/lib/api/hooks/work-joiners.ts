'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

/** Joining a new employee (HR and the Boss): account + HR record + 90-day plan + first tasks in one step. */
export interface JoinerOptions {
  roles: string[];
  managers: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string; roleKey: string }>;
  defaultPlan: Array<{ title: string; dueDay: number }>;
  suggestedTasks: Array<{ title: string; dueDay: number; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' }>;
}
export interface NewJoinerInput {
  name: string; email: string; roles: string[]; managerId?: string | null; department?: string | null; positionTitle: string; joinDate?: string; templateId?: string;
  tasks: Array<{ title: string; dueDay: number; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; description?: string }>;
}
export interface JoinedEmployee {
  userId: string; name: string; email: string; positionTitle: string; joinDate: string; probationEnd: string; planId: string; planItems: number; reviewDays: number[]; tasks: number;
  /** the account waits for someone other than the creator to approve it; the link is issued then (Admin → Approvals) */
  pendingApproval: true; invite: null; warnings: string[];
}

export const useJoinerOptions = (enabled = true) =>
  useQuery({ queryKey: ['work', 'joiners', 'options'] as const, enabled, queryFn: async () => (await api.get<JoinerOptions>('/workforce/hr/joiners/options')).data });

export function useJoinEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: NewJoinerInput) => (await api.post<JoinedEmployee>('/workforce/hr/joiners', b)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['work', 'reports'] });
      void qc.invalidateQueries({ queryKey: ['work', 'joiners'] });
      void qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}
