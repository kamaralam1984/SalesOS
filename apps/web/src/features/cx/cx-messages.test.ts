import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import hi from '../../../messages/hi.json';
import mr from '../../../messages/mr.json';
import { CATEGORIES, COMPLAINT_STATUSES, PRIORITIES, ROOT_CAUSES } from './complaints-page';

type Tree = { [k: string]: string | Tree };
const get = (t: Tree, path: string) => path.split('.').reduce<string | Tree | undefined>((a, k) => (a && typeof a === 'object' ? a[k] : undefined), t);

const VOCAB: Record<string, readonly string[]> = {
  'cx.complaintStatus': COMPLAINT_STATUSES,
  'cx.priority': PRIORITIES,
  'cx.category': CATEGORIES,
  'cx.rootCause': ROOT_CAUSES,
  'cx.workStatus': ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'ESCALATED', 'CANCELLED'],
  'cx.handoverStatus': ['DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'ACKNOWLEDGED', 'OVERDUE', 'COMPLETED'],
  'cx.escalationStatus': ['OPEN', 'IN_REVIEW', 'RESOLVED', 'CANCELLED'],
  'cx.refundStatus': ['REQUESTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'PROCESSED', 'RECONCILED', 'CANCELLED'],
  'cx.refundReason': ['LEARNER_REQUEST', 'DUPLICATE_PAYMENT', 'PROGRAM_CANCELLED', 'MISSELLING', 'TECHNICAL', 'OTHER'],
  'cx.survey.kind': ['CSAT', 'NPS', 'ENROLMENT_EXPERIENCE'],
  'cx.survey.qtype': ['RATING_1_5', 'NPS_0_10', 'TEXT', 'YES_NO'],
  'cx.survey.channel': ['MANUAL', 'PHONE', 'WHATSAPP', 'EMAIL', 'IN_PERSON'],
  'cx.handoverField': ['learnerName', 'learnerContact', 'languagePreference', 'program', 'amountPaid', 'amountDue', 'paymentVerified', 'promisesMade', 'goals', 'objections', 'specialNotes', 'consents'],
  'cx.risks.statusValue': ['OPEN', 'MITIGATING', 'RESOLVED', 'ACCEPTED'],
  'cx.reports.sev': ['1', '2', '3', '4'],
  'collab.department': ['FOUNDER', 'SALES', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'],
  'collab.kind': ['TASK', 'HANDOFF', 'CAMPAIGN_ALIGNMENT', 'WEBINAR_PLANNING', 'INSIGHT_REQUEST'],
};

describe('Phase 7 messages cover every dynamic key in en, hi and mr', () => {
  for (const [name, msgs] of [['en', en], ['hi', hi], ['mr', mr]] as const) {
    it(`${name}: every enumerated label exists and is non-empty`, () => {
      for (const [ns, values] of Object.entries(VOCAB)) {
        for (const v of values) {
          const m = get(msgs as unknown as Tree, `${ns}.${v}`);
          expect(typeof m === 'string' && m.length > 0, `${name}:${ns}.${v}`).toBe(true);
        }
      }
    });
  }
  it('hub tiles all have title and hint; Hindi and Marathi are translated, not copies of English', () => {
    for (const id of ['complaints', 'escalations', 'relationships', 'satisfaction', 'refunds', 'handovers', 'reports', 'actionItems', 'risks']) {
      for (const f of ['title', 'hint']) {
        expect(typeof get(en as unknown as Tree, `cx.hub.${id}.${f}`)).toBe('string');
        expect(get(hi as unknown as Tree, `cx.hub.${id}.${f}`)).not.toBe(get(en as unknown as Tree, `cx.hub.${id}.${f}`));
        expect(get(mr as unknown as Tree, `cx.hub.${id}.${f}`)).not.toBe(get(en as unknown as Tree, `cx.hub.${id}.${f}`));
      }
    }
    for (const k of ['cx.complaints.title', 'cx.handover.submit', 'cx.reports.publish', 'collab.tasks.title']) {
      expect(get(hi as unknown as Tree, k)).not.toBe(get(en as unknown as Tree, k));
      expect(get(mr as unknown as Tree, k)).not.toBe(get(en as unknown as Tree, k));
    }
  });
});
