// Dedicated database: never the shared one.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.PERF_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agenti_perf?schema=public';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6391';
process.env.SESSION_SECRET = 'perf-session-secret-perf-session-secret-0123456789';
process.env.CORS_ORIGINS = 'http://localhost:3100';
process.env.LOG_LEVEL = 'silent';
process.env.THROTTLE_STORAGE = 'memory';
process.env.KPI_CACHE_TTL_SECONDS = '0';
