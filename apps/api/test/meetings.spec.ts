import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createOrg, createTestApp, createUser, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from './helpers';

let t: TestApp;
let fx: OrgFixture;
let other: AuthedAgent;
let A: Record<'founder' | 'hr' | 'admin' | 'finance' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1', AuthedAgent>;

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  const o = await createOrg(t.prisma);
  other = await loginAgent(t.app, await createUser(t.prisma, o, { roles: ['FOUNDER_CEO'] }));
  A = {
    founder: await loginAgent(t.app, fx.founder), hr: await loginAgent(t.app, fx.hr), admin: await loginAgent(t.app, fx.admin), finance: await loginAgent(t.app, fx.finance),
    managerA: await loginAgent(t.app, fx.managerA), managerB: await loginAgent(t.app, fx.managerB), execA1: await loginAgent(t.app, fx.execA1), execA2: await loginAgent(t.app, fx.execA2), execB1: await loginAgent(t.app, fx.execB1),
  };
});
afterAll(async () => { await t.close(); });

const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const meeting = (over: object = {}) => ({ title: `[TEST] Meeting ${Math.random().toString(36).slice(2, 7)}`, url: 'https://us06web.zoom.us/j/84017415725?pwd=abc', startsAt: at(1), durationMinutes: 60, audience: { everyone: true }, ...over });
const ids = async (who: AuthedAgent) => (await who.get('/meetings/active')).body.data.map((m: { id: string }) => m.id) as string[];

describe('who may announce meetings, and what a link may be', () => {
  it('HR, Founder and Developer-level roles announce; everyone else cannot create, list or cancel', async () => {
    for (const who of [A.execA1, A.managerA, A.admin, A.finance]) {
      expect((await who.post('/meetings').send(meeting())).status, who.user.email).toBe(403);
      expect((await who.get('/meetings')).status).toBe(403);
      expect((await who.get('/meetings/options')).status).toBe(403);
    }
    expect((await A.hr.post('/meetings').send(meeting())).status).toBe(201);
    expect((await A.founder.post('/meetings').send(meeting())).status).toBe(201);
  });

  it('only https Zoom links are accepted (no other hosts, no http, no user-info trick); time and audience are validated', async () => {
    for (const url of ['http://zoom.us/j/1', 'https://evil.example/j/1', 'https://zoom.us.evil.example/j/1', 'https://zoom.us@evil.example/j/1', 'javascript:alert(1)', 'not a url']) {
      expect((await A.hr.post('/meetings').send(meeting({ url }))).status, url).toBe(400);
    }
    expect((await A.hr.post('/meetings').send(meeting({ url: 'https://zoom.us/j/12345' }))).status).toBe(201);
    expect((await A.hr.post('/meetings').send(meeting({ startsAt: at(-5), durationMinutes: 30 }))).status).toBe(400); // already ended
    expect((await A.hr.post('/meetings').send(meeting({ startsAt: at(24 * 120) }))).status).toBe(400); // too far
    expect((await A.hr.post('/meetings').send(meeting({ audience: { everyone: false } }))).status).toBe(400); // must choose who
    expect((await A.hr.post('/meetings').send(meeting({ audience: { everyone: false, roles: ['MARKETING'] } }))).status).toBe(400); // nobody has that role
    expect((await A.hr.post('/meetings').send(meeting({ audience: { everyone: false, teamIds: ['00000000-0000-4000-8000-000000000001'] } }))).status).toBe(400);
    expect((await A.hr.post('/meetings').send(meeting({ audience: { everyone: false, userIds: [other.user.id] } }))).status).toBe(400); // another organisation's person
  });
});

describe('who sees which meeting on the home page', () => {
  it('a meeting for everyone reaches everyone, with the link', async () => {
    const m = await A.hr.post('/meetings').send(meeting());
    expect(m.status).toBe(201);
    const id = m.body.data.id as string;
    for (const who of [A.execA1, A.execB1, A.admin, A.finance, A.managerA, A.founder]) expect(await ids(who), who.user.email).toContain(id);
    const mine = (await A.execA1.get('/meetings/active')).body.data.find((x: { id: string }) => x.id === id);
    expect(mine.url).toMatch(/^https:\/\/.*zoom\.us\//);
    expect(await ids(other)).not.toContain(id); // another organisation never sees it
  });

  it('a meeting for chosen roles, a team or named people reaches only them', async () => {
    const byRole = (await A.hr.post('/meetings').send(meeting({ audience: { everyone: false, roles: ['SALES_MANAGER'] } }))).body.data.id as string;
    const byTeam = (await A.hr.post('/meetings').send(meeting({ audience: { everyone: false, teamIds: [fx.teamA.id] } }))).body.data.id as string;
    const byPerson = (await A.hr.post('/meetings').send(meeting({ audience: { everyone: false, userIds: [fx.execB1.id] } }))).body.data.id as string;
    expect(await ids(A.managerA)).toEqual(expect.arrayContaining([byRole, byTeam]));
    expect(await ids(A.managerB)).toContain(byRole);
    expect(await ids(A.managerB)).not.toContain(byTeam);
    expect(await ids(A.execA1)).toContain(byTeam);
    expect(await ids(A.execA1)).not.toContain(byRole);
    expect(await ids(A.execA1)).not.toContain(byPerson);
    expect(await ids(A.execB1)).toContain(byPerson);
    expect(await ids(A.execB1)).not.toContain(byTeam);
    expect(await ids(A.admin)).not.toEqual(expect.arrayContaining([byRole, byTeam, byPerson]));
    expect((await A.execA1.get('/meetings/active')).body.data.every((m: { url: string }) => typeof m.url === 'string')).toBe(true);
  });
});

describe('who joined, filters, cancel', () => {
  let id: string;
  it('Join is recorded once and only for invited people; HR sees invited and joined', async () => {
    id = (await A.hr.post('/meetings').send(meeting({ title: '[TEST] Sales review call', audience: { everyone: false, teamIds: [fx.teamA.id] } }))).body.data.id as string;
    expect((await A.execB1.post(`/meetings/${id}/join`).send({})).status).toBe(404); // not invited
    expect((await A.execA1.post(`/meetings/${id}/join`).send({})).status).toBe(200);
    const first = (await A.execA1.post(`/meetings/${id}/join`).send({})).body.data.joinedAt;
    expect(await t.prisma.companyMeetingJoin.count({ where: { meetingId: id } })).toBe(1);
    expect(first).toBeTruthy();
    const d = (await A.hr.get(`/meetings/${id}`)).body.data;
    expect(d.invited.map((u: { id: string }) => u.id).sort()).toEqual([fx.managerA.id, fx.execA1.id, fx.execA2.id].sort());
    expect(d.invited.find((u: { id: string }) => u.id === fx.execA1.id).joinedAt).toBeTruthy();
    expect(d.invited.find((u: { id: string }) => u.id === fx.execA2.id).joinedAt).toBeNull();
    const row = (await A.hr.get('/meetings')).body.data.find((m: { id: string }) => m.id === id);
    expect(row).toMatchObject({ invitedCount: 3, joinedCount: 1, status: 'UPCOMING' });
    expect((await A.execA1.get(`/meetings/${id}`)).status).toBe(403);
    expect((await other.get(`/meetings/${id}`)).status).toBe(404);
  });

  it('the list filters by text, status, audience, role, team, person and date', async () => {
    const list = async (qs: string) => (await A.hr.get(`/meetings${qs}`)).body.data.map((m: { id: string }) => m.id) as string[];
    expect(await list('?q=sales%20review')).toEqual([id]);
    expect(await list('?audience=SELECTED')).toContain(id);
    expect(await list('?audience=EVERYONE')).not.toContain(id);
    expect(await list(`?teamId=${fx.teamA.id}`)).toContain(id);
    expect(await list(`?teamId=${fx.teamB.id}`)).not.toContain(id);
    expect(await list(`?userId=${fx.execA1.id}`)).toContain(id);
    expect(await list(`?userId=${fx.execB1.id}`)).not.toContain(id);
    expect(await list('?roleKey=SALES_MANAGER')).not.toContain(id);
    expect(await list('?status=UPCOMING')).toContain(id);
    expect(await list('?status=LIVE')).not.toContain(id);
    const today = new Date().toISOString().slice(0, 10);
    expect(await list(`?from=${today}&to=${today}`)).toEqual(expect.any(Array));
    expect((await A.hr.get('/meetings?status=NOPE')).status).toBe(400);
  });

  it('cancelling removes it from home pages, keeps it in the list as CANCELLED, and is audited', async () => {
    expect((await A.execA1.delete(`/meetings/${id}`)).status).toBe(403);
    expect((await A.hr.delete(`/meetings/${id}`)).status).toBe(200);
    expect(await ids(A.execA1)).not.toContain(id);
    expect((await A.execA1.post(`/meetings/${id}/join`).send({})).status).toBe(404);
    expect((await A.hr.get('/meetings?status=CANCELLED')).body.data.map((m: { id: string }) => m.id)).toContain(id);
    expect(await t.prisma.auditLog.count({ where: { entityId: id, action: { in: ['meeting.created', 'meeting.cancelled'] } } })).toBe(2);
    expect((await other.delete(`/meetings/${id}`)).status).toBe(404);
  });

  it('options list roles, teams and people for the pickers', async () => {
    const o = (await A.hr.get('/meetings/options')).body.data;
    expect(o.roles).not.toContain('DEVELOPER');
    expect(o.teams.map((x: { id: string }) => x.id)).toContain(fx.teamA.id);
    expect(o.people.map((x: { id: string }) => x.id)).toContain(fx.execA1.id);
    expect(o.teams.map((x: { id: string }) => x.id)).not.toContain(undefined);
  });
});
