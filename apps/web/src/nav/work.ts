import { Banknote, CalendarCheck2, CalendarDays, ClipboardList, Network, Target, Users, Wallet } from 'lucide-react';
import type { NavDomain } from './types';

/**
 * Workforce navigation (DEC-048). The hrefs below are the contract between the workforce web areas:
 *   /work                      My Work hub (employee / manager / HR / Boss dashboard by scope)
 *   /work/attendance           check in/out, monthly calendar, corrections (team/HR via ?user=)
 *   /work/leave                balances (incl. Earned Leave ledger), apply, history
 *   /work/approvals            leave approvals (manager step / HR step)
 *   /work/goals, /work/goals/[id]    45-day goal cycle
 *   /work/tasks, /work/tasks/[id]    work tasks
 *   /work/holidays             holiday calendar (+ manage for HR)
 *   /work/directory, /work/people/[id], /work/org-chart   search, Employee 360, organisation chart
 *   /work/hr                   HR hub: policy, balances, birthdays, probation, announcements
 *   /work/payroll, /work/payroll/[month], /work/payslips     payroll register and own payslips
 *   /work/reports              reports and exports
 */
export const workNav: NavDomain = {
  sectionKey: 'work',
  items: [
    {
      id: 'work', labelKey: 'work', href: '/work', icon: CalendarCheck2, permission: 'workforce:dashboard:view', mobilePriority: 2, order: 30,
      children: [
        { id: 'work.attendance', labelKey: 'workAttendance', href: '/work/attendance', permission: 'attendance:self' },
        { id: 'work.leave', labelKey: 'workLeave', href: '/work/leave', permission: 'leave:apply' },
        { id: 'work.goals', labelKey: 'workGoals', href: '/work/goals', permission: 'goals:view' },
        { id: 'work.tasks', labelKey: 'workTasks', href: '/work/tasks', permission: 'work-tasks:view' },
        { id: 'work.holidays', labelKey: 'workHolidays', href: '/work/holidays', permission: 'holidays:view' },
        { id: 'work.payslips', labelKey: 'workPayslips', href: '/work/payslips', permission: 'payroll:payslip:view' },
      ],
    },
    { id: 'work.approvals', labelKey: 'workApprovals', href: '/work/approvals', icon: ClipboardList, permission: ['leave:approve', 'leave:approve-hr'], mobilePriority: null, order: 31 },
    { id: 'work.goalsHub', labelKey: 'workGoalCycle', href: '/work/goals', icon: Target, permission: 'goals:view', mobilePriority: null, order: 32 },
    { id: 'work.directory', labelKey: 'workDirectory', href: '/work/directory', icon: Users, permission: 'directory:view', mobilePriority: null, order: 33 },
    { id: 'work.orgChart', labelKey: 'workOrgChart', href: '/work/org-chart', icon: Network, permission: 'directory:view', mobilePriority: null, order: 34 },
    {
      id: 'work.hr', labelKey: 'workHr', href: '/work/hr', icon: CalendarDays, permission: ['workforce:settings:view', 'birthdays:view'], mobilePriority: null, order: 35,
      children: [
        { id: 'work.hr.policy', labelKey: 'workHrPolicy', href: '/work/hr/policy', permission: 'workforce:settings:view' },
        { id: 'work.hr.balances', labelKey: 'workHrBalances', href: '/work/hr/balances', permission: 'leave:balance:adjust' },
        { id: 'work.hr.birthdays', labelKey: 'workHrBirthdays', href: '/work/hr/birthdays', permission: 'birthdays:view' },
        { id: 'work.hr.joiners', labelKey: 'workHrJoiners', href: '/work/hr/joiners', permission: 'joiners:manage' },
        { id: 'work.hr.probation', labelKey: 'workHrProbation', href: '/work/hr/probation', permission: 'workforce:settings:view' },
        { id: 'work.hr.announcements', labelKey: 'workHrAnnouncements', href: '/work/hr/announcements', permission: 'announcements:manage' },
      ],
    },
    {
      id: 'work.payroll', labelKey: 'workPayroll', href: '/work/payroll', icon: Wallet, permission: 'payroll:run:view', mobilePriority: null, order: 36,
      children: [{ id: 'work.payroll.structures', labelKey: 'workPayrollStructures', href: '/work/payroll/structures', permission: 'payroll:structure:view' }],
    },
    { id: 'work.reports', labelKey: 'workReports', href: '/work/reports', icon: Banknote, permission: 'workforce:reports:view', mobilePriority: null, order: 37 },
  ],
};
