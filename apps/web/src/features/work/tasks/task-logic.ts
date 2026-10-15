import type { TaskPriority, TaskStatus, WorkTask } from '@/lib/api/hooks/work-tasks';
import type { Tone } from '../common/shared';

export const taskStatusTone = (s: TaskStatus): Tone =>
  s === 'COMPLETED' ? 'green' : s === 'REVIEW' ? 'gold' : s === 'REJECTED' || s === 'CANCELLED' ? 'neutral' : s === 'IN_PROGRESS' ? 'blue' : 'neutral';
export const priorityTone = (p: TaskPriority): Tone => (p === 'URGENT' ? 'red' : p === 'HIGH' ? 'gold' : 'neutral');

export const taskViews = (can: (k: string, min?: 'own' | 'team' | 'org') => boolean): Array<'mine' | 'assigned' | 'team' | 'all'> => {
  const v: Array<'mine' | 'assigned' | 'team' | 'all'> = ['mine'];
  if (can('work-tasks:create', 'team')) v.push('assigned');
  if (can('work-tasks:view', 'team')) v.push('team', 'all');
  return v;
};

/** Buttons offered on a task, in display order, from the server-computed `can.transitions` (the API stays the authority). */
export type TaskActionKey = 'ACCEPTED' | 'IN_PROGRESS' | 'REVIEW' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'SEND_BACK' | 'REASSIGN';
export interface TaskAction { key: TaskActionKey; to: TaskStatus; noteRequired: boolean; evidence: boolean; primary: boolean }

export function taskActions(task: Pick<WorkTask, 'status' | 'can'>): TaskAction[] {
  const tr = task.can.transitions;
  const out: TaskAction[] = [];
  const add = (key: TaskActionKey, to: TaskStatus, o: Partial<Omit<TaskAction, 'key' | 'to'>> = {}) =>
    out.push({ key, to, noteRequired: false, evidence: false, primary: false, ...o });
  if (tr.ACCEPTED) add('ACCEPTED', 'ACCEPTED', { primary: task.status === 'ASSIGNED' });
  if (tr.IN_PROGRESS) {
    if (task.status === 'REVIEW') add('SEND_BACK', 'IN_PROGRESS', { noteRequired: true });
    else add('IN_PROGRESS', 'IN_PROGRESS', { primary: task.status === 'ACCEPTED' });
  }
  if (tr.REVIEW) add('REVIEW', 'REVIEW', { evidence: true, primary: true });
  if (tr.COMPLETED) add('COMPLETED', 'COMPLETED', { evidence: true, primary: task.status === 'REVIEW' });
  if (tr.ASSIGNED) add('REASSIGN', 'ASSIGNED');
  if (tr.REJECTED) add('REJECTED', 'REJECTED', { noteRequired: true });
  if (tr.CANCELLED) add('CANCELLED', 'CANCELLED');
  return out;
}
