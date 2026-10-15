import type { JobRegistry } from '../registry';
import { registerDayClose } from './day-close';
import { registerEarnedLeave } from './earned-leave';
import { registerGoals } from './goals';
import { registerTasks } from './tasks';
import { registerBirthdays } from './birthdays';
import { registerProbation } from './probation';

/**
 * workforce jobs (DEC-048). Owners add their handlers here, each in its own file under jobs/workforce/:
 *  - earned-leave (daily engine, idempotent), attendance auto-absent, goal risk + reminders, work-task overdue,
 *    probation / birthday reminders, year-end carry-forward.
 * Handlers must be idempotent (BullMQ retries). Pure logic lives in @salesos/workforce-core.
 */
export function register(registry: JobRegistry): void {
  // filled by the workforce modules
  registerDayClose(registry);
  registerEarnedLeave(registry);
  registerGoals(registry);
  registerTasks(registry);
  registerProbation(registry);
  registerBirthdays(registry);
}
