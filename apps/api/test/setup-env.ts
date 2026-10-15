// Runs in every test worker BEFORE modules load: deterministic, isolated env for the api test DB.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_test?schema=public';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6391';
process.env.SESSION_SECRET = 'test-session-secret-test-session-secret-0123456789';
process.env.CORS_ORIGINS = 'http://localhost:3100';
process.env.LOG_LEVEL = 'silent';
process.env.THROTTLE_LIMIT ??= '100000';
process.env.THROTTLE_LOGIN_LIMIT ??= '100000';
process.env.THROTTLE_STORAGE = 'memory';
process.env.LOGIN_MAX_ATTEMPTS = '5';
process.env.LOGIN_LOCKOUT_MINUTES = '15';
// Route-specific limits (rate-limits.ts) are tight by default; ordinary suites run thousands of calls from one IP.
// test/security/rate-limits.spec.ts lowers them at runtime to prove they are enforced.
for (const k of ['UPLOAD', 'IMPORT', 'EXPORT', 'AI', 'REPORT', 'DOWNLOAD', 'ADMIN_ACTION']) process.env[`THROTTLE_${k}_LIMIT`] ??= '100000';
process.env.FORGOT_PASSWORD_MIN_MS ??= '400';
