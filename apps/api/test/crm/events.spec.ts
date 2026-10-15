import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLead, crmKit, uniq, type CrmKit } from './kit';

let k: CrmKit;
beforeAll(async () => { k = await crmKit(); });
afterAll(async () => { await k.close(); });

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
async function mkEvent(body: Record<string, unknown> = {}, who = k.a.marketing) {
  const r = await who.post('/events').send({ type: 'WEBINAR', title: `[TEST] ${uniq('Webinar')}`, startsAt: hours(-3), endsAt: hours(-1), ...body });
  if (r.status !== 201) throw new Error(`event create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data as { id: string };
}
const attend = (who: typeof k.a.managerA, eventId: string, leadId: string, status: string, extra: Record<string, unknown> = {}) => who.post(`/events/${eventId}/attendance`).send({ leadId, status, ...extra });

describe('webinar / demo events', () => {
  it('programs are configurable and events attach to them; only events:manage roles can create (executives cannot)', async () => {
    const program = await k.a.founder.post('/programs').send({ code: `evt${Date.now() % 100000}`, name: '[TEST] Event program', kind: 'EVENT' });
    expect(program.status).toBe(201);
    const ev = await mkEvent({ programId: program.body.data.id });
    expect((await k.a.execA1.post('/events').send({ type: 'DEMO', title: 'x', startsAt: hours(5) })).status).toBe(403);
    expect((await k.a.marketing.post('/events').send({ type: 'DEMO', title: 'x', startsAt: hours(5), endsAt: hours(4) })).status).toBe(422);
    expect((await k.a.marketing.post('/events').send({ type: 'DEMO', title: 'x', startsAt: hours(5), programId: '00000000-0000-4000-8000-000000000001' })).status).toBe(422);
    const got = await k.a.execA1.get(`/events/${ev.id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.programId).toBe(program.body.data.id);
    const upcoming = await k.a.execA1.get('/events?upcoming=true&limit=100');
    expect(upcoming.status).toBe(200);
    expect(upcoming.body.data.every((e: { status: string }) => e.status === 'SCHEDULED')).toBe(true);
    expect((await k.a.execA1.get('/events/00000000-0000-4000-8000-000000000001')).status).toBe(404);
    expect((await k.a.founder.post('/programs').send({ code: program.body.data.code, name: 'dup' })).status).toBe(409);
  });

  it('attendance follows the participation machine; the lead stage follows webinar/demo attendance; illegal transitions are 409', async () => {
    const lead = await createLead(k.a.execA1);
    for (const s of ['CONTACT_ATTEMPTED', 'CONNECTED', 'QUALIFIED']) await k.a.execA1.post(`/leads/${lead.id}/status`).send({ status: s });
    const ev = await mkEvent();
    expect((await attend(k.a.managerA, ev.id, lead.id, 'ATTENDED')).body.error.code).toBe('INVALID_TRANSITION'); // must be invited/registered first
    expect((await attend(k.a.managerA, ev.id, lead.id, 'REGISTERED')).status).toBe(200);
    expect((await k.t.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('WEBINAR_REGISTERED');
    expect((await attend(k.a.managerA, ev.id, lead.id, 'FOLLOWED_UP')).body.error.code).toBe('INVALID_TRANSITION');
    expect((await attend(k.a.managerA, ev.id, lead.id, 'CONVERTED')).body.error.code).toBe('DERIVED_STATUS');
    const ok = await attend(k.a.managerA, ev.id, lead.id, 'ATTENDED', { durationMinutes: 55 });
    expect(ok.status).toBe(200);
    expect((await k.t.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('WEBINAR_ATTENDED');
    expect(await k.t.prisma.task.count({ where: { leadId: lead.id, ruleKey: 'ATTENDANCE_FOLLOW_UP', status: 'OPEN' } })).toBe(1);
    expect((await attend(k.a.managerA, ev.id, lead.id, 'NO_SHOW')).body.error.code).toBe('INVALID_TRANSITION');
    expect((await attend(k.a.managerA, ev.id, lead.id, 'FOLLOWED_UP')).status).toBe(200);
    expect((await attend(k.a.managerA, ev.id, lead.id, 'REGISTERED')).body.error.code).toBe('INVALID_TRANSITION');
    // idempotent no-op on the same status
    const same = await attend(k.a.managerA, ev.id, lead.id, 'FOLLOWED_UP');
    expect(same.status).toBe(200);
    expect(same.body.data.created).toBe(false);
    const tl = await k.a.execA1.get(`/leads/${lead.id}/timeline?limit=100`);
    expect(tl.body.data.filter((i: { type: string }) => i.type === 'attendance').length).toBeGreaterThanOrEqual(1);
    const detail = await k.a.execA1.get(`/leads/${lead.id}`);
    expect(detail.body.data.latestEvent).toMatchObject({ status: 'FOLLOWED_UP', type: 'WEBINAR' });
    expect(await k.t.prisma.auditLog.count({ where: { action: { in: ['attendance.created', 'attendance.updated'] }, metadata: { path: ['leadId'], equals: lead.id } } })).toBeGreaterThanOrEqual(3);
  });

  it('demo attendance moves the lead along the demo stages; a lead in an incompatible stage stays put with a warning', async () => {
    const lead = await createLead(k.a.execA1);
    const demo = await mkEvent({ type: 'DEMO', title: '[TEST] demo', startsAt: hours(-2), endsAt: hours(-1) });
    const r = await attend(k.a.managerA, demo.id, lead.id, 'REGISTERED');
    expect(r.status).toBe(200);
    expect(r.body.meta.warnings.join(' ')).toMatch(/stays in NEW/);
    expect((await k.t.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('NEW');
    const q = await createLead(k.a.execA1);
    for (const s of ['CONTACT_ATTEMPTED', 'CONNECTED', 'QUALIFIED']) await k.a.execA1.post(`/leads/${q.id}/status`).send({ status: s });
    await attend(k.a.managerA, demo.id, q.id, 'REGISTERED');
    expect((await k.t.prisma.lead.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('DEMO_SCHEDULED');
    await attend(k.a.managerA, demo.id, q.id, 'ATTENDED');
    expect((await k.t.prisma.lead.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('DEMO_ATTENDED');
  });

  it('no-show only after the event ended, then reschedule creates a linked registration for the new event', async () => {
    const lead = await createLead(k.a.execA1);
    const future = await mkEvent({ startsAt: hours(5), endsAt: hours(6) });
    await attend(k.a.managerA, future.id, lead.id, 'REGISTERED');
    expect((await attend(k.a.managerA, future.id, lead.id, 'NO_SHOW')).body.error.code).toBe('EVENT_NOT_ENDED');
    expect((await attend(k.a.managerA, future.id, lead.id, 'ATTENDED')).body.error.code).toBe('EVENT_NOT_STARTED');
    expect((await attend(k.a.managerA, future.id, lead.id, 'CANCELLED')).body.error.code).toBe('REASON_REQUIRED');
    const past = await mkEvent();
    await attend(k.a.managerA, past.id, lead.id, 'REGISTERED');
    expect((await attend(k.a.managerA, past.id, lead.id, 'NO_SHOW')).status).toBe(200);
    expect(await k.t.prisma.task.count({ where: { leadId: lead.id, ruleKey: 'NO_SHOW_FOLLOW_UP' } })).toBe(1);
    expect((await attend(k.a.managerA, past.id, lead.id, 'RESCHEDULED')).status).toBe(422);
    const next = await mkEvent({ startsAt: hours(48), endsAt: hours(49) });
    expect((await attend(k.a.managerA, past.id, lead.id, 'RESCHEDULED', { newEventId: next.id })).status).toBe(200);
    const moved = await k.t.prisma.eventAttendance.findFirstOrThrow({ where: { eventId: next.id, leadId: lead.id } });
    expect(moved.status).toBe('REGISTERED');
    expect(moved.rescheduledFromId).toBeTruthy();
  });

  it('capacity and closed events are enforced', async () => {
    const [a, b] = [await createLead(k.a.execA1), await createLead(k.a.execA1)];
    const small = await mkEvent({ startsAt: hours(4), endsAt: hours(5), capacity: 1 });
    expect((await attend(k.a.managerA, small.id, a.id, 'REGISTERED')).status).toBe(200);
    expect((await attend(k.a.managerA, small.id, b.id, 'REGISTERED')).body.error.code).toBe('EVENT_FULL');
    await k.a.marketing.patch(`/events/${small.id}`).send({ status: 'CANCELLED' });
    expect((await attend(k.a.managerA, small.id, b.id, 'INVITED')).body.error.code).toBe('EVENT_CLOSED');
  });

  it('scope: managers only attach leads they can see; marketing sees names only; executives register their own leads via the lead route', async () => {
    const mine = await createLead(k.a.execA1);
    const theirs = await createLead(k.a.execB1);
    const ev = await mkEvent({ startsAt: hours(3), endsAt: hours(4) });
    expect((await attend(k.a.managerA, ev.id, theirs.id, 'REGISTERED')).status).toBe(404);
    expect((await attend(k.a.execA1, ev.id, mine.id, 'REGISTERED')).status).toBe(403); // events:manage not granted to executives
    expect((await k.a.execA1.post(`/leads/${mine.id}/events`).send({ eventId: ev.id, status: 'REGISTERED' })).status).toBe(200);
    expect((await k.a.execA1.post(`/leads/${theirs.id}/events`).send({ eventId: ev.id, status: 'REGISTERED' })).status).toBe(404);
    expect((await attend(k.a.marketing, ev.id, theirs.id, 'INVITED')).status).toBe(200); // marketing manages events org-wide
    const m = await k.a.marketing.get(`/events/${ev.id}/attendance`);
    expect(m.body.data.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(m.body.data[0].lead).sort()).toEqual(['fullName', 'id']); // summary projection: no phone/owner
    const mgr = await k.a.managerA.get(`/events/${ev.id}/attendance`);
    expect(mgr.body.data.map((x: { lead: { id: string } }) => x.lead.id)).toEqual([mine.id]);
    expect(mgr.body.data[0].lead.phone).toBeTruthy();
  });
});
