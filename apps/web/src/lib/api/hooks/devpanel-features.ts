'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export type FeatureScope = 'summary' | 'own' | 'team' | 'org';
export type SubjectType = 'ROLE' | 'USER';
export type FeatureState = 'DEFAULT' | 'ON' | 'OFF';

export interface FeatureRow {
  key: string;
  domain: string;
  description: string;
  sensitive: boolean;
  /** devpanel:* keys: only the Developer role holds them; they cannot be switched here. */
  locked: boolean;
  /** what the subject has without an override of its own (a user: its roles incl. role overrides) */
  default: FeatureScope | null;
  override: { effect: 'GRANT' | 'DENY'; scope: FeatureScope | null } | null;
  effective: FeatureScope | null;
}
export interface FeatureView {
  subject: { type: SubjectType; key: string; label: string; roles: string[] };
  overrides: number;
  total: number;
  enabled: number;
  permissions: FeatureRow[];
}
export interface FeatureChange {
  permissionKey: string;
  state: FeatureState;
  scope?: FeatureScope;
}
export interface FeatureSummary {
  subjects: Array<{ type: SubjectType; key: string; label: string; grants: number; denies: number }>;
}

const key = {
  all: ['devpanel', 'features'] as const,
  view: (t: SubjectType, s: string) => ['devpanel', 'features', 'view', t, s] as const,
  summary: ['devpanel', 'features', 'summary'] as const,
};

export const useFeatureView = (type: SubjectType, subject: string) =>
  useQuery({
    queryKey: key.view(type, subject),
    enabled: Boolean(subject),
    queryFn: async () => (await api.get<FeatureView>('/dev-panel/features', { subjectType: type, subject })).data,
  });

export const useFeatureSummary = () =>
  useQuery({ queryKey: key.summary, queryFn: async () => (await api.get<FeatureSummary>('/dev-panel/features/summary')).data });

/** Apply a batch of switches. The server returns the refreshed view, which replaces the cached one. */
export function useChangeFeatures(type: SubjectType, subject: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { changes: FeatureChange[]; confirmSensitive?: boolean }) =>
      (await api.put<FeatureView>('/dev-panel/features', { subjectType: type, subject, changes: v.changes, ...(v.confirmSensitive ? { confirmSensitive: true } : {}) })).data,
    onSuccess: (view) => {
      qc.setQueryData(key.view(type, subject), view);
      void qc.invalidateQueries({ queryKey: key.summary });
    },
  });
}

export function useResetFeatures(type: SubjectType, subject: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<{ removed: number }>('/dev-panel/features/reset', { subjectType: type, subject })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: key.all }),
  });
}
