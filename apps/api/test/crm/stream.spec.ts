import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createLead, crmKit, future, type CrmKit } from './kit';

let k: CrmKit;
let base = '';
beforeAll(async () => {
  process.env.CRM_STREAM_POLL_MS = '150';
  k = await crmKit();
  await k.app.listen(0);
  base = `http://127.0.0.1:${(k.app.getHttpServer().address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => {
  delete process.env.CRM_STREAM_POLL_MS;
  await k.close();
});

async function cookieFor(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3100' }, body: JSON.stringify({ email, password: 'Test-Passw0rd-Strong!' }) });
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

interface Collected { events: { event: string; data: Record<string, unknown> & { id?: string; status?: string; title?: string; leadId?: string }; id?: string }[]; stop: () => void; status: number; contentType: string | null; done: Promise<void> }
/** Opens the SSE stream and collects parsed events until stop() is called. */
async function open(cookie: string, qs = '', headers: Record<string, string> = {}): Promise<Collected> {
  const ctl = new AbortController();
  const res = await fetch(`${base}/stream${qs}`, { headers: { cookie, ...headers }, signal: ctl.signal });
  const events: Collected['events'] = [];
  const out: Collected = { events, stop: () => ctl.abort(), status: res.status, contentType: res.headers.get('content-type'), done: Promise.resolve() };
  if (!res.body) return out;
  out.done = (async () => {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          const id = /^id: (.*)$/m.exec(block)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data), id });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return out;
}
const until = async (fn: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout waiting for stream event');
};

describe('SSE live updates (scope filtered) + polling fallback', () => {
  it('requires a session and speaks text/event-stream', async () => {
    expect((await fetch(`${base}/stream`)).status).toBe(401);
    const c = await open(await cookieFor(k.fx.execA1.email));
    expect(c.status).toBe(200);
    expect(c.contentType).toMatch(/text\/event-stream/);
    await until(() => c.events.some((e) => e.event === 'ready'));
    c.stop();
    await c.done;
  });

  it('delivers task changes only for records in the caller\'s scope; peers and other teams see nothing of them', async () => {
    const [cA1, cA2, cMgrA, cMgrB, cFounder] = await Promise.all([k.fx.execA1, k.fx.execA2, k.fx.managerA, k.fx.managerB, k.fx.founder].map(async (u) => open(await cookieFor(u.email))));
    await until(() => [cA1, cA2, cMgrA, cMgrB, cFounder].every((c) => c.events.some((e) => e.event === 'ready')));
    const all = [cA1, cA2, cMgrA, cMgrB, cFounder];
    try {
    const lead = await createLead(k.a.execA1);
    const mine = await k.a.execA1.post(`/leads/${lead.id}/tasks`).send({ title: 'STREAM-SECRET-A1', dueAt: future(30) });
    const taskId = mine.body.data.id as string;
    const tasksOf = (c: Collected) => c.events.filter((e) => e.event === 'task').map((e) => e.data.id);
    await until(() => tasksOf(cA1).includes(taskId) && tasksOf(cMgrA).includes(taskId) && tasksOf(cFounder).includes(taskId));
    await new Promise((r) => setTimeout(r, 600)); // give the out-of-scope streams several polls
    expect(tasksOf(cA2)).not.toContain(taskId); // peer executive
    expect(tasksOf(cMgrB)).not.toContain(taskId); // sibling manager
    expect(JSON.stringify(cA2.events)).not.toContain('STREAM-SECRET-A1');
    expect(JSON.stringify(cMgrB.events)).not.toContain('STREAM-SECRET-A1');
    // completion is streamed too
    await k.a.execA1.post(`/tasks/${taskId}/complete`).send({});
    await until(() => cA1.events.some((e) => e.event === 'task' && e.data.id === taskId && e.data.status === 'DONE'));
    } finally {
      for (const c of all) c.stop();
      await Promise.all(all.map((c) => c.done));
    }
  });

  it('in-app notifications are delivered to their recipient only', async () => {
    const [c1, c2] = await Promise.all([k.fx.execA1, k.fx.execB1].map(async (u) => open(await cookieFor(u.email))));
    await until(() => c1.events.some((e) => e.event === 'ready') && c2.events.some((e) => e.event === 'ready'));
    await k.t.prisma.notification.create({ data: { organizationId: k.fx.org.id, userId: k.fx.execA1.id, type: 'follow_up.due', title: 'ONLY-FOR-A1', dedupeKey: `s-${Math.random()}` } });
    await until(() => c1.events.some((e) => e.event === 'notification' && e.data.title === 'ONLY-FOR-A1'));
    await new Promise((r) => setTimeout(r, 500));
    expect(JSON.stringify(c2.events)).not.toContain('ONLY-FOR-A1');
    const list = await k.a.execA1.get('/crm-notifications');
    expect(list.body.data.unread).toBeGreaterThanOrEqual(1);
    const id = list.body.data.items.find((n: { title: string }) => n.title === 'ONLY-FOR-A1').id;
    expect((await k.a.execB1.post(`/crm-notifications/${id}/read`).send({})).body.data.updated).toBe(0); // cannot mark someone else's
    expect((await k.a.execA1.post(`/crm-notifications/${id}/read`).send({})).body.data.updated).toBe(1);
    expect((await k.t.prisma.notification.findUniqueOrThrow({ where: { id } })).status).toBe('READ');
    c1.stop();
    c2.stop();
    await Promise.all([c1.done, c2.done]);
  });

  it('exception counts are scoped (manager of another team does not learn about this team)', async () => {
    const l = (await k.a.managerA.post('/leads').send({ fullName: '[TEST] stream unowned', phone: '9876500011' })).body.data.lead;
    expect(l.id).toBeTruthy();
    const pollA = await k.a.managerA.get('/stream/poll?since=2020-01-01T00:00:00Z');
    const pollB = await k.a.managerB.get('/stream/poll?since=2020-01-01T00:00:00Z');
    const countA = pollA.body.data.events.find((e: { type: string }) => e.type === 'exceptions').data.openCount;
    const countB = pollB.body.data.events.find((e: { type: string }) => e.type === 'exceptions').data.openCount;
    expect(countA).toBeGreaterThan(countB);
    expect(pollB.body.data.events.some((e: { type: string; data: { leadId: string } }) => e.type === 'task' && e.data.leadId === l.id)).toBe(false);
  });

  it('polling fallback returns scoped changes since a cursor and a new cursor to continue from', async () => {
    const lead = await createLead(k.a.execA2);
    const first = await k.a.execA2.get('/stream/poll?since=2020-01-01T00:00:00Z');
    expect(first.status).toBe(200);
    const cursor = first.body.data.cursor as string;
    expect(first.body.data.events.some((e: { type: string; data: { leadId: string } }) => e.type === 'task' && e.data.leadId === lead.id)).toBe(true);
    const t = await k.a.execA2.post(`/leads/${lead.id}/tasks`).send({ title: 'after cursor', dueAt: future(40) });
    const next = await k.a.execA2.get(`/stream/poll?since=${encodeURIComponent(cursor)}`);
    const ids = next.body.data.events.filter((e: { type: string }) => e.type === 'task').map((e: { data: { id: string } }) => e.data.id);
    expect(ids).toContain(t.body.data.id);
    // the cursor looks back a few seconds (commit visibility), so recent neighbours may repeat; consumers de-duplicate by id@updatedAt
    expect(next.body.data.events.filter((e: { type: string; data: { assignedToId: string } }) => e.type === 'task').every((e: { data: { assignedToId: string } }) => e.data.assignedToId === k.fx.execA2.id)).toBe(true);
    const peer = await k.a.execA1.get(`/stream/poll?since=${encodeURIComponent(cursor)}`);
    expect(peer.body.data.events.filter((e: { type: string; data: { leadId: string } }) => e.type === 'task' && e.data.leadId === lead.id)).toHaveLength(0); // never the peer's records
    expect((await k.a.execA2.get('/stream/poll?since=not-a-date')).status).toBe(400);
  });

  it('resumes from Last-Event-ID', async () => {
    const lead = await createLead(k.a.execA1);
    const before = new Date(Date.now() - 2000).toISOString();
    const c = await open(await cookieFor(k.fx.execA1.email), '', { 'last-event-id': before });
    await until(() => c.events.some((e) => e.event === 'task' && e.data.leadId === lead.id));
    c.stop();
    await c.done;
  });
});
