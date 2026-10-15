/** Shared CX vocabularies (validated by Zod in the API; stored as strings where the set is configurable). */
export const COMPLAINT_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type ComplaintPriorityKey = (typeof COMPLAINT_PRIORITIES)[number];

export const COMPLAINT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REOPENED'] as const;
export type ComplaintStatusKey = (typeof COMPLAINT_STATUSES)[number];
export const COMPLAINT_ACTIVE_STATUSES: ComplaintStatusKey[] = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ESCALATED', 'REOPENED'];

/** Complaint categories (what the learner complains about). */
export const COMPLAINT_CATEGORIES = ['PAYMENT_BILLING', 'PROGRAM_CONTENT', 'DELIVERY_ACCESS', 'SALES_CONDUCT', 'REFUND', 'SUPPORT_RESPONSE', 'TECHNICAL', 'OTHER'] as const;

/** Root-cause categories (why it happened). Mandatory on resolve; also used for refund root causes. */
export const ROOT_CAUSE_CATEGORIES = [
  'EXPECTATION_MISMATCH',
  'MISLEADING_PROMISE',
  'PRODUCT_FIT',
  'PRICING_PAYMENT',
  'DELIVERY_DELAY',
  'SUPPORT_QUALITY',
  'TECHNICAL_ISSUE',
  'PERSONAL_CIRCUMSTANCES',
  'PROCESS_GAP',
  'OTHER',
] as const;
export type RootCauseKey = (typeof ROOT_CAUSE_CATEGORIES)[number];

export const LANGUAGES = ['EN', 'HI', 'MR'] as const;
export type LanguageKey = (typeof LANGUAGES)[number];

export const SURVEY_KINDS = ['CSAT', 'NPS', 'ENROLMENT_EXPERIENCE'] as const;
export const QUESTION_TYPES = ['RATING_1_5', 'NPS_0_10', 'TEXT', 'YES_NO'] as const;

export const XF_DEPARTMENTS = ['FOUNDER', 'SALES', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'] as const;
export type XfDepartmentKey = (typeof XF_DEPARTMENTS)[number];

/** Which department a role belongs to (drives department-scoped visibility of cross-functional tasks). */
export const ROLE_DEPARTMENT: Record<string, XfDepartmentKey | undefined> = {
  FOUNDER_CEO: 'FOUNDER',
  SALES_TEAM_LEAD: 'SALES',
  SALES_MANAGER: 'SALES',
  SALES_EXECUTIVE: 'SALES',
  MARKETING: 'MARKETING',
  COMMUNITY: 'COMMUNITY',
  OPERATIONS: 'OPERATIONS',
  STUDENT_SUCCESS: 'STUDENT_SUCCESS',
};

/** Roles that notify a department when a task is assigned/escalated to it (role key per department). */
export const DEPARTMENT_ROLE: Record<XfDepartmentKey, string> = {
  FOUNDER: 'FOUNDER_CEO',
  SALES: 'SALES_TEAM_LEAD',
  MARKETING: 'MARKETING',
  COMMUNITY: 'COMMUNITY',
  OPERATIONS: 'OPERATIONS',
  STUDENT_SUCCESS: 'STUDENT_SUCCESS',
};

export type WorkStatusKey = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'ESCALATED' | 'CANCELLED';
export const WORK_OPEN_STATUSES: WorkStatusKey[] = ['OPEN', 'IN_PROGRESS', 'OVERDUE', 'ESCALATED'];

export type HandoverStatusKey = 'DRAFT' | 'SUBMITTED' | 'INFO_REQUESTED' | 'ACKNOWLEDGED' | 'OVERDUE' | 'COMPLETED';

/** Keys that must never be stored in cross-functional payloads / shared insights (data minimisation, MS-CX-002). */
export const PII_KEY_PATTERN = /(phone|mobile|whatsapp|e-?mail|address|aadhaar|aadhar|pan[_-]?(no|number)?|passport|dob|birth|full_?name|learner_?name|contact)/i;
