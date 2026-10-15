import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHandoverFromTrigger } from '@salesos/cx-core';
import type { RoleKey } from '@salesos/shared-types';
import { createUser, loginAgent, type AuthedAgent } from './helpers';
import { listRoutes } from './helpers/routes';
import { buildKit, collect, wonDeal, type RevenueKit } from './revenue/kit';

/**
 * KI-H-06 + sweep: roles whose grant for an entity is `summary` (or that hold no grant) must never receive money fields,
 * on ANY list or detail endpoint of ANY domain. Data is created by Executives/Finance, then every GET route is called
 * as each restricted role with real ids harvested from the Founder's lists (so detail routes are exercised too).
 */
let k: RevenueKit;
const restricted: Partial<Record<RoleKey, AuthedAgent>> = {};
const RESTRICTED: RoleKey[] = ['STUDENT_SUCCESS', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'HR', 'ADMIN'];
let deal: { dealId: string; leadId: string };
let refundId: string;
let paymentId: string;

/** Keys that carry money. A restricted role may only see them null / absent. */
const MONEY_KEY = /^(amount\w*|\w*amount|price\w*|\w*price|fee\w*|discount\w*|revenue\w*|\w*revenue|collected|outstanding|refunded|netcollections|balance|paid|commission|incentive\w*|payout\w*|salary\w*|ctc|salevalue|estimatedvalue|wonvalue|value|forecast|achieved)$/i;
const BENIGN = new Set(['count', 'amountofitems']);

const PII_KEY = /^(phone|phonee164|phoneraw|email|alternatephone|whatsapp|address)$/i;
function piiLeaks(value: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...piiLeaks(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEY.test(key) && v) out.push(`${path}.${key}`);
      else out.push(...piiLeaks(v, `${path}.${key}`));
    }
  }
  return out;
}

function leaks(value: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...leaks(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (MONEY_KEY.test(key) && !BENIGN.has(key.toLowerCase()) && v !== null && v !== undefined && v !== false && v !== 0 && v !== '0' && v !== '0.00' && typeof v !== 'object') out.push(`${path}.${key}=${String(v)}`);
      else out.push(...leaks(v, `${path}.${key}`));
    }
  }
  return out;
}

beforeAll(async () => {
  k = await buildKit();
  for (const role of RESTRICTED) {
    if (role === 'HR') restricted[role] = k.agents.hr;
    else if (role === 'ADMIN') restricted[role] = k.agents.admin;
    else restricted[role] = await loginAgent(k.t.app, await createUser(k.prisma, k.fx.org, { roles: [role] }));
  }
  deal = await wonDeal(k);
  paymentId = await collect(k, deal.dealId);
  const r = await k.agents.managerA.post('/refunds').send({ dealId: deal.dealId, paymentId, amount: '12000.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Learner circumstances changed' });
  if (r.status !== 201) throw new Error(`refund setup ${r.status} ${JSON.stringify(r.body)}`);
  refundId = r.body.data.id;
  await wonDeal(k, { ownerKey: 'execB1' });
  // a submitted Student Success handover carries amountPaid / amountDue for those who may see money; summary roles must not
  await createHandoverFromTrigger(k.prisma, { id: randomUUID(), eventType: 'deal.closed', organizationId: k.fx.org.id, payload: { dealId: deal.dealId, leadId: deal.leadId, outcome: 'WON', ownerId: k.fx.execA1.id, saleValue: '50000.00' } });
  const h = await k.prisma.handoverRecord.findFirstOrThrow({ where: { dealId: deal.dealId } });
  const upd = await k.agents.execA1.patch(`/handovers/${h.id}`).send({ learnerName: 'Asha Verma', learnerContact: '+919800000001', languagePreference: 'HI', programName: 'AI Sprint', amountPaid: 5000, amountDue: 15000, paymentVerified: true, promisesMade: 'Weekly mentor call', goals: 'Launch first offer', objections: 'None raised', specialNotes: 'Evenings', consents: { dataSharing: true, contact: true } });
  if (upd.status !== 200) throw new Error(`handover update ${upd.status} ${JSON.stringify(upd.body)}`);
  const sub = await k.agents.execA1.post(`/handovers/${h.id}/submit`).send({});
  if (sub.status !== 200) throw new Error(`handover submit ${sub.status} ${JSON.stringify(sub.body)}`);
});
afterAll(async () => { await k.close(); });

describe('KI-H-06: deals, collections and refunds for summary-scope roles', () => {
  it('Student Success: deal list/detail/pipeline return a minimal projection with no amounts, notes or money block', async () => {
    const ss = restricted.STUDENT_SUCCESS!;
    const list = await ss.get('/deals').query({ limit: 50 });
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    for (const d of list.body.data) {
      expect(d.amount).toBeNull();
      expect(d.money).toBeNull();
      expect(d.note).toBeNull();
      expect(d.lostReason).toBeNull();
      expect(d.highValueThreshold).toBeNull();
      expect(d.isHighValue).toBeNull();
    }
    expect(JSON.stringify(list.body)).not.toContain('50000');
    const one = await ss.get(`/deals/${deal.dealId}`);
    expect(one.status).toBe(200);
    expect(one.body.data.amount).toBeNull();
    expect(one.body.data.money).toBeNull();
    expect(one.body.data.payments).toBeUndefined();
    expect(one.body.data.refunds).toBeUndefined();
    expect(one.body.data.salesRecord).toBeUndefined();
    expect(JSON.stringify(one.body)).not.toContain('50000');
    const pipe = await ss.get('/deals/pipeline');
    expect(pipe.status).toBe(200);
    for (const s of pipe.body.data) { expect(s.amount).toBeNull(); expect(s.highValueCount).toBeNull(); }
    // no oracle on hidden fields through filters
    expect((await ss.get('/deals').query({ highValue: 'true' })).status).toBe(400);
  });

  it('Student Success: refunds are a minimal projection (no amounts, no reasons)', async () => {
    const ss = restricted.STUDENT_SUCCESS!;
    const list = await ss.get('/refunds');
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(leaks(list.body.data)).toEqual([]);
    const one = await ss.get(`/refunds/${refundId}`);
    expect(one.status).toBe(200);
    expect(leaks(one.body.data)).toEqual([]);
    expect(JSON.stringify(one.body)).not.toContain('12000');
  });

  it.each(['MARKETING', 'COMMUNITY', 'OPERATIONS', 'HR', 'ADMIN'] as const)('%s cannot read deals, collections or refunds at all', async (role) => {
    const a = restricted[role]!;
    for (const path of ['/deals', `/deals/${deal.dealId}`, '/deals/pipeline', '/collections', `/collections/${paymentId}`, '/collections/daily', '/refunds', `/refunds/${refundId}`, `/leads/${deal.leadId}/deals`]) {
      const res = await a.get(path);
      expect([403, 404], `${role} ${path} -> ${res.status}`).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain('50000');
    }
  });
});

describe('sweep: every GET route, every restricted role, ids harvested from the Founder', () => {
  it('no restricted role receives a money field from any endpoint', async () => {
    const routes = listRoutes(k.t.app).filter((r) => r.method === 'GET' && !r.isPublic && !/export|stream|events\/.*\/ics|\.ics|download|openapi/i.test(r.path));
    const pool = new Map<string, string[]>();
    const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v : []).map((x) => (x as { id?: string })?.id).filter((x): x is string => typeof x === 'string').slice(0, 3);
    const flat = routes.filter((r) => !r.path.includes(':'));
    for (const r of flat) {
      const res = await k.agents.founder.get(r.path.replace(/^\//, '/')).query({ limit: 5 });
      if (res.status === 200) pool.set(r.path.split('/')[1] ?? '', [...(pool.get(r.path.split('/')[1] ?? '') ?? []), ...idsOf(res.body.data)]);
    }
    pool.set('deals', [...(pool.get('deals') ?? []), deal.dealId]);
    pool.set('collections', [...(pool.get('collections') ?? []), paymentId]);
    pool.set('refunds', [...(pool.get('refunds') ?? []), refundId]);
    pool.set('leads', [...(pool.get('leads') ?? []), deal.leadId]);
    const urls: string[] = [];
    for (const r of routes) {
      if (!r.path.includes(':')) { urls.push(r.path); continue; }
      const ids = [...new Set(pool.get(r.path.split('/')[1] ?? '') ?? [])].slice(0, 4);
      for (const id of ids) urls.push(r.path.replace(/:[A-Za-z]+/g, id));
    }
    expect(urls.length).toBeGreaterThan(40);
    const found: string[] = [];
    const pii: string[] = [];
    let ok = 0;
    for (const role of RESTRICTED) {
      for (const url of urls) {
        const res = await restricted[role]!.get(url);
        if (res.status !== 200) continue;
        ok += 1;
        // Aggregated KPI/report/dashboard values are summary-by-design (kpi:view / reports:view = summary); owned by the analytics module
        // Student Success holds handover:view at ORG scope by design: the handover checklist carries amount paid / due (DEC handover content)
        const designed = /^\/(kpis|reports|dashboards?)(\/|\?|$)/.test(url) || (role === 'STUDENT_SUCCESS' && /^\/handovers(\/|\?|$)/.test(url));
        const l = designed ? [] : leaks(res.body.data);
        if (l.length) found.push(`${role} GET ${url}: ${l.slice(0, 3).join(', ')}`);
        // contact details of leads/learners are never part of a minimum-data projection (own profile and the user directory are separate permissions)
        if (['STUDENT_SUCCESS', 'MARKETING'].includes(role) && !/^\/(auth|users|org|devices|notifications)/.test(url)) {
          const p = piiLeaks(res.body.data);
          if (p.length) pii.push(`${role} GET ${url}: ${p.slice(0, 3).join(', ')}`);
        }
      }
    }
    expect(ok).toBeGreaterThan(20);
    expect(found).toEqual([]);
    expect(pii).toEqual([]);
  });
});
