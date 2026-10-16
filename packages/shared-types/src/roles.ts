/** Primary hierarchy roles + secondary permission groups (ADR / PHASE_PROMPTS section B.3). */
export const ROLE_KEYS = [
  'DEVELOPER',
  'FOUNDER_CEO',
  'SALES_TEAM_LEAD',
  'SALES_MANAGER',
  'SALES_EXECUTIVE',
  'ADMIN',
  'FINANCE',
  'HR',
  'MARKETING',
  'COMMUNITY',
  'OPERATIONS',
  'STUDENT_SUCCESS',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const PRIMARY_ROLE_KEYS = [
  'DEVELOPER',
  'FOUNDER_CEO',
  'SALES_TEAM_LEAD',
  'SALES_MANAGER',
  'SALES_EXECUTIVE',
  'ADMIN',
] as const satisfies readonly RoleKey[];

export const SECONDARY_ROLE_KEYS = [
  'FINANCE',
  'HR',
  'MARKETING',
  'COMMUNITY',
  'OPERATIONS',
  'STUDENT_SUCCESS',
] as const satisfies readonly RoleKey[];

/** Roles that only the founder may assign (privilege-escalation guard). */
export const SENSITIVE_ROLE_KEYS: readonly RoleKey[] = ['FOUNDER_CEO', 'HR', 'FINANCE'];

/**
 * summary = org-wide but MINIMUM-DATA projection only (id/name/status; no PII). own < team < org.
 */
export const SCOPE_LEVELS = ['summary', 'own', 'team', 'org'] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];
export const SCOPE_RANK: Record<ScopeLevel, number> = { summary: 0, own: 1, team: 2, org: 3 };
