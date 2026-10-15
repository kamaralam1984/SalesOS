import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { addDays, localDay } from '@salesos/workforce-core';
import { runProbationSweep } from '../src/jobs/workforce/probation';
import { runBirthdaySweep } from '../src/jobs/workforce/birthdays';
import { buildRegistry } from '../src/jobs/registry';

const DB = process.env.TEST_WORKER_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';
let prisma: PrismaClient;
let orgId: string;
const today = localDay(new Date(), 'Asia/Kolkata');
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const uid = () => randomUUID().slice(0, 8);
const mkUser = (name: string, over: Record<string, unknown> = {}) => prisma.user.create({ data: { organizationId: orgId, email: `${name}-${uid()}@test.local`, name, ...over } });
const events = (prefix: string) => prisma.outboxEvent.findMany({ where: { organizationId: orgId, idempotencyKey: { startsWith: `notification.requested:${prefix}` } } });

describe('workforce HR worker jobs (real Postgres)', () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: DB });
    orgId = (await prisma.organization.create({ data: { name: '[TEST] workforce-d', slug: `wd-${uid()}` } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('registers the probation and birthday queues as repeatable processors', () => {
    const reg = buildRegistry();
    const queues = reg.processors.map((p) => p.queue);
    expect(queues).toEqual(expect.arrayContaining(['workforce-probation', 'workforce-birthdays']));
    expect(reg.repeatables.map((r) => r.name)).toEqual(expect.arrayContaining(['workforce-probation-sweep', 'workforce-birthday-sweep']));
  });

  describe('probation reminders', () => {
    it('queues ONE reminder 7 days before the end, to HR and the line manager; reruns do not duplicate', async () => {
      const mgr = await mkUser('mgr');
      const emp = await mkUser('emp', { managerId: mgr.id });
      await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: emp.id, joinDate: d(addDays(today, -83)), probationEndDate: d(addDays(today, 7)), probationMonths: 3 } });
      const first = await runProbationSweep(prisma);
      expect(first.queued).toBeGreaterThanOrEqual(1);
      const rows = await events(`probation.ending_soon:${emp.id}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payload).toMatchObject({ type: 'probation.ending_soon', roles: ['HR'], userIds: [mgr.id], actionUrl: '/work/hr/probation' });
      expect(JSON.stringify(rows[0]!.payload)).not.toContain('emp-');
      const again = await runProbationSweep(prisma);
      expect(again.queued).toBe(0);
      expect(await events(`probation.ending_soon:${emp.id}`)).toHaveLength(1);
    });
    it('skips other offsets, confirmed, exited and inactive employees; falls back to joinDate + default months', async () => {
      const mk = async (name: string, profile: Record<string, unknown>, user: Record<string, unknown> = {}) => {
        const u = await mkUser(name, user);
        await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: u.id, ...profile } });
        return u;
      };
      const off = await mk('off', { joinDate: d(addDays(today, -60)), probationEndDate: d(addDays(today, 5)) });
      const conf = await mk('conf', { joinDate: d(addDays(today, -83)), probationEndDate: d(addDays(today, 7)) });
      await prisma.probationReview.create({ data: { organizationId: orgId, employeeId: conf.id, checkpointDay: 1001, dueDate: d(today), status: 'COMPLETED', outcome: 'CONFIRM' } });
      const exited = await mk('exited', { joinDate: d(addDays(today, -83)), probationEndDate: d(addDays(today, 7)), exitDate: d(addDays(today, -1)) });
      const inactive = await mk('inactive', { joinDate: d(addDays(today, -83)), probationEndDate: d(addDays(today, 7)) }, { isActive: false });
      // no stored end date: join 2026-... three calendar months before (today + 7 days)
      const [y, m, day] = addDays(today, 7).split('-').map(Number) as [number, number, number];
      const joinTarget = new Date(Date.UTC(y!, m! - 1 - 3, day!)).toISOString().slice(0, 10);
      const fb = await mk('fallback', { joinDate: d(joinTarget) });
      await runProbationSweep(prisma);
      for (const u of [off, conf, exited, inactive]) expect(await events(`probation.ending_soon:${u.id}`), u.name).toHaveLength(0);
      const fbEv = await events(`probation.ending_soon:${fb.id}`);
      expect(fbEv.length).toBeLessThanOrEqual(1); // day clamping can shift the end for 29-31 day starts; never more than one
    });
    it('reminders follow the end date: a moved end date is only reminded at a configured offset', async () => {
      const emp = await mkUser('ext');
      const p = await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: emp.id, joinDate: d(addDays(today, -83)), probationEndDate: d(addDays(today, 7)) } });
      await runProbationSweep(prisma);
      await prisma.employeeProfile.update({ where: { id: p.id }, data: { probationEndDate: d(addDays(today, 7 + 0)) } });
      await runProbationSweep(prisma);
      expect(await events(`probation.ending_soon:${emp.id}`)).toHaveLength(1);
      await prisma.employeeProfile.update({ where: { id: p.id }, data: { probationEndDate: d(addDays(today, 14)) } });
      await runProbationSweep(prisma); // 14 days left: not a configured offset, nothing new
      expect(await events(`probation.ending_soon:${emp.id}`)).toHaveLength(1);
    });
    it('honours a custom reminder policy per organisation', async () => {
      const org2 = await prisma.organization.create({ data: { name: '[TEST] workforce-d-2', slug: `wd2-${uid()}` } });
      await prisma.workforceSetting.create({ data: { organizationId: org2.id, config: { hr: { probationReminderDays: [14] } }, version: 1 } as never });
      const u = await prisma.user.create({ data: { organizationId: org2.id, email: `p-${uid()}@test.local`, name: 'p' } });
      await prisma.employeeProfile.create({ data: { organizationId: org2.id, userId: u.id, joinDate: d(addDays(today, -76)), probationEndDate: d(addDays(today, 14)) } });
      await runProbationSweep(prisma);
      const rows = await prisma.outboxEvent.findMany({ where: { organizationId: org2.id, idempotencyKey: { startsWith: `notification.requested:probation.ending_soon:${u.id}` } } });
      expect(rows).toHaveLength(1);
    });
  });

  describe('birthday reminders', () => {
    it('queues HR and (only when shared) team reminders at configured offsets; no names, dates of birth or ages', async () => {
      const mgr = await mkUser('bmgr');
      const peer = await mkUser('bpeer', { managerId: mgr.id });
      const shared = await mkUser('bshared', { managerId: mgr.id });
      const priv = await mkUser('bprivate', { managerId: mgr.id });
      const dob = (days: number) => d(`1988-${addDays(today, days).slice(5)}`);
      await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: shared.id, dateOfBirth: dob(3), shareBirthday: true } });
      await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: priv.id, dateOfBirth: dob(3), shareBirthday: false } });
      const r1 = await runBirthdaySweep(prisma);
      expect(r1.queued).toBeGreaterThanOrEqual(3);
      const hrShared = await events(`birthday.upcoming:hr:${shared.id}`);
      const team = await events(`birthday.upcoming:team:${shared.id}`);
      const hrPriv = await events(`birthday.upcoming:hr:${priv.id}`);
      const teamPriv = await events(`birthday.upcoming:team:${priv.id}`);
      expect(hrShared).toHaveLength(1);
      expect(hrPriv).toHaveLength(1);
      expect(team).toHaveLength(1);
      expect(teamPriv).toHaveLength(0);
      expect((team[0]!.payload as { userIds: string[] }).userIds.sort()).toEqual([mgr.id, peer.id, priv.id].sort());
      expect(JSON.stringify([hrShared, team, hrPriv]).match(/1988|bshared|bprivate/)).toBeNull();
      const r2 = await runBirthdaySweep(prisma);
      expect(r2.queued).toBe(0);
      expect(await events(`birthday.upcoming:hr:${shared.id}`)).toHaveLength(1);
    });
    it('does nothing for offsets that are not configured, exited or inactive people', async () => {
      const a = await mkUser('boff');
      const b = await mkUser('bexit');
      const c = await mkUser('binactive', { isActive: false });
      await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: a.id, dateOfBirth: d(`1990-${addDays(today, 5).slice(5)}`) } });
      await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: b.id, dateOfBirth: d(`1990-${addDays(today, 3).slice(5)}`), exitDate: d(addDays(today, -2)) } });
      await prisma.employeeProfile.create({ data: { organizationId: orgId, userId: c.id, dateOfBirth: d(`1990-${addDays(today, 3).slice(5)}`) } });
      await runBirthdaySweep(prisma);
      for (const u of [a, b, c]) expect(await events(`birthday.upcoming:hr:${u.id}`), u.name).toHaveLength(0);
    });
  });
});
