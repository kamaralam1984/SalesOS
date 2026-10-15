import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildOrgFixture, createTestApp, loginAgent, type OrgFixture, type TestApp } from './helpers';

/** Analytics reconcile item: SOP acknowledgements, coaching sessions and engagement answers must bump the KPI cache version. */
let t: TestApp;
let fx: OrgFixture;
beforeAll(async () => { t = await createTestApp(); fx = await buildOrgFixture(t.prisma); });
afterAll(async () => { await t.close(); });

const events = (type: string) => t.prisma.outboxEvent.findMany({ where: { organizationId: fx.org.id, eventType: type } });

describe('KPI-affecting people events are published', () => {
  it('coaching.session_recorded after a session is saved', async () => {
    const mgr = await loginAgent(t.app, fx.managerA);
    const res = await mgr.post('/coaching/sessions').send({ sessionDate: new Date().toISOString(), durationMin: 30, topics: ['CALL_QUALITY'], participantIds: [fx.execA1.id], actions: [] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await events('coaching.session_recorded')).length).toBe(1);
  });

  it('engagement.responded names the survey only, never the respondent', async () => {
    const hr = await loginAgent(t.app, fx.hr);
    const s = await hr.post('/engagement/surveys').send({ title: 'Pulse check', questions: [{ id: 'q1', text: 'How is the week?', type: 'SCALE_5' }] });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const ex = await loginAgent(t.app, fx.execA1);
    const r = await ex.post('/engagement/responses').send({ surveyId: s.body.data.id, answers: { q1: 4 } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ev = await events('engagement.responded');
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0])).not.toContain(fx.execA1.id);
  });

  it('the worker invalidates the KPI cache for all three', async () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../worker/src/jobs/analytics/invalidate.ts'), 'utf8');
    for (const e of ['sop.acknowledged', 'coaching.session_recorded', 'engagement.responded']) expect(src).toContain(`'${e}'`);
  });
});
