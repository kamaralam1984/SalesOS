import { PII_KEY_PATTERN, ROLE_DEPARTMENT, piiKeyPaths, piiValuePaths, type XfDepartmentKey } from '@salesos/cx-core';
import { AppError } from '../../common/http/errors';
import type { Principal } from '../../common/authz';

export const LEADERSHIP_ROLES = ['FOUNDER_CEO', 'SALES_TEAM_LEAD'];
export const isLeadership = (u: Principal) => u.roles.some((r) => LEADERSHIP_ROLES.includes(r));

/** Departments the caller belongs to (via roles). */
export function departmentsOf(u: Principal): XfDepartmentKey[] {
  return [...new Set(u.roles.map((r) => ROLE_DEPARTMENT[r]).filter((d): d is XfDepartmentKey => !!d))];
}

/** Departments whose members outside Sales must only receive minimum data (no contact details in tasks/insights). */
export const MINIMUM_DATA_DEPARTMENTS: XfDepartmentKey[] = ['MARKETING', 'COMMUNITY', 'OPERATIONS'];

/** 422 when text/payload carries personal contact data or PII-named keys (MS-CX-002: share minimum data). */
export function assertNoPii(parts: { texts?: Array<string | null | undefined>; payload?: unknown }, what = 'This item'): void {
  const bad: string[] = [];
  for (const t of parts.texts ?? []) if (t && piiValuePaths(t).length) bad.push('text');
  if (parts.payload !== undefined) {
    bad.push(...piiKeyPaths(parts.payload), ...piiValuePaths(parts.payload));
  }
  if (bad.length) {
    throw new AppError('PII_NOT_ALLOWED', `${what} would share personal contact details. Share only the minimum (counts, themes, program, no names, phone numbers or e-mails).`, 422, [...new Set(bad)].map((p) => ({ path: p, message: 'personal data not allowed' })));
  }
}
export { PII_KEY_PATTERN };
