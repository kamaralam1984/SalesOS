import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { login } from './helpers';

/** Visual inspection screenshots (mobile + desktop). Output outside the repo: SHOTS_DIR=/path pnpm exec playwright test e2e/a11y-shots.spec.ts */
const OUT = process.env.SHOTS_DIR;
test.skip(!OUT, 'Set SHOTS_DIR');
const VIEWS = [{ n: 'm', w: 375, h: 812 }, { n: 'd', w: 1280, h: 800 }];
const PAGES: Array<{ n: string; user: string; url: string; detail?: string }> = [
  { n: 'dashboard', user: 'exec.a1', url: '/dashboard/executive' },
  { n: 'dashboard-founder', user: 'founder', url: '/dashboard/founder' },
  { n: 'leads', user: 'exec.a1', url: '/crm/leads' },
  { n: 'lead-detail', user: 'exec.a1', url: '/crm/leads', detail: '/crm/leads/' },
  { n: 'followup', user: 'exec.a1', url: '/crm/tasks' },
  { n: 'deals', user: 'manager.a', url: '/revenue/deals' },
  { n: 'revenue', user: 'finance', url: '/revenue' },
  { n: 'sop', user: 'manager.a', url: '/sop' },
  { n: 'complaints', user: 'studentsuccess', url: '/cx/complaints' },
  { n: 'reports', user: 'founder', url: '/reporting' },
];
for (const p of PAGES) {
  test(`shot ${p.n}`, async ({ page }) => {
    test.setTimeout(90_000);
    fs.mkdirSync(OUT!, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page, p.user);
    await page.goto(p.url);
    await page.locator('main h1').waitFor();
    if (p.detail) {
      await page.waitForTimeout(1500);
      const href = await page.locator(`main a[href^="${p.detail}"]`).evaluateAll((as) => as.map((a) => a.getAttribute('href')).find((h) => h && /\/[0-9a-f-]{8,}/.test(h)));
      await page.goto(href!);
    }
    for (const v of VIEWS) {
      await page.setViewportSize({ width: v.w, height: v.h });
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(OUT!, `${p.n}-${v.n}.png`), fullPage: true });
    }
  });
}
