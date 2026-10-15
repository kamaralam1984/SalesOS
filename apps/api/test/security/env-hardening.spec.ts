import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadEnv } from '../../src/config/env';
import { storageConfigFromEnv } from '@salesos/platform-core';
import { autoDdlEnabled } from '../../src/common/prisma/auto-ddl';
import { assertSeedAllowed } from '../../src/seed/seed';

const good = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://salesos_app:Xk9vR2mQ7tLp4sWz1cBn6Yd@db.internal:5432/salesos?schema=public',
  REDIS_URL: 'redis://redis.internal:6379',
  SESSION_SECRET: randomBytes(48).toString('base64'),
  PLATFORM_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CORS_ORIGINS: 'https://sales.coacheasily.example',
  APP_BASE_URL: 'https://sales.coacheasily.example',
  THROTTLE_STORAGE: 'redis',
  S3_ENDPOINT: 'https://s3.example.com', S3_BUCKET: 'salesos-prod', S3_ACCESS_KEY: 'AKIAEXAMPLEREALKEY', S3_SECRET_KEY: randomBytes(24).toString('base64'),
});
const refuses = (over: Record<string, string | undefined>, re: RegExp) => {
  const env = { ...good(), ...over } as NodeJS.ProcessEnv;
  for (const k of Object.keys(over)) if (over[k] === undefined) delete env[k];
  expect(() => loadEnv(env)).toThrow(re);
};

describe('production environment validation refuses weak, default and development configuration', () => {
  it('accepts a sane production configuration', () => {
    const e = loadEnv(good());
    expect(e.isProd).toBe(true);
    expect(e.docsEnabled).toBe(false);
  });

  it.each([
    ['placeholder from .env.example', 'change-me-generate-with-openssl-rand-base64-48'],
    ['the test secret', 'test-session-secret-test-session-secret-0123456789'],
    ['dev word', 'dev-only-secret-dev-only-secret-dev-only-secret'],
    ['low entropy', 'a'.repeat(64)],
    ['two characters repeated', 'ab'.repeat(40)],
    ['too short', 'Sh0rt-but-random-9Zq'],
    ['contains the product name', 'salesos-Zk39sJd02kLmQ8xT7pRwEyVn5BcA1uHg'],
    ['the word password', 'Zk39sJd02kLmQ8xT7pRwEyVn5BcA1uHg-password'],
  ])('refuses SESSION_SECRET: %s', (_n, v) => refuses({ SESSION_SECRET: v }, /SESSION_SECRET/));

  it.each([
    ['dev password from docker-compose', 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos'],
    ['postgres/postgres', 'postgresql://postgres:postgres@db:5432/salesos'],
    ['empty password', 'postgresql://salesos@db:5432/salesos'],
    ['password is "password"', 'postgresql://app:password@db:5432/salesos'],
    ['changeme', 'postgresql://app:change-me-please@db:5432/salesos'],
  ])('refuses DATABASE_URL: %s', (_n, v) => refuses({ DATABASE_URL: v }, /DATABASE_URL/));

  it('refuses memory rate-limit counters, http origins, wildcard CORS, Swagger and a missing/weak encryption key', () => {
    refuses({ THROTTLE_STORAGE: 'memory' }, /THROTTLE_STORAGE/);
    refuses({ CORS_ORIGINS: 'http://sales.example.com' }, /https/);
    refuses({ APP_BASE_URL: 'http://localhost:3100' }, /APP_BASE_URL/);
    refuses({ CORS_ORIGINS: '*' }, /CORS_ORIGINS/);
    refuses({ CORS_ORIGINS: 'https://a.example.com,*' }, /CORS_ORIGINS/);
    refuses({ ENABLE_DOCS: 'true' }, /ENABLE_DOCS/);
    refuses({ PLATFORM_ENCRYPTION_KEY: undefined }, /PLATFORM_ENCRYPTION_KEY/);
    refuses({ PLATFORM_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }, /entropy/);
    refuses({ PLATFORM_ENCRYPTION_KEY: Buffer.from('too-short').toString('base64') }, /32 bytes/);
  });

  it('refuses development object-storage credentials and a missing object store (no silent fallback to the dev MinIO)', () => {
    refuses({ S3_SECRET_KEY: 'salesos_minio_dev_only' }, /S3_SECRET_KEY/);
    refuses({ S3_ACCESS_KEY: 'minioadmin' }, /S3_ACCESS_KEY/);
    refuses({ S3_ENDPOINT: undefined }, /S3_ENDPOINT/);
    refuses({ S3_BUCKET: undefined }, /S3_BUCKET/);
    expect(() => storageConfigFromEnv({ NODE_ENV: 'production' })).toThrow(/not configured for production/);
    expect(() => storageConfigFromEnv({ ...good(), S3_SECRET_KEY: 'salesos_minio_dev_only' })).toThrow(/Development object-storage/);
    expect(storageConfigFromEnv({ NODE_ENV: 'development' }).accessKey).toBe('salesos_minio'); // dev convenience unchanged
  });

  it('development and test keep working with the documented dev values (the refusals are production-only)', () => {
    expect(() => loadEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos', SESSION_SECRET: 'change-me-generate-with-openssl-rand-base64-48' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe('boot-time DDL is off in production unless explicitly enabled', () => {
  it('defaults', () => {
    expect(autoDdlEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(autoDdlEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
    expect(autoDdlEnabled({ NODE_ENV: 'production', DB_AUTO_DDL: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(autoDdlEnabled({ NODE_ENV: 'test', DB_AUTO_DDL: 'false' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('the demo seed (publicly documented passwords) refuses anything that looks like a real deployment', () => {
  const fake = (realOrgs: number) => ({ organization: { count: async () => realOrgs } }) as unknown as Parameters<typeof assertSeedAllowed>[0];
  it('refuses NODE_ENV=production, non-local database hosts and databases that hold real organisations', async () => {
    await expect(assertSeedAllowed(fake(0), { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x:y@127.0.0.1/db' } as NodeJS.ProcessEnv)).rejects.toThrow(/production/);
    await expect(assertSeedAllowed(fake(0), { NODE_ENV: 'development', DATABASE_URL: 'postgresql://x:y@db.prod.example.com/db' } as NodeJS.ProcessEnv)).rejects.toThrow(/non-local/);
    await expect(assertSeedAllowed(fake(2), { NODE_ENV: 'development', DATABASE_URL: 'postgresql://x:y@127.0.0.1/db' } as NodeJS.ProcessEnv)).rejects.toThrow(/non-demo organisations/);
    await expect(assertSeedAllowed(fake(0), { NODE_ENV: 'development', DATABASE_URL: 'postgresql://x:y@127.0.0.1/db' } as NodeJS.ProcessEnv)).resolves.toBeUndefined();
  });
});
