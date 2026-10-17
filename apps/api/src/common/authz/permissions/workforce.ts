import type { RoleKey, ScopeLevel } from '@salesos/shared-types';
import { definePermissions } from './define';

const ALL_ROLES: RoleKey[] = ['FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE', 'ADMIN', 'FINANCE', 'HR', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'];
/** every employee (any role) on the platform: own scope */
const selfGrants = (extra: Partial<Record<RoleKey, ScopeLevel>> = {}): Partial<Record<RoleKey, ScopeLevel>> => ({ ...Object.fromEntries(ALL_ROLES.map((r) => [r, 'own' as ScopeLevel])), ...extra });
/** every employee: organisation scope (directory-style, minimum data) */
const everyoneOrg = (): Partial<Record<RoleKey, ScopeLevel>> => Object.fromEntries(ALL_ROLES.map((r) => [r, 'org' as ScopeLevel]));

/**
 * Workforce permissions (DEC-048): attendance, holidays, leave, Earned Leave, goals, work tasks, payroll, org chart, birthdays.
 * "Employee" = any user (all roles hold `own`); Boss = FOUNDER_CEO; Manager scope = team; HR / Finance are secondary groups.
 * Payroll and leave-balance data are sensitive: ADMIN holds none (DEC-032).
 */
export const workforcePermissions = definePermissions('workforce', {
  'attendance:self': { description: 'Check in/out and view own attendance', grants: selfGrants() },
  'attendance:view': { description: 'View attendance (own / team / organisation)', grants: selfGrants({ FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', HR: 'org' }) },
  'attendance:correct': { description: 'Correct an attendance record with a reason (audited with old/new value)', sensitive: true, grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', HR: 'org' } },
  'holidays:view': { description: 'View the holiday calendar', grants: everyoneOrg() },
  'meetings:view': { description: 'See the Zoom meetings the company has announced on the home page', grants: selfGrants({ DEVELOPER: 'own' }) },
  'meetings:manage': { description: 'Announce, list and cancel company Zoom meetings (HR, Founder, Developer)', grants: { FOUNDER_CEO: 'org', HR: 'org', DEVELOPER: 'org' } },
  'holidays:manage': { description: 'Create/approve/edit holidays and generate suggestions', grants: { FOUNDER_CEO: 'org', HR: 'org' } },
  'leave:apply': { description: 'Apply for / cancel own leave', grants: selfGrants() },
  'leave:view': { description: 'View leave requests and balances (own / team / organisation)', grants: selfGrants({ FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', HR: 'org' }) },
  'leave:approve': { description: 'Approve/reject leave at the manager step', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team' } },
  'leave:approve-hr': { description: 'Approve/reject leave at the HR step', sensitive: true, grants: { FOUNDER_CEO: 'org', HR: 'org' } },
  'leave:balance:adjust': { description: 'Adjust a leave balance (opening balance, correction); always audited', sensitive: true, grants: { FOUNDER_CEO: 'org', HR: 'org' } },
  'joiners:manage': { description: 'Join a new employee: create the account, HR record, the 90-day training plan and first tasks (HR and the Boss)', sensitive: true, grants: { FOUNDER_CEO: 'org', HR: 'org' } },
  'workforce:settings:view': { description: 'View workforce policy (leave types, Earned Leave, attendance, goals, payroll)', grants: { FOUNDER_CEO: 'org', HR: 'org' } },
  'workforce:settings:manage': { description: 'Change workforce policy; every change is logged with user and time', sensitive: true, grants: { FOUNDER_CEO: 'org', HR: 'org' } },
  'goals:view': { description: 'View goals (own / team / organisation)', grants: selfGrants({ FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', HR: 'org' }) },
  'goals:create': { description: 'Create a goal (own scope = for yourself; team/org = assign to others)', grants: selfGrants({ FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team' }) },
  'goals:update': { description: 'Update goal progress, milestones and submit for verification', grants: selfGrants({ FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team' }) },
  'goals:review': { description: 'Comment on, verify or return a goal', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team' } },
  'work-tasks:view': { description: 'View work tasks (own / team / organisation)', grants: selfGrants({ FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', HR: 'org' }) },
  'work-tasks:create': { description: 'Create a work task (own = for yourself; team = assign to team members; org = assign to anyone)', grants: selfGrants({ FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', HR: 'org' }) },
  'work-tasks:update': { description: 'Update/accept/progress/review a work task you are part of (assignee or assigner), or in scope', grants: selfGrants({ FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', HR: 'org' }) },
  'directory:view': { description: 'Employee directory, global search and organisation chart (name, designation, department, manager, status)', grants: everyoneOrg() },
  'birthdays:view': { description: 'View upcoming birthdays of all employees (date of birth is HR data)', sensitive: true, grants: { FOUNDER_CEO: 'org', HR: 'org' } },
  'workforce:dashboard:view': { description: 'Workforce dashboards: employee (own), manager (team), HR / Boss (organisation)', grants: selfGrants({ FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', HR: 'org' }) },
  'workforce:reports:view': { description: 'Attendance, leave, Earned Leave, task, goal, holiday, probation and birthday reports', grants: { FOUNDER_CEO: 'org', SALES_TEAM_LEAD: 'team', SALES_MANAGER: 'team', HR: 'org' } },
  'workforce:reports:export': { description: 'Export workforce reports (CSV/XLSX, audited)', sensitive: true, grants: { FOUNDER_CEO: 'org', HR: 'org' } },
  'announcements:view': { description: 'View company announcements', grants: everyoneOrg() },
  'announcements:manage': { description: 'Publish company announcements', grants: { FOUNDER_CEO: 'org', HR: 'org' } },
  'payroll:structure:view': { description: 'View salary structures', sensitive: true, grants: { FOUNDER_CEO: 'org', FINANCE: 'org', HR: 'org' } },
  'payroll:structure:manage': { description: 'Create salary structure versions for employees', sensitive: true, grants: { FINANCE: 'org', HR: 'org' } },
  'payroll:run:view': { description: 'View payroll runs and all payslips', sensitive: true, grants: { FOUNDER_CEO: 'org', FINANCE: 'org', HR: 'org' } },
  'payroll:run:manage': { description: 'Create a payroll run, calculate it from attendance/leave, add adjustment lines before approval', sensitive: true, grants: { FINANCE: 'org', HR: 'org' } },
  'payroll:run:approve': { description: 'Approve or send back a calculated payroll run', sensitive: true, grants: { FOUNDER_CEO: 'org' } },
  'payroll:run:mark-paid': { description: 'Record that an approved run was paid externally (payout reference); Sales OS never moves money', sensitive: true, grants: { FINANCE: 'org' } },
  'payroll:payslip:view': { description: 'View own payslips', grants: selfGrants() },
});
