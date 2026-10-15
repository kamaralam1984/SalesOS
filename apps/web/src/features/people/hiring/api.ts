'use client';
import { useApiGet, useApiList, pk } from '../common/api';
import { useApiMutation } from '../hrkit/kit';

export type CandidateStage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'ASSESSMENT' | 'OFFER' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
export const STAGES: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];
export type Criterion = 'MET' | 'NOT_MET' | 'UNKNOWN' | 'NOT_REQUIRED';

export interface Requisition {
  id: string;
  title: string;
  roleKey: string;
  profileId: string | null;
  hiringManagerId: string;
  hiringManagerName: string | null;
  headcount: number;
  status: 'OPEN' | 'ON_HOLD' | 'FILLED' | 'CANCELLED';
  targetDate: string | null;
  notes: string | null;
  candidateCount: number;
  stages: Record<string, number>;
}
export interface ProfileMatch { experience: Criterion; teamManagement: Criterion; industry: Criterion; education: Criterion; matchedIndustries: string[] }
export interface Candidate {
  id: string;
  requisitionId: string;
  requisitionTitle: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  stage: CandidateStage;
  stageReason: string | null;
  educationLevel: string | null;
  experienceYears: number | null;
  teamMgmtYears: number | null;
  industries: string[];
  profileMatch: ProfileMatch | null;
}
export interface Feedback {
  id: string;
  interviewerName: string | null;
  round: number;
  interviewAt: string;
  recommendation: 'STRONG_YES' | 'YES' | 'NO' | 'STRONG_NO';
  competencyScores: Record<string, number>;
  notes: string | null;
  notesRestricted: boolean;
}
export interface CandidateDetail extends Candidate { feedback: Feedback[] }
export interface RoleProfile {
  id?: string;
  roleKey: string;
  title: string;
  minEducation: string | null;
  preferredEducation: string | null;
  minExperienceYears: number | null;
  maxExperienceYears: number | null;
  minTeamMgmtYears: number | null;
  preferredIndustries: string[];
  requiredBackgrounds: string[];
  additionalCriteria?: string[];
  notes: string | null;
}
export interface Competency { id: string; key: string; name: string; isActive: boolean }

export const useRequisitions = () => useApiList<Requisition>(pk('hiring', 'req'), '/people/hiring', { limit: 50 });
export const useCandidates = (requisitionId: string | null) => useApiList<Candidate>(pk('hiring', 'cand'), '/people/hiring/candidates', { requisitionId, limit: 100 }, Boolean(requisitionId));
export const useCandidate = (id: string | null) => useApiGet<CandidateDetail>(pk('hiring', 'cand-detail', id ?? ''), `/people/hiring/candidates/${id}`, {}, Boolean(id));
export const useRoleProfiles = () => useApiGet<RoleProfile[]>(pk('hiring', 'profiles'), '/people/hiring/profiles');
export const useCompetencies = () => useApiGet<Competency[]>(pk('competencies'), '/people/competencies');

export const useCreateRequisition = () => useApiMutation<Record<string, unknown>>('post', () => '/people/hiring');
export const useUpdateRequisition = (id: string) => useApiMutation<Record<string, unknown>>('patch', () => `/people/hiring/${id}`);
export const useCreateCandidate = () => useApiMutation<Record<string, unknown>>('post', () => '/people/hiring/candidates');
export const useMoveCandidate = (id: string) => useApiMutation<{ stage: CandidateStage; reason?: string }>('post', () => `/people/hiring/candidates/${id}/stage`);
export const useAddFeedback = (id: string) => useApiMutation<Record<string, unknown>>('post', () => `/people/hiring/candidates/${id}/feedback`);
export const useSaveProfile = () => useApiMutation<Record<string, unknown>>('put', () => '/people/hiring/profiles');
