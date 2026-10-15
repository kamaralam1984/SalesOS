import { Users } from 'lucide-react';
import type { NavDomain } from './types';

/** CRM domain (Phase 3): workspace, leads, tasks, follow-ups, manager queues, imports, events, settings. */
export const crmNav: NavDomain = {
  sectionKey: 'workspace',
  items: [
    {
      id: 'crm',
      labelKey: 'crm',
      href: '/crm',
      icon: Users,
      permission: 'leads:view',
      mobilePriority: 2,
      order: 10,
      children: [
        { id: 'crm.leads', labelKey: 'crmLeads', href: '/crm/leads', permission: 'leads:view' },
        { id: 'crm.tasks', labelKey: 'crmTasks', href: '/crm/tasks', permission: 'tasks:view' },
        { id: 'crm.calendar', labelKey: 'crmCalendar', href: '/crm/calendar', permission: 'tasks:view' },
        { id: 'crm.overdue', labelKey: 'crmOverdue', href: '/crm/overdue', permission: 'tasks:view' },
        { id: 'crm.exceptions', labelKey: 'crmExceptions', href: '/crm/exceptions', permission: 'leads:exceptions:view' },
        { id: 'crm.reassignment', labelKey: 'crmReassignment', href: '/crm/reassignment', permission: 'leads:reassignment-queue:resolve' },
        { id: 'crm.duplicates', labelKey: 'crmDuplicates', href: '/crm/duplicates', permission: 'leads:duplicates:review' },
        { id: 'crm.reactivation', labelKey: 'crmReactivation', href: '/crm/reactivation', permission: 'leads:reactivation:view' },
        { id: 'crm.imports', labelKey: 'crmImports', href: '/crm/imports', permission: ['leads:import', 'imports:view'] },
        { id: 'crm.events', labelKey: 'crmEvents', href: '/crm/events', permission: 'events:view' },
        { id: 'crm.settings', labelKey: 'crmSettings', href: '/crm/settings', permission: 'settings:view' },
      ],
    },
  ],
};
