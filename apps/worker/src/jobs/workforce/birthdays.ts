import type { PrismaClient } from '@prisma/client';
import type { JobRegistry } from '../registry';
import { PLATFORM_EVENTS } from '@salesos/shared-types';
import { hrPolicy, localDay, nextBirthday, reminderDueToday, type HrPolicy } from '@salesos/workforce-core';

export const WORKFORCE_BIRTHDAYS_QUEUE = 'workforce-birthdays';
const BATCH = 500;
const MAX_PER_RUN = 20_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface BirthdaySweepResult { scanned: number; queued: number }

/**
 * Birthday reminders at `hr.birthdayReminderDays` before the next birthday (idempotent; key = employee + celebration date + offset):
 *  - HR and the Founder (birthdays:view holders) get ONE generic `birthday.upcoming` per employee and offset;
 *  - the team (line manager and peers) is told ONLY when the employee agreed to share (`shareBirthday=true`).
 * Notifications carry no name, no date of birth and no age. Exited or deactivated employees are skipped.
 */
export async function runBirthdaySweep(prisma: PrismaClient, now = new Date()): Promise<BirthdaySweepResult> {
  const res: BirthdaySweepResult = { scanned: 0, queued: 0 };
  const policies = new Map<string, HrPolicy>();
  const policyFor = async (orgId: string) => {
    let p = policies.get(orgId);
    if (!p) {
      const row = await prisma.workforceSetting.findUnique({ where: { organizationId: orgId } });
      p = hrPolicy(row?.config);
      policies.set(orgId, p);
    }
    return p;
  };
  let cursor: string | undefined;
  while (res.scanned < MAX_PER_RUN) {
    const profiles = await prisma.employeeProfile.findMany({
      where: { dateOfBirth: { not: null }, exitDate: null, user: { isActive: true } },
      orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { user: { select: { managerId: true } } },
    });
    if (profiles.length === 0) break;
    cursor = profiles[profiles.length - 1]!.id;
    const rows: Array<{ eventType: string; aggregateType: string; aggregateId: string; organizationId: string; payload: object; idempotencyKey: string; availableAt: Date }> = [];
    for (const p of profiles) {
      res.scanned++;
      const policy = await policyFor(p.organizationId);
      const today = localDay(now, policy.timezone);
      const nb = nextBirthday(iso(p.dateOfBirth!), today);
      if (!reminderDueToday(nb.daysUntil, policy.birthdayReminderDays)) continue;
      const base = { aggregateType: 'employee_profile', aggregateId: p.id, organizationId: p.organizationId, availableAt: now };
      const hrKey = `birthday.upcoming:hr:${p.userId}:${nb.date}:${nb.daysUntil}`;
      rows.push({
        ...base, eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, idempotencyKey: `notification.requested:${hrKey}`,
        payload: {
          organizationId: p.organizationId, type: 'birthday.upcoming', roles: ['HR', 'FOUNDER_CEO'], entity: { type: 'employee_profile', id: p.id }, dedupeKey: hrKey, actionUrl: '/work/hr/birthdays',
          title: nb.daysUntil === 0 ? 'A birthday is today' : 'A birthday is coming up',
        },
      });
      if (p.shareBirthday && p.user.managerId) {
        const peers = await prisma.user.findMany({ where: { organizationId: p.organizationId, isActive: true, managerId: p.user.managerId, id: { not: p.userId } }, select: { id: true }, take: 100 });
        const userIds = [...new Set([p.user.managerId, ...peers.map((x) => x.id)])];
        const teamKey = `birthday.upcoming:team:${p.userId}:${nb.date}:${nb.daysUntil}`;
        rows.push({
          ...base, eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, idempotencyKey: `notification.requested:${teamKey}`,
          payload: {
            organizationId: p.organizationId, type: 'birthday.upcoming', userIds, entity: { type: 'employee_profile', id: p.id }, dedupeKey: teamKey, actionUrl: '/work/directory',
            title: nb.daysUntil === 0 ? 'A teammate has a birthday today' : 'A teammate has a birthday coming up',
          },
        });
      }
    }
    if (rows.length > 0) {
      const r = await prisma.outboxEvent.createMany({ data: rows, skipDuplicates: true });
      res.queued += r.count;
    }
    if (profiles.length < BATCH) break;
  }
  return res;
}

export function registerBirthdays(registry: JobRegistry): void {
  registry.processor({
    queue: WORKFORCE_BIRTHDAYS_QUEUE,
    concurrency: 1,
    process: async (_job, ctx) => {
      const r = await runBirthdaySweep(ctx.prisma);
      if (r.queued > 0) ctx.log.info({ job: 'workforce-birthday-sweep', ...r }, 'workforce sweep queued notifications');
      return r;
    },
  });
  registry.repeatable({ queue: WORKFORCE_BIRTHDAYS_QUEUE, name: 'workforce-birthday-sweep', everyMs: 60 * 60_000 });
}
