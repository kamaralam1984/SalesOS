import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const fmt = (url: string, v: { id: string; nodes: { target: unknown[] }[] }) =>
  `${url} ${v.id}: ${v.nodes
    .map((n) => n.target.join(' '))
    .slice(0, 3)
    .join(' | ')}`;

for (const url of ['/login', '/forgot-password', '/dev/style-guide']) {
  test(`axe: ${url} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations.map((v) => fmt(url, v))).toEqual([]);
  });
}

test('axe: authenticated shell and admin pages', async ({ page }) => {
  await login(page, 'admin');
  for (const url of ['/dashboard/admin', '/admin/users', '/admin/teams', '/admin/settings']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations.map((v) => fmt(url, v))).toEqual([]);
  }
});
