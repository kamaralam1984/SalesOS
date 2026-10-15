import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('security headers and CSP: no violations while using login, shell, admin and charts', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to (execute|apply|load|connect)/i.test(m.text()))
      violations.push(m.text());
  });
  page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`));

  const res = await page.goto('/login');
  const h = res!.headers();
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("object-src 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['strict-transport-security']).toContain('max-age');
  expect(h['x-powered-by']).toBeUndefined();

  await login(page, 'admin');
  for (const url of ['/admin/users', '/admin/teams', '/admin/audit', '/dev/style-guide']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
  }
  expect(violations).toEqual([]);
});

test('service worker is served and never caches the API (static policy file reachable)', async ({
  request,
}) => {
  const res = await request.get('/sw.js');
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['cache-control']).toContain('no-cache');
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe('standalone');
});
