import type { AuthedAgent } from '../helpers';
import { loginAgent } from '../helpers';
import type { TestApp } from '../helpers';
import type { AnalyticsFixture } from './fixture';

export const Q = '?from=2026-07-01&to=2026-07-31';

export async function agents(t: TestApp, f: AnalyticsFixture) {
  return {
    founder: await loginAgent(t.app, f.founder),
    tl: await loginAgent(t.app, f.teamLead),
    mA: await loginAgent(t.app, f.managerA),
    mB: await loginAgent(t.app, f.managerB),
    a1: await loginAgent(t.app, f.execA1),
    a2: await loginAgent(t.app, f.execA2),
    b1: await loginAgent(t.app, f.execB1),
    admin: await loginAgent(t.app, f.admin),
    hr: await loginAgent(t.app, f.hr),
    finance: await loginAgent(t.app, f.finance),
  };
}

export async function kpi(a: AuthedAgent, id: string, query = Q) {
  const r = await a.get(`/kpis/${id}${query}`);
  if (r.status !== 200) throw new Error(`GET /kpis/${id} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data as import('../../src/modules/reporting/kpi/types').KpiResult;
}
