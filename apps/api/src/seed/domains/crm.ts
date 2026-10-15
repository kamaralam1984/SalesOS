import { createLeadTx, directDeps, ensureCrmDefaults, type Tx } from '@salesos/crm-core';
import type { SeedContext } from './types';

/**
 * crm demo data. Every record is labelled [DEMO]; idempotent (re-runnable): sources/programs/events are upserted by
 * natural key, leads use createKey `demo:<n>` so a second run creates nothing. Calls are source=MANUAL demo rows
 * clearly marked in their notes. No real people, numbers or conversations.
 */
const SOURCES = [
  { name: '[DEMO] Instagram campaign', type: 'CAMPAIGN' as const },
  { name: '[DEMO] Free AI Sprint webinar', type: 'WEBINAR' as const },
  { name: '[DEMO] Referral', type: 'REFERRAL' as const },
  { name: '[DEMO] Website form', type: 'WEBSITE' as const },
  { name: '[DEMO] CSV import', type: 'IMPORT' as const },
];
const PROGRAMS = [
  { code: 'AI_SPRINT', name: '[DEMO] AI Sprint (free live)', kind: 'PROGRAM' as const },
  { code: 'CBAX', name: '[DEMO] CBAX', kind: 'PROGRAM' as const },
  { code: 'MCA_X', name: '[DEMO] MCA X', kind: 'PROGRAM' as const },
  { code: 'MCA_ELITE_X', name: '[DEMO] MCA Elite X', kind: 'PROGRAM' as const },
  { code: 'COACHEASILY_X', name: '[DEMO] CoachEasily X (app)', kind: 'APP' as const },
  { code: 'WC_SUMMIT', name: '[DEMO] Wealthy Coach Summit', kind: 'EVENT' as const },
];
const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ishita', 'Vikram', 'Ananya', 'Arjun', 'Sana', 'Neel', 'Tara', 'Dev', 'Riya', 'Yash', 'Pooja', 'Kunal', 'Nisha', 'Samir', 'Lata'];
const LAST = ['Sharma', 'Patil', 'Khan', 'Iyer', 'Deshmukh', 'Nair', 'Gupta', 'Joshi', 'Kulkarni', 'Mehta'];
const INTEREST = ['LOW', 'MEDIUM', 'HIGH'] as const;

export async function seedCrm(ctx: SeedContext): Promise<void> {
  const { prisma, organizationId: org, userIds } = ctx;
  const deps = directDeps();
  await prisma.$transaction((tx) => ensureCrmDefaults(tx, org));

  const sources: string[] = [];
  for (const s of SOURCES) {
    const row = await prisma.leadSource.upsert({ where: { organizationId_name: { organizationId: org, name: s.name } }, update: {}, create: { organizationId: org, ...s } });
    sources.push(row.id);
  }
  const programs: string[] = [];
  for (const [i, p] of PROGRAMS.entries()) {
    const row = await prisma.program.upsert({ where: { organizationId_code: { organizationId: org, code: p.code } }, update: {}, create: { organizationId: org, sortOrder: i * 10, ...p } });
    programs.push(row.id);
  }
  const webinarSource = sources[1]!;
  await prisma.leadCampaign.upsert({ where: { organizationId_sourceId_name: { organizationId: org, sourceId: webinarSource, name: '[DEMO] October AI Sprint' } }, update: {}, create: { organizationId: org, sourceId: webinarSource, name: '[DEMO] October AI Sprint' } });

  // round-robin is configured but OFF by default (DEC-008: manual always available); managers switch it on in settings
  const teams = await prisma.team.findMany({ where: { organizationId: org, name: { startsWith: '[DEMO]' } } });
  for (const t of teams) await prisma.assignmentRule.upsert({ where: { organizationId_teamId: { organizationId: org, teamId: t.id } }, update: {}, create: { organizationId: org, teamId: t.id, isEnabled: false } });

  // events: one upcoming webinar, one upcoming demo, one past webinar with attendance
  const day = 86_400_000;
  const now = Date.now();
  const mkEvent = async (title: string, type: 'WEBINAR' | 'DEMO', startsAt: Date, programId: string, status: 'SCHEDULED' | 'COMPLETED') => {
    const ex = await prisma.crmEvent.findFirst({ where: { organizationId: org, title } });
    return ex ?? prisma.crmEvent.create({ data: { organizationId: org, title, type, startsAt, endsAt: new Date(startsAt.getTime() + 90 * 60_000), programId, status, capacity: 200, hostId: userIds.get('manager.a') ?? null, createdById: userIds.get('marketing') ?? null } });
  };
  const upcomingWebinar = await mkEvent('[DEMO] Free AI Sprint: live session', 'WEBINAR', new Date(now + 3 * day), programs[0]!, 'SCHEDULED');
  await mkEvent('[DEMO] CBAX product demo', 'DEMO', new Date(now + 5 * day), programs[1]!, 'SCHEDULED');
  const pastWebinar = await mkEvent('[DEMO] Wealthy Coach Summit preview webinar', 'WEBINAR', new Date(now - 6 * day), programs[5]!, 'COMPLETED');

  // leads: 4 per executive-ish pattern, deterministic, idempotent via createKey
  const execs = [...userIds.keys()].filter((k) => k.startsWith('exec.')).sort();
  let n = 0;
  for (const local of execs) {
    const ownerId = userIds.get(local)!;
    for (let j = 0; j < 4; j++) {
      n++;
      const createKey = `demo:${n}`;
      if (await prisma.lead.findFirst({ where: { organizationId: org, createKey } })) continue;
      const first = FIRST[n % FIRST.length]!;
      const last = LAST[(n * 3) % LAST.length]!;
      const phone = `98${String(10_000_000 + n * 7919).padStart(8, '0').slice(-8)}`;
      const created = await prisma.$transaction(
        (tx: Tx) =>
          createLeadTx(tx, deps, { userId: userIds.get('manager.a') ?? ownerId, organizationId: org }, {
            fullName: `[DEMO] ${first} ${last}`,
            phone,
            email: n % 3 === 0 ? `demo.lead${n}@example.invalid` : null,
            sourceId: sources[n % sources.length],
            programId: programs[n % programs.length],
            assignedToId: ownerId,
            interestLevel: INTEREST[n % 3],
            estimatedValue: (n % 4) * 25000 + 15000,
            consentStatus: n % 5 === 0 ? 'UNKNOWN' : 'GRANTED',
            consentSource: 'demo-seed',
            isKeyProspect: n % 9 === 0,
            createKey,
          }),
        { timeout: 20_000 },
      );
      const lead = created.lead;
      // shape a realistic spread of lifecycle states (deterministic)
      const mode = n % 8;
      const callAt = new Date(now - (n % 5) * day - 3600_000);
      const mkCall = (outcome: 'NO_ANSWER' | 'CONNECTED' | 'BUSY', extra: Record<string, unknown> = {}) =>
        prisma.callLog.create({ data: { organizationId: org, leadId: lead.id, userId: ownerId, source: 'MANUAL', outcome, startedAt: callAt, notes: '[DEMO] sample call note', ...extra } });
      if (mode === 1) {
        await mkCall('NO_ANSWER');
        await prisma.lead.update({ where: { id: lead.id }, data: { status: 'CONTACT_ATTEMPTED', callAttemptCount: 1, noAnswerCount: 1, lastContactAt: callAt, lastActivityAt: callAt, firstContactAt: callAt } });
      } else if (mode === 2 || mode === 3) {
        await mkCall('CONNECTED', { interestLevel: 'HIGH', objectionCategory: mode === 2 ? 'PRICE' : 'TIMING' });
        await prisma.lead.update({ where: { id: lead.id }, data: { status: mode === 2 ? 'CONNECTED' : 'QUALIFIED', interestLevel: 'HIGH', callAttemptCount: 1, lastContactAt: callAt, lastActivityAt: callAt, firstContactAt: callAt } });
      } else if (mode === 4) {
        await prisma.lead.update({ where: { id: lead.id }, data: { status: 'PROPOSAL_NEGOTIATION', interestLevel: 'HIGH', lastActivityAt: callAt } });
      }
      if (mode === 5) {
        // overdue follow-up (visible in the overdue queue)
        await prisma.task.updateMany({ where: { leadId: lead.id, status: 'OPEN' }, data: { dueAt: new Date(now - 26 * 3600_000) } });
        await prisma.lead.update({ where: { id: lead.id }, data: { nextActionAt: new Date(now - 26 * 3600_000) } });
      }
      if (mode === 6) {
        await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: new Date(now - 6 * day), createdAt: new Date(now - 9 * day) } });
      }
      if (mode === 7 && n % 2 === 1) {
        await prisma.eventAttendance.upsert({ where: { eventId_leadId: { eventId: pastWebinar.id, leadId: lead.id } }, update: {}, create: { organizationId: org, eventId: pastWebinar.id, leadId: lead.id, status: 'ATTENDED', joinedAt: new Date(now - 6 * day), registeredAt: new Date(now - 8 * day) } });
      }
      if (mode === 0 && n % 2 === 0) {
        await prisma.eventAttendance.upsert({ where: { eventId_leadId: { eventId: upcomingWebinar.id, leadId: lead.id } }, update: {}, create: { organizationId: org, eventId: upcomingWebinar.id, leadId: lead.id, status: 'REGISTERED', registeredAt: new Date(now - day) } });
      }
    }
  }

  // an unowned lead (exception queue) and a duplicate pair (review queue)
  const mgrA = userIds.get('manager.a');
  const teamA = teams.find((t) => t.name.includes('Team A'));
  for (const spec of [
    { key: 'demo:unowned', name: '[DEMO] Unowned enquiry', phone: '9811100001' },
    { key: 'demo:dup-1', name: '[DEMO] Priya Verma', phone: '9811100002' },
    { key: 'demo:dup-2', name: '[DEMO] Priya Verma', phone: '9811100002' },
  ]) {
    if (await prisma.lead.findFirst({ where: { organizationId: org, createKey: spec.key } })) continue;
    await prisma.$transaction((tx: Tx) => createLeadTx(tx, deps, { userId: mgrA ?? null, organizationId: org, teamId: teamA?.id ?? null }, { fullName: spec.name, phone: spec.phone, sourceId: sources[3], assignedToId: spec.key === 'demo:unowned' ? null : (userIds.get('exec.a1') ?? null), createKey: spec.key }));
  }
}
