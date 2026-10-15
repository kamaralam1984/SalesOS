import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  api,
  apiRequest,
  getCsrfToken,
  setCsrfToken,
  setUnauthorizedHandler,
} from './client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('api client', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    setCsrfToken(null);
    setUnauthorizedHandler(null);
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends credentials, never caches, and unwraps the envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { data: { a: 1 }, meta: { requestId: 'r1' }, error: null }),
    );
    const r = await api.get<{ a: number }>('/things', { q: 'x', empty: '' });
    expect(r.data).toEqual({ a: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/things\?q=x$/);
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
  });

  it('adds the CSRF header on mutations once a token is known', async () => {
    setCsrfToken('tok123');
    fetchMock.mockResolvedValueOnce(json(200, { data: {}, meta: {}, error: null }));
    await api.post('/things', { x: 1 });
    expect(fetchMock.mock.calls[0]![1].headers['x-csrf-token']).toBe('tok123');
  });

  it('bootstraps the CSRF token from /auth/me before the first mutation', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { data: { csrfToken: 'fresh' }, meta: {}, error: null }))
      .mockResolvedValueOnce(json(200, { data: {}, meta: {}, error: null }));
    await api.post('/things', {});
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/auth\/me$/);
    expect(fetchMock.mock.calls[1]![1].headers['x-csrf-token']).toBe('fresh');
    expect(getCsrfToken()).toBe('fresh');
  });

  it('throws ApiError with code, message, details and request id', async () => {
    fetchMock.mockResolvedValueOnce(
      json(422, {
        data: null,
        meta: { requestId: 'rid' },
        error: {
          code: 'VALIDATION',
          message: 'bad',
          details: [{ path: ['email'], message: 'taken' }],
        },
      }),
    );
    const err = await api.get('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'VALIDATION', requestId: 'rid' });
    expect(err.fieldErrors).toEqual({ email: 'taken' });
  });

  it('fires the unauthorized handler on 401 unless skipped', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(
      json(401, { data: null, meta: {}, error: { code: 'UNAUTHENTICATED', message: 'no' } }),
    );
    await api.get('/x').catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    await apiRequest('/auth/me', { skipUnauthorizedHandler: true }).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never claims success when offline: rejects without calling fetch', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const err = await api.post('/things', {}).catch((e) => e);
    expect(err).toMatchObject({ code: 'OFFLINE', status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps network failure to NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('failed'));
    const err = await api.get('/x').catch((e) => e);
    expect(err).toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('refreshes CSRF and retries once on a CSRF rejection', async () => {
    setCsrfToken('stale');
    fetchMock
      .mockResolvedValueOnce(
        json(403, { data: null, meta: {}, error: { code: 'CSRF_INVALID', message: 'csrf' } }),
      )
      .mockResolvedValueOnce(json(200, { data: { csrfToken: 'new' }, meta: {}, error: null }))
      .mockResolvedValueOnce(json(200, { data: { ok: true }, meta: {}, error: null }));
    const r = await api.post<{ ok: boolean }>('/things', {});
    expect(r.data.ok).toBe(true);
    expect(fetchMock.mock.calls[2]![1].headers['x-csrf-token']).toBe('new');
  });
});
