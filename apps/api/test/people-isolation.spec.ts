import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createOrg, createTestApp, createUser, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from './helpers';

let t: TestApp;
let fx: OrgFixture;
type Who = 'founder' | 'teamLead' | 'managerA' | 'managerB' | 'execA1' | 'execA2' | 'execB1' | 'admin' | 'hr' | 'finance';
let A: Record<Who, AuthedAgent>;
const iso = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();
const day = (offsetDays = 0) => iso(offsetDays).slice(0, 10);
const put = (a: AuthedAgent, path: string, body: object) => a.agent.put('/api/v1' + path).set('x-csrf-token', a.csrfToken).set('Origin', 'http://localhost:3100').send(body);

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  A = {
    founder: await loginAgent(t.app, fx.founder), teamLead: await loginAgent(t.app, fx.teamLead), managerA: await loginAgent(t.app, fx.managerA), managerB: await loginAgent(t.app, fx.managerB),
    execA1: await loginAgent(t.app, fx.execA1), execA2: await loginAgent(t.app, fx.execA2), execB1: await loginAgent(t.app, fx.execB1),
    admin: await loginAgent(t.app, fx.admin), hr: await loginAgent(t.app, fx.hr), finance: await loginAgent(t.app, fx.finance),
  };
});
afterAll(async () => { await t.close(); });

const session = (over: object = {}) => ({ sessionDate: iso(-1), durationMin: 45, topics: ['OBJECTION_HANDLING', 'CALL_QUALITY'], participantIds: [fx.execA1.id, fx.execA2.id], notes: 'Practised price objections', ...over });

describe('coaching: scope, notes visibility, hours', () => {
  let sid: string;
  it('team manager records sessions for their own team only', async () => {
    expect((await A.execA1.post('/coaching/sessions').send(session())).status).toBe(403);
    expect((await A.admin.post('/coaching/sessions').send(session())).status).toBe(403);
    expect((await A.managerA.post('/coaching/sessions').send(session({ participantIds: [fx.execB1.id] }))).status).toBe(404);
    expect((await A.managerA.post('/coaching/sessions').send(session({ participantIds: [fx.managerA.id] }))).status).toBe(400);
    const res = await A.managerA.post('/coaching/sessions').send(session({ actions: [{ title: 'Practise 5 price-objection calls', ownerId: fx.execA1.id, dueDate: day(7) }] }));
    expect(res.status).toBe(201);
    sid = res.body.data.id;
    expect(res.body.data.coachId).toBe(fx.managerA.id);
    expect(await t.prisma.auditLog.count({ where: { entityId: sid, action: 'coaching.session_recorded' } })).toBe(1);
  });

  it('notes visibility: participants see PARTICIPANTS notes; org-level viewers (TL, HR) and other teams do not', async () => {
    expect((await A.execA1.get(`/coaching/sessions/${sid}`)).body.data.notes).toBe('Practised price objections');
    expect((await A.execA2.get(`/coaching/sessions/${sid}`)).body.data.notes).toBe('Practised price objections');
    const tl = (await A.teamLead.get(`/coaching/sessions/${sid}`)).body.data;
    expect(tl.notes).toBeNull();
    expect(tl.notesHidden).toBe(true);
    expect((await A.hr.get(`/coaching/sessions/${sid}`)).body.data.notes).toBeNull();
    expect((await A.execB1.get(`/coaching/sessions/${sid}`)).status).toBe(404);
    expect((await A.managerB.get(`/coaching/sessions/${sid}`)).status).toBe(404);
    expect((await A.admin.get(`/coaching/sessions/${sid}`)).status).toBe(403);
  });

  it('COACH_ONLY hides notes from participants; MANAGEMENT shares with team/org managers', async () => {
    const co = (await A.managerA.post('/coaching/sessions').send(session({ noteVisibility: 'COACH_ONLY', notes: 'private coach reflection' }))).body.data.id;
    expect((await A.managerA.get(`/coaching/sessions/${co}`)).body.data.notes).toBe('private coach reflection');
    expect((await A.execA1.get(`/coaching/sessions/${co}`)).body.data.notes).toBeNull();
    const mg = (await A.managerA.post('/coaching/sessions').send(session({ noteVisibility: 'MANAGEMENT', notes: 'shared with management' }))).body.data.id;
    expect((await A.teamLead.get(`/coaching/sessions/${mg}`)).body.data.notes).toBe('shared with management');
    expect((await A.hr.get(`/coaching/sessions/${mg}`)).body.data.notes).toBe('shared with management');
  });

  it('executives only list sessions they took part in; managers only their team', async () => {
    const mine = (await A.execA1.get('/coaching/sessions')).body.data;
    expect(mine.length).toBeGreaterThan(0);
    for (const s of mine) expect(s.participants.map((p: { userId: string }) => p.userId)).toContain(fx.execA1.id);
    expect((await A.execB1.get('/coaching/sessions')).body.data).toEqual([]);
    expect((await A.managerB.get('/coaching/sessions')).body.data).toEqual([]);
    expect((await A.teamLead.get('/coaching/sessions')).body.data.length).toBeGreaterThanOrEqual(3);
  });

  it('only the coach edits a session; owners update only the status of their own actions', async () => {
    expect((await A.managerB.patch(`/coaching/sessions/${sid}`).send({ durationMin: 60 })).status).toBe(404);
    expect((await A.teamLead.patch(`/coaching/sessions/${sid}`).send({ durationMin: 60 })).status).toBe(200); // org-level coach role may edit
    const actions = (await A.execA1.get(`/coaching/sessions/${sid}`)).body.data.actions;
    const aid = actions[0].id;
    expect((await A.execA2.patch(`/coaching/actions/${aid}`).send({ status: 'DONE' })).status).toBe(404);
    expect((await A.execA1.patch(`/coaching/actions/${aid}`).send({ title: 'changed by employee' })).status).toBe(403);
    const done = await A.execA1.patch(`/coaching/actions/${aid}`).send({ status: 'DONE' });
    expect(done.body.data.status).toBe('DONE');
    expect((await t.prisma.coachingAction.findUniqueOrThrow({ where: { id: aid } })).completedAt).not.toBeNull();
  });

  it('coaching hours are facts (minutes x sessions) per coach within scope', async () => {
    const q = `from=${encodeURIComponent(iso(-3))}&to=${encodeURIComponent(iso(1))}`;
    const org = (await A.teamLead.get(`/coaching/hours?${q}`)).body.data;
    const a = org.coaches.find((c: { coachId: string }) => c.coachId === fx.managerA.id);
    expect(a.sessions).toBe(3);
    expect(a.sessionMinutes).toBe(60 + 45 + 45);
    expect(org.totalHours).toBe(Math.round((150 / 60) * 100) / 100);
    expect(org.minutesByTopic.CALL_QUALITY).toBe(150);
    expect((await A.managerB.get(`/coaching/hours?${q}`)).body.data.coaches).toEqual([]);
  });

  it('one-on-ones: employees never see manager-private notes', async () => {
    expect((await A.managerA.post('/coaching/one-on-ones').send({ employeeId: fx.execB1.id, scheduledFor: iso(), sharedNotes: 'x' })).status).toBe(404);
    const r = await A.managerA.post('/coaching/one-on-ones').send({ employeeId: fx.execA1.id, scheduledFor: iso(), sharedNotes: 'Agreed weekly goals', privateNotes: 'Watch engagement', durationMin: 30, actions: [{ title: 'Send revised plan', ownerId: fx.execA1.id }] });
    expect(r.status).toBe(201);
    expect(r.body.data.privateNotes).toBe('Watch engagement');
    const emp = (await A.execA1.get('/coaching/one-on-ones')).body.data[0];
    expect(emp.sharedNotes).toBe('Agreed weekly goals');
    expect(emp.privateNotes).toBeNull();
    expect((await A.teamLead.get('/coaching/one-on-ones')).body.data[0].privateNotes).toBeNull();
    expect((await A.execA2.get('/coaching/one-on-ones')).body.data).toEqual([]);
  });
});

describe('KPI/KRA assignments, scorecards', () => {
  it('managers assign to their team, never to themselves or other teams; executives read only their own', async () => {
    const body = (assigneeId: string) => ({ assigneeId, weekStart: day(0), items: [{ key: 'calls-completed', name: 'Calls completed', target: 120, unit: 'count' }] });
    expect((await A.managerA.post('/people/kpi-assignments').send(body(fx.managerA.id))).status).toBe(403);
    expect((await A.managerA.post('/people/kpi-assignments').send(body(fx.execB1.id))).status).toBe(404);
    expect((await A.execA1.post('/people/kpi-assignments').send(body(fx.execA1.id))).status).toBe(403);
    const ok = await A.managerA.post('/people/kpi-assignments').send(body(fx.execA1.id));
    expect(ok.status).toBe(200);
    expect((await A.teamLead.post('/people/kpi-assignments').send(body(fx.managerA.id))).status).toBe(200);
    expect((await A.execA1.get('/people/kpi-assignments')).body.data).toHaveLength(1);
    expect((await A.execA2.get('/people/kpi-assignments')).body.data).toEqual([]);
    expect((await A.admin.get('/people/kpi-assignments')).status).toBe(403);
    const sc = await A.managerA.post('/people/scorecards').send({ subjectId: fx.execA1.id, periodType: 'WEEK', periodStart: day(-7), periodEnd: day(-1), inputs: [{ key: 'calls-completed', name: 'Calls', target: 120, actual: 100 }] });
    expect(sc.status).toBe(200);
    expect((await A.execA1.get('/people/scorecards')).body.data[0].inputs[0].actual).toBe(100);
    expect((await A.execB1.get('/people/scorecards')).body.data).toEqual([]);
  });
});

describe('monthly performance reviews', () => {
  let rid: string;
  const review = (employeeId: string) => ({ employeeId, periodStart: day(-30), periodEnd: day(-1), competencyScores: { ownership: 4, communication: 3 }, rating: 4, strengths: 'Reliable follow-through' });
  it('creation is scoped; employees cannot see drafts; self-review is denied', async () => {
    expect((await A.managerA.post('/people/reviews').send(review(fx.managerA.id))).status).toBe(403);
    expect((await A.managerA.post('/people/reviews').send(review(fx.execB1.id))).status).toBe(404);
    expect((await A.execA1.post('/people/reviews').send(review(fx.execA2.id))).status).toBe(403);
    expect((await A.managerA.post('/people/reviews').send({ ...review(fx.execA1.id), competencyScores: { bogus: 3 } })).status).toBe(400);
    const res = await A.managerA.post('/people/reviews').send(review(fx.execA1.id));
    expect(res.status).toBe(201);
    rid = res.body.data.id;
    expect((await A.managerA.post('/people/reviews').send(review(fx.execA1.id))).status).toBe(409);
    expect((await A.execA1.get(`/people/reviews/${rid}`)).status).toBe(404); // draft hidden from the employee
    expect((await A.execA1.get('/people/reviews')).body.data).toEqual([]);
    expect((await A.managerB.get(`/people/reviews/${rid}`)).status).toBe(404);
    expect((await A.admin.get(`/people/reviews/${rid}`)).status).toBe(403);
  });
  it('workflow: submit (reviewer only) -> approve (not reviewer, not manager) -> employee acknowledges', async () => {
    expect((await A.teamLead.post(`/people/reviews/${rid}/submit`).send({})).status).toBe(403);
    expect((await A.managerA.post(`/people/reviews/${rid}/submit`).send({})).body.data.status).toBe('SUBMITTED');
    expect((await A.managerA.patch(`/people/reviews/${rid}`).send({ strengths: 'late edit' })).status).toBe(409);
    expect((await A.managerA.post(`/people/reviews/${rid}/approve`).send({})).status).toBe(403);
    expect((await A.execA1.get(`/people/reviews/${rid}`)).status).toBe(404); // still not visible to the employee
    expect((await A.teamLead.post(`/people/reviews/${rid}/approve`).send({})).body.data.status).toBe('APPROVED');
    expect((await A.teamLead.post(`/people/reviews/${rid}/approve`).send({})).status).toBe(409);
    expect((await A.execA2.post(`/people/reviews/${rid}/acknowledge`).send({})).status).toBe(404);
    expect((await A.managerA.post(`/people/reviews/${rid}/acknowledge`).send({})).status).toBe(403);
    expect((await A.execA1.post(`/people/reviews/${rid}/acknowledge`).send({ comment: 'Agree' })).body.data.status).toBe('ACKNOWLEDGED');
    expect(await t.prisma.auditLog.count({ where: { entityId: rid, action: { in: ['review.created', 'review.submitted', 'review.approved', 'review.acknowledged'] } } })).toBe(4);
  });
  it('an HR reviewer cannot approve their own review; incomplete reviews cannot be submitted', async () => {
    const r = (await A.hr.post('/people/reviews').send({ employeeId: fx.execB1.id, periodStart: day(-60), periodEnd: day(-31) })).body.data.id;
    const inc = await A.hr.post(`/people/reviews/${r}/submit`).send({});
    expect(inc.status).toBe(422);
    await A.hr.patch(`/people/reviews/${r}`).send({ rating: 3, competencyScores: { ownership: 3 } });
    await A.hr.post(`/people/reviews/${r}/submit`).send({});
    expect((await A.hr.post(`/people/reviews/${r}/approve`).send({})).status).toBe(403);
    expect((await A.founder.post(`/people/reviews/${r}/approve`).send({})).status).toBe(200);
  });
  it('exposes the JD competency framework', async () => {
    const c = (await A.managerA.get('/people/competencies')).body.data;
    expect(c.map((x: { key: string }) => x.key)).toEqual(['ownership', 'strategic_thinking', 'results_orientation', 'proactive', 'customer_first', 'data_driven', 'communication', 'coaching_ability', 'collaboration', 'growth_mindset']);
    expect((await A.admin.get('/people/competencies')).status).toBe(403);
  });
});

describe('HR data isolation (employee profiles, hiring, onboarding, succession)', () => {
  it('employee profiles are visible to HR only: Admin, Founder, Team Lead, managers, executives and Finance are denied', async () => {
    for (const w of ['admin', 'founder', 'teamLead', 'managerA', 'execA1', 'finance'] as Who[]) {
      expect((await A[w].get(`/people/employees/${fx.execA1.id}`)).status).toBe(403);
      expect((await A[w].get('/people/employees')).status).toBe(403);
      expect((await put(A[w], `/people/employees/${fx.execA1.id}`, { employmentType: 'FULL_TIME' })).status).toBe(403);
    }
    const saved = await put(A.hr, '/people/employees/' + fx.execA1.id, { employmentType: 'FULL_TIME', joinDate: day(-100), positionTitle: 'Sales Executive' });
    expect(saved.status).toBe(200);
    const get = await A.hr.get(`/people/employees/${fx.execA1.id}`);
    expect(get.body.data).toMatchObject({ positionTitle: 'Sales Executive', joinDate: day(-100) });
    expect(await t.prisma.auditLog.count({ where: { action: 'hr.record_viewed', actorId: fx.hr.id } })).toBeGreaterThan(0);
    const denied = await put(A.managerA, '/people/employees/' + fx.execA1.id, { exitDate: day(1) });
    expect(denied.status).toBe(403);
    expect((await A.hr.get(`/people/employees/${fx.execA1.id.replace(/.$/, '0')}`)).status).toBe(404);
  });

  let reqA: string;
  let cand: string;
  it('hiring pipeline: manager sees only own requisitions; executives/admin/finance denied; cross-team denied', async () => {
    const r = await A.managerA.post('/people/hiring').send({ title: 'Sales Executive - Team A', roleKey: 'SALES_EXECUTIVE', headcount: 2 });
    expect(r.status).toBe(201);
    reqA = r.body.data.id;
    const rb = await A.managerB.post('/people/hiring').send({ title: 'Sales Executive - Team B', roleKey: 'SALES_EXECUTIVE' });
    expect((await A.managerA.get('/people/hiring')).body.data.map((x: { id: string }) => x.id)).toEqual([reqA]);
    expect((await A.teamLead.get('/people/hiring')).body.data).toHaveLength(2);
    expect((await A.hr.get('/people/hiring')).body.data).toHaveLength(2);
    for (const w of ['execA1', 'admin', 'finance'] as Who[]) expect((await A[w].get('/people/hiring')).status).toBe(403);
    expect((await A.managerA.patch(`/people/hiring/${rb.body.data.id}`).send({ status: 'ON_HOLD' })).status).toBe(404);
    const c = await A.managerA.post('/people/hiring/candidates').send({ requisitionId: reqA, name: 'Candidate One', email: 'c1@example.com', experienceYears: 4, industries: ['EdTech'] });
    expect(c.status).toBe(201);
    cand = c.body.data.id;
    expect((await A.managerB.post('/people/hiring/candidates').send({ requisitionId: reqA, name: 'Intruder' })).status).toBe(404);
    expect((await A.managerB.get(`/people/hiring/candidates/${cand}`)).status).toBe(404);
    expect((await A.managerB.get('/people/hiring/candidates')).body.data).toEqual([]);
    expect((await A.hr.get(`/people/hiring/candidates/${cand}`)).status).toBe(200);
  });

  it('candidate moves are validated; interview notes are restricted to HR, the interviewer and the hiring manager', async () => {
    expect((await A.managerA.post(`/people/hiring/candidates/${cand}/stage`).send({ stage: 'REJECTED' })).status).toBe(400);
    expect((await A.managerA.post(`/people/hiring/candidates/${cand}/stage`).send({ stage: 'INTERVIEW' })).body.data.stage).toBe('INTERVIEW');
    const fb = await A.hr.post(`/people/hiring/candidates/${cand}/feedback`).send({ interviewAt: iso(), recommendation: 'YES', competencyScores: { ownership: 4 }, notes: 'Strong ownership examples' });
    expect(fb.status).toBe(201);
    expect((await A.hr.get(`/people/hiring/candidates/${cand}`)).body.data.feedback[0].notes).toBe('Strong ownership examples');
    expect((await A.managerA.get(`/people/hiring/candidates/${cand}`)).body.data.feedback[0].notes).toBe('Strong ownership examples'); // hiring manager
    const tl = (await A.teamLead.get(`/people/hiring/candidates/${cand}`)).body.data.feedback[0];
    expect(tl.notes).toBeNull();
    expect(tl.notesRestricted).toBe(true);
    expect(tl.recommendation).toBe('YES');
    expect((await A.managerA.post(`/people/hiring/candidates/${cand}/stage`).send({ stage: 'REJECTED', reason: 'Not a fit' })).body.data.stage).toBe('REJECTED');
    expect((await A.managerA.post(`/people/hiring/candidates/${cand}/stage`).send({ stage: 'OFFER' })).status).toBe(409);
  });

  it('role profiles (hiring criteria) are configurable at organization level only', async () => {
    const body = { roleKey: 'SALES_TEAM_LEAD', title: 'Sales Team Lead', minExperienceYears: 8, maxExperienceYears: 10, minTeamMgmtYears: 3, preferredIndustries: ['Coaching', 'EdTech'], requiredBackgrounds: ['Inside Sales'], additionalCriteria: ['Proven record of achieving revenue targets'] };
    const putProfile = (a: AuthedAgent) => put(a, '/people/hiring/profiles', body);
    expect((await putProfile(A.managerA)).status).toBe(403);
    expect((await putProfile(A.hr)).status).toBe(200);
    expect((await A.teamLead.get('/people/hiring/profiles')).body.data[0]).toMatchObject({ roleKey: 'SALES_TEAM_LEAD', minExperienceYears: 8, preferredIndustries: ['Coaching', 'EdTech'], additionalCriteria: ['Proven record of achieving revenue targets'] });
  });

  it('onboarding + probation: HR creates templates; managers see/complete only their team', async () => {
    const tpl = await A.hr.post('/people/onboarding/templates').send({ roleKey: 'SALES_EXECUTIVE', name: 'Exec onboarding', items: [{ title: 'Set up CRM access', category: 'TOOLS', dueDay: 2 }, { title: 'Read mandatory SOPs', dueDay: 5 }] });
    expect(tpl.status).toBe(201);
    expect((await A.managerA.post('/people/onboarding/templates').send({ roleKey: 'SALES_EXECUTIVE', name: 'Manager template', items: [{ title: 'abc', dueDay: 1 }] })).status).toBe(403);
    const plan = await A.managerA.post('/people/onboarding').send({ employeeId: fx.execA1.id, templateId: tpl.body.data.id, startDate: day(-2) });
    expect(plan.status).toBe(201);
    expect(plan.body.data.progress).toMatchObject({ total: 2, done: 0 });
    expect((await A.managerA.post('/people/onboarding').send({ employeeId: fx.execB1.id, templateId: tpl.body.data.id, startDate: day(0) })).status).toBe(404);
    expect((await A.managerA.post('/people/onboarding').send({ employeeId: fx.execA1.id, templateId: tpl.body.data.id, startDate: day(0) })).status).toBe(409);
    const item = plan.body.data.items[0].id;
    expect((await A.execA2.patch(`/people/onboarding/items/${item}`).send({ status: 'DONE' })).status).toBe(404);
    expect((await A.execA1.patch(`/people/onboarding/items/${item}`).send({ status: 'SKIPPED' })).status).toBe(403);
    expect((await A.execA1.patch(`/people/onboarding/items/${item}`).send({ status: 'DONE' })).body.data.progress.pct).toBe(50);
    expect((await A.execA2.get('/people/onboarding')).body.data).toEqual([]);
    expect((await A.managerB.get('/people/onboarding')).body.data).toEqual([]);
    expect((await A.admin.get('/people/onboarding')).status).toBe(403);
    const prob = (await A.managerA.get('/people/probation')).body.data;
    expect(prob.map((p: { checkpointDay: number }) => p.checkpointDay)).toEqual([30, 60, 90]);
    expect((await A.managerB.post(`/people/probation/${prob[0].id}/complete`).send({ outcome: 'ON_TRACK' })).status).toBe(404);
    expect((await A.execA1.post(`/people/probation/${prob[0].id}/complete`).send({ outcome: 'CONFIRM' })).status).toBe(403);
    const done = await A.managerA.post(`/people/probation/${prob[0].id}/complete`).send({ outcome: 'ON_TRACK', competencyScores: { ownership: 3 }, notes: 'Settling in' });
    expect(done.body.data.status).toBe('COMPLETED');
    expect((await A.managerA.post(`/people/probation/${prob[0].id}/complete`).send({ outcome: 'ON_TRACK' })).status).toBe(409);
  });

  it('succession board: Founder/Team Lead/HR only', async () => {
    for (const w of ['managerA', 'execA1', 'admin', 'finance'] as Who[]) expect((await A[w].get('/people/succession')).status).toBe(403);
    const pos = await A.founder.post('/people/succession/positions').send({ title: 'Sales Team Lead', roleKey: 'SALES_TEAM_LEAD', incumbentId: fx.teamLead.id });
    expect(pos.status).toBe(201);
    const bench = await A.teamLead.post('/people/succession').send({ positionId: pos.body.data.id, userId: fx.managerA.id, readiness: 'READY_NOW', developmentActions: [{ title: 'Lead quarterly review', dueDate: day(30) }] });
    expect(bench.status).toBe(200);
    await A.hr.post('/people/succession').send({ positionId: pos.body.data.id, userId: fx.managerB.id, readiness: 'READY_LATER' });
    const board = (await A.hr.get('/people/succession')).body.data;
    expect(board[0]).toMatchObject({ coverage: 'COVERED' });
    expect(board[0].readyNow[0].userId).toBe(fx.managerA.id);
    expect(board[0].readyLater[0].userId).toBe(fx.managerB.id);
    expect((await A.managerA.post('/people/succession').send({ positionId: pos.body.data.id, userId: fx.execA1.id, readiness: 'READY_NOW' })).status).toBe(403);
  });
});

describe('recognition, resources, engagement', () => {
  it('recognition: scoped records, minimum-data public wall, no self-recognition', async () => {
    const prog = await A.founder.post('/people/recognition-programs').send({ key: 'top-test', name: 'Top performer', kind: 'TOP_PERFORMER' });
    expect(prog.status).toBe(201);
    expect((await A.managerA.post('/people/recognition-programs').send({ key: 'x-test', name: 'xx' })).status).toBe(403);
    expect((await A.managerA.post('/people/recognitions').send({ programId: prog.body.data.id, recipientId: fx.managerA.id, reason: 'Great quarter' })).status).toBe(403);
    expect((await A.managerA.post('/people/recognitions').send({ programId: prog.body.data.id, recipientId: fx.execB1.id, reason: 'Great quarter' })).status).toBe(404);
    expect((await A.managerA.post('/people/recognitions').send({ programId: prog.body.data.id, recipientId: fx.execA1.id, reason: 'Closed three hard deals', isPublic: true })).status).toBe(201);
    expect((await A.managerA.post('/people/recognitions').send({ programId: prog.body.data.id, recipientId: fx.execA2.id, reason: 'Private kudos for effort' })).status).toBe(201);
    const wall = (await A.execB1.get('/people/recognitions?wall=true')).body.data;
    expect(wall).toHaveLength(1);
    expect(wall[0]).toMatchObject({ recipientName: fx.execA1.name, reason: 'Closed three hard deals' });
    expect(wall[0]).not.toHaveProperty('grantedById');
    expect((await A.execB1.get('/people/recognitions')).body.data).toEqual([]);
    expect((await A.execA2.get('/people/recognitions')).body.data).toHaveLength(1);
    expect((await A.admin.get('/people/recognitions?wall=true')).status).toBe(403);
  });

  it('skills library: everyone reads; HR/Team Lead manage and assign; learners update only their own progress', async () => {
    expect((await A.execA1.post('/resources').send({ title: 'Negotiation essentials', skillTags: ['Negotiation'] })).status).toBe(403);
    const r = await A.hr.post('/resources').send({ title: 'Negotiation essentials', skillTags: ['Negotiation'], type: 'ARTICLE', url: 'https://example.com/neg' });
    expect(r.status).toBe(201);
    expect((await A.execB1.get('/resources?tag=negotiation')).body.data).toHaveLength(1);
    expect((await A.execB1.get('/resources?q=essentials')).body.data).toHaveLength(1);
    expect((await A.execA1.post(`/resources/${r.body.data.id}/assign`).send({ userIds: [fx.execA2.id] })).status).toBe(403);
    expect((await A.teamLead.post(`/resources/${r.body.data.id}/assign`).send({ userIds: [fx.execA1.id, fx.execA2.id], dueDate: day(14) })).body.data.assigned).toBe(2);
    const mine = (await A.execA1.get('/resources/assignments')).body.data;
    expect(mine).toHaveLength(1);
    expect((await A.execA2.patch(`/resources/assignments/${mine[0].id}`).send({ status: 'COMPLETED' })).status).toBe(403);
    expect((await A.execA1.patch(`/resources/assignments/${mine[0].id}`).send({ status: 'COMPLETED' })).body.data.status).toBe('COMPLETED');
    expect((await A.hr.get('/resources/assignments')).body.data).toHaveLength(2);
    expect((await A.execB1.get('/resources/assignments')).body.data).toEqual([]);
  });

  it('engagement pulse is anonymous: no user column, one response per user, aggregates suppressed below 5', async () => {
    const s = await A.hr.post('/engagement/surveys').send({ title: 'Pulse', questions: [{ id: 'q1', text: 'I understand my goals', type: 'SCALE_5' }, { id: 'q2', text: 'Anything else?', type: 'TEXT' }] });
    expect(s.status).toBe(201);
    expect((await A.managerA.post('/engagement/surveys').send({ title: 'nope', questions: [{ id: 'q1', text: 'abc', type: 'SCALE_5' }] })).status).toBe(403);
    const sid = s.body.data.id;
    const ans = (n: number) => ({ surveyId: sid, answers: { q1: n, q2: 'ok' } });
    expect((await A.execA1.post('/engagement/responses').send({ surveyId: sid, answers: { q1: 'five' } })).status).toBe(400);
    expect((await A.execA1.post('/engagement/responses').send(ans(5))).status).toBe(200);
    expect((await A.execA1.post('/engagement/responses').send(ans(5))).status).toBe(409);
    expect((await A.hr.get('/engagement/results')).body.data.find((x: { surveyId: string }) => x.surveyId === sid)).toMatchObject({ responseCount: 1, suppressed: true, questions: null });
    for (const [a, n] of [[A.execA2, 4], [A.execB1, 3], [A.managerA, 4], [A.managerB, 4]] as const) expect((await a.post('/engagement/responses').send(ans(n))).status).toBe(200);
    const res = (await A.hr.get(`/engagement/results?surveyId=${sid}`)).body.data[0];
    expect(res).toMatchObject({ responseCount: 5, suppressed: false });
    expect(res.questions[0]).toMatchObject({ average: 4, responses: 5 });
    expect((await A.execA1.get('/engagement/results')).status).toBe(403);
    expect((await A.admin.get('/engagement/results')).status).toBe(403);
    const cols = await t.prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'engagement_responses'`;
    expect(cols.map((c) => c.column_name)).not.toContain('user_id');
    expect(await t.prisma.engagementResponse.count({ where: { surveyId: sid } })).toBe(5);
  });
});

describe('cross-organisation isolation', () => {
  it('a user from another organisation cannot reach any of this data', async () => {
    const org2 = await createOrg(t.prisma);
    const tl2 = await createUser(t.prisma, org2, { roles: ['SALES_TEAM_LEAD'] });
    const hr2 = await createUser(t.prisma, org2, { roles: ['HR'] });
    const a = await loginAgent(t.app, tl2);
    const h = await loginAgent(t.app, hr2);
    for (const p of ['/coaching/sessions', '/people/reviews', '/people/pips', '/incentives/recommendations', '/people/hiring', '/people/kpi-assignments', '/people/recognitions', '/people/probation', '/people/onboarding']) {
      const res = await a.get(p);
      expect(res.status, p).toBe(200);
      expect(res.body.data, p).toEqual([]);
    }
    expect((await h.get(`/people/employees/${fx.execA1.id}`)).status).toBe(404);
    expect((await a.post('/people/kpi-assignments').send({ assigneeId: fx.execA1.id, weekStart: day(0), items: [{ key: 'k', name: 'k' }] })).status).toBe(400);
  });
});
