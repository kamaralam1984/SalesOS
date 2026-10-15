import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const fmt = (url: string, v: { id: string; nodes: { target: unknown[] }[] }) => `${url} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`;

const PAGES: Record<string, string[]> = {
  teamlead: ['/cx', '/cx/complaints', '/cx/escalations', '/cx/relationships', '/cx/satisfaction', '/cx/refunds', '/cx/handovers', '/cx/founder-reports', '/cx/action-items', '/cx/risks', '/collaboration', '/collaboration/plans', '/collaboration/insights'],
  studentsuccess: ['/cx/handovers', '/cx/complaints'],
};

for (const [who, urls] of Object.entries(PAGES)) {
  test(`axe: Phase 7 pages as ${who} have no WCAG A/AA violations (desktop and mobile width)`, async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, who);
    for (const size of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
      await page.setViewportSize(size);
      for (const url of urls) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main h1')).toBeVisible();
        // no page-level horizontal scroll on phones
        if (size.width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${url} overflows horizontally`).toBe(true);
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(results.violations.map((v) => fmt(`${url}@${size.width}`, v))).toEqual([]);
      }
    }
  });
}
