import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  ProviderRegistry, backoffMs, buildIcs, canTransition, decryptSecret, enqueueDelivery, loadEncryptionKey, processDueDeliveries, signWebhook, transitionDelivery, verifyWebhook,
} from '@salesos/platform-core';
import { buildOrgFixture, createOrg, createTestApp, createUser, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

let t: TestApp;
let fx: OrgFixture;
let admin: AuthedAgent;
let exec: AuthedAgent;
const SECRET = `whsec_${randomUUID()}`;
const TEL_SECRET = `tel_${randomUUID()}`;
const ORG_B_SECRET = `orgb_${randomUUID()}`;
const KEY = loadEncryptionKey();
const registry = new ProviderRegistry();

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  admin = await loginAgent(t.app, fx.admin);
  exec = await loginAgent(t.app, fx.execA1);
  const r = await admin.patch('/integrations/sandbox-email').send({ enabled: true, webhookSecret: SECRET, secret: 'sk_live_SUPERSECRETVALUE_1234' });
  expect(r.status).toBe(200);
});
afterAll(async () => { await t.close(); });

const enqueue = (over: Partial<Parameters<typeof enqueueDelivery>[1]> = {}) =>
  enqueueDelivery(t.prisma, { organizationId: fx.org.id, channel: 'EMAIL', kind: 'EMAIL', toAddress: `rcpt-${randomUUID().slice(0, 6)}@example.com`, body: 'hello', subject: 's', idempotencyKey: randomUUID(), ...over });
const statusOf = async (id: string) => (await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).status;
const processAt = (now = new Date(), extra: object = {}) => processDueDeliveries(t.prisma, { registry, key: KEY, now, limit: 100, ...extra });
const webhook = (body: object, opts: { secret?: string; ts?: number; raw?: string; header?: string | null; provider?: string } = {}) => {
  const raw = opts.raw ?? JSON.stringify(body);
  const header = opts.header === null ? undefined : (opts.header ?? signWebhook(opts.secret ?? SECRET, raw, opts.ts));
  const r = request(t.app.getHttpServer()).post(`/api/v1/integrations/webhooks/${opts.provider ?? 'sandbox-email'}`).set('content-type', 'application/json');
  if (header) r.set('x-signature', header);
  return r.send(raw);
};

describe('delivery state machine', () => {
  it('never reaches DELIVERED without a provider callback source', () => {
    const states = ['QUEUED', 'SENT', 'FAILED', 'DEAD_LETTER', 'SUPPRESSED', 'CANCELLED', 'DELIVERED'] as const;
    const sources = ['WORKER', 'ADMIN', 'SYSTEM', 'PROVIDER_CALLBACK'] as const;
    for (const from of states) for (const src of sources) {
      const ok = canTransition(from, 'DELIVERED', src);
      expect(ok).toBe(from === 'SENT' && src === 'PROVIDER_CALLBACK');
    }
    expect(canTransition('QUEUED', 'SENT', 'PROVIDER_CALLBACK')).toBe(false);
    expect(canTransition('DELIVERED', 'QUEUED', 'ADMIN')).toBe(false);
  });

  it('transitionDelivery refuses an illegal jump and records every legal one', async () => {
    const d = await enqueue();
    await expect(transitionDelivery(t.prisma, d.id, 'QUEUED', 'DELIVERED', 'PROVIDER_CALLBACK')).rejects.toThrow(/Illegal/);
    await expect(transitionDelivery(t.prisma, d.id, 'QUEUED', 'DELIVERED', 'WORKER')).rejects.toThrow(/Illegal/);
    expect(await statusOf(d.id)).toBe('QUEUED');
  });

  it('worker success = SENT (accepted), never DELIVERED; reference + history recorded', async () => {
    const d = await enqueue();
    const r = await processAt();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const row = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    expect(row.status).toBe('SENT');
    expect(row.providerReference).toMatch(/^sbx_/);
    expect(row.deliveredAt).toBeNull();
    expect(row.events.map((e) => e.toStatus)).toEqual(['QUEUED', 'SENT']);
    const view = await admin.get(`/integrations/deliveries/${d.id}`);
    expect(view.body.data.statusLabel).toMatch(/not confirmed delivered/);
  });

  it('retries with exponential backoff, then dead-letters; admin sees it and recovers it', async () => {
    const d = await enqueue({ body: 'x [[sandbox:fail]]', maxAttempts: 3 });
    const dead: string[] = [];
    const t0 = new Date();
    await processAt(t0, { onDeadLetter: async (x: { id: string }) => { dead.push(x.id); } });
    let row = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect([row.status, row.attempts, row.errorCode]).toEqual(['QUEUED', 1, 'SANDBOX_TEMPORARY_FAILURE']);
    expect(row.nextAttemptAt.getTime() - t0.getTime()).toBeGreaterThanOrEqual(backoffMs(1) - 5);
    // not due yet -> untouched
    await processAt(new Date(t0.getTime() + 1000), { onDeadLetter: async (x: { id: string }) => { dead.push(x.id); } });
    expect((await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).attempts).toBe(1);
    await processAt(new Date(t0.getTime() + backoffMs(1) + 1000), { onDeadLetter: async (x: { id: string }) => { dead.push(x.id); } });
    row = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect([row.status, row.attempts]).toEqual(['QUEUED', 2]);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(t0.getTime() + backoffMs(1) + backoffMs(2) - 2000);
    await processAt(new Date(t0.getTime() + backoffMs(1) + backoffMs(2) + 5000), { onDeadLetter: async (x: { id: string }) => { dead.push(x.id); } });
    row = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect([row.status, row.attempts]).toEqual(['DEAD_LETTER', 3]);
    expect(dead).toEqual([d.id]);

    // visible
    const failures = await admin.get('/integrations/failures');
    expect(failures.body.data.deliveries.some((x: { id: string; recoverable: boolean }) => x.id === d.id && x.recoverable)).toBe(true);
    expect((await admin.get('/integrations/health')).body.data.deadLetters).toBeGreaterThanOrEqual(1);
    const list = await admin.get('/integrations/deliveries?status=DEAD_LETTER');
    expect(list.body.data.some((x: { id: string }) => x.id === d.id)).toBe(true);

    // recoverable: fix the cause (the marker), retry from the admin API, worker picks it up
    await t.prisma.notificationDelivery.update({ where: { id: d.id }, data: { body: 'fixed body' } });
    const retry = await admin.post(`/integrations/deliveries/${d.id}/retry`).send({});
    expect(retry.status).toBe(201);
    expect(retry.body.data.status).toBe('QUEUED');
    expect(retry.body.data.events.at(-1).source).toBe('ADMIN');
    await processAt();
    expect(await statusOf(d.id)).toBe('SENT');
    expect((await admin.post(`/integrations/deliveries/${d.id}/retry`).send({})).status).toBe(409);
    expect(await t.prisma.auditLog.count({ where: { action: 'delivery.requeued', entityId: d.id } })).toBe(1);
  });

  it('permanent provider rejection dead-letters immediately (no pointless retries)', async () => {
    const d = await enqueue({ body: '[[sandbox:permanent]]' });
    await processAt();
    const row = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect([row.status, row.attempts]).toEqual(['DEAD_LETTER', 1]);
  });

  it('blocked real providers fail closed with PROVIDER_BLOCKED (DEC-013) and cannot be enabled', async () => {
    const res = await admin.patch('/integrations/resend').send({ enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROVIDER_BLOCKED');
    expect((await admin.patch('/integrations/sandbox-email').send({ mode: 'LIVE' })).status).toBe(409);
    const list = await admin.get('/integrations');
    const resend = list.body.data.find((p: { provider: string }) => p.provider === 'resend');
    expect(resend.status).toBe('BLOCKED');
    expect(resend.blockedReason).toMatch(/DEC-013/);
  });

  it('a crashed worker lease expires: claimed rows become claimable again', async () => {
    const d = await enqueue();
    // simulate claim without send: lease 10 min in the future
    const t0 = new Date();
    await t.prisma.notificationDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date(t0.getTime() + 5 * 60_000) } });
    await processAt(t0);
    expect(await statusOf(d.id)).toBe('QUEUED');
    await processAt(new Date(t0.getTime() + 6 * 60_000));
    expect(await statusOf(d.id)).toBe('SENT');
  });
});

describe('admin test message + simulated outage (journey 15 rehearsal)', () => {
  it('test message goes through the queue; a simulated outage dead-letters it; turning the outage off and retrying recovers it (SENT, not DELIVERED)', async () => {
    expect((await admin.patch('/integrations/sandbox-email').send({ settings: { simulateOutage: true } })).status).toBe(200);
    const sent = await admin.post('/integrations/sandbox-email/test').send({ to: 'qa@example.com', body: 'hello from admin' });
    expect(sent.status).toBe(201);
    const id = sent.body.data.id as string;
    expect(sent.body.data.status).toBe('QUEUED');
    await t.prisma.notificationDelivery.update({ where: { id }, data: { maxAttempts: 2 } });
    const t0 = new Date();
    await processAt(t0);
    await processAt(new Date(t0.getTime() + backoffMs(1) + 1000));
    const dead = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    expect([dead.status, dead.errorCode]).toEqual(['DEAD_LETTER', 'SANDBOX_SIMULATED_OUTAGE']);
    expect((await admin.get('/integrations/failures')).body.data.deliveries.some((x: { id: string }) => x.id === id)).toBe(true);
    await admin.patch('/integrations/sandbox-email').send({ settings: { simulateOutage: false } });
    expect((await admin.post(`/integrations/deliveries/${id}/retry`).send({})).status).toBe(201);
    await processAt();
    const row = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    expect([row.status, row.deliveredAt]).toEqual(['SENT', null]);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'integration.test_sent', entityId: id } })).toBe(1);
  });
  it('test sends need an enabled, non-blocked, non-telephony integration and the integrations permission', async () => {
    expect((await admin.post('/integrations/resend/test').send({ to: 'a@b.co', body: 'x' })).status).toBe(409);
    expect((await admin.post('/integrations/sandbox-whatsapp/test').send({ to: '+911234567890', body: 'x' })).status).toBe(409); // not enabled
    expect((await admin.post('/integrations/nope/test').send({ to: 'a@b.co', body: 'x' })).status).toBe(404);
    expect((await exec.post('/integrations/sandbox-email/test').send({ to: 'a@b.co', body: 'x' })).status).toBe(403);
  });
});

describe('suppression: configuration, consent, opt-out', () => {
  it('suppresses (visibly) when the channel is not configured or has no address', async () => {
    const other = await createOrg(t.prisma);
    const a = await enqueueDelivery(t.prisma, { organizationId: other.id, channel: 'SMS', kind: 'SMS', toAddress: '+911234567890', body: 'x', idempotencyKey: randomUUID() });
    expect(a.status).toBe('SUPPRESSED');
    expect((await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: a.id } })).errorCode).toBe('CHANNEL_NOT_CONFIGURED');
    const b = await enqueue({ toAddress: null });
    expect(b.status).toBe('SUPPRESSED');
  });

  it('external recipients need consent; opt-out wins; consent API is audited', async () => {
    const addr = `lead-${randomUUID().slice(0, 6)}@example.com`;
    expect((await enqueue({ toAddress: addr, requireConsent: true })).status).toBe('SUPPRESSED');
    expect((await t.prisma.notificationDelivery.findFirstOrThrow({ where: { toAddress: addr } })).errorCode).toBe('NO_CONSENT');
    const optIn = await admin.agent.put('/api/v1/integrations/consent').set('x-csrf-token', admin.csrfToken).set('Origin', 'http://localhost:3100').send({ channel: 'EMAIL', address: addr.toUpperCase(), status: 'OPTED_IN', source: 'form' });
    expect(optIn.status).toBe(200);
    const ok = await enqueue({ toAddress: addr, requireConsent: true });
    expect(ok.status).toBe('QUEUED');
    await admin.agent.put('/api/v1/integrations/consent').set('x-csrf-token', admin.csrfToken).set('Origin', 'http://localhost:3100').send({ channel: 'EMAIL', address: addr, status: 'OPTED_OUT', source: 'reply STOP' });
    const out = await enqueue({ toAddress: addr, requireConsent: true });
    expect(out.status).toBe('SUPPRESSED');
    expect((await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: out.id } })).errorCode).toBe('OPTED_OUT');
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'consent.recorded' } })).toBe(2);
  });

  it('idempotent enqueue: same key creates one delivery', async () => {
    const key = randomUUID();
    const a = await enqueue({ idempotencyKey: key });
    const b = await enqueue({ idempotencyKey: key });
    expect([a.created, b.created, a.id === b.id]).toEqual([true, false, true]);
  });

  it('calendar delivery carries a valid ICS body; invalid events are suppressed', async () => {
    await admin.patch('/integrations/sandbox-calendar').send({ enabled: true });
    const ok = await enqueue({ channel: 'CALENDAR', kind: 'CALENDAR', subject: 'Call; with, lead', body: 'Line1\nLine2', calendar: { startsAt: '2026-11-02T10:00:00Z' } });
    const row = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: ok.id } });
    expect(row.body).toContain('BEGIN:VCALENDAR');
    expect(row.body).toContain('DTSTART:20261102T100000Z');
    expect(row.body).toContain('SUMMARY:Call\\; with\\, lead');
    expect(row.body).toContain('\r\n');
    const bad = await enqueue({ channel: 'CALENDAR', kind: 'CALENDAR', calendar: { startsAt: 'not-a-date' } });
    expect(bad.status).toBe('SUPPRESSED');
    const ics = buildIcs({ uid: 'u1', title: 'A'.repeat(200) + ' ünï; x,y', startsAt: new Date('2026-01-01T00:00:00Z') });
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(ics).toContain('SUMMARY:');
  });
});

describe('webhooks: signature, tolerance, replay', () => {
  it('unit: verifyWebhook rejects missing/malformed/stale/mismatched, accepts valid', () => {
    const body = '{"a":1}';
    const now = 1_800_000_000;
    expect(verifyWebhook('s', body, undefined, { nowSeconds: now })).toEqual({ ok: false, reason: 'MISSING' });
    expect(verifyWebhook('s', body, 'garbage', { nowSeconds: now })).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifyWebhook('s', body, signWebhook('s', body, now - 301), { nowSeconds: now })).toEqual({ ok: false, reason: 'STALE' });
    expect(verifyWebhook('s', body, signWebhook('s', body, now + 301), { nowSeconds: now })).toEqual({ ok: false, reason: 'STALE' });
    expect(verifyWebhook('other', body, signWebhook('s', body, now), { nowSeconds: now })).toEqual({ ok: false, reason: 'MISMATCH' });
    expect(verifyWebhook('s', body + ' ', signWebhook('s', body, now), { nowSeconds: now })).toEqual({ ok: false, reason: 'MISMATCH' });
    expect(verifyWebhook('s', body, signWebhook('s', body, now), { nowSeconds: now })).toEqual({ ok: true });
  });

  it('provider callback is the ONLY path to DELIVERED', async () => {
    const d = await enqueue();
    // callback for a still-QUEUED delivery must not skip SENT
    await t.prisma.notificationDelivery.update({ where: { id: d.id }, data: { providerReference: 'early-ref', provider: 'sandbox-email' } });
    const early = await webhook({ id: `evt-${randomUUID()}`, type: 'delivery.status', data: { reference: 'early-ref', status: 'delivered' } });
    expect(early.status).toBe(200);
    expect(early.body.data.outcome).toBe('IGNORED_STATE');
    expect(await statusOf(d.id)).toBe('QUEUED');

    await processAt();
    const sent = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(sent.status).toBe('SENT');
    const ok = await webhook({ id: `evt-${randomUUID()}`, type: 'delivery.status', data: { reference: sent.providerReference, status: 'delivered' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ accepted: true, duplicate: false, outcome: 'APPLIED' });
    const done = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    expect(done.status).toBe('DELIVERED');
    expect(done.deliveredAt).not.toBeNull();
    expect(done.events.map((e) => `${e.toStatus}:${e.source}`)).toEqual(['QUEUED:SYSTEM', 'SENT:WORKER', 'DELIVERED:PROVIDER_CALLBACK']);
  });

  it('provider failure callback moves SENT -> FAILED with the provider error code (visible for retry)', async () => {
    const d = await enqueue();
    await processAt();
    const sent = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    const res = await webhook({ id: `evt-${randomUUID()}`, type: 'delivery.status', data: { reference: sent.providerReference, status: 'bounced', errorCode: 'MAILBOX_FULL' } });
    expect(res.body.data.outcome).toBe('APPLIED');
    const row = await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect([row.status, row.errorCode]).toEqual(['FAILED', 'MAILBOX_FULL']);
    expect((await admin.post(`/integrations/deliveries/${d.id}/retry`).send({})).status).toBe(201);
  });

  it('forged / tampered / stale / unsigned / wrong-provider requests are rejected with 401 and change nothing', async () => {
    const d = await enqueue();
    await processAt();
    const ref = (await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).providerReference;
    const body = { id: `evt-${randomUUID()}`, type: 'delivery.status', data: { reference: ref, status: 'delivered' } };
    const raw = JSON.stringify(body);
    const cases: Array<[string, () => request.Test]> = [
      ['wrong secret', () => webhook(body, { secret: 'attacker-secret-attacker' })],
      ['no signature', () => webhook(body, { header: null })],
      ['stale timestamp', () => webhook(body, { ts: Math.floor(Date.now() / 1000) - 3600 })],
      ['tampered body', () => webhook(body, { raw: raw.replace('delivered', 'failed'), header: signWebhook(SECRET, raw) })],
      ['malformed header', () => webhook(body, { header: 't=abc,v1=zz' })],
      ['unknown provider', () => webhook(body, { provider: 'does-not-exist' })],
    ];
    for (const [name, p] of cases) {
      const res = await p();
      expect(res.status, name).toBe(401);
      expect(res.body.error.code, name).toBe('INVALID_SIGNATURE');
    }
    expect(await statusOf(d.id)).toBe('SENT');
    expect(await t.prisma.webhookEvent.count({ where: { eventId: body.id } })).toBe(0);
  });

  it('replay: identical event is a no-op (duplicate), same id with another payload is 409; stored once', async () => {
    const d = await enqueue();
    await processAt();
    const ref = (await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).providerReference;
    const id = `evt-${randomUUID()}`;
    const body = { id, type: 'delivery.status', data: { reference: ref, status: 'delivered' } };
    const first = await webhook(body);
    expect(first.body.data.outcome).toBe('APPLIED');
    const evCount = await t.prisma.notificationDeliveryEvent.count({ where: { deliveryId: d.id } });
    const again = await webhook(body);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ accepted: false, duplicate: true });
    const tamper = await webhook({ ...body, data: { reference: ref, status: 'failed' } });
    expect(tamper.status).toBe(409);
    expect(tamper.body.error.code).toBe('REPLAY_MISMATCH');
    expect(await t.prisma.notificationDeliveryEvent.count({ where: { deliveryId: d.id } })).toBe(evCount);
    expect(await statusOf(d.id)).toBe('DELIVERED');
    expect(await t.prisma.webhookEvent.count({ where: { provider: 'sandbox-email', eventId: id } })).toBe(1);
  });

  it('a secret from another organisation cannot affect this organisation (tenant isolation)', async () => {
    const orgB = await createOrg(t.prisma);
    const adminB = await loginAgent(t.app, await createUser(t.prisma, orgB, { roles: ['ADMIN'] }));
    await adminB.patch('/integrations/sandbox-email').send({ enabled: true, webhookSecret: ORG_B_SECRET });
    const d = await enqueue();
    await processAt();
    const ref = (await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).providerReference;
    const res = await webhook({ id: `evt-${randomUUID()}`, type: 'delivery.status', data: { reference: ref, status: 'delivered' } }, { secret: ORG_B_SECRET });
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('IGNORED_UNKNOWN_REFERENCE'); // org B's secret verified, but the reference belongs to org A
    expect(await statusOf(d.id)).toBe('SENT');
  });

  it('opt-out callback records consent withdrawal', async () => {
    const addr = `stop-${randomUUID().slice(0, 6)}@example.com`;
    const d = await enqueue({ toAddress: addr });
    await processAt();
    const ref = (await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).providerReference;
    await webhook({ id: `evt-${randomUUID()}`, type: 'delivery.status', data: { reference: ref, status: 'opted_out' } });
    expect((await enqueue({ toAddress: addr })).status).toBe('SUPPRESSED');
  });

  it('invalid payload with a valid signature is a 400 and the event id is not burned', async () => {
    const id = `evt-${randomUUID()}`;
    const res = await webhook({ id, type: 'delivery.status', data: { reference: 5 } });
    expect(res.status).toBe(400);
    expect(await t.prisma.webhookEvent.count({ where: { eventId: id } })).toBe(0);
  });
});

describe('telephony webhook -> provider-verified call events (source PROVIDER)', () => {
  beforeAll(async () => {
    expect((await admin.patch('/integrations/sandbox-telephony').send({ enabled: true, webhookSecret: TEL_SECRET })).status).toBe(200);
  });
  const call = (body: object, secret = TEL_SECRET) => {
    const raw = JSON.stringify(body);
    return request(t.app.getHttpServer()).post('/api/v1/integrations/telephony/webhook').set('content-type', 'application/json').set('x-signature', signWebhook(secret, raw)).set('x-provider', 'sandbox-telephony').send(raw);
  };
  it('stores a PROVIDER call event once, publishes an outbox event, links the agent by email', async () => {
    const callId = `call-${randomUUID()}`;
    const body = { id: `evt-${randomUUID()}`, type: 'call.event', data: { callId, direction: 'OUTBOUND', status: 'COMPLETED', from: '+911111111111', to: '+912222222222', agentEmail: fx.execA1.email, startedAt: '2026-10-15T09:00:00Z', durationSec: 95 } };
    expect((await call(body)).body.data.outcome).toBe('APPLIED');
    expect((await call(body)).body.data.duplicate).toBe(true);
    const rows = await t.prisma.providerCallEvent.findMany({ where: { providerCallId: callId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'PROVIDER', userId: fx.execA1.id, durationSec: 95, organizationId: fx.org.id });
    expect(await t.prisma.outboxEvent.count({ where: { eventType: 'call.provider_event.received', aggregateId: rows[0]!.id } })).toBe(1);
    // a later status update of the same call updates the row, not a second one
    await call({ id: `evt-${randomUUID()}`, type: 'call.event', data: { callId, direction: 'OUTBOUND', status: 'COMPLETED', durationSec: 100 } });
    expect(await t.prisma.providerCallEvent.count({ where: { providerCallId: callId } })).toBe(1);
  });
  it('telephony route only accepts call events and rejects forged signatures', async () => {
    const forged = await call({ id: 'x', type: 'call.event', data: {} }, 'wrong-secret-wrong-secret');
    expect(forged.status).toBe(401);
    const delivery = await call({ id: `evt-${randomUUID()}`, type: 'delivery.status', data: { reference: 'r', status: 'delivered' } });
    expect(delivery.body.data.outcome).toBe('IGNORED_UNKNOWN_TYPE');
  });
});

describe('integration secrets are never returned', () => {
  it('no API response contains secret material; DB holds AES-GCM ciphertext; audit records field names only', async () => {
    const secret = 'sk_live_SUPERSECRETVALUE_1234';
    const outputs = [
      JSON.stringify((await admin.get('/integrations')).body),
      JSON.stringify((await admin.get('/integrations/health')).body),
      JSON.stringify((await admin.patch('/integrations/sandbox-email').send({ secret, webhookSecret: SECRET })).body),
      JSON.stringify((await admin.post('/integrations/sandbox-email/health').send({})).body),
    ];
    for (const o of outputs) {
      expect(o).not.toContain(secret);
      expect(o).not.toContain(SECRET);
      expect(o).not.toMatch(/secretCipher|webhookSecretCipher|v1:[A-Za-z0-9+/=]+:/);
    }
    const row = await t.prisma.integrationConfig.findFirstOrThrow({ where: { organizationId: fx.org.id, provider: 'sandbox-email' } });
    expect(row.secretCipher).toMatch(/^v1:/);
    expect(row.secretCipher).not.toContain(secret);
    expect(decryptSecret(row.secretCipher!, KEY)).toBe(secret);
    const view = (await admin.get('/integrations')).body.data.find((p: { provider: string }) => p.provider === 'sandbox-email');
    expect(view).toMatchObject({ hasSecret: true, hasWebhookSecret: true });
    const audits = await t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, action: 'integration.updated' } });
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain(secret);
    // secret-looking keys in plain settings are refused
    expect((await admin.patch('/integrations/sandbox-email').send({ settings: { apiKey: 'abc' } })).status).toBe(400);
  });

  it('tampered ciphertext fails authentication (GCM)', () => {
    const row = 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA';
    expect(() => decryptSecret(row, KEY)).toThrow();
  });

  it('health check records status; executives cannot reach any integration endpoint', async () => {
    const h = await admin.post('/integrations/sandbox-email/health').send({});
    expect(h.body.data.lastHealthStatus).toBe('OK');
    expect((await admin.post('/integrations/resend/health').send({})).body.data.lastHealthStatus).toBe('DOWN');
    expect((await exec.get('/integrations')).status).toBe(403);
    expect((await exec.get('/integrations/deliveries')).status).toBe(403);
  });
});
