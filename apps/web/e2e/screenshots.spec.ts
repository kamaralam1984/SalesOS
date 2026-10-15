import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Responsive visual checks. Output goes to SHOTS_DIR (outside the repo), never into the project.
 * Run: SHOTS_DIR=/tmp/shots pnpm e2e:shots
 */
const OUT = process.env.SHOTS_DIR;
const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1920', width: 1920, height: 1080 },
];
const PAGES = [
  { name: 'login', url: '/login' },
  { name: 'styleguide', url: '/dev/style-guide', fullPage: true },
];

test.skip(!OUT, 'Set SHOTS_DIR to capture screenshots');

for (const vp of VIEWPORTS) {
  for (const pg of PAGES) {
    test(`${pg.name} @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(pg.url);
      await page.waitForLoadState('networkidle');
      fs.mkdirSync(OUT!, { recursive: true });
      await page.screenshot({
        path: path.join(OUT!, `${pg.name}-${vp.name}.png`),
        fullPage: pg.fullPage ?? false,
      });
    });
  }
}

const AUTH_PAGES = [
  { name: 'dash-admin', user: 'admin', url: '/dashboard/admin' },
  { name: 'users', user: 'admin', url: '/admin/users' },
  { name: 'teams', user: 'admin', url: '/admin/teams' },
  { name: 'settings', user: 'admin', url: '/admin/settings' },
  { name: 'audit', user: 'admin', url: '/admin/audit' },
  { name: 'crm-placeholder', user: 'founder', url: '/crm' },
];
for (const vp of VIEWPORTS.filter((v) => v.name === '375' || v.name === '1280')) {
  for (const pg of AUTH_PAGES) {
    test(`auth ${pg.name} @ ${vp.name}`, async ({ page }) => {
      const { login } = await import('./helpers');
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page, pg.user);
      await page.goto(pg.url);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);
      fs.mkdirSync(OUT!, { recursive: true });
      await page.screenshot({ path: path.join(OUT!, `${pg.name}-${vp.name}.png`) });
    });
  }
}
