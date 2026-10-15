/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API envelope in test helper */
import { expect, test, type Page } from '@playwright/test';
import { login, sql } from './helpers';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 4103}/api/v1`;
const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3103}`;
const stamp = Date.now().toString(36);
let seq = 0;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uniqueName = (p: string) => `[E2E] ${p} ${stamp}-${++seq}`;
const phone = () => `9${String(700_000_000 + Math.floor(Math.random() * 99_999_999)).padStart(9, '0')}`;

/** Authenticated API call using the page's session cookie (same cookie jar as the UI). */
async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const me = await page.request.get(`${API}/auth/me`);
  const csrf = ((await me.json()) as { data: { csrfToken: string } }).data.csrfToken;
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, Origin: WEB } });
  return { status: res.status(), body: (await res.json().catch(() => null)) as { data: any; meta: any; error: any } | null };
}

async function who(page: Page, local: string) {
  await login(page, local, /\/dashboard\//);
}

test.describe.configure({ mode: 'serial' });

test.describe('UJ-03 manager assigns a lead to a team member', () => {
  test('assign inside the team; outside the team is not offered and is refused by the API', async ({ page }) => {
    await who(page, 'manager.a');
    const name = uniqueName('Assign');
    const created = await call(page, 'POST', '/leads', { fullName: name, phone: phone() });
    expect(created.status).toBe(201);
    const id = created.body!.data.lead.id as string;

    await page.goto(`/crm/leads/${id}`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Unassigned').first()).toBeVisible();
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: /assign lead/i });
    const owner = dlg.getByRole('combobox', { name: /new owner/i });
    await owner.click();
    await owner.fill('Executive B1');
    await expect(dlg.getByRole('option', { name: /Executive B1/ })).toHaveCount(0); // other team: not offered
    await owner.fill('Executive A2');
    await dlg.getByRole('option', { name: /Executive A2/ }).click();
    await dlg.getByLabel(/^reason/i).fill('Balancing load in the team');
    await dlg.getByRole('button', { name: /^assign$/i }).click();
    await expect(page.getByText(/is now assigned to \[DEMO\] Executive A2/)).toBeVisible();
    await expect(page.getByText('Balancing load in the team')).toBeVisible();

    // the API refuses a cross-team target (404, never leaks existence)
    const users = await call(page, 'GET', '/users?limit=100');
    expect(users.body!.data.some?.((u: { name: string }) => u.name.includes('Executive B1')) ?? false).toBe(false);
    const b1 = sql("select id from users where email='exec.b1@demo.salesos.local'");
    const refused = await call(page, 'POST', `/leads/${id}/assign`, { toUserId: b1, reason: 'cross team attempt' });
    expect(refused.status).toBe(404);

    // another team's lead is invisible to this manager
    const otherTeamLead = sql("select l.id from leads l join users u on u.id=l.assigned_to_id where u.email='exec.b1@demo.salesos.local' limit 1");
    await page.goto(`/crm/leads/${otherTeamLead}`);
    await expect(page.getByText(/could not find that lead|could not find that record/i)).toBeVisible();
  });
});

test.describe('UJ-04 executive records activity and schedules a follow-up', () => {
  test('disposition + follow-up are saved together and appear on the timeline and task list', async ({ page }) => {
    await who(page, 'exec.a1');
    const name = uniqueName('Activity');
    const num = phone();
    await page.goto('/crm/leads');
    await page.getByRole('button', { name: 'New lead' }).click();
    const create = page.getByRole('dialog', { name: /new lead/i });
    await create.getByLabel(/full name/i).fill(name);
    await create.getByLabel(/^phone/i).fill(num);
    await create.getByRole('button', { name: /create lead/i }).click();
    await expect(page.getByText(`Lead ${name} created`).first()).toBeVisible();
    await page.getByRole('searchbox', { name: /search leads/i }).fill(name);
    await page.getByRole('link', { name }).first().click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`call ${esc(name)}`, 'i') })).toHaveAttribute('href', `tel:+91${num}`);

    await page.getByRole('button', { name: 'Log call' }).first().click();
    await expect(page.getByRole('dialog', { name: /log call/i })).toBeVisible();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByText('MANUAL').first()).toBeVisible();
    await dlg.getByRole('button', { name: /save call/i }).click();
    await expect(dlg.getByText(/choose the lead's interest level/i)).toBeVisible(); // mandatory fields enforced
    await dlg.getByLabel('Connected', { exact: true }).check({ force: true });
    await dlg.getByLabel(/interest level/i).selectOption('HIGH');
    await dlg.getByLabel(/main objection/i).selectOption('PRICE');
    await dlg.getByRole('button', { name: 'Tomorrow 10:00' }).click();
    await dlg.getByLabel(/^notes/i).fill('Interested, wants a discount');
    await dlg.getByRole('button', { name: /save call/i }).click();
    await expect(dlg.getByRole('heading', { name: /call saved/i })).toBeVisible();
    await expect(dlg.getByText(/follow up: /i)).toBeVisible();
    await expect(dlg.getByText('NEW → CONTACT_ATTEMPTED')).toBeVisible();
    await dlg.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByText(/call: connected/i)).toBeVisible();
    await expect(page.getByText('MANUAL').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Tasks' }).click();
    await expect(page.getByText(`Follow up: ${name}`)).toBeVisible();
    await page.getByRole('tab', { name: 'Calls' }).click();
    await expect(page.getByText(/wants a discount/i)).toBeVisible();
  });
});

test.describe('UJ-05 overdue and unattended work is flagged', () => {
  test('overdue queue shows the late task; the manager exception queue shows an unowned lead', async ({ page }) => {
    await who(page, 'exec.a1');
    const name = uniqueName('Overdue');
    const lead = await call(page, 'POST', '/leads', { fullName: name, phone: phone() });
    const leadId = lead.body!.data.lead.id as string;
    const tasks = await call(page, 'GET', `/tasks?leadId=${leadId}`);
    const taskId = tasks.body!.data[0].id as string;
    sql(`update tasks set due_at = now() - interval '3 hours' where id='${taskId}'`);
    await page.goto('/crm/overdue');
    await expect(page.getByRole('heading', { level: 1, name: 'Overdue tasks' })).toBeVisible();
    await expect(page.getByText(`First contact: ${name}`).first()).toBeVisible();
    await expect(page.getByText(/overdue/i).first()).toBeVisible();

    await page.context().clearCookies();
    await who(page, 'manager.a');
    const unowned = uniqueName('Unowned');
    expect((await call(page, 'POST', '/leads', { fullName: unowned, phone: phone() })).status).toBe(201);
    await page.goto('/crm/exceptions');
    await expect(page.getByRole('heading', { level: 1, name: 'Exception queue' })).toBeVisible();
    await expect(page.getByText(unowned).first()).toBeVisible();
    await expect(page.getByText('No owner').first()).toBeVisible();
    // the overdue task of the team is visible to the manager too (scoped to the team)
    await page.goto('/crm/overdue');
    await expect(page.getByText(`First contact: ${name}`).first()).toBeVisible();
  });
});

test.describe('UJ-06 lead progresses through webinar and stages', () => {
  test('register, attend, valid transitions succeed and an illegal one is refused', async ({ page }) => {
    await who(page, 'manager.a');
    const ev = await call(page, 'POST', '/events', { type: 'WEBINAR', title: uniqueName('Webinar'), startsAt: new Date(Date.now() + 10 * 60_000).toISOString(), endsAt: new Date(Date.now() + 70 * 60_000).toISOString() });
    expect(ev.status).toBe(201);
    const eventTitle = ev.body!.data.title as string;
    await page.context().clearCookies();

    await who(page, 'exec.a1');
    const name = uniqueName('Journey');
    const lead = await call(page, 'POST', '/leads', { fullName: name, phone: phone() });
    const id = lead.body!.data.lead.id as string;
    for (const status of ['CONTACT_ATTEMPTED', 'CONNECTED', 'QUALIFIED']) expect((await call(page, 'POST', `/leads/${id}/status`, { status })).status).toBe(200);

    await page.goto(`/crm/leads/${id}`);
    await page.getByRole('tab', { name: /webinars and demos/i }).click();
    const row = page.getByRole('listitem').filter({ hasText: eventTitle });
    await row.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByText('Attendance updated').first()).toBeVisible();
    await expect(page.getByRole('listitem', { name: undefined }).filter({ hasText: 'Webinar registered' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Mark attended' }).click();
    await expect(page.getByText('Attended').first()).toBeVisible();

    // lead stage followed the webinar steps (stepper marks the current step)
    await expect(page.getByRole('listitem').filter({ hasText: 'Webinar attended' }).first()).toHaveAttribute('aria-current', 'step');

    // legal move: demo scheduled
    await page.getByRole('button', { name: 'Change stage' }).click();
    let dlg = page.getByRole('dialog', { name: /change stage/i });
    await dlg.getByLabel(/new stage/i).selectOption({ label: 'Demo scheduled' });
    await dlg.getByRole('button', { name: /^change stage$/i }).click();
    await expect(page.getByText(/Stage of .* updated/)).toBeVisible();

    // illegal move: cannot win straight from demo scheduled
    await page.getByRole('button', { name: 'Change stage' }).click();
    dlg = page.getByRole('dialog', { name: /change stage/i });
    await dlg.getByLabel(/new stage/i).selectOption({ label: 'Won' });
    await dlg.getByLabel(/won value/i).fill('1000');
    await dlg.getByRole('button', { name: /^change stage$/i }).click();
    await expect(dlg.getByRole('alert').filter({ hasText: /cannot move lead from DEMO_SCHEDULED to WON/i })).toBeVisible();
    expect(sql(`select status from leads where id='${id}'`)).toBe('DEMO_SCHEDULED');
  });
});

test.describe('UJ-16 mobile one-hand follow-up flow (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('workspace card -> tel -> disposition sheet -> next action quick pick, no horizontal scroll', async ({ page }) => {
    await who(page, 'exec.a1');
    const name = uniqueName('Mobile');
    const lead = await call(page, 'POST', '/leads', { fullName: name, phone: phone(), isKeyProspect: true, interestLevel: 'HIGH' });
    const id = lead.body!.data.lead.id as string;
    await page.goto('/crm');
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    const card = page.getByRole('article', { name });
    await expect(card).toBeVisible();
    const tel = card.getByRole('link', { name: new RegExp(`call ${esc(name)}`, 'i') });
    await expect(tel).toHaveAttribute('href', /^tel:\+91\d{10}$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // tapping tel remembers an unlogged call; returning to the tab offers the disposition sheet
    await page.evaluate(() => document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a[href^="tel:"]')) e.preventDefault(); }, true));
    await tel.tap();
    await expect(page.getByTestId('unlogged-call')).toBeVisible();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('dialog', { name: new RegExp(`log call: ${esc(name)}`, 'i') })).toBeVisible();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/did you speak to/i)).toBeVisible();

    await sheet.getByLabel('No answer', { exact: true }).check({ force: true });
    await sheet.getByRole('button', { name: 'In 3 hours' }).tap();
    const box = await sheet.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844 + 1); // sheet sits within the viewport
    await sheet.getByRole('button', { name: /save call/i }).tap();
    await expect(sheet.getByRole('heading', { name: /call saved/i })).toBeVisible();
    await expect(sheet.getByText(/retry call/i).or(sheet.getByText(/follow up/i)).first()).toBeVisible();
    await sheet.getByRole('button', { name: 'Done' }).tap();
    await expect(page.getByTestId('unlogged-call')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // lead detail on a phone: FAB present, dial button present
    await page.goto(`/crm/leads/${id}`);
    await expect(page.getByTestId('fab-log-call')).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`call ${esc(name)}`, 'i') })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe('CRM extras', () => {
  test('manager sees queues; executive is denied manager screens; calendar and axe sanity', async ({ page }) => {
    await who(page, 'exec.a1');
    await page.goto('/crm/exceptions');
    await expect(page.getByText(/do not have access/i)).toBeVisible();
    await page.goto('/crm/calendar');
    await expect(page.getByRole('heading', { level: 1, name: 'Follow-up calendar' })).toBeVisible();
    await page.context().clearCookies();
    await who(page, 'manager.a');
    for (const [url, h1] of [['/crm/reassignment', 'Reassignment queue'], ['/crm/duplicates', 'Duplicate review'], ['/crm/reactivation', 'Lost-lead reactivation'], ['/crm/imports', 'Import leads from CSV'], ['/crm/events', 'Webinars, demos and events']] as const) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible();
    }
  });
});

test.describe('CRM accessibility and live updates', () => {
  test('SSE goes live for a signed-in manager', async ({ page }) => {
    await who(page, 'manager.a');
    await page.goto('/crm');
    await expect(page.getByText('Live updates on')).toBeVisible({ timeout: 20_000 });
  });

  for (const path of ['/crm', '/crm/leads', '@lead', '/crm/tasks', '/crm/calendar', '/crm/exceptions', '/crm/duplicates', '/crm/imports', '/crm/events', '/crm/settings']) {
    test(`axe WCAG A/AA: ${path}`, async ({ page }) => {
      const AxeBuilder = (await import('@axe-core/playwright')).default;
      await who(page, path === '/crm/settings' ? 'teamlead' : 'manager.a');
      const url = path === '@lead' ? `/crm/leads/${sql("select l.id from leads l join users u on u.id=l.assigned_to_id where u.email='exec.a1@demo.salesos.local' limit 1")}` : path;
      await page.goto(url);
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(800);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    });
  }
});
