// DEV TOOL: logs in to the isolated UI-review stack and screenshots every static route (light/dark x desktop/mobile),
// recording console errors, failed requests, horizontal overflow and axe violations. Output: $OUT/report.json + PNGs.
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:3101';
const OUT = process.env.OUT;
const EMAIL = process.env.EMAIL ?? 'purushottam@coacheasily.local';
const PASSWORD = process.env.PASSWORD;
const ROUTES = (process.env.ROUTES ?? '').split(',').filter(Boolean);
const THEMES = (process.env.THEMES ?? 'light,dark').split(',');
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const VPS = (process.env.VPS ?? 'desktop,mobile').split(',');
const AXE = process.env.AXE !== '0';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const report = [];
for (const theme of THEMES) {
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], colorScheme: theme, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(6000); await page.getByLabel(/work email/i).fill(EMAIL);
    await page.getByLabel(/^password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 400000, waitUntil: 'commit' });
    await page.evaluate((t) => { try { localStorage.setItem('salesos.theme.v1', t); } catch {} }, theme);
    for (const route of ROUTES) {
      const errors = [];
      const failed = [];
      const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); };
      const onResp = (r) => { if (r.status() >= 400 && !r.url().includes('/_next/')) failed.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 120)}`); };
      page.on('console', onConsole); page.on('response', onResp);
      let status = 'ok';
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(Number(process.env.SETTLE ?? 2200));
      } catch (e) { status = `nav-error: ${String(e).slice(0, 120)}`; }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => 0);
      const title = await page.locator('h1').first().textContent({ timeout: 1500 }).catch(() => null);
      let axe = null;
      if (AXE) { try { axe = (await new AxeBuilder({ page }).analyze()).violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}`); } catch { axe = ['axe-failed']; } }
      const file = `${route.replace(/\//g, '_') || '_root'}.${theme}.${vp}.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: true }).catch(() => {});
      report.push({ route, theme, vp, status, finalUrl: page.url().replace(BASE, ''), h1: title?.trim() ?? null, overflowPx: overflow, errors: [...new Set(errors)].slice(0, 5), failed: [...new Set(failed)].slice(0, 5), axe, file });
      page.off('console', onConsole); page.off('response', onResp);
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`done: ${report.length} captures`);
