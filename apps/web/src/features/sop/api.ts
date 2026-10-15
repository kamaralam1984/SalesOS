'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { pk, useApiGet, useApiList } from '@/features/people/common/api';

export type VersionStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'RETIRED';

export interface SopVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  title: string;
  status: VersionStatus;
  changeSummary: string | null;
  effectiveDate: string | null;
  attachmentFileIds: string[];
  createdById: string;
  createdByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  body?: string;
}

export interface SopListItem {
  id: string;
  category: string;
  title: string;
  summary: string | null;
  ownerId: string;
  ownerName: string | null;
  isMandatory: boolean;
  audienceRoles: string[];
  tags: string[];
  status: 'ACTIVE' | 'RETIRED';
  effectiveVersion: { id: string; versionNumber: number; effectiveDate: string | null; acknowledgedByMe: boolean } | null;
  openVersion?: { id: string; versionNumber: number; status: VersionStatus } | null;
}

export interface SopDetail extends Omit<SopListItem, 'effectiveVersion' | 'openVersion'> {
  effectiveVersionId: string | null;
  effectiveVersion: (SopVersion & { body: string }) | null;
  acknowledgedByMe: boolean;
  acknowledgedAt: string | null;
  versions: SopVersion[];
}

export interface AckHistoryRow { id: string; versionId: string; versionNumber: number; userId: string; userName: string | null; acknowledgedAt: string }

export interface Adoption {
  scope: string;
  overall: { required: number; acknowledged: number; ratePct: number | null };
  byDocument: Array<{ documentId: string; documentTitle: string; versionId: string; versionNumber: number; required: number; acknowledged: number; ratePct: number | null; pending: Array<{ userId: string; name: string | null }> }>;
  byUser: Array<{ userId: string; name: string | null; required: number; acknowledged: number; ratePct: number | null; pendingDocumentIds: string[] }>;
}

export type GapStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'WONT_FIX';
export type GapKind = 'PROCESS_GAP' | 'AUTOMATION';
export interface Gap {
  id: string;
  kind: GapKind;
  title: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: GapStatus;
  priority: number;
  resolution: string | null;
  linkedSopId: string | null;
  reportedByName: string | null;
  resolvedAt: string | null;
}

type Q = Record<string, string | number | boolean | undefined | null>;

export const useSopList = (q: Q) => useApiList<SopListItem>(pk('sop', 'list'), '/sop', q);
export const useSopDoc = (id: string) => useApiGet<SopDetail>(pk('sop', 'doc', id), `/sop/${id}`, {}, Boolean(id));
export const useSopVersion = (id: string | null | undefined) => useApiGet<SopVersion & { body: string }>(pk('sop', 'version', id ?? ''), `/sop/versions/${id}`, {}, Boolean(id));
export const useAckHistory = (docId: string, enabled: boolean) => useApiGet<AckHistoryRow[]>(pk('sop', 'acks', docId), `/sop/${docId}/acknowledgements`, {}, enabled);
export const useAdoption = (documentId?: string) => useApiGet<Adoption>(pk('sop', 'adoption'), '/sop/adoption', { documentId });
export const useGaps = (q: Q) => useApiList<Gap>(pk('sop', 'gaps'), '/sop/gaps', q);

function useSopMutation<TIn, TOut>(fn: (input: TIn) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: pk('sop') }) });
}

export interface VersionInput { title?: string; body: string; changeSummary?: string; effectiveDate?: string; attachmentFileIds?: string[] }
export interface CreateSopInput extends VersionInput {
  category: string;
  title: string;
  summary?: string;
  isMandatory: boolean;
  audienceRoles: string[];
  tags: string[];
}

export const useCreateSop = () => useSopMutation(async (b: CreateSopInput) => (await api.post<{ id: string; versionId: string }>('/sop', b)).data);
export const useCreateVersion = (docId: string) => useSopMutation(async (b: VersionInput & { changeSummary: string }) => (await api.post<{ id: string }>(`/sop/${docId}/versions`, b)).data);
export const useUpdateVersion = (id: string) => useSopMutation(async (b: Partial<VersionInput>) => (await api.patch<unknown>(`/sop/versions/${id}`, b)).data);
export const useSubmitVersion = () => useSopMutation(async (id: string) => (await api.post<unknown>(`/sop/versions/${id}/submit`, {})).data);
export const useApproveVersion = () => useSopMutation(async (v: { id: string; effectiveDate?: string }) => (await api.post<{ remindersQueued: number }>(`/sop/versions/${v.id}/approve`, v.effectiveDate ? { effectiveDate: v.effectiveDate } : {})).data);
export const useRejectVersion = () => useSopMutation(async (v: { id: string; reason: string }) => (await api.post<unknown>(`/sop/versions/${v.id}/reject`, { reason: v.reason })).data);
export const useRetireSop = () => useSopMutation(async (id: string) => (await api.post<unknown>(`/sop/${id}/retire`, {})).data);
export const useAcknowledge = () => useSopMutation(async (versionId: string) => (await api.post<{ acknowledgedAt: string; alreadyAcknowledged: boolean }>(`/sop/versions/${versionId}/acknowledge`, {})).data);
export const useRemind = () => useSopMutation(async (versionId: string) => (await api.post<{ queued: number }>(`/sop/versions/${versionId}/remind`, {})).data);
export const useCreateGap = () =>
  useSopMutation(async (b: { kind: GapKind; title: string; description?: string; ownerId?: string; priority: number; linkedSopId?: string }) => (await api.post<Gap>('/sop/gaps', b)).data);
export const useUpdateGap = (id: string) =>
  useSopMutation(async (b: { status?: GapStatus; resolution?: string; ownerId?: string | null; priority?: number; description?: string }) => (await api.patch<Gap>(`/sop/gaps/${id}`, b)).data);

export { useQuery };
