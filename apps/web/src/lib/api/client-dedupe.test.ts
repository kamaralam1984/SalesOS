import { afterEach, describe, expect, it, vi } from 'vitest';

/** The guard is off under NODE_ENV=test, so these tests load a fresh copy of the client with it switched on. */
async function load() {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'development');
  return import('./client');
}
const ok = (data: unknown) => new Response(JSON.stringify({ data, meta: {} }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('GET storm guard', () => {
  it('shares one request between identical GETs in flight, and answers a repeat within a second from the last result', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ok([1, 2]));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await load();
    const burst = await Promise.all(Array.from({ length: 50 }, () => api.get('/leads', { page: 1 })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(burst.every((r) => JSON.stringify(r.data) === '[1,2]')).toBe(true);
    await api.get('/leads', { page: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // within the cooldown
    await api.get('/leads', { page: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // a different URL is a different request
  });

  it('a write clears the cache so the next read is fresh, and failures are never cached', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok('old'))
      .mockResolvedValueOnce(ok({ saved: true }))
      .mockResolvedValueOnce(ok('new'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'X', message: 'boom' } }), { status: 500, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(ok('after-error'));
    vi.stubGlobal('fetch', fetchMock);
    const { api, setCsrfToken } = await load();
    setCsrfToken('t');
    expect((await api.get('/leads')).data).toBe('old');
    await api.post('/leads', { name: 'x' });
    expect((await api.get('/leads')).data).toBe('new');
    vi.stubGlobal('Date', class extends Date { static override now() { return super.now() + 5000; } });
    await expect(api.get('/leads')).rejects.toMatchObject({ status: 500 });
    expect((await api.get('/leads')).data).toBe('after-error'); // the error was not remembered
  });
});
