import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CSRF_HEADER } from '@salesos/shared-types';
import { TEST_PASSWORD, type TestUser } from './factory';

export const API = '/api/v1';
const ORIGIN = 'http://localhost:3100';

type Agent = ReturnType<typeof request.agent>;

/** supertest agent that keeps the session cookie and automatically sends the CSRF header + allowed Origin. */
export class AuthedAgent {
  csrfToken = '';
  constructor(
    readonly agent: Agent,
    readonly user: TestUser,
  ) {}

  get(path: string) { return this.agent.get(API + path); }
  post(path: string) { return this.agent.post(API + path).set(CSRF_HEADER, this.csrfToken).set('Origin', ORIGIN); }
  patch(path: string) { return this.agent.patch(API + path).set(CSRF_HEADER, this.csrfToken).set('Origin', ORIGIN); }
  put(path: string) { return this.agent.put(API + path).set(CSRF_HEADER, this.csrfToken).set('Origin', ORIGIN); }
  delete(path: string) { return this.agent.delete(API + path).set(CSRF_HEADER, this.csrfToken).set('Origin', ORIGIN); }
  /** Unsafe call WITHOUT csrf header (to test the protection). */
  postNoCsrf(path: string) { return this.agent.post(API + path); }
}

/** Logs in via the real endpoint; throws with the response body when it fails. */
export async function loginAgent(app: INestApplication, user: Pick<TestUser, 'email'> & { password?: string }, password = user.password ?? TEST_PASSWORD) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post(`${API}/auth/login`).set('Origin', ORIGIN).send({ email: user.email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
  const a = new AuthedAgent(agent, user as TestUser);
  a.csrfToken = res.body.data.csrfToken;
  return a;
}

/** Cookie-less client for unauthenticated calls. */
export const anonymous = (app: INestApplication) => ({
  get: (p: string) => request(app.getHttpServer()).get(API + p),
  post: (p: string) => request(app.getHttpServer()).post(API + p).set('Origin', ORIGIN),
  patch: (p: string) => request(app.getHttpServer()).patch(API + p).set('Origin', ORIGIN),
  put: (p: string) => request(app.getHttpServer()).put(API + p).set('Origin', ORIGIN),
  delete: (p: string) => request(app.getHttpServer()).delete(API + p).set('Origin', ORIGIN),
});

/** Latest outbox email for a recipient; use it to fish out reset/invite tokens in tests. */
export async function latestEmailToken(prisma: import('@prisma/client').PrismaClient, to: string): Promise<string> {
  const events = await prisma.outboxEvent.findMany({ where: { eventType: 'notification.email.requested' }, orderBy: { createdAt: 'desc' }, take: 50 });
  const ev = events.find((e) => (e.payload as { to?: string }).to === to);
  if (!ev) throw new Error(`No email outbox event for ${to}`);
  const link = (ev.payload as { variables: { link: string } }).variables.link;
  return new URL(link).searchParams.get('token')!;
}
