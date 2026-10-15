#!/usr/bin/env node
// Dependency-free HTTP load test for the SalesOS API (Node 24 fetch + undici keep-alive).
// Usage: API=http://127.0.0.1:4412/api/v1 DURATION=15 CONC=10 node scripts/perf/load.mjs [scenario,...]
// Needs a demo-seeded DB (demo credentials) and relaxed throttles on the API under test (THROTTLE_LIMIT/LOGIN_*). NEVER run against production.
import { writeFileSync } from 'node:fs';

const API = process.env.API ?? 'http://127.0.0.1:4412/api/v1';
const DURATION = Number(process.env.DURATION ?? 15);
const CONC = Number(process.env.CONC ?? 10);
const OUT = process.env.OUT; // optional JSON output path
const demoPassword = (l) => `Demo!${l.replace(/\./g, '')}#2026`;
const email = (l) => `${l}@demo.salesos.local`;

async function login(local) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email(local), password: demoPassword(local) }) });
  if (!r.ok) throw new Error(`login ${local} -> ${r.status} ${await r.text()}`);
  const body = await r.json();
  const data = body.data ?? body;
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { cookie, csrf: data.csrfToken, local };
}
const get = async (s, path) => (await fetch(`${API}${path}`, { headers: { cookie: s.cookie } })).json();

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;

async function run(name, conc, make) {
  const lat = [];
  let errors = 0, total = 0, bytes = 0;
  const statuses = {};
  const end = Date.now() + DURATION * 1000;
  async function worker(i) {
    let n = 0;
    while (Date.now() < end) {
      const { path, init } = make(i, n++);
      const t = performance.now();
      try {
        const r = await fetch(`${API}${path}`, init);
        const buf = await r.arrayBuffer();
        bytes += buf.byteLength;
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        if (r.status >= 400) errors++;
      } catch { errors++; statuses.network = (statuses.network ?? 0) + 1; }
      lat.push(performance.now() - t);
      total++;
    }
  }
  await Promise.all(Array.from({ length: conc }, (_, i) => worker(i)));
  lat.sort((a, b) => a - b);
  return { name, conc, requests: total, rps: +(total / DURATION).toFixed(1), p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1), max: +(lat.at(-1) ?? 0).toFixed(1), errorRate: +((errors / Math.max(total, 1)) * 100).toFixed(2), statuses, avgKB: +(bytes / Math.max(total, 1) / 1024).toFixed(1) };
}

const founder = await login('founder');
const finance = await login('finance').catch(() => founder);
const teamLead = await login('teamlead');
const execs = await Promise.all(['exec.a1', 'exec.a2', 'exec.b1', 'exec.b2'].map(login));
const lead = await get(founder, '/leads?limit=50');
const items = Array.isArray(lead.data) ? lead.data : (lead.data?.items ?? []);
const founderIds = items.map((l) => l.id);
const execLeads = await Promise.all(execs.map(async (e) => ((await get(e, '/leads?limit=50')).data ?? []).map((l) => l.id)));
const H = (s, extra = {}) => ({ headers: { cookie: s.cookie, ...extra } });
const J = (s, body, extra = {}) => ({ method: 'POST', headers: { cookie: s.cookie, 'content-type': 'application/json', 'x-csrf-token': s.csrf, ...extra }, body: JSON.stringify(body) });
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

const scenarios = {
  login: [3, (i) => ({ path: '/auth/login', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email('exec.a1'), password: demoPassword('exec.a1') }) } })],
  'lead-list-exec': [CONC, (i) => ({ path: '/leads?limit=25', init: H(execs[i % execs.length]) })],
  'lead-list-founder': [CONC, () => ({ path: '/leads?limit=25', init: H(founder) })],
  'lead-list-filter-search': [CONC, (i, n) => ({ path: `/leads?limit=25&status=CONNECTED&search=Perf%20Lead%2000${10 + (n % 80)}`, init: H(founder) })],
  'lead-detail': [CONC, (i) => { const k = i % execs.length; return { path: `/leads/${rnd(execLeads[k])}`, init: H(execs[k]) }; }],
  'lead-timeline': [CONC, (i) => { const k = i % execs.length; return { path: `/leads/${rnd(execLeads[k])}/timeline`, init: H(execs[k]) }; }],
  'create-call': [CONC, (i, n) => { const k = i % execs.length; return { path: `/leads/${rnd(execLeads[k])}/calls`, init: J(execs[k], { outcome: 'NO_ANSWER', notes: 'load test' }, { 'idempotency-key': `l3-${Date.now()}-${i}-${n}` }) }; }],
  'task-list': [CONC, (i) => ({ path: '/tasks?limit=25', init: H(execs[i % execs.length]) })],
  'dashboard-exec': [CONC, (i) => ({ path: '/dashboard/salesperson', init: H(execs[i % execs.length]) })],
  'dashboard-founder': [Math.min(CONC, 4), () => ({ path: '/dashboard/ceo', init: H(founder) })],
  'dashboard-team-lead': [Math.min(CONC, 4), () => ({ path: '/dashboard/team-lead', init: H(teamLead) })],
  'report-funnel': [Math.min(CONC, 4), () => ({ path: '/reports/funnel', init: H(founder) })],
  'report-team-performance': [Math.min(CONC, 4), () => ({ path: '/reports/team-performance', init: H(founder) })],
  'report-follow-ups': [Math.min(CONC, 4), () => ({ path: '/reports/follow-ups', init: H(founder) })],
  'leads-csv-export': [2, () => ({ path: '/leads/export', init: H(founder) })],
  'report-export-create': [2, (i, n) => ({ path: '/reports/exports', init: J(founder, { report: 'team-performance', format: 'CSV' }, { 'idempotency-key': `l3x-${Date.now()}-${i}-${n}` }) })],
};

const only = process.argv[2]?.split(',');
const results = [];
for (const [name, [conc, make]] of Object.entries(scenarios)) {
  if (only && !only.includes(name)) continue;
  await run(name, 1, make); // warm-up
  const r = await run(name, conc, make);
  results.push(r);
  console.log(JSON.stringify(r));
}
console.log('\n| scenario | conc | req | rps | p50 ms | p95 ms | p99 ms | max ms | err % | avg KB |\n|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) console.log(`| ${r.name} | ${r.conc} | ${r.requests} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} | ${r.errorRate} | ${r.avgKB} |`);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
