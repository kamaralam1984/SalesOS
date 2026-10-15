import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from './helpers';

// The @Throttle limit on auth routes is read when the controller module is first imported, so this file
// sets a tiny limit BEFORE a dynamic import of the app (vitest isolates module registries per test file).
let t: TestApp;
const prev = process.env.THROTTLE_LOGIN_LIMIT;
beforeAll(async () => {
  process.env.THROTTLE_LOGIN_LIMIT = '3';
  const { createTestApp } = await import('./helpers');
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  process.env.THROTTLE_LOGIN_LIMIT = prev;
});

describe('auth route rate limiting', () => {
  it('throttles repeated login attempts per client with 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await request(t.app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3100').send({ email: 'nobody@test.salesos.local', password: 'Wrong-password-123' })).status);
    }
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3).every((c) => c === 429)).toBe(true);
  });
});
