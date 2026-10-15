import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildKit, collect, makeLead, createDeal, type RevenueKit } from './kit';

let k: RevenueKit;
beforeAll(async () => { k = await buildKit(); });
afterAll(async () => { await k.close(); });

const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const period = async (type: 'MONTH' | 'QUARTER' | 'YEAR', anchor: string, agent = k.agents.founder) => {
  const r = await agent.post('/targets/periods').send({ type, anchor });
  expect([200, 201]).toContain(r.status);
  return r.body.data as { id: string; startsOn: string; endsOn: string; label: string };
};
const mk = (agent: typeof k.agents.founder, body: Record<string, unknown>) => agent.post('/targets').send({ metric: 'REVENUE', ...body });

describe('target periods (DEC-001)', () => {
  it('creates calendar month / quarter and Indian fiscal year periods, idempotently', async () => {
    const m = await period('MONTH', '2031-02-14');
    expect(m).toMatchObject({ startsOn: '2031-02-01', endsOn: '2031-02-28', label: 'Feb 2031' });
    const again = await period('MONTH', '2031-02-01');
    expect(again.id).toBe(m.id);
    const q = await period('QUARTER', '2031-08-01');
    expect(q).toMatchObject({ startsOn: '2031-07-01', endsOn: '2031-09-30', label: 'Q3 2031' });
    const y = await period('YEAR', '2031-02-01');
    expect(y).toMatchObject({ startsOn: '2030-04-01', endsOn: '2031-03-31', label: 'FY 2030-31' });
    expect((await k.agents.execA1.post('/targets/periods').send({ type: 'MONTH', anchor: '2031-02-14' })).status).toBe(403);
    expect((await k.agents.founder.post('/targets/periods').send({ type: 'WEEK', anchor: '2031-02-14' })).status).toBe(400);
    const list = await k.agents.managerA.get('/targets/periods').query({ year: 2031 });
    // the fiscal year starts in April 2030, so the year filter (by start date) lists only the month and quarter
    expect(list.body.data.map((p: { type: string }) => p.type).sort()).toEqual(['MONTH', 'QUARTER']);
  });
});

describe('breakdown Founder -> Team Lead -> Manager -> Executive', () => {
  it('builds the cascade, validates sums, and reports consistency', async () => {
    const p = await period('MONTH', '2032-03-10');
    const root = await mk(k.agents.founder, { periodId: p.id, level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '1000000.00' });
    expect(root.status).toBe(201);
    expect(root.body.data).toMatchObject({ amount: '1000000.00', originalAmount: '1000000.00', level: 'FOUNDER', unit: 'INR' });
    const tl = await mk(k.agents.founder, { periodId: p.id, level: 'TEAM_LEAD', ownerUserId: k.fx.teamLead.id, amount: '1000000.00', parentId: root.body.data.id });
    expect(tl.status).toBe(201);
    const mA = await mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerA.id, amount: '600000.00', parentId: tl.body.data.id });
    expect(mA.status).toBe(201);
    // the second manager would overshoot the Team Lead target
    const over = await mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerB.id, amount: '400000.01', parentId: tl.body.data.id });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('BREAKDOWN_EXCEEDS_PARENT');
    expect(over.body.error.details).toMatchObject({ parentAmount: '1000000.00', allocated: '600000.00', remaining: '400000.00' });
    expect((await mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerB.id, amount: '400000.00', parentId: tl.body.data.id })).status).toBe(201);
    // manager breaks down into his own executives, but only within his team
    expect((await mk(k.agents.managerA, { periodId: p.id, level: 'EXECUTIVE', ownerUserId: k.fx.execB1.id, amount: '1.00', parentId: mA.body.data.id })).status).toBe(404);
    expect((await mk(k.agents.managerA, { periodId: p.id, level: 'EXECUTIVE', ownerUserId: k.fx.execA1.id, amount: '350000.00', parentId: mA.body.data.id })).status).toBe(201);
    const bd = await k.agents.teamLead.get(`/targets/${root.body.data.id}/breakdown`);
    expect(bd.status).toBe(200);
    const node = bd.body.data.root;
    expect(node).toMatchObject({ level: 'FOUNDER', amount: '1000000.00', childrenSum: '1000000.00', unallocated: '0.00', consistency: 'CONSISTENT' });
    const tlNode = node.children[0];
    expect(tlNode).toMatchObject({ level: 'TEAM_LEAD', childrenSum: '1000000.00', consistency: 'CONSISTENT' });
    const mANode = tlNode.children.find((c: { ownerName: string }) => c.ownerName === k.fx.managerA.name);
    expect(mANode).toMatchObject({ amount: '600000.00', childrenSum: '350000.00', unallocated: '250000.00', consistency: 'UNDER_ALLOCATED' });
    expect(mANode.children).toHaveLength(1);
  });

  it('enforces levels, owner roles, reporting lines, uniqueness and whole-number enrolments', async () => {
    const p = await period('MONTH', '2032-04-10');
    const root = (await mk(k.agents.founder, { periodId: p.id, level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '100000.00' })).body.data;
    const skip = await mk(k.agents.founder, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerA.id, amount: '1.00', parentId: root.id });
    expect(skip.body.error.code).toBe('LEVEL_MISMATCH');
    const wrongRole = await mk(k.agents.founder, { periodId: p.id, level: 'TEAM_LEAD', ownerUserId: k.fx.execA1.id, amount: '1.00', parentId: root.id });
    expect(wrongRole.body.error.code).toBe('OWNER_ROLE_MISMATCH');
    const orphan = await mk(k.agents.founder, { periodId: p.id, level: 'EXECUTIVE', ownerUserId: k.fx.execA1.id, amount: '1.00' });
    expect(orphan.body.error.code).toBe('PARENT_REQUIRED');
    const tl = (await mk(k.agents.founder, { periodId: p.id, level: 'TEAM_LEAD', ownerUserId: k.fx.teamLead.id, amount: '100000.00', parentId: root.id })).body.data;
    const mgr = (await mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerA.id, amount: '50000.00', parentId: tl.id })).body.data;
    const wrongLine = await mk(k.agents.teamLead, { periodId: p.id, level: 'EXECUTIVE', ownerUserId: k.fx.execB1.id, amount: '1.00', parentId: mgr.id });
    expect(wrongLine.body.error.code).toBe('OWNER_NOT_UNDER_PARENT');
    expect((await mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerA.id, amount: '1.00', parentId: tl.id })).body.error.code).toBe('TARGET_EXISTS');
    const otherMetric = await mk(k.agents.founder, { periodId: p.id, metric: 'COLLECTION', level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '80000.00' });
    expect(otherMetric.status).toBe(201);
    const mismatch = await mk(k.agents.founder, { periodId: p.id, metric: 'ENROLMENT', level: 'TEAM_LEAD', ownerUserId: k.fx.teamLead.id, amount: '10', parentId: otherMetric.body.data.id });
    expect(mismatch.body.error.code).toBe('PARENT_MISMATCH'); // a child must use the same period and metric as its parent
    const enrol = await mk(k.agents.founder, { periodId: p.id, metric: 'ENROLMENT', level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '10.5' });
    expect(enrol.status).toBe(422);
    const enrolOk = await mk(k.agents.founder, { periodId: p.id, metric: 'ENROLMENT', level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '120' });
    expect(enrolOk.status).toBe(201);
    expect(enrolOk.body.data).toMatchObject({ amount: '120', unit: 'COUNT' });
    // managers and executives cannot create top-level targets, cross-org owners are 404
    expect((await mk(k.agents.managerA, { periodId: p.id, level: 'TEAM_LEAD', ownerUserId: k.fx.teamLead.id, amount: '1.00' })).status).toBe(404); // the Team Lead is outside the manager's scope
    expect((await mk(k.agents.execA1, { periodId: p.id, level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '1.00' })).status).toBe(403);
    expect((await mk(k.agents.founder, { periodId: p.id, level: 'TEAM_LEAD', ownerUserId: '11111111-1111-4111-8111-111111111111', amount: '1.00', parentId: root.id })).status).toBe(404);
  });

  it('concurrent allocations cannot jointly exceed the parent', async () => {
    const p = await period('MONTH', '2032-05-10');
    const root = (await mk(k.agents.founder, { periodId: p.id, level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '100.00' })).body.data;
    const tl = (await mk(k.agents.founder, { periodId: p.id, level: 'TEAM_LEAD', ownerUserId: k.fx.teamLead.id, amount: '100.00', parentId: root.id })).body.data;
    const owners = [k.fx.managerA.id, k.fx.managerB.id];
    // two managers race for 60 each under a 100 parent; plus repeated attempts on the same manager
    const rs = await Promise.all([...owners, ...owners].map((o) => mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: o, amount: '60.00', parentId: tl.id })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    const children = await k.prisma.target.findMany({ where: { parentId: tl.id } });
    expect(children.reduce((a, c) => a + Number(c.amount), 0)).toBeLessThanOrEqual(100);
  });

  it('prorates a mid-period joiner by working days and stores the basis explicitly', async () => {
    const p = await period('MONTH', '2032-06-10'); // June 2032: 30 days, Sundays 6,13,20,27 -> 26 working days
    const root = (await mk(k.agents.founder, { periodId: p.id, level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '1000000.00' })).body.data;
    const tl = (await mk(k.agents.founder, { periodId: p.id, level: 'TEAM_LEAD', ownerUserId: k.fx.teamLead.id, amount: '1000000.00', parentId: root.id })).body.data;
    const m = await mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerA.id, amount: '260000.00', parentId: tl.id, proration: { joinOn: '2032-06-16' } });
    expect(m.status).toBe(201);
    expect(m.body.data.prorationBasis).toMatchObject({ workingDaysPeriod: 26, workingDaysActive: 13, baseAmount: '260000.00', joinOn: '2032-06-16', method: 'WORKING_DAYS_MON_SAT' });
    expect(m.body.data.amount).toBe('130000.00');
    expect(m.body.data.originalAmount).toBe('130000.00');
  });
});

describe('revisions: no silent edits (DEC-002)', () => {
  async function seed() {
    const p = await period('MONTH', `20${33 + Math.floor(Math.random() * 60)}-0${1 + Math.floor(Math.random() * 9)}-10`);
    const root = (await mk(k.agents.founder, { periodId: p.id, level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '1000000.00' })).body.data;
    const tl = (await mk(k.agents.founder, { periodId: p.id, level: 'TEAM_LEAD', ownerUserId: k.fx.teamLead.id, amount: '800000.00', parentId: root.id })).body.data;
    const mgr = (await mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerA.id, amount: '500000.00', parentId: tl.id })).body.data;
    const ex = (await mk(k.agents.managerA, { periodId: p.id, level: 'EXECUTIVE', ownerUserId: k.fx.execA1.id, amount: '200000.00', parentId: mgr.id })).body.data;
    return { p, root, tl, mgr, ex };
  }

  it('a revision is a proposal: the value changes only on approval, with reason, approver and history kept', async () => {
    const t = await seed();
    expect((await k.agents.teamLead.patch(`/targets/${t.ex.id}`).send({ newAmount: '250000.00', reason: 'short' })).status).toBe(400);
    expect((await k.agents.managerA.patch(`/targets/${t.ex.id}`).send({ newAmount: '250000.00', reason: 'Larger territory this month' })).status).toBe(403); // targets:update is TL/Founder
    const rev = await k.agents.teamLead.patch(`/targets/${t.ex.id}`).send({ newAmount: '250000.00', reason: 'Larger territory this month' });
    expect(rev.status).toBe(200);
    expect(rev.body.data).toMatchObject({ status: 'PENDING', oldAmount: '200000.00', newAmount: '250000.00', reason: 'Larger territory this month' });
    const cur = await k.agents.execA1.get(`/targets/${t.ex.id}`);
    expect(cur.body.data.amount).toBe('200000.00'); // unchanged until approved
    expect(cur.body.data.pendingRevision).toMatchObject({ newAmount: '250000.00' });
    expect((await k.agents.teamLead.patch(`/targets/${t.ex.id}`).send({ newAmount: '260000.00', reason: 'Second request while pending' })).status).toBe(409);

    // the proposer (Team Lead) cannot approve their own; exec/manager cannot approve at all
    const self = await k.agents.teamLead.post(`/targets/${t.ex.id}/approve`).send({ revisionId: rev.body.data.id, decision: 'approve' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SEPARATION_OF_DUTIES');
    expect((await k.agents.managerA.post(`/targets/${t.ex.id}/approve`).send({ revisionId: rev.body.data.id, decision: 'approve' })).status).toBe(403);
    // the parent has no room for +50000 (manager 500000 - no, children sum 200000 -> 250000 fits). Founder approves.
    const ok = await k.agents.founder.post(`/targets/${t.ex.id}/approve`).send({ revisionId: rev.body.data.id, decision: 'approve', note: 'Agreed' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ amount: '250000.00', originalAmount: '200000.00', version: 2 });
    const hist = await k.agents.founder.get(`/targets/${t.ex.id}/revisions`);
    expect(hist.body.data.map((r: { seq: number; status: string }) => [r.seq, r.status])).toEqual([[1, 'APPROVED'], [0, 'APPROVED']]);
    expect(hist.body.data[0]).toMatchObject({ reason: 'Larger territory this month', decisionNote: 'Agreed', decidedByName: k.fx.founder.name, oldAmount: '200000.00', newAmount: '250000.00' });
    expect((await k.agents.founder.post(`/targets/${t.ex.id}/approve`).send({ revisionId: rev.body.data.id, decision: 'approve' })).status).toBe(409);
    expect(await k.prisma.auditLog.count({ where: { entityId: t.ex.id, action: { in: ['target.revision_proposed', 'target.revision_approved'] } } })).toBe(2);
  });

  it('Founder-level and Team-Lead-level revisions need the Founder; rejection leaves the target untouched', async () => {
    const t = await seed();
    const r1 = await k.agents.founder.patch(`/targets/${t.tl.id}`).send({ newAmount: '900000.00', reason: 'Raise the bar for the team lead' });
    expect((await k.agents.teamLead.post(`/targets/${t.tl.id}/approve`).send({ revisionId: r1.body.data.id, decision: 'approve' })).status).toBe(403);
    // Founder proposed and may decide as owner of the policy (recorded as self-approved in the audit log)
    const ok = await k.agents.founder.post(`/targets/${t.tl.id}/approve`).send({ revisionId: r1.body.data.id, decision: 'approve' });
    expect(ok.status).toBe(200);
    const audit = await k.prisma.auditLog.findFirstOrThrow({ where: { entityId: t.tl.id, action: 'target.revision_approved' } });
    expect(audit.metadata).toMatchObject({ selfApproved: true });
    const r2 = await k.agents.founder.patch(`/targets/${t.mgr.id}`).send({ newAmount: '450000.00', reason: 'Seasonal dip expected' });
    const rej = await k.agents.teamLead.post(`/targets/${t.mgr.id}/approve`).send({ revisionId: r2.body.data.id, decision: 'reject', note: 'Not now' });
    expect(rej.status).toBe(200);
    expect(rej.body.data.amount).toBe('500000.00');
    const hist = await k.agents.founder.get(`/targets/${t.mgr.id}/revisions`);
    expect(hist.body.data[0]).toMatchObject({ status: 'REJECTED', decisionNote: 'Not now' });
  });

  it('keeps the breakdown consistent: no revision below what is allocated below, none that overflows the parent', async () => {
    const t = await seed();
    const below = await k.agents.founder.patch(`/targets/${t.mgr.id}`).send({ newAmount: '100000.00', reason: 'Cut below the executive allocation' });
    expect(below.status).toBe(422);
    expect(below.body.error.code).toBe('BREAKDOWN_EXCEEDS_PARENT');
    const above = await k.agents.founder.patch(`/targets/${t.tl.id}`).send({ newAmount: '1200000.00', reason: 'Raise above the founder target' });
    expect(above.status).toBe(422);
    expect(await k.prisma.targetRevision.count({ where: { targetId: { in: [t.mgr.id, t.tl.id] }, seq: { gt: 0 } } })).toBe(0);
  });

  it('history is tamper-proof at the database: original amount, revision values and deletes are blocked', async () => {
    const t = await seed();
    await expect(k.prisma.target.update({ where: { id: t.ex.id }, data: { originalAmount: '1.00' } })).rejects.toThrow(/immutable/);
    const rev = await k.prisma.targetRevision.findFirstOrThrow({ where: { targetId: t.ex.id, seq: 0 } });
    await expect(k.prisma.targetRevision.update({ where: { id: rev.id }, data: { newAmount: '1.00' } })).rejects.toThrow(/append-only/);
    await expect(k.prisma.targetRevision.delete({ where: { id: rev.id } })).rejects.toThrow();
  });
});

describe('daily achievement tracking', () => {
  it('computes revenue, collection and enrolment achievement from booked sales and verified collections (isolated organisation)', async () => {
    const k2 = await buildKit();
    try {
      const today = todayIst();
      const p = (await k2.agents.founder.post('/targets/periods').send({ type: 'MONTH', anchor: today })).body.data;
      const T = async (metric: string, level: string, owner: string, amount: string, parentId?: string, agent = k2.agents.founder) => (await agent.post('/targets').send({ periodId: p.id, metric, level, ownerUserId: owner, amount, ...(parentId ? { parentId } : {}) })).body.data;
      const rev = await T('REVENUE', 'FOUNDER', k2.fx.founder.id, '1000000.00');
      const revTl = await T('REVENUE', 'TEAM_LEAD', k2.fx.teamLead.id, '1000000.00', rev.id);
      const revMa = await T('REVENUE', 'MANAGER', k2.fx.managerA.id, '400000.00', revTl.id, k2.agents.teamLead);
      const revEx = await T('REVENUE', 'EXECUTIVE', k2.fx.execA1.id, '200000.00', revMa.id, k2.agents.managerA);
      const col = await T('COLLECTION', 'FOUNDER', k2.fx.founder.id, '500000.00');
      const enr = await T('ENROLMENT', 'FOUNDER', k2.fx.founder.id, '20');
      for (const t of [rev, revTl, revMa, revEx, col, enr]) expect(t.id, JSON.stringify(t)).toBeTruthy();

      // execA1 sells 50,000 and 30,000 (both collected: 50,000 + 10,000); execA2 sells 20,000 (not collected); execB1 sells 10,000
      const sell = async (owner: 'execA1' | 'execA2' | 'execB1', amount: string) => {
        const lead = await makeLead(k2, k2.fx[owner].id, owner === 'execB1' ? k2.fx.teamB.id : k2.fx.teamA.id);
        const d = await createDeal(k2, k2.agents[owner], lead.id, { amount });
        expect((await k2.agents[owner].post(`/deals/${d.body.data.id}/close`).send({ outcome: 'WON', finalAmount: amount })).status).toBe(200);
        return d.body.data.id as string;
      };
      const a = await sell('execA1', '50000.00');
      const b = await sell('execA1', '30000.00');
      await sell('execA2', '20000.00');
      await sell('execB1', '10000.00');
      await collect(k2, a, '50000.00');
      await collect(k2, b, '10000.00');

      const ach = async (id: string, agent = k2.agents.founder) => (await agent.get(`/targets/${id}/achievement`)).body.data;
      const rExec = await ach(revEx.id, k2.agents.execA1);
      expect(rExec).toMatchObject({ metric: 'REVENUE', actual: '80000.00', target: '200000.00', achievementPct: '40.0', noTargetSet: false, asOf: today });
      expect(rExec.detail).toMatchObject({ booked: '80000.00', wonDeals: 2 });
      const rMgr = await ach(revMa.id, k2.agents.managerA);
      expect(rMgr).toMatchObject({ actual: '100000.00', achievementPct: '25.0' }); // A1 + A2
      const rOrg = await ach(rev.id);
      expect(rOrg).toMatchObject({ actual: '110000.00', achievementPct: '11.0' });
      // the daily series ends today and adds up to the actual
      expect(rOrg.daily.at(-1).cumulative).toBe('110000.00');
      expect(rOrg.daily.find((d: { date: string }) => d.date === today).amount).toBe('110000.00');
      const cOrg = await ach(col.id);
      expect(cOrg).toMatchObject({ metric: 'COLLECTION', actual: '60000.00', achievementPct: '12.0' });
      expect(cOrg.detail).toMatchObject({ verifiedCollections: '60000.00', refundsProcessed: '0.00' });
      const eOrg = await ach(enr.id);
      expect(eOrg).toMatchObject({ metric: 'ENROLMENT', actual: '4', target: '20', achievementPct: '20.0' });
      // Closed-won revenue is not collection: the two stay different
      expect(rOrg.actual).not.toBe(cOrg.actual);
      // as-of before the period start clamps to the start (no achievement)
      const early = (await k2.agents.founder.get(`/targets/${rev.id}/achievement`).query({ asOf: '2000-01-01' })).body.data;
      expect(early.actual).toBe('0.00');
      // refunds reduce both revenue (when approved) and collection (when processed)
      const rf = await k2.agents.execA1.post('/refunds').send({ dealId: a, amount: '5000.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Learner asked for a refund' });
      await k2.agents.managerA.post(`/refunds/${rf.body.data.id}/review`).send({ note: 'Verified with learner', recommendation: 'APPROVE' });
      await k2.agents.finance.post(`/refunds/${rf.body.data.id}/approve`).send({ reason: 'Approved by finance' });
      expect((await ach(rev.id)).actual).toBe('105000.00'); // approved refunds reduce revenue
      expect((await ach(col.id)).actual).toBe('60000.00'); // not yet processed
      await k2.agents.finance.post(`/refunds/${rf.body.data.id}/process`).send({ externalRef: 'RF-T-1', method: 'UPI' });
      expect((await ach(col.id)).actual).toBe('55000.00');
    } finally {
      await k2.close();
    }
  });

  it('target-as-of-date: an approved revision only counts from its effective date', async () => {
    const k2 = await buildKit();
    try {
      const today = todayIst();
      const p = (await k2.agents.founder.post('/targets/periods').send({ type: 'MONTH', anchor: today })).body.data;
      const t = (await k2.agents.founder.post('/targets').send({ periodId: p.id, metric: 'REVENUE', level: 'FOUNDER', ownerUserId: k2.fx.founder.id, amount: '100000.00' })).body.data;
      const r = await k2.agents.founder.patch(`/targets/${t.id}`).send({ newAmount: '200000.00', reason: 'Raise after strong week', effectiveFrom: p.endsOn });
      await k2.agents.founder.post(`/targets/${t.id}/approve`).send({ revisionId: r.body.data.id, decision: 'approve' });
      const now = (await k2.agents.founder.get(`/targets/${t.id}/achievement`).query({ asOf: p.startsOn })).body.data;
      expect(now).toMatchObject({ target: '100000.00', originalTarget: '100000.00', currentTarget: '200000.00' });
      const end = (await k2.agents.founder.get(`/targets/${t.id}/achievement`).query({ asOf: p.endsOn })).body.data;
      expect(end.target).toBe('200000.00');
    } finally {
      await k2.close();
    }
  });
});

describe('role-scoped target visibility', () => {
  it('executive sees only their own; manager their team; sibling manager, peer, HR, admin and other orgs are denied; Finance gets a summary', async () => {
    const p = await period('MONTH', '2034-07-10');
    const root = (await mk(k.agents.founder, { periodId: p.id, level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '1000.00' })).body.data;
    const tl = (await mk(k.agents.founder, { periodId: p.id, level: 'TEAM_LEAD', ownerUserId: k.fx.teamLead.id, amount: '1000.00', parentId: root.id })).body.data;
    const mA = (await mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerA.id, amount: '500.00', parentId: tl.id })).body.data;
    const mB = (await mk(k.agents.teamLead, { periodId: p.id, level: 'MANAGER', ownerUserId: k.fx.managerB.id, amount: '500.00', parentId: tl.id })).body.data;
    const e1 = (await mk(k.agents.managerA, { periodId: p.id, level: 'EXECUTIVE', ownerUserId: k.fx.execA1.id, amount: '250.00', parentId: mA.id })).body.data;
    const e2 = (await mk(k.agents.managerA, { periodId: p.id, level: 'EXECUTIVE', ownerUserId: k.fx.execA2.id, amount: '250.00', parentId: mA.id })).body.data;
    const eB = (await mk(k.agents.managerB, { periodId: p.id, level: 'EXECUTIVE', ownerUserId: k.fx.execB1.id, amount: '250.00', parentId: mB.id })).body.data;
    const idsOf = async (agent: typeof k.agents.execA1) => new Set(((await agent.get('/targets').query({ periodId: p.id, limit: 100 })).body.data as Array<{ id: string }>).map((x) => x.id));
    const exec = await idsOf(k.agents.execA1);
    expect([...exec]).toEqual([e1.id]);
    const mgrA = await idsOf(k.agents.managerA);
    expect(mgrA.has(mA.id) && mgrA.has(e1.id) && mgrA.has(e2.id)).toBe(true);
    expect(mgrA.has(mB.id) || mgrA.has(eB.id) || mgrA.has(root.id)).toBe(false);
    expect((await idsOf(k.agents.teamLead)).size).toBe(7);
    // single-record IDOR: peer / sibling / cross-org answer 404, never 403
    expect((await k.agents.execA1.get(`/targets/${e2.id}`)).status).toBe(404);
    expect((await k.agents.execA1.get(`/targets/${mA.id}`)).status).toBe(404);
    expect((await k.agents.managerA.get(`/targets/${eB.id}`)).status).toBe(404);
    expect((await k.agents.managerA.get(`/targets/${mB.id}/achievement`)).status).toBe(404);
    expect((await k.agents.execA1.get(`/targets/${e2.id}/breakdown`)).status).toBe(404);
    expect((await k.agents.hr.get('/targets')).status).toBe(403);
    expect((await k.agents.admin.get('/targets')).status).toBe(403);
    // a manager's breakdown of the team lead target hides the sibling team but still shows the consistent total
    expect((await k.agents.managerA.get(`/targets/${tl.id}/breakdown`)).status).toBe(404);
    const bd = await k.agents.managerA.get(`/targets/${mA.id}/breakdown`);
    expect(bd.body.data.root.children).toHaveLength(2);
    // Finance: summary only (no owner identity)
    const fin = await k.agents.finance.get(`/targets/${e1.id}`);
    expect(fin.status).toBe(200);
    expect(fin.body.data).toMatchObject({ ownerUserId: null, ownerName: null, amount: '250.00' });
    expect((await k.agents.finance.post('/targets').send({ periodId: p.id, metric: 'REVENUE', level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '1.00' })).status).toBe(403);
  });

  it('another organisation cannot see or use these records', async () => {
    const k2 = await buildKit();
    try {
      const p = await period('MONTH', '2035-01-10');
      const t = (await mk(k.agents.founder, { periodId: p.id, level: 'FOUNDER', ownerUserId: k.fx.founder.id, amount: '10.00' })).body.data;
      expect((await k2.agents.founder.get(`/targets/${t.id}`)).status).toBe(404);
      expect((await k2.agents.founder.patch(`/targets/${t.id}`).send({ newAmount: '11.00', reason: 'cross org attempt!' })).status).toBe(404);
      expect((await k2.agents.founder.post('/targets').send({ periodId: p.id, metric: 'REVENUE', level: 'FOUNDER', ownerUserId: k2.fx.founder.id, amount: '1.00' })).status).toBe(404);
      expect((await k2.agents.founder.get('/targets').query({ periodId: p.id })).body.data).toEqual([]);
    } finally {
      await k2.close();
    }
  });
});
