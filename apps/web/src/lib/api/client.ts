/**
 * Single place that knows how to talk to the SalesOS API.
 * Everything configurable about the contract (base URL, CSRF header/bootstrap, envelope) lives here.
 */
import type { ApiEnvelope, ApiMeta } from './types';

// Browser default is same-origin `/api/v1` (proxied to the API by next.config rewrites), so the app works from
// localhost and from a phone on the LAN with first-party cookies. Set NEXT_PUBLIC_API_URL to talk to the API directly.
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : 'http://localhost:4100/api/v1')
).replace(/\/$/, '');
/** Header the API expects on state-changing requests (documented by the backend: shared-types CSRF_HEADER). */
export const CSRF_HEADER = 'x-csrf-token';
/** Endpoint that returns `{ csrfToken }` for the current session. `/auth/me` carries it in its payload. */
export const CSRF_BOOTSTRAP_PATH = '/auth/me';
export const REQUEST_ID_HEADER = 'x-request-id';
/** Error codes from the API that mean "CSRF token missing/stale, refresh and retry once". */
const CSRF_ERROR_CODES = new Set([
  'CSRF_INVALID',
  'CSRF_TOKEN_INVALID',
  'CSRF_MISSING',
  'FORBIDDEN_CSRF',
]);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;
  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }
  get isNetwork() {
    return this.status === 0;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  /** Field errors if the API returned `details: [{ path, message }]` or `{ field: message }`. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    const d = this.details as unknown;
    if (Array.isArray(d)) {
      for (const it of d) {
        if (it && typeof it === 'object') {
          const rec = it as { path?: unknown; field?: unknown; message?: unknown };
          const p = Array.isArray(rec.path) ? rec.path.join('.') : (rec.path ?? rec.field);
          if (typeof p === 'string' && typeof rec.message === 'string') out[p] = rec.message;
        }
      }
    } else if (d && typeof d === 'object') {
      for (const [k, v] of Object.entries(d as Record<string, unknown>))
        if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Do not fire the global 401 handler (used by session bootstrap / login). */
  skipUnauthorizedHandler?: boolean;
  headers?: Record<string, string>;
}

let csrfToken: string | null = null;
let unauthorizedHandler: ((err: ApiError) => void) | null = null;

export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};
export const getCsrfToken = () => csrfToken;
export const setUnauthorizedHandler = (fn: ((err: ApiError) => void) | null) => {
  unauthorizedHandler = fn;
};

function buildUrl(path: string, query?: Query): string {
  const url = new URL(API_BASE_URL + (path.startsWith('/') ? path : `/${path}`));
  if (query)
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return url.toString();
}

async function refreshCsrf(): Promise<void> {
  const res = await rawFetch(CSRF_BOOTSTRAP_PATH, { method: 'GET', skipUnauthorizedHandler: true });
  const data = res.data as { csrfToken?: string } | null;
  if (data?.csrfToken) csrfToken = data.csrfToken;
}

async function rawFetch(path: string, opts: RequestOptions): Promise<ApiResult<unknown>> {
  const method = opts.method ?? 'GET';
  const mutating = method !== 'GET';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError({
      status: 0,
      code: 'OFFLINE',
      message: 'You are offline. Nothing was sent or saved.',
    });
  }
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (mutating && csrfToken) headers[CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Nothing was saved.',
    });
  }
  const requestId = res.headers.get(REQUEST_ID_HEADER) ?? undefined;
  let env: ApiEnvelope<unknown> | null = null;
  if (res.status !== 204) {
    try {
      env = (await res.json()) as ApiEnvelope<unknown>;
    } catch {
      env = null;
    }
  }
  if (res.status === 503 && env?.error?.code === 'MAINTENANCE' && typeof window !== 'undefined')
    window.dispatchEvent(new Event('salesos:maintenance'));
  if (!res.ok || env?.error) {
    throw new ApiError({
      status: res.status,
      code: env?.error?.code ?? `HTTP_${res.status}`,
      message: env?.error?.message ?? res.statusText ?? 'Request failed',
      details: env?.error?.details,
      requestId: env?.meta?.requestId ?? requestId,
    });
  }
  return { data: env?.data ?? null, meta: { requestId, ...(env?.meta ?? {}) } };
}

/** Typed request returning the envelope's data + meta. Throws ApiError. */
export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<ApiResult<T>> {
  const mutating = (opts.method ?? 'GET') !== 'GET';
  try {
    if (mutating && !csrfToken && path !== '/auth/login') {
      try {
        await refreshCsrf();
      } catch {
        /* proceed; server will reply 401/403 and we surface that */
      }
    }
    return (await rawFetch(path, opts)) as ApiResult<T>;
  } catch (err) {
    if (err instanceof ApiError) {
      if (
        mutating &&
        (err.status === 403 || err.status === 419) &&
        (CSRF_ERROR_CODES.has(err.code) || /csrf/i.test(err.message))
      ) {
        await refreshCsrf();
        return (await rawFetch(path, opts)) as ApiResult<T>;
      }
      if (err.status === 401 && !opts.skipUnauthorizedHandler) unauthorizedHandler?.(err);
    }
    throw err;
  }
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    apiRequest<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, o: RequestOptions = {}) =>
    apiRequest<T>(path, { ...o, method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, o: RequestOptions = {}) =>
    apiRequest<T>(path, { ...o, method: 'PATCH', body: body ?? {} }),
  put: <T>(path: string, body?: unknown, o: RequestOptions = {}) =>
    apiRequest<T>(path, { ...o, method: 'PUT', body: body ?? {} }),
  delete: <T>(path: string, o: RequestOptions = {}) =>
    apiRequest<T>(path, { ...o, method: 'DELETE' }),
};
