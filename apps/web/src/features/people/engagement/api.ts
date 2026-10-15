'use client';
import { useApiGet, pk } from '../common/api';
import { useApiMutation } from '../hrkit/kit';

export interface Question { id: string; text: string; type: 'SCALE_5' | 'TEXT' }
export interface OpenSurvey { id: string; title: string; questions: Question[]; closesAt: string | null; answered: boolean }
export interface QuestionResult { questionId: string; text: string; responses: number; average: number | null; distribution: Record<string, number> }
export interface SurveyResult { surveyId: string; title: string; status: string; responseCount: number; suppressed: boolean; minResponses: number; questions: QuestionResult[] | null }

export const useOpenSurveys = () => useApiGet<OpenSurvey[]>(pk('engagement', 'open'), '/engagement/surveys');
export const useSurveyResults = (enabled: boolean) => useApiGet<SurveyResult[]>(pk('engagement', 'results'), '/engagement/results', {}, enabled);
export const useRespond = () => useApiMutation<{ surveyId: string; answers: Record<string, number | string> }>('post', () => '/engagement/responses');
export const useCreateSurvey = () => useApiMutation<Record<string, unknown>>('post', () => '/engagement/surveys');
