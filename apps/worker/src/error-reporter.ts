import { randomUUID } from 'node:crypto';

/**
 * Optional, Sentry-compatible error reporting without an SDK dependency.
 * Enabled ONLY when SENTRY_DSN is set in the environment (no DSN is ever committed). Sends the legacy "store" envelope
 * over HTTPS with a short timeout; failures are swallowed (reporting must never break a request).
 * Privacy: only error name/message/stack, release, environment, request id and route template are sent. Never request
 * bodies, headers, cookies, query strings or user identifiers.
 */
export interface ReportContext {
  requestId?: string;
  route?: string;
  method?: string;
  status?: number;
}

export interface ErrorReporter {
  readonly enabled: boolean;
  capture(err: unknown, ctx?: ReportContext): void;
}

export interface ReporterOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  service: string;
  fetchImpl?: typeof fetch;
}

export function parseDsn(dsn: string): { url: string; auth: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split('/').filter(Boolean).pop();
    if (!u.username || !projectId) return null;
    const base = u.pathname.replace(/\/[^/]*$/, '');
    return {
      url: `${u.protocol}//${u.host}${base}/api/${projectId}/store/`,
      auth: `Sentry sentry_version=7, sentry_client=salesos/1.0, sentry_key=${u.username}`,
    };
  } catch {
    return null;
  }
}

const NOOP: ErrorReporter = { enabled: false, capture: () => undefined };

export function createErrorReporter(opts: ReporterOptions): ErrorReporter {
  const target = opts.dsn ? parseDsn(opts.dsn) : null;
  if (!target) return NOOP;
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    enabled: true,
    capture(err, ctx = {}) {
      const e = err instanceof Error ? err : new Error(String(err));
      const body = {
        event_id: randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        platform: 'node',
        level: 'error',
        server_name: opts.service,
        release: opts.release,
        environment: opts.environment,
        exception: { values: [{ type: e.name, value: e.message.slice(0, 500), stacktrace: { frames: [] } }] },
        extra: { stack: (e.stack ?? '').slice(0, 4000) },
        tags: { service: opts.service, ...(ctx.route ? { route: ctx.route } : {}), ...(ctx.status ? { status: String(ctx.status) } : {}) },
        request: ctx.method ? { method: ctx.method, url: ctx.route } : undefined,
        contexts: ctx.requestId ? { trace: { trace_id: ctx.requestId.replace(/[^a-f0-9]/gi, '').slice(0, 32) || undefined }, request: { id: ctx.requestId } } : undefined,
      };
      void doFetch(target.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sentry-auth': target.auth },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      }).catch(() => undefined);
    },
  };
}

let current: ErrorReporter = NOOP;
export const setErrorReporter = (r: ErrorReporter) => {
  current = r;
};
export const errorReporter = (): ErrorReporter => current;
