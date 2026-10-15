import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { NAV_DOMAINS } from '../src/nav/registry';
import { login } from './helpers';

/**
 * Route crawler: for every route in the nav registry (plus first detail page behind each list) axe-scan at
 * 375/768/1280/1920 and assert no horizontal page overflow. Each route is covered by the first role that can open it;
 * every role also scans its own dashboard at all widths. Set A11Y_REPORT=/path/file.json to dump all findings
 * (including moderate/minor) for the report. Fails on serious/critical violations and overflow.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const WIDTHS = [
  { w: 375, h: 812 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
  { w: 1920, h: 1080 },
];
const ROLES = ['founder', 'teamlead', 'manager.a', 'exec.a1', 'finance', 'hr', 'studentsuccess', 'marketing', 'admin'];

const navHrefs = new Set<string>();
for (const d of NAV_DOMAINS) for (const i of d.items) { navHrefs.add(i.href); for (const c of i.children ?? []) navHrefs.add(c.href); }
const EXTRA = ['/notifications', '/dashboard', '/crm/leads', '/people/employees'];
const ROUTES = [...new Set([...navHrefs, ...EXTRA])].filter((h) => !h.includes('['));

const covered = new Set<string>();
const findings: Array<{ role: string; url: string; width: number; id: string; impact: string | null | undefined; targets: string[] }> = [];
const overflow: string[] = [];

async function settle(page: Page) {
  await page.locator('main').first().waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse'), null, { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function scan(page: Page, role: string, url: string, width: number) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of results.violations) {
    findings.push({ role, url, width, id: v.id, impact: v.impact, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) });
  }
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 1) overflow.push(`${role} ${url} @${width}: +${over}px`);
}

for (const role of ROLES) {
  test(`a11y crawl as ${role}`, async ({ page }) => {
    test.setTimeout(30 * 60_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page, role);
    const myRoutes: string[] = [];
    for (const r of ROUTES) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(r);
      await settle(page);
      if (/\/forbidden/.test(page.url()) || (await page.locator('main h1').count()) === 0) continue;
      myRoutes.push(r);
      // First detail page behind a list page.
      const detail = await page.locator(`main a[href^="${r}/"]`).evaluateAll((as) => as.map((a) => a.getAttribute('href')).find((h) => h && /\/[0-9a-f-]{8,}/.test(h)));
      if (detail && !ROUTES.includes(detail)) myRoutes.push(detail);
    }
    const mine = [...new Set(myRoutes)];
    for (const r of mine) {
      for (const { w, h } of WIDTHS) {
        const key = `${r}@${w}`;
        const isDash = r.startsWith('/dashboard');
        if (covered.has(key) && !(isDash && r !== '/dashboard')) continue;
        covered.add(key);
        await page.setViewportSize({ width: w, height: h });
        await page.goto(r);
        await settle(page);
        await scan(page, role, r, w);
      }
    }
  });
}

test.afterAll(() => {
  if (process.env.A11Y_REPORT) {
    fs.mkdirSync(path.dirname(process.env.A11Y_REPORT), { recursive: true });
    fs.writeFileSync(process.env.A11Y_REPORT, JSON.stringify({ routesCovered: covered.size, findings, overflow }, null, 1));
  }
});

test('a11y crawl result: no serious/critical violations and no horizontal overflow', () => {
  const bad = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical').map((f) => `${f.role} ${f.url} @${f.width} ${f.impact} ${f.id}: ${f.targets.join(' | ')}`);
  expect([...new Set(bad)]).toEqual([]);
  expect(overflow).toEqual([]);
});
