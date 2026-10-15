import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('axe: revenue pages (Team Lead view of seeded demo data) have no WCAG A/AA violations', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'teamlead');
  for (const url of ['/revenue', '/revenue/deals', '/revenue/targets', '/revenue/collections', '/revenue/refunds', '/revenue/forecasts', '/revenue/pricing', '/revenue/intel']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1')).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => `${url} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  }
});

test('revenue pages render real seeded numbers and honest empty states on mobile width', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await login(page, 'founder');
  await page.goto('/revenue/deals');
  await expect(page.getByRole('heading', { level: 1, name: 'Deals' })).toBeVisible();
  await expect(page.locator('main').getByText(/\[DEMO\]/).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.goto('/revenue/targets');
  await expect(page.getByRole('heading', { level: 1, name: 'Targets' })).toBeVisible();
  await ctx.close();
});
