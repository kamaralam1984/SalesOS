import { describe, expect, it, vi } from 'vitest';
import { createErrorReporter, parseDsn } from '../src/common/observability/error-reporter';

describe('optional Sentry-compatible error reporter', () => {
  it('is a disabled no-op without a DSN (nothing is sent)', () => {
    const f = vi.fn();
    const r = createErrorReporter({ service: 'x', fetchImpl: f as unknown as typeof fetch });
    expect(r.enabled).toBe(false);
    r.capture(new Error('boom'));
    expect(f).not.toHaveBeenCalled();
  });
  it('parses a DSN into the store endpoint and sends only error + route + request id (no headers/body/cookies)', async () => {
    expect(parseDsn('https://abc123@o1.ingest.example.io/42')?.url).toBe('https://o1.ingest.example.io/api/42/store/');
    expect(parseDsn('not a dsn')).toBeNull();
    const f = vi.fn().mockResolvedValue({ ok: true });
    const r = createErrorReporter({ dsn: 'https://abc123@o1.ingest.example.io/42', service: 'salesos-api', environment: 'staging', release: '1.0.0', fetchImpl: f as unknown as typeof fetch });
    r.capture(new Error('db exploded'), { requestId: 'req-12345678', route: '/api/v1/leads/:id', method: 'GET', status: 500 });
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://o1.ingest.example.io/api/42/store/');
    expect((init.headers as Record<string, string>)['x-sentry-auth']).toContain('sentry_key=abc123');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ environment: 'staging', release: '1.0.0', tags: { service: 'salesos-api', route: '/api/v1/leads/:id', status: '500' } });
    expect(JSON.stringify(body)).not.toMatch(/cookie|authorization|password/i);
  });
  it('never throws when the transport fails', () => {
    const r = createErrorReporter({ dsn: 'https://k@h.example/1', service: 's', fetchImpl: (() => Promise.reject(new Error('net'))) as unknown as typeof fetch });
    expect(() => r.capture(new Error('x'))).not.toThrow();
  });
});
