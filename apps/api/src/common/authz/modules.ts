/**
 * Organisation-wide feature modules the Developer (Super Admin) can switch ON/OFF. A module is a set of permission-key prefixes;
 * while it is OFF every permission under those prefixes is removed from every user (the Developer included), so the API rejects
 * the calls (403) and the web hides the screens. The Sales/CRM core (leads, calls, tasks, follow-ups, deals, collections, refunds,
 * targets, forecasts, KPIs, dashboards, reports, users, teams, audit) is NOT a module: it can never be switched off.
 */
export interface ModuleDef {
  key: string;
  label: string;
  description: string;
  /** state when the organisation has never touched the switch */
  defaultEnabled: boolean;
  /** permission keys starting with any of these belong to the module */
  prefixes: readonly string[];
}

export const MODULES: readonly ModuleDef[] = [
  { key: 'attendance', label: 'Attendance', description: 'Check in/out, day sheets, attendance corrections and team attendance views', defaultEnabled: false, prefixes: ['attendance:'] },
  { key: 'leave', label: 'Leave and Earned Leave', description: 'Leave applications, approvals and balances', defaultEnabled: true, prefixes: ['leave:'] },
  { key: 'payroll', label: 'Payroll', description: 'Salary structures, payroll runs and payslips', defaultEnabled: true, prefixes: ['payroll:'] },
  { key: 'hiring', label: 'Hiring and onboarding', description: 'Openings, candidates, joiners and onboarding checklists', defaultEnabled: true, prefixes: ['hiring:', 'onboarding:', 'joiners:'] },
  { key: 'coaching', label: 'Coaching, reviews and incentives', description: 'Coaching, scorecards, reviews, PIP, succession, recognition and incentives', defaultEnabled: true, prefixes: ['coaching:', 'scorecards:', 'reviews:', 'pip:', 'succession:', 'recognition:', 'incentives:'] },
  { key: 'sop', label: 'SOP centre and resources', description: 'SOPs, acknowledgements, gaps and the resource library', defaultEnabled: true, prefixes: ['sop:', 'resources:'] },
  { key: 'cx', label: 'Customer experience', description: 'Complaints, satisfaction, relationships and programs', defaultEnabled: true, prefixes: ['complaints:', 'satisfaction:', 'relationships:', 'programs:'] },
  { key: 'collaboration', label: 'Collaboration', description: 'Cross-functional tasks, action items, proposals, meetings and announcements', defaultEnabled: true, prefixes: ['xf-tasks:', 'action-items:', 'proposals:', 'meetings:', 'announcements:'] },
  { key: 'workforce', label: 'Workforce tools', description: 'Goals, work tasks, directory, holidays, birthdays, HR records and workforce reports', defaultEnabled: true, prefixes: ['goals:', 'work-tasks:', 'directory:', 'holidays:', 'birthdays:', 'hr:', 'workforce:'] },
];

export type ModuleStates = Record<string, boolean>;

export const SETTINGS_KEY = 'modules';

export const isModuleKey = (key: string) => MODULES.some((m) => m.key === key);

/** Resolve stored switches (unknown keys ignored) over the module defaults. */
export function resolveModuleStates(stored: unknown): ModuleStates {
  const raw = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out: ModuleStates = {};
  for (const m of MODULES) out[m.key] = typeof raw[m.key] === 'boolean' ? (raw[m.key] as boolean) : m.defaultEnabled;
  return out;
}

/** Module that owns this permission key, or undefined for the always-on core. devpanel:* is never owned by a module. */
export function moduleOfPermission(key: string): ModuleDef | undefined {
  if (key.startsWith('devpanel:')) return undefined;
  return MODULES.find((m) => m.prefixes.some((p) => key.startsWith(p)));
}

/** Remove every permission that belongs to a switched-off module. */
export function stripDisabledModules<T>(permissions: Map<string, T>, states: ModuleStates): Map<string, T> {
  for (const key of [...permissions.keys()]) {
    const m = moduleOfPermission(key);
    if (m && states[m.key] === false) permissions.delete(key);
  }
  return permissions;
}
