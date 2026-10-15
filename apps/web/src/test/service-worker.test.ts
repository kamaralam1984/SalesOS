// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Executes public/sw.js against a fake ServiceWorkerGlobalScope and asserts its caching policy. */
function loadWorker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const put = vi.fn();
  const cache = { put, match: vi.fn().mockResolvedValue(undefined), addAll: vi.fn() };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    match: vi.fn().mockResolvedValue(new Response('offline page')),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
  };
  const networkFetch = vi.fn().mockResolvedValue({
    ok: true,
    type: 'basic',
    clone() {
      return this;
    },
  });
  const self = {
    location: { origin: 'https://app.example' },
    addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const code = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8');
  new Function('self', 'caches', 'fetch', 'Response', 'URL', code)(
    self,
    caches,
    networkFetch,
    Response,
    URL,
  );
  const dispatch = (url: string, init: { method?: string; mode?: string } = {}) => {
    const respondWith = vi.fn();
    handlers.fetch!({
      request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith,
    });
    return respondWith;
  };
  return { dispatch, put, networkFetch, caches };
}

describe('service worker caching policy (MS-UX-009)', () => {
  it('never intercepts /api requests', () => {
    const { dispatch, put } = loadWorker();
    expect(dispatch('https://app.example/api/v1/users')).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
  it('never intercepts cross-origin requests (the API lives on another origin)', () => {
    const { dispatch } = loadWorker();
    expect(dispatch('http://localhost:4100/api/v1/auth/me')).not.toHaveBeenCalled();
  });
  it('never intercepts writes', () => {
    const { dispatch } = loadWorker();
    expect(
      dispatch('https://app.example/_next/static/x.js', { method: 'POST' }),
    ).not.toHaveBeenCalled();
  });
  it('navigations are network-only; authenticated HTML is never stored', async () => {
    const { dispatch, put, networkFetch } = loadWorker();
    const respond = dispatch('https://app.example/admin/users', { mode: 'navigate' });
    expect(respond).toHaveBeenCalled();
    await respond.mock.calls[0]![0];
    expect(networkFetch).toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
  it('falls back to the static offline page when the network fails', async () => {
    const { dispatch, networkFetch, caches } = loadWorker();
    networkFetch.mockRejectedValueOnce(new TypeError('offline'));
    const res = await dispatch('https://app.example/crm', { mode: 'navigate' }).mock.calls[0]![0];
    expect(caches.match).toHaveBeenCalledWith('/offline.html');
    expect(await (res as Response).text()).toBe('offline page');
  });
  it('only caches immutable static assets', async () => {
    const { dispatch, put } = loadWorker();
    await dispatch('https://app.example/_next/static/chunks/a.js').mock.calls[0]![0];
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]![0].url).toContain('/_next/static/');
  });
});
