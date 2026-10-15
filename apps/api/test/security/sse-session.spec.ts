import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createLead, crmKit, type CrmKit } from '../crm/kit';

/** SSE streams must end when the session is revoked / user deactivated, and be capped per user. */
let k: CrmKit;
let base = '';
beforeAll(async () => {
  process.env.CRM_STREAM_POLL_MS = '150';
  process.env.CRM_STREAM_MAX_PER_USER = '2';
  k = await crmKit();
  await k.app.listen(0);
  base = `http://127.0.0.1:${(k.app.getHttpServer().address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => { delete process.env.CRM_STREAM_POLL_MS; delete process.env.CRM_STREAM_MAX_PER_USER; await k.close(); });

async function login(email: string) {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3100' }, body: JSON.stringify({ email, password: 'Test-Passw0rd-Strong!' }) });
  expect(res.status).toBe(200);
  return { cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await res.json()) as { data: { csrfToken: string } }).data.csrfToken };
}
async function readUntilClosed(res: Response, ms: number): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = '';
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await Promise.race([reader.read(), new Promise<null>((r2) => setTimeout(() => r2(null), 300))]);
    if (r === null) continue;
    if (r.done) return `${out}[CLOSED]`;
    out += dec.decode(r.value);
  }
  void reader.cancel();
  return out;
}

describe('SSE hardening', () => {
  it('the stream ends within a poll interval after logout, and a revoked cookie cannot reopen it', async () => {
    await createLead(k.a.execA1);
    const s = await login(k.fx.execA1.email);
    const ctl = new AbortController();
    const res = await fetch(`${base}/stream`, { headers: { cookie: s.cookie }, signal: ctl.signal });
    expect(res.status).toBe(200);
    const closing = readUntilClosed(res, 8000);
    await new Promise((r) => setTimeout(r, 500));
    const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, origin: 'http://localhost:3100' } });
    expect(out.status).toBe(200);
    const text = await closing;
    expect(text).toContain('session-ended');
    expect(text).toContain('[CLOSED]');
    expect((await fetch(`${base}/stream`, { headers: { cookie: s.cookie } })).status).toBe(401);
    ctl.abort();
  }, 30_000);

  it('a user may hold at most CRM_STREAM_MAX_PER_USER streams (429 beyond), freed on close', async () => {
    const s = await login(k.fx.execA2.email);
    const ctls = [new AbortController(), new AbortController()];
    const open = await Promise.all(ctls.map((c) => fetch(`${base}/stream`, { headers: { cookie: s.cookie }, signal: c.signal })));
    expect(open.map((r) => r.status)).toEqual([200, 200]);
    const third = await fetch(`${base}/stream`, { headers: { cookie: s.cookie } });
    expect(third.status).toBe(429);
    ctls[0]!.abort();
    await new Promise((r) => setTimeout(r, 600));
    const again = await fetch(`${base}/stream`, { headers: { cookie: s.cookie } });
    expect(again.status).toBe(200);
    void again.body?.cancel();
    ctls[1]!.abort();
  }, 30_000);
});
