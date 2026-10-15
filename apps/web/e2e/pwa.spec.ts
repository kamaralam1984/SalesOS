import { expect, test } from '@playwright/test';
import { demoEmail, demoPassword } from './helpers';

/** PWA checks. Needs a production build (the service worker registers only when NODE_ENV=production). */
const API = `http://localhost:${process.env.E2E_API_PORT ?? 4103}/api/v1`;

test('manifest is valid and icons resolve', async ({ page, request }) => {
  await page.goto('/login');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ name: expect.any(String), short_name: expect.any(String), start_url: '/', display: 'standalone' });
  expect(m.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
  expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  for (const i of m.icons) expect((await request.get(new URL(i.src, page.url()).toString())).ok()).toBe(true);
});

test('service worker never caches private API data or authenticated HTML; offline shows banner/page, writes are not faked', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByLabel(/work email/i).fill(demoEmail('exec.a1'));
  await page.getByLabel(/^password/i).fill(demoPassword('exec.a1'));
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\//);
  await page.goto('/crm/leads');
  await expect(page.locator('main h1')).toBeVisible();
  await page.reload();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // Inspect every cache: only static assets / offline page / icons, never /api or authenticated pages.
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url);
    return out;
  });
  expect(cached.length).toBeGreaterThan(0);
  for (const u of cached) {
    const p = new URL(u).pathname;
    expect(p, `cached: ${u}`).toMatch(/^\/(_next\/static\/|icons\/|offline\.html$)/);
  }
  expect(cached.some((u) => /\/api\//.test(u) || /\/crm\/leads|\/dashboard/.test(new URL(u).pathname))).toBe(false);

  // Offline: navigation shows the static offline page (no private HTML served from cache)
  await context.setOffline(true);
  const off = await context.newPage();
  await off.goto('/crm/leads').catch(() => {});
  await expect(off.getByRole('heading', { level: 1 })).toContainText(/offline/i);
  await expect(off.locator('body')).not.toContainText(/\[E2E\]|\[DEMO\]/);
  await off.close();

  // In-app offline: banner appears; a write attempt fails and is NOT reported as success
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText(/offline/i).first()).toBeVisible();
  const r = await page.evaluate(async (api) => fetch(`${api}/leads`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' }).then((x) => x.status).catch(() => 'network-error'), API);
  expect(r).toBe('network-error');
  await context.setOffline(false);
});
