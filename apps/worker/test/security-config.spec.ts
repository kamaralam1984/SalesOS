import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/config';

describe('worker production configuration (Phase 10 security)', () => {
  it('refuses the development database password in production, accepts a real credential, and leaves dev/test alone', () => {
    const dev = 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos';
    expect(() => loadWorkerEnv({ NODE_ENV: 'production', DATABASE_URL: dev } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => loadWorkerEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://app:@db/salesos' } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => loadWorkerEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://salesos_app:Xk9vR2mQ7tLp4sWz1cBn6Yd@db.internal:5432/salesos' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => loadWorkerEnv({ NODE_ENV: 'development', DATABASE_URL: dev } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
