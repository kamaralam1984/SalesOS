#!/usr/bin/env node
// Role-based API smoke journeys against a running stack (no deps; Node >= 20).
//   API_URL=http://127.0.0.1:4312 WEB_URL=http://127.0.0.1:3312 node scripts/smoke-staging.mjs
// Uses the [DEMO] seed users (staging/dev only). Exits non-zero on any failure; prints a result table.
const API = (process.env.API_URL ?? 'http://127.0.0.1:4312').replace(/\/$/, '') + '/api/v1';
const WEB = process.env.WEB_URL ?? '';
const pw = (l) => `Demo!${l.replace(/\./g, '')}#2026`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };

class Session {
  constructor() { this.cookies = new Map(); this.csrf = ''; }
  async req(method, path, body) {
    const headers = { accept: 'application/json', cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.csrf && method !== 'GET') headers['x-csrf-token'] = this.csrf;
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies.set(kv.slice(0, i), kv.slice(i + 1)); }
    let json = null; try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json, headers: res.headers };
  }
  async login(local) {
    const r = await this.req('POST', '/auth/login', { email: `${local}@demo.salesos.local`, password: pw(local) });
    if (r.status === 200 || r.status === 201) this.csrf = r.json?.data?.csrfToken ?? '';
    return r;
  }
}

async function main() {
  // 1. liveness / readiness (public)
  const h = await fetch(API + '/health'); check('GET /health 200', h.ok);
  const rd = await fetch(API + '/ready'); const rdj = await rd.json().catch(() => ({}));
  check('GET /ready 200 (db+redis)', rd.ok, JSON.stringify(rdj?.data?.checks ?? rdj));
  const unauth = await fetch(API + '/leads'); check('unauthenticated GET /leads is 401', unauth.status === 401, String(unauth.status));
  const bad = await new Session().login('founder').then(() => new Session().req('POST', '/auth/login', { email: 'founder@demo.salesos.local', password: 'wrong-password-123' }));
  check('wrong password rejected (401)', bad.status === 401, String(bad.status));

  // 2. founder
  const f = new Session(); const fl = await f.login('founder');
  check('founder login', [200, 201].includes(fl.status), String(fl.status));
  const me = await f.req('GET', '/auth/me'); check('founder /auth/me', me.status === 200 && JSON.stringify(me.json).includes('FOUNDER'), String(me.status));
  const leads = await f.req('GET', '/leads?limit=5'); check('founder lists leads (bounded)', leads.status === 200 && Array.isArray(leads.json?.data) && leads.json.data.length <= 5, `${leads.status} n=${leads.json?.data?.length}`);
  for (const p of ['/tasks?limit=5', '/deals?limit=5', '/kpis', '/users?limit=5', '/teams']) { const r = await f.req('GET', p); check(`founder GET ${p}`, r.status === 200, String(r.status)); }
  const aud = await f.req('GET', '/audit-logs?limit=5'); check('founder reads audit logs', aud.status === 200, String(aud.status));
  const noCsrf = await fetch(API + '/leads', { method: 'POST', headers: { 'content-type': 'application/json', cookie: [...f.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, body: '{}' });
  check('mutation without CSRF token rejected (403)', noCsrf.status === 403, String(noCsrf.status));

  // 3. executive A1: own scope + denials
  const e = new Session(); const el = await e.login('exec.a1');
  check('executive login', [200, 201].includes(el.status), String(el.status));
  const eleads = await e.req('GET', '/leads?limit=100'); check('executive lists own leads', eleads.status === 200, `${eleads.status} n=${eleads.json?.data?.length}`);
  const fl2 = leads.json?.data?.length ?? 0;
  const eaud = await e.req('GET', '/audit-logs'); check('executive denied audit logs (403)', eaud.status === 403, String(eaud.status));
  const eusers = await e.req('POST', '/users', { email: 'x@example.com', name: 'x' }); check('executive cannot create users (403)', eusers.status === 403, String(eusers.status));
  // lead of another manager's team must be invisible to this executive
  const other = new Session(); await other.login('exec.b1'); const oleads = await other.req('GET', '/leads?limit=1');
  const otherId = oleads.json?.data?.[0]?.id;
  if (otherId) { const x = await e.req('GET', `/leads/${otherId}`); check('cross-team lead read denied (404/403)', [403, 404].includes(x.status), String(x.status)); }
  else check('cross-team lead read denied (404/403)', true, 'skipped: exec.b1 has no leads (non-fatal)');

  // 4. manager + finance + admin sanity
  for (const [role, path, ok] of [['manager.a', '/leads?limit=5', [200]], ['finance', '/deals?limit=5', [200]], ['admin', '/users?limit=5', [200]], ['admin', '/leads?limit=5', [200, 403]]]) {
    const s = new Session(); const l = await s.login(role); const r = await s.req('GET', path);
    check(`${role} login + GET ${path}`, [200, 201].includes(l.status) && ok.includes(r.status), `${l.status}/${r.status}`);
  }
  // 5. logout invalidates the session
  const out = await f.req('POST', '/auth/logout'); const after = await f.req('GET', '/auth/me');
  check('logout then /auth/me is 401', [200, 204].includes(out.status) && after.status === 401, `${out.status}/${after.status}`);

  // 6. web
  if (WEB) {
    for (const [p, expect] of [['/login', 200], ['/offline', 200], ['/manifest.webmanifest', 200], ['/sw.js', 200]]) {
      const r = await fetch(WEB + p, { redirect: 'manual' }); check(`web GET ${p}`, r.status === expect, String(r.status));
    }
    const r = await fetch(WEB + '/dashboard/founder', { redirect: 'manual' }); check('web protected route redirects unauthenticated to /login', [302, 307, 308].includes(r.status) && (r.headers.get('location') ?? '').includes('/login'), `${r.status} ${r.headers.get('location')}`);
    const l = await fetch(WEB + '/login'); const csp = l.headers.get('content-security-policy') ?? '';
    check('web sends CSP with nonce + security headers', /nonce-/.test(csp) && l.headers.get('x-content-type-options') === 'nosniff', csp.slice(0, 60));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
