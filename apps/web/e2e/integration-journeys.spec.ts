/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API envelope in test helper */
import { expect, test, type Page } from '@playwright/test';
import { login, sql } from './helpers';

/**
 * Integration pass journeys (CRM + notifications + revenue + people): edit lead fields, reschedule a task, sub-navigation,
 * reassignment history, ONE notification per overdue task, strategy plan, shared-credit split, expectation acknowledgement.
 */
const API = `http://localhost:${process.env.E2E_API_PORT ?? 4103}/api/v1`;
const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3103}`;
const stamp = Date.now().toString(36);
let seq = 0;
const uniqueName = (p: string) => `[E2E] ${p} ${stamp}-${++seq}`;
const phone = () => `9${String(600_000_000 + Math.floor(Math.random() * 99_999_999)).padStart(9, '0')}`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const me = await page.request.get(`${API}/auth/me`);
  const csrf = ((await me.json()) as { data: { csrfToken: string } }).data.csrfToken;
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, Origin: WEB } });
  return { status: res.status(), body: (await res.json().catch(() => null)) as { data: any; meta: any; error: any } | null };
}
const who = (page: Page, local: string) => login(page, local, /\/dashboard\//);

test.describe.configure({ mode: 'serial' });

test.describe('CRM: edit lead fields, reschedule a task, sub-navigation', () => {
  test('executive edits a lead (only changed fields saved) and reschedules its task; the CRM sub-pages are reachable from the sidebar', async ({ page }) => {
    await who(page, 'exec.a1');
    const name = uniqueName('Edit');
    const created = await call(page, 'POST', '/leads', { fullName: name, phone: phone() });
    expect(created.status).toBe(201);
    const id = created.body!.data.lead.id as string;

    await page.goto(`/crm/leads/${id}`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    // sub-navigation of the CRM section is rendered in the sidebar and works
    const sub = page.getByTestId('subnav-crm');
    await expect(sub.getByRole('link', { name: 'Tasks' })).toBeVisible();
    await expect(sub.getByRole('link', { name: 'Leads' })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('button', { name: 'Edit details' }).click();
    const dlg = page.getByRole('dialog', { name: /edit lead details/i });
    await dlg.getByLabel(/^email/i).fill('edited.lead@example.com');
    await dlg.getByLabel(/estimated value/i).fill('75000');
    await dlg.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`${name} updated`)).toBeVisible();
    await expect(page.getByText('edited.lead@example.com')).toBeVisible();
    const row = sql(`select email || '|' || estimated_value::text from leads where id='${id}'`);
    expect(row).toBe('edited.lead@example.com|75000.00');

    // reschedule the automatic first-contact task
    await page.getByRole('tab', { name: 'Tasks' }).click();
    await page.getByRole('button', { name: 'Edit task' }).first().click();
    const tdlg = page.getByRole('dialog', { name: 'Edit task' });
    const before = sql(`select due_at::text from tasks where lead_id='${id}' order by created_at limit 1`);
    await tdlg.getByRole('button', { name: 'Tomorrow 10:00' }).click();
    await tdlg.getByRole('button', { name: 'Save task' }).click();
    await expect(page.getByText('Task rescheduled')).toBeVisible();
    const after = sql(`select due_at::text from tasks where lead_id='${id}' order by created_at limit 1`);
    expect(after).not.toBe(before);

    // the sidebar link leads to the tasks page
    await sub.getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/crm\/tasks/);
    await expect(page.getByTestId('subnav-crm').getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
  });

  test('manager sees the reassignment history', async ({ page }) => {
    await who(page, 'manager.a');
    const name = uniqueName('History');
    const created = await call(page, 'POST', '/leads', { fullName: name, phone: phone() });
    const id = created.body!.data.lead.id as string;
    const orgId = sql(`select organization_id from leads where id='${id}'`);
    const ownerA = sql("select id from users where email='exec.a1@demo.salesos.local'");
    const ownerB = sql("select id from users where email='exec.a2@demo.salesos.local'");
    const mgr = sql("select id from users where email='manager.a@demo.salesos.local'");
    sql(`update leads set assigned_to_id='${ownerA}' where id='${id}'`);
    sql(`insert into reassignment_queue (id, organization_id, lead_id, previous_owner_id, new_owner_id, reason, status, resolved_at, resolved_by_id, resolution_note, created_at, team_id) select gen_random_uuid(), '${orgId}', '${id}', '${ownerA}', '${ownerB}', 'OWNER_DEACTIVATED', 'RESOLVED', now(), '${mgr}', 'Moved to Executive A2 for the weekend', now() - interval '1 day', team_id from leads where id='${id}'`);
    expect(sql(`select count(*) from reassignment_queue where lead_id='${id}' and status='RESOLVED'`)).toBe('1');
    await page.goto('/crm/reassignment');
    await page.getByRole('tab', { name: 'History' }).click();
    const list = page.getByTestId('reassignment-history');
    await expect(list).toContainText(name);
    await expect(list).toContainText('Moved to Executive A2 for the weekend');
  });
});

test.describe('notifications: one fact, one alert', () => {
  test('an overdue task raises exactly ONE in-app notification (CRM and platform stores are unified)', async ({ page }) => {
    test.setTimeout(240_000);
    await who(page, 'exec.a1');
    const name = uniqueName('Overdue');
    const created = await call(page, 'POST', '/leads', { fullName: name, phone: phone() });
    const leadId = created.body!.data.lead.id as string;
    const taskId = (await call(page, 'GET', `/tasks?leadId=${leadId}`)).body!.data[0].id as string;
    sql(`update tasks set due_at = now() - interval '2 hours' where id='${taskId}'`);
    await expect.poll(async () => {
      const r = await call(page, 'GET', '/notifications?limit=100');
      return (r.body!.data as any[]).filter((n) => n.entity?.id === taskId && n.type === 'follow_up.overdue').length;
    }, { timeout: 150_000, intervals: [5_000] }).toBe(1);
    // give a possible duplicate time to appear, then prove there is still exactly one
    await page.waitForTimeout(15_000);
    const all = (await call(page, 'GET', '/notifications?limit=100')).body!.data as any[];
    // 'Due now' (follow_up.due) is a different fact; the OVERDUE fact at level 1 must exist exactly once, in one store
    expect(all.filter((n) => n.entity?.id === taskId && n.type === 'follow_up.overdue')).toHaveLength(1);
    expect(sql(`select count(*) from notifications where entity_id='${taskId}' and type='follow_up.overdue'`)).toBe('1');
    expect(sql(`select count(*) from crm_notification_deliveries where entity_id='${taskId}' and kind='task.overdue' and status='DELIVERED'`)).toBe('1');
    // and the bell shows it
    await page.goto('/crm/tasks');
    await page.getByRole('button', { name: /notifications/i }).first().click();
    await expect(page.getByTestId('notification-item').first()).toBeVisible();
  });
});

test.describe('revenue: strategy plans', () => {
  test('Team Lead creates a plan and an initiative and moves it along; an executive has no access', async ({ page }) => {
    await who(page, 'teamlead');
    const title = uniqueName('Plan');
    const initiative = uniqueName('Weekly demo slots');
    await page.goto('/revenue/strategy');
    await expect(page.getByRole('heading', { level: 1, name: 'Strategy plans' })).toBeVisible();
    await page.getByRole('button', { name: 'New plan' }).click();
    const dlg = page.getByRole('dialog', { name: 'New plan' });
    await dlg.getByLabel(/^Plan title/).fill(title);
    await dlg.getByLabel(/^Summary/).fill('Concentrate on webinar-to-demo conversion and referrals');
    await dlg.getByRole('button', { name: 'Create plan' }).click();
    const card = page.locator('section, div').filter({ has: page.getByRole('heading', { name: title }) }).last();
    await expect(page.getByText(title).first()).toBeVisible();
    await page.getByRole('button', { name: 'Add initiative' }).first().click();
    const idlg = page.getByRole('dialog', { name: 'Add initiative' });
    await idlg.getByRole('textbox', { name: /^Initiative/ }).fill(initiative);
    await idlg.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(initiative).first()).toBeVisible();
    await page.getByLabel(`Status of ${initiative}`).first().selectOption('IN_PROGRESS');
    await expect.poll(() => sql(`select status from strategy_initiatives where title='${initiative}' order by created_at desc limit 1`)).toBe('IN_PROGRESS');
    void card;

    await page.context().clearCookies();
    await who(page, 'exec.a1');
    await page.goto('/revenue/strategy');
    await expect(page.getByText(/permission|not allowed|access/i).first()).toBeVisible();
  });
});

test.describe('people: ownership expectations are acknowledged by the employee', () => {
  test('HR publishes an expectation; the executive acknowledges it once; HR sees the adoption', async ({ page }) => {
    await who(page, 'hr');
    const title = uniqueName('Own the pipeline');
    const made = await call(page, 'POST', '/people/expectations', { roleKey: 'SALES_EXECUTIVE', kind: 'OWNERSHIP', title, body: 'Every lead you hold has a next action and an honest status.' });
    expect(made.status).toBe(201);
    await page.context().clearCookies();
    await who(page, 'exec.a1');
    await page.goto('/people/onboarding');
    await page.getByRole('tab', { name: 'Expectations' }).click();
    const item = page.getByRole('listitem').filter({ hasText: title });
    await item.getByRole('button', { name: /acknowledge/i }).click();
    await expect(item.getByTestId('ack-done')).toBeVisible();
    expect(sql(`select count(*) from role_expectation_acknowledgements a join role_expectations e on e.id=a.expectation_id where e.title='${title}'`)).toBe('1');
    await page.context().clearCookies();
    await who(page, 'hr');
    await page.goto('/people/onboarding');
    await page.getByRole('tab', { name: 'Expectations' }).click();
    await expect(page.getByTestId('ack-adoption')).toContainText(title);
  });
});
