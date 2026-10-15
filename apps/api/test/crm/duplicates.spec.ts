import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLead, crmKit, uniq, uniqPhone, type CrmKit } from './kit';

let k: CrmKit;
beforeAll(async () => { k = await crmKit(); });
afterAll(async () => { await k.close(); });

describe('duplicate detection (flag, never silently merge)', () => {
  it('flags exact phone and case-insensitive email matches and fuzzy name + phone-suffix matches; the new lead is still created', async () => {
    const phone = uniqPhone();
    const a = await createLead(k.a.execA1, { fullName: '[TEST] Meera Kulkarni', phone, email: 'Meera.K@Example.com' });
    const b = await k.a.execA1.post('/leads').send({ fullName: '[TEST] Someone else', phone: `+91 ${phone}` });
    expect(b.status).toBe(201);
    expect(b.body.data.possibleDuplicates.map((d: { id: string }) => d.id)).toContain(a.id);
    expect(b.body.meta.warnings.join(' ')).toMatch(/duplicate/i);
    const c = await k.a.execA1.post('/leads').send({ fullName: '[TEST] Different', phone: uniqPhone(), email: 'meera.k@example.COM' });
    expect(c.body.data.possibleDuplicates.map((d: { id: string }) => d.id)).toContain(a.id);
    const d = await k.a.execA1.post('/leads').send({ fullName: '[TEST] Meera K', phone: `0${phone}` });
    expect(d.body.data.possibleDuplicates.length).toBeGreaterThanOrEqual(1);
    const rows = await k.t.prisma.duplicateCandidate.findMany({ where: { OR: [{ leadId: a.id }, { otherLeadId: a.id }] } });
    expect(rows.map((r) => r.matchType).sort()).toContain('PHONE_EXACT');
    expect(rows.map((r) => r.matchType)).toContain('EMAIL_EXACT');
    // nothing was merged: all leads still visible and independent
    expect(await k.t.prisma.lead.count({ where: { id: { in: [a.id, b.body.data.lead.id] }, mergedIntoId: null } })).toBe(2);
    const flagged = await k.a.execA1.get(`/leads/${a.id}`);
    expect(flagged.body.data.duplicateFlag).toBe(true);
    expect(flagged.body.data.openDuplicateCount).toBeGreaterThanOrEqual(2);
  });

  it('a different phone with a different name is NOT flagged', async () => {
    const r = await k.a.execA1.post('/leads').send({ fullName: '[TEST] Totally Unique Person', phone: uniqPhone() });
    expect(r.body.data.possibleDuplicates).toEqual([]);
    expect(r.body.data.lead.duplicateFlag).toBe(false);
  });
});

describe('duplicate review queue: merge keeps audit, dismiss clears the flag', () => {
  async function pair(who = k.a.execA1) {
    const phone = uniqPhone();
    const winner = await createLead(who, { fullName: uniq('Winner'), phone, programId: undefined });
    const loser = await createLead(who, { fullName: uniq('Loser'), phone, email: 'loser@example.com', interestLevel: 'HIGH' });
    const cand = await k.t.prisma.duplicateCandidate.findFirstOrThrow({ where: { OR: [{ leadId: winner.id, otherLeadId: loser.id }, { leadId: loser.id, otherLeadId: winner.id }] } });
    return { winner, loser, cand };
  }

  it('lists open candidates side by side for the owner\'s manager only (scope)', async () => {
    const { cand, winner, loser } = await pair();
    const list = await k.a.managerA.get('/leads/duplicates?limit=100');
    const item = list.body.data.find((c: { id: string }) => c.id === cand.id);
    expect(item).toBeTruthy();
    expect([item.leadA.id, item.leadB.id].sort()).toEqual([winner.id, loser.id].sort());
    expect(item.matchType).toBe('PHONE_EXACT');
    expect(list.body.data.find((c: { id: string }) => c.id === cand.id)).toBeTruthy();
    const other = await k.a.managerB.get('/leads/duplicates?limit=100');
    expect(other.body.data.find((c: { id: string }) => c.id === cand.id)).toBeUndefined();
    expect((await k.a.managerB.post(`/leads/duplicates/${cand.id}/merge`).send({ winnerLeadId: winner.id, reason: 'try it' })).status).toBe(404);
    expect((await k.a.execA1.get('/leads/duplicates')).status).toBe(403);
  });

  it('merge moves calls/notes/tasks/history to the winner, hides the loser, writes an audit + immutable merge log and cannot be repeated', async () => {
    const { winner, loser, cand } = await pair();
    await k.a.execA1.post(`/leads/${loser.id}/calls`).send({ outcome: 'NO_ANSWER' });
    await k.a.execA1.post(`/leads/${loser.id}/notes`).send({ body: 'note on the duplicate' });
    const loserTasks = await k.t.prisma.task.count({ where: { leadId: loser.id } });
    const res = await k.a.managerA.post(`/leads/duplicates/${cand.id}/merge`).send({ winnerLeadId: winner.id, takeFromLoser: ['email', 'interestLevel'], reason: 'same person' });
    expect(res.status).toBe(200);
    expect(res.body.data.winner.email).toBe('loser@example.com');
    expect(res.body.data.winner.interestLevel).toBe('HIGH');
    expect(await k.t.prisma.callLog.count({ where: { leadId: winner.id } })).toBe(1);
    expect(await k.t.prisma.callLog.count({ where: { leadId: loser.id } })).toBe(0);
    expect(await k.t.prisma.leadNote.count({ where: { leadId: winner.id, body: 'note on the duplicate' } })).toBe(1);
    expect(await k.t.prisma.task.count({ where: { leadId: winner.id } })).toBeGreaterThanOrEqual(loserTasks);
    const loserRow = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: loser.id } });
    expect(loserRow.mergedIntoId).toBe(winner.id);
    expect((await k.a.execA1.get(`/leads/${loser.id}`)).status).toBe(404); // hidden from reads
    const list = await k.a.execA1.get(`/leads?q=${encodeURIComponent(loser.fullName)}`);
    expect(list.body.data).toHaveLength(0);
    const log = await k.t.prisma.leadMerge.findFirstOrThrow({ where: { loserId: loser.id } });
    expect(log).toMatchObject({ winnerId: winner.id, mergedById: k.fx.managerA.id });
    expect((log.snapshotBefore as { loser: { fullName: string } }).loser.fullName).toBe(loser.fullName); // loser record preserved
    const audit = await k.t.prisma.auditLog.findFirstOrThrow({ where: { entityId: winner.id, action: 'lead.merged' } });
    expect(JSON.stringify(audit.metadata)).not.toContain('loser@example.com'); // no contact PII in audit metadata
    expect((await k.t.prisma.duplicateCandidate.findUniqueOrThrow({ where: { id: cand.id } })).status).toBe('MERGED');
    expect((await k.a.managerA.post(`/leads/duplicates/${cand.id}/merge`).send({ winnerLeadId: winner.id, reason: 'again' })).status).toBe(409);
    const tl = await k.a.execA1.get(`/leads/${winner.id}/timeline?limit=100`);
    expect(tl.body.data.some((i: { type: string }) => i.type === 'merge')).toBe(true);
    expect(tl.body.data.filter((i: { type: string }) => i.type === 'call')).toHaveLength(1);
  });

  it('dismiss closes the candidate and clears the duplicate flag when nothing else is open', async () => {
    const { winner, cand } = await pair();
    expect((await k.a.managerA.post(`/leads/duplicates/${cand.id}/dismiss`).send({ reason: 'two different people sharing a phone' })).status).toBe(200);
    expect((await k.t.prisma.duplicateCandidate.findUniqueOrThrow({ where: { id: cand.id } })).status).toBe('DISMISSED');
    expect((await k.t.prisma.lead.findUniqueOrThrow({ where: { id: winner.id } })).duplicateFlag).toBe(false);
    expect((await k.a.managerA.post(`/leads/duplicates/${cand.id}/dismiss`).send({ reason: 'again again' })).status).toBe(409);
    expect((await k.a.managerA.post(`/leads/duplicates/${cand.id}/dismiss`).send({})).status).toBe(400);
  });

  it('refuses to merge two won leads and validates the winner id', async () => {
    const { winner, loser, cand } = await pair();
    expect((await k.a.managerA.post(`/leads/duplicates/${cand.id}/merge`).send({ winnerLeadId: '00000000-0000-4000-8000-000000000009', reason: 'nope' })).status).toBe(422);
    for (const l of [winner, loser]) await k.a.execA1.post(`/leads/${l.id}/calls`).send({ outcome: 'WON', wonValue: 100 });
    expect((await k.a.managerA.post(`/leads/duplicates/${cand.id}/merge`).send({ winnerLeadId: winner.id, reason: 'both won' })).status).toBe(409);
  });
});
