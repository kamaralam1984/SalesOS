/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API envelope in test helper */
import { expect, test, type Page } from '@playwright/test';
import { login, logout } from './helpers';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 4103}/api/v1`;
const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3103}`;
const stamp = Date.now().toString(36);
// a distinct past reporting week per run (reports are unique per period)
const periodDate = new Date(Date.UTC(2010, 0, 4) + (Math.floor(Date.now() / 60_000) % 2600) * 7 * 86_400_000).toISOString().slice(0, 10);
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phone = () => `9${String(700_000_000 + Math.floor(Math.random() * 99_999_999)).padStart(9, '0')}`;

/** Authenticated API call using the page's session cookie (same cookie jar as the UI). */
async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown, headers: Record<string, string> = {}) {
  const me = await page.request.get(`${API}/auth/me`);
  const csrf = ((await me.json()) as { data: { csrfToken: string } }).data.csrfToken;
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, Origin: WEB, ...headers } });
  return { status: res.status(), body: (await res.json().catch(() => null)) as { data: any; meta: any; error: any } | null };
}

test.describe.configure({ mode: 'serial' });

test.describe('UJ-10 sale -> Student Success handover with the required information', () => {
  const learner = `[E2E] Handover Learner ${stamp}`;
  let handoverUrl = '';

  test('a won sale creates a draft handover; the seller cannot submit it incomplete, then submits it', async ({ page }) => {
    await login(page, 'exec.a1', /\/dashboard\//);
    // 1. real sale: lead -> deal -> close WON through the revenue API (publishes deal.closed; the worker creates the handover)
    const lead = await call(page, 'POST', '/leads', { fullName: learner, phone: phone() });
    expect(lead.status).toBe(201);
    const leadId = lead.body!.data.lead.id as string;
    const programs = await call(page, 'GET', '/leads/meta');
    const programId = (programs.body!.data.programs as Array<{ id: string }>)[0]!.id;
    const deal = await call(page, 'POST', `/leads/${leadId}/deals`, { programId, amount: '25000.00', currency: 'INR' }, { 'Idempotency-Key': `e2e-deal-${stamp}` });
    expect(deal.status, JSON.stringify(deal.body)).toBe(201);
    const dealId = (deal.body!.data.deal?.id ?? deal.body!.data.id) as string;
    for (const status of ['CONTACT_ATTEMPTED', 'CONNECTED', 'QUALIFIED', 'PROPOSAL_NEGOTIATION']) {
      const moved = await call(page, 'POST', `/leads/${leadId}/status`, { status });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    }
    const closed = await call(page, 'POST', `/deals/${dealId}/close`, { outcome: 'WON', finalAmount: '25000.00' }, { 'Idempotency-Key': `e2e-close-${stamp}` });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    // 2. the handover appears for the seller (created by the worker from the event)
    await page.goto('/cx/handovers');
    await expect(page.getByRole('heading', { level: 1, name: 'Handovers' })).toBeVisible();
    await page.getByRole('tab', { name: 'All' }).click();
    const card = page.getByRole('link', { name: new RegExp(esc(learner)) });
    await expect(async () => {
      await page.reload();
      await page.getByRole('tab', { name: 'All' }).click();
      await expect(card).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 40_000 });
    await expect(card).toContainText('Draft');
    await card.click();
    await expect(page.getByRole('heading', { level: 1, name: learner })).toBeVisible();
    handoverUrl = page.url();

    // 3. required information is enforced: submitting an incomplete checklist is refused and the gaps are listed
    await expect(page.getByRole('list', { name: 'Checklist' })).toContainText('Promises made');
    await page.getByRole('button', { name: 'Submit to Student Success' }).click();
    await expect(page.getByText('Checklist incomplete')).toBeVisible();
    await expect(page.getByText(/Still missing:.*Promises made.*Consent/)).toBeVisible();

    // 4. fill the checklist and submit
    await page.getByLabel(/Language preference/).selectOption('MR');
    await page.getByLabel(/^Programme/).fill('AI Sprint');
    await page.getByLabel(/^Payment verified/).selectOption('yes');
    await page.getByLabel(/^Promises made/).fill('Weekly mentor call and community access');
    await page.getByLabel(/^Learner goals/).fill('Launch a first coaching offer in 90 days');
    await page.getByLabel(/^Objections raised/).fill('None');
    await page.getByLabel(/^Special notes/).fill('Prefers evening calls');
    await page.getByLabel(/^Contact/).fill('+919800000123');
    await page.getByLabel(/^Amount paid/).fill('5000');
    await page.getByLabel(/^Amount due/).fill('20000');
    await page.getByRole('checkbox', { name: /agreed to share these details/ }).check();
    await page.getByRole('button', { name: 'Submit to Student Success' }).click();
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel(/^Promises made/)).toHaveCount(0); // no longer editable
    await expect(page.getByText('Weekly mentor call and community access')).toBeVisible();
  });

  test('Student Success sees it in the inbox with the minimum data, asks a question, then acknowledges and completes', async ({ page }) => {
    await login(page, 'studentsuccess', /\/dashboard\//);
    await page.goto('/cx/handovers');
    await expect(page.getByRole('heading', { level: 1, name: 'Handover inbox' })).toBeVisible();
    const card = page.getByRole('link', { name: new RegExp(esc(learner)) });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Acknowledge/); // pending alert timer
    await card.click();
    await expect(page.getByText('Prefers evening calls')).toBeVisible();
    await expect(page.getByText('Marathi')).toBeVisible();
    // data minimisation: no sales or deal identifiers exposed on the page
    await expect(page.getByText(/Open lead|Open deal/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Ask for more information' }).click();
    const ask = page.getByRole('dialog', { name: 'Ask for more information' });
    await ask.getByLabel(/Your questions/).fill('Which batch did the learner choose?');
    await ask.getByRole('button', { name: 'Ask for more information' }).click();
    await expect(page.getByText('Info requested', { exact: true }).first()).toBeVisible();
    await logout(page);

    // the seller answers (task + editable again) and resubmits
    await login(page, 'exec.a1', /\/dashboard\//);
    await page.goto(handoverUrl);
    await expect(page.getByText('Student Success asked for more information')).toBeVisible();
    await page.getByLabel(/^Special notes/).fill('Prefers evening calls. Batch B (evenings).');
    await page.getByRole('button', { name: 'Submit to Student Success' }).click();
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
    await logout(page);

    await login(page, 'studentsuccess', /\/dashboard\//);
    await page.goto(handoverUrl);
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText('Acknowledged', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Complete onboarding' }).click();
    const done = page.getByRole('dialog', { name: 'Complete onboarding' });
    await done.getByLabel(/Completion note/).fill('Onboarding call done, joined batch B');
    await done.getByRole('button', { name: 'Complete onboarding' }).click();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: 'Onboarding call done, joined batch B' })).toBeVisible();
  });
});

test.describe('escalation journey: complaint with SLA, and a high-value conversation escalated to the Team Lead', () => {
  const title = `[E2E] Class link missing ${stamp}`;
  const conversation = `[E2E] Corporate batch ${stamp}`;
  const resolutionText = `Approved 5 instalments with Founder sign-off ${stamp}`;

  test('an executive logs a complaint (SLA clock visible) and the manager works it to resolution with a root cause', async ({ page }) => {
    await login(page, 'exec.a1', /\/dashboard\//);
    await page.goto('/cx/complaints');
    await page.getByRole('button', { name: /Log complaint/ }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Log a complaint' });
    await dlg.getByLabel(/^Title/).fill(title);
    await dlg.getByLabel(/What happened/).fill('Learner did not receive the class link for week 2');
    await dlg.getByLabel(/^Category/).selectOption('DELIVERY_ACCESS');
    await dlg.getByLabel(/^Priority/).selectOption('P1');
    await dlg.getByRole('button', { name: 'Log complaint' }).click();
    const item = page.getByRole('link', { name: new RegExp(esc(title)) });
    await expect(item).toBeVisible();
    await expect(item).toContainText(/Due in|Breached/); // SLA countdown (icon + text)
    await expect(item).toContainText('auto-assigned to manager');
    await logout(page);

    await login(page, 'manager.a', /\/dashboard\//);
    await page.goto('/cx/complaints');
    await page.getByRole('link', { name: new RegExp(esc(title)) }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
    let d = page.getByRole('dialog', { name: 'Acknowledge' });
    await d.getByLabel(/First response/).fill('Sorry about this, resending the link now');
    await d.getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await expect(page.getByText('Acknowledged', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Start work' }).click();
    d = page.getByRole('dialog', { name: 'Start work' });
    await d.getByLabel(/Plan or next action/).fill('Re-issue access and confirm on a call');
    await d.getByRole('button', { name: 'Start work' }).click();
    // an illegal shortcut is not offered: resolving needs a root cause
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    d = page.getByRole('dialog', { name: 'Resolve' });
    await d.getByLabel(/^Resolution/).fill('Link re-issued and confirmed with the learner');
    await expect(d.getByRole('button', { name: 'Resolve', exact: true })).toBeDisabled();
    await d.getByLabel(/Root cause/).selectOption('PROCESS_GAP');
    await d.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.getByText('Resolved', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Process gap').first()).toBeVisible();
    await expect(page.getByText(/Resolved within the service level|Resolved after the service level/)).toBeVisible();
    // the history shows each step
    await expect(page.getByRole('list', { name: 'History' })).toContainText('RESOLVED');
  });

  test('a high-value conversation is escalated, the Team Lead reviews and resolves it, the owner sees the outcome', async ({ page }) => {
    await login(page, 'exec.a1', /\/dashboard\//);
    await page.goto('/cx/escalations');
    await page.getByRole('button', { name: /Escalate a conversation/ }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Escalate a conversation' });
    await dlg.getByRole('searchbox').fill('E2E');
    const first = dlg.getByRole('listbox', { name: 'Search results' }).getByRole('option').first();
    await expect(first).toBeVisible();
    await first.click();
    await dlg.getByLabel(/^Title/).fill(conversation);
    await dlg.getByLabel(/^Context/).fill('Twelve seats, wants one invoice and an EMI plan');
    await dlg.getByLabel(/^Blocker/).fill('Needs a discount approval');
    await dlg.getByRole('checkbox', { name: /Involve the Founder/ }).check();
    await dlg.getByRole('button', { name: 'Escalate', exact: true }).click();
    const open = page.getByRole('heading', { name: /^Open/ }).locator('xpath=ancestor::section');
    await expect(open.getByText(conversation)).toBeVisible();
    await expect(open.getByText('Needs a discount approval').first()).toBeVisible();
    await expect(open.getByText('Founder involved').first()).toBeVisible();
    await logout(page);

    await login(page, 'teamlead', /\/dashboard\//);
    await page.goto('/cx/escalations');
    const card = page.getByRole('article', { name: conversation });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Start review' }).click();
    await page.getByRole('dialog', { name: 'Start review' }).getByRole('button', { name: 'Start review' }).click();
    const review = page.getByRole('heading', { name: /^In review/ }).locator('xpath=ancestor::section');
    await expect(review.getByText(conversation)).toBeVisible();
    await review.getByRole('article', { name: conversation }).getByRole('button', { name: 'Resolve', exact: true }).click();
    const d = page.getByRole('dialog', { name: 'Resolve', exact: true });
    await d.getByLabel(/^Resolution/).fill(resolutionText);
    await d.getByRole('button', { name: 'Resolve', exact: true }).click();
    const resolved = page.getByRole('heading', { name: /^Resolved/ }).locator('xpath=ancestor::section');
    await expect(resolved.getByText(resolutionText)).toBeVisible();
    await logout(page);

    await login(page, 'exec.a1', /\/dashboard\//);
    await page.goto('/cx/escalations');
    const mine = page.getByRole('heading', { name: /^Resolved/ }).locator('xpath=ancestor::section');
    await expect(mine.getByText(resolutionText)).toBeVisible();
    await expect(mine.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(0);
  });
});

test.describe('UJ-12 weekly Founder report, immutable snapshot, and action items completed with evidence', () => {
  const riskTitle = `[E2E] Collections slipping ${stamp}`;
  const itemTitle = `[E2E] Publish the objection SOP ${stamp}`;
  let reportUrl = '';

  test('the Team Lead builds a report: a risk needs a proposed solution before it can be published; publishing locks it', async ({ page }) => {
    await login(page, 'teamlead', /\/dashboard\//);
    await page.goto('/cx/risks');
    await page.getByRole('button', { name: /Raise a risk/ }).first().click();
    const rd = page.getByRole('dialog', { name: 'Raise a risk' });
    await rd.getByLabel(/^Risk/).fill(riskTitle);
    await rd.getByLabel(/What is the risk/).fill('Three EMI learners missed the second instalment');
    await rd.getByRole('checkbox', { name: /Raised before it hits a target/ }).check();
    await rd.getByRole('button', { name: 'Raise risk', exact: true }).click();
    await expect(page.getByText(riskTitle)).toBeVisible();
    await expect(page.getByText('No solution yet').first()).toBeVisible();

    await page.goto('/cx/founder-reports');
    await page.getByRole('button', { name: 'New report' }).click();
    await page.getByRole('dialog', { name: 'Start a report' }).getByLabel(/A date inside the period/).fill(periodDate);
    await page.getByRole('dialog', { name: 'Start a report' }).getByRole('button', { name: 'Start report' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Weekly Founder report/ })).toBeVisible();
    reportUrl = page.url();
    // numbers come from the analytics provider (KPI dictionary) - or are shown as unavailable ("-"), never invented
    await expect(page.getByText('Revenue and collections vs target')).toBeVisible();
    await expect(page.locator('li', { hasText: 'Revenue and collections vs target' }).locator('li').first()).toBeVisible();

    await page.getByLabel(/^Narrative/).fill('Pipeline steady; demo follow-up improved; collections need attention.');
    await page.getByLabel('Add from risk register').selectOption({ label: riskTitle });
    await expect(page.getByText('A proposed solution is required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish report' })).toBeDisabled();
    await expect(page.getByText(/1 risk still needs a proposed solution/)).toBeVisible();
    await page.getByLabel(/^Proposed solution/).fill('Weekly EMI reminder call, escalate at day 3');
    await page.getByRole('checkbox', { name: 'No opportunities to report this period' }).check();
    await page.getByRole('checkbox', { name: 'I reviewed the action items' }).check();
    await expect(page.getByRole('progressbar', { name: 'Completeness' })).toHaveAttribute('aria-valuenow', '100');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('All changes saved')).toBeVisible();

    await page.getByRole('button', { name: 'Publish report' }).click();
    const confirm = page.getByRole('dialog', { name: 'Publish this report?' });
    await expect(confirm).toContainText('cannot be edited afterwards');
    await confirm.getByRole('button', { name: 'Publish and lock' }).click();
    await expect(page.getByText('Locked snapshot')).toBeVisible();
    await expect(page.getByText('Fingerprint matches the stored content')).toBeVisible();
    await expect(page.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
    await expect(page.getByLabel(/^Narrative/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Publish report' })).toHaveCount(0);

    // immutability at the API: an edit attempt on the published report is refused
    const id = reportUrl.split('/').pop()!;
    const edit = await call(page, 'PATCH', `/founder-reports/${id}`, { title: 'Rewritten history' });
    expect(edit.status).toBe(409);
    expect(edit.body!.error.code).toBe('REPORT_IMMUTABLE');

    // a correction is a NEW version; the original stays untouched
    await page.getByRole('button', { name: 'Create a corrected version' }).click();
    await expect(page.getByText('Correction of version 1')).toBeVisible();
    await page.goto(reportUrl);
    await expect(page.getByRole('link', { name: 'Version 2' })).toBeVisible();
    await expect(page.getByText('Locked snapshot')).toBeVisible();
  });

  test('the Founder reviews the report and assigns an action item; the Team Lead completes it with evidence on time', async ({ page }) => {
    await login(page, 'founder', /\/dashboard\//);
    await page.goto(reportUrl);
    await expect(page.getByText('Locked snapshot')).toBeVisible();
    await page.getByLabel('Rating').selectOption('4');
    await page.getByLabel(/^Note$/).fill('Clear risk with a concrete fix');
    await page.getByRole('button', { name: 'Save review' }).click();
    await expect(page.getByText(/Reviewed by .* · 4\/5/)).toBeVisible();

    await page.goto('/cx/action-items');
    await page.getByRole('button', { name: 'New action item' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'New action item' });
    await dlg.getByLabel(/^Title/).fill(itemTitle);
    await dlg.getByLabel(/^Owner/).selectOption({ label: '[DEMO] Sales Team Lead' });
    await dlg.getByRole('button', { name: 'Create action item' }).click();
    await page.getByLabel('Show').selectOption('all');
    await expect(page.getByText(itemTitle)).toBeVisible();
    await logout(page);

    await login(page, 'teamlead', /\/dashboard\//);
    await page.goto('/cx/action-items');
    const li = page.getByRole('listitem').filter({ hasText: itemTitle });
    await expect(li).toBeVisible();
    await li.getByRole('button', { name: 'Start' }).click();
    await expect(li).toContainText('In progress');
    await li.getByRole('button', { name: 'Mark complete' }).click();
    const d = page.getByRole('dialog', { name: 'Mark complete' });
    await d.getByLabel(/What was done/).fill('Published to the SOP centre');
    // evidence is mandatory: nothing is sent without it
    await d.getByRole('button', { name: 'Mark complete' }).click();
    await expect(d).toBeVisible();
    await d.getByLabel(/^Evidence/).fill('SOP-OBJ v3, approved');
    await d.getByRole('button', { name: 'Mark complete' }).click();
    await expect(li).toContainText('Done on time');
    await expect(li).toContainText('SOP-OBJ v3, approved');
    await li.getByRole('button', { name: 'Show history' }).click();
    await expect(li).toContainText('IN_PROGRESS → COMPLETED');
    await expect(page.getByText('Completed on time')).toBeVisible();
  });
});

test.describe('collaboration: cross-team tasks with department-scoped visibility', () => {
  const taskTitle = `[E2E] Reminder copy ${stamp}`;
  test('Team Lead hands a task to Marketing; Marketing sees it, Operations does not; completion is confirmed by the requester', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, 'teamlead', /\/dashboard\//);
    await page.goto('/collaboration');
    await page.getByRole('button', { name: 'New task' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'New cross-team task' });
    await dlg.getByLabel(/^Title/).fill(taskTitle);
    await dlg.getByLabel(/^Department/).selectOption('MARKETING');
    await dlg.getByLabel(/^Owner/).selectOption({ label: '[DEMO] Marketing' });
    await dlg.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('button', { name: taskTitle })).toBeVisible();
    await logout(page);

    await login(page, 'marketing', /\/dashboard\//);
    await page.goto('/collaboration');
    await page.getByRole('button', { name: taskTitle }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Start' }).click();
    await sheet.getByRole('button', { name: 'Mark done' }).click();
    const done = page.getByRole('dialog', { name: 'Mark done' });
    await done.getByLabel(/What was delivered/).fill('Three reminders in English and Hindi');
    await done.getByRole('button', { name: 'Mark done' }).click();
    await expect(sheet.getByText('Completed').first()).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Confirm completion' })).toHaveCount(0); // the assignee cannot confirm own work
    await page.keyboard.press('Escape'); // close the task sheet before using the account menu
    await expect(sheet).toHaveCount(0);
    await logout(page);

    await login(page, 'operations', /\/dashboard\//);
    await page.goto('/collaboration');
    await expect(page.getByRole('button', { name: taskTitle })).toHaveCount(0); // other department: not visible
    await logout(page);

    await login(page, 'teamlead', /\/dashboard\//);
    await page.goto('/collaboration');
    await page.getByRole('button', { name: taskTitle }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm completion' }).click();
    await expect(page.getByRole('dialog').getByText(/Confirmed by/)).toBeVisible();
  });
});
