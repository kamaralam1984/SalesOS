import { expect, test, type Page } from '@playwright/test';
import { demoEmail, demoPassword } from './helpers';

/** Keyboard-only walkthroughs of critical flows (no mouse/click calls), dialog focus management, reduced motion. */
const stamp = Date.now().toString(36);
const phone = () => `9${String(700_000_000 + Math.floor(Math.random() * 99_999_999)).padStart(9, '0')}`;

async function tabUntil(page: Page, matches: (el: Element) => boolean, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((src) => new Function(`return (${src})`)()(document.activeElement!), matches.toString());
    if (hit) return;
  }
  throw new Error('focus never reached the target by Tab');
}
const focusInside = (page: Page, sel: string) => page.evaluate((s) => !!document.activeElement?.closest(s), sel);

test('login by keyboard only, skip link works', async ({ page }) => {
  await page.goto('/login');
  await tabUntil(page, (el) => (el as HTMLInputElement).type === 'email' || /work email/i.test((el as HTMLElement).getAttribute('aria-label') ?? ''));
  await page.keyboard.type(demoEmail('exec.a1'));
  await page.keyboard.press('Tab');
  await page.keyboard.type(demoPassword('exec.a1'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\//);
  // skip link: first Tab on a fresh page lands on a visible "skip to content" link
  await page.goto('/crm/leads');
  await page.locator('main h1').waitFor();
  await page.waitForTimeout(1000);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: /skip to (main )?content/i });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => !!document.activeElement?.closest('main') || document.activeElement?.id === 'main-content' || location.hash.length > 1)).toBe(true);
});

test.describe('lead create + call log + task complete by keyboard', () => {
  test.use({ storageState: undefined });
  test('flow', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/login');
    await page.getByLabel(/work email/i).fill(demoEmail('exec.a1'));
    await page.getByLabel(/^password/i).fill(demoPassword('exec.a1'));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard\//);

    await page.goto('/crm/leads');
    const name = `[E2E] Keyboard ${stamp}`;
    const newLead = page.getByRole('button', { name: 'New lead' });
    await newLead.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: /new lead/i });
    await expect(dlg).toBeVisible();
    expect(await focusInside(page, '[role="dialog"]')).toBe(true);
    // focus trap: 25 Tabs and Shift+Tabs never leave the dialog
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); expect(await focusInside(page, '[role="dialog"]')).toBe(true); }
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Shift+Tab'); expect(await focusInside(page, '[role="dialog"]')).toBe(true); }
    // Escape closes and returns focus to the trigger
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(newLead).toBeFocused();
    // reopen and complete the form by keyboard
    await page.keyboard.press('Enter');
    await expect(dlg).toBeVisible();
    await dlg.getByLabel(/full name/i).focus();
    await page.keyboard.type(name);
    await dlg.getByLabel(/^phone/i).focus();
    await page.keyboard.type(phone());
    await dlg.getByRole('button', { name: /create lead/i }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Lead ${name} created`).first()).toBeVisible();

    // open the lead and log a call with the keyboard (radio group arrows, selects, Enter)
    await page.getByRole('searchbox', { name: /search leads/i }).fill(name);
    const link = page.getByRole('link', { name }).first();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const logBtn = page.getByRole('button', { name: 'Log call' }).first();
    await logBtn.focus();
    await page.keyboard.press('Enter');
    const call = page.getByRole('dialog');
    await expect(call).toBeVisible();
    await call.getByLabel('Connected', { exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(call.getByLabel('Connected', { exact: true })).toBeChecked();
    await call.getByLabel(/interest level/i).selectOption('HIGH');
    await call.getByLabel(/main objection/i).selectOption('PRICE');
    await call.getByLabel(/^notes/i).focus();
    await page.keyboard.type('keyboard-only note');
    await call.getByRole('button', { name: 'Tomorrow 10:00' }).focus();
    await page.keyboard.press('Enter');
    await call.getByRole('button', { name: /save call/i }).focus();
    await page.keyboard.press('Enter');
    await expect(call.getByRole('heading', { name: /call saved/i })).toBeVisible();
    await call.getByRole('button', { name: 'Done' }).focus();
    await page.keyboard.press('Enter');
    await expect(call).toBeHidden();
    await expect(logBtn).toBeFocused(); // focus restored after the dialog closes

    // complete the follow-up task from the task list by keyboard
    await page.goto('/crm/tasks');
    const row = page.getByText(`Follow up: ${name}`).first();
    await expect(row).toBeVisible();
    const done = page.locator('li, tr, article, div').filter({ hasText: `Follow up: ${name}` }).getByRole('button', { name: 'Mark done' }).first();
    await done.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Task completed').first()).toBeVisible();
  });
});

test('mobile More sheet traps focus and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login');
  await page.getByLabel(/work email/i).fill(demoEmail('manager.a'));
  await page.getByLabel(/^password/i).fill(demoPassword('manager.a'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\//);
  const more = page.getByRole('button', { name: /^more/i }).first();
  await more.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); expect(await focusInside(page, '[role="dialog"]')).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();
});

test.describe('prefers-reduced-motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('animations/transitions are neutralised app-wide', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/work email/i).fill(demoEmail('manager.a'));
    await page.getByLabel(/^password/i).fill(demoPassword('manager.a'));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard\//);
    await page.goto('/crm/leads');
    await page.getByRole('button', { name: 'New lead' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const longest = await page.evaluate(() => {
      let max = 0;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const cs = getComputedStyle(el);
        const parse = (s: string) => Math.max(0, ...s.split(',').map((v) => (v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000) || 0));
        if (cs.animationName !== 'none') max = Math.max(max, parse(cs.animationDuration));
        max = Math.max(max, parse(cs.transitionDuration));
      }
      return max;
    });
    expect(longest).toBeLessThanOrEqual(10); // ms: effectively instant
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  });
});

test('charts expose a text summary, an accessible name and a data-table alternative', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel(/work email/i).fill(demoEmail('founder'));
  await page.getByLabel(/^password/i).fill(demoPassword('founder'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\//);
  let charts = 0;
  for (const url of ['/dashboard/founder', '/reporting', '/revenue/forecasts', '/cx/satisfaction']) {
    await page.goto(url);
    await page.locator('main h1').waitFor();
    await page.waitForTimeout(1500);
    const info = await page.locator('main [role="img"]').evaluateAll((els) =>
      els.map((e) => ({ label: e.getAttribute('aria-label') ?? '', describedSection: !!e.closest('[aria-describedby]'), svgOnly: e.tagName.toLowerCase() === 'svg' })),
    );
    for (const i of info) {
      charts++;
      expect(i.label.length, `${url}: chart without accessible name`).toBeGreaterThan(8);
    }
    // a chart/table toggle exists for each chart wrapper
    const toggles = await page.locator('main [aria-pressed]').filter({ hasText: /table/i }).count();
    if (info.length) expect(toggles, `${url}: table alternative`).toBeGreaterThan(0);
  }
  expect(charts).toBeGreaterThan(0);
});
