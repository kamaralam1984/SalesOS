import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { REDACT_PATHS } from '../src/common/logging/logger.module';

describe('structured logging redaction', () => {
  it('redacts cookies, authorization, passwords, tokens and email links', () => {
    const lines: string[] = [];
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, { write: (s: string) => void lines.push(s) });
    log.info({
      req: { headers: { cookie: 'salesos_session=SECRET', authorization: 'Bearer SECRET', 'x-csrf-token': 'SECRET' } },
      res: { headers: { 'set-cookie': ['salesos_session=SECRET'] } },
      body: { password: 'SECRET', token: 'SECRET' },
      payload: { variables: { link: 'https://x/reset?token=SECRET' } },
      password: 'SECRET',
      token: 'SECRET',
    });
    expect(lines.join('')).not.toContain('SECRET');
    expect(lines.join('')).toContain('[REDACTED]');
  });

  it('Phase 10: credentials nested two levels deep and common credential field names are redacted', () => {
    const lines: string[] = [];
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, { write: (s2: string) => void lines.push(s2) });
    log.info({
      ctx: { user: { password: 'SECRET2', token: 'SECRET2' } },
      body: { newPassword: 'SECRET2', apiKey: 'SECRET2', csrfToken: 'SECRET2', webhookSecret: 'SECRET2' },
      req: { headers: { 'x-api-key': 'SECRET2', 'x-signature': 'SECRET2', 'proxy-authorization': 'SECRET2' } },
      newPassword: 'SECRET2',
    });
    expect(lines.join('')).not.toContain('SECRET2');
  });
});
