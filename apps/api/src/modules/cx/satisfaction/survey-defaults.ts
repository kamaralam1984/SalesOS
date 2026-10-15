/** Built-in question sets used when the organisation has not configured its own template for a kind (kpi-dictionary KPI-CX-001/004). */
export interface SurveyQuestion {
  id: string;
  text: string;
  type: 'RATING_1_5' | 'NPS_0_10' | 'TEXT' | 'YES_NO';
  required: boolean;
}

export const BUILTIN_TEMPLATES: Record<'CSAT' | 'NPS' | 'ENROLMENT_EXPERIENCE', { name: string; questions: SurveyQuestion[] }> = {
  CSAT: { name: 'Learner satisfaction (CSAT)', questions: [{ id: 'overall', text: 'How satisfied are you with your experience so far?', type: 'RATING_1_5', required: true }, { id: 'comment', text: 'Anything we could do better?', type: 'TEXT', required: false }] },
  NPS: { name: 'Likelihood to recommend (NPS)', questions: [{ id: 'recommend', text: 'How likely are you to recommend us to a friend or colleague?', type: 'NPS_0_10', required: true }, { id: 'comment', text: 'What is the main reason for your score?', type: 'TEXT', required: false }] },
  ENROLMENT_EXPERIENCE: {
    name: 'Enrolment experience',
    questions: [
      { id: 'overall', text: 'Overall, how was your enrolment experience?', type: 'RATING_1_5', required: true },
      { id: 'clarity', text: 'Were the programme details and promises explained clearly?', type: 'YES_NO', required: false },
      { id: 'comment', text: 'What could have made enrolment easier?', type: 'TEXT', required: false },
    ],
  },
};

export const SCORE_RANGE: Record<'CSAT' | 'NPS' | 'ENROLMENT_EXPERIENCE', [number, number]> = { CSAT: [1, 5], NPS: [0, 10], ENROLMENT_EXPERIENCE: [1, 5] };
