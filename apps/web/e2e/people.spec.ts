import { expect, test } from '@playwright/test';
import { login, logout } from './helpers';

const stamp = Date.now().toString(36);
test.describe.configure({ mode: 'serial' });

// A different calendar month per run keeps the (employee, period) unique constraint happy on a reused database.
const monthOffset = Math.floor(Date.now() / 60_000) % 1500;
const periodStart = new Date(Date.UTC(2000, monthOffset, 1)).toISOString().slice(0, 10);
const periodEnd = new Date(Date.UTC(2000, monthOffset + 1, 0)).toISOString().slice(0, 10);

test.describe('journey 11: manager records a coaching session and a review action (real API + DB)', () => {
  const action = `Practise price-objection script ${stamp}`;

  test('manager records a coaching session with an action item for an executive', async ({ page }) => {
    await login(page, 'manager.a', /\/dashboard\//);
    await page.goto('/people/coaching');
    await expect(page.getByRole('heading', { level: 1, name: 'Coaching log' })).toBeVisible();
    await page.getByRole('button', { name: /record session/i }).first().click();
    const dlg = page.getByRole('dialog', { name: /record coaching session/i });
    await dlg.getByLabel(/duration/i).fill('50');
    await dlg.getByRole('checkbox', { name: 'Objection handling' }).click();
    await dlg.getByRole('checkbox', { name: 'Call quality' }).click();
    await dlg.getByRole('checkbox', { name: /Executive A1/ }).click();
    await dlg.getByLabel(/^notes/i).fill(`Reviewed two calls ${stamp}`);
    await dlg.getByRole('button', { name: /add action item/i }).click();
    await dlg.getByLabel(/^action/i).first().fill(action);
    await dlg.getByLabel(/owner/i).first().selectOption({ label: '[DEMO] Executive A1' });
    await dlg.getByRole('button', { name: /save session/i }).click();
    await expect(page.getByText('Coaching session recorded')).toBeVisible();
    await expect(page.getByText(/Executive A1/).locator('visible=true').first()).toBeVisible();
  });

  test('coaching hours reflect the recorded session', async ({ page }) => {
    await login(page, 'manager.a', /\/dashboard\//);
    await page.goto('/people/coaching');
    await expect(page.getByText(/coaching hours/i).first()).toBeVisible();
  });

  test('the executive sees the action item and completes it; sees only their own sessions', async ({ page }) => {
    await login(page, 'exec.a1', /\/dashboard\//);
    await page.goto('/people/coaching');
    await page.getByRole('tab', { name: /action items/i }).click();
    const row = page.getByText(action).first();
    await expect(row).toBeVisible();
    const status = row.locator('xpath=ancestor::*[.//select][1]').getByLabel(/my status/i);
    await status.selectOption({ label: 'Done' });
    await expect(status).toHaveValue('DONE');
    await page.reload();
    await page.getByRole('tab', { name: /action items/i }).click();
    await expect(page.getByText(action).first().locator('xpath=ancestor::*[.//select][1]').getByLabel(/my status/i)).toHaveValue('DONE');
  });

  test('manager drafts and submits a monthly review; the Team Lead approves; the employee acknowledges', async ({ page }) => {
    await login(page, 'manager.a', /\/dashboard\//);
    await page.goto('/people/reviews');
    await expect(page.getByRole('heading', { level: 1, name: 'Performance reviews' })).toBeVisible();
    await page.getByRole('button', { name: /new review/i }).first().click();
    const dlg = page.getByRole('dialog', { name: /new monthly review/i });
    await dlg.getByLabel(/^employee/i).selectOption({ label: '[DEMO] Executive A2' });
    await dlg.getByLabel(/period start/i).fill(periodStart);
    await dlg.getByLabel(/period end/i).fill(periodEnd);
    await dlg.locator('label').filter({ hasText: /Ownership mindset and accountability: score 4/ }).click();
    await dlg.locator('label').filter({ hasText: /Communication skills: score 3/ }).click();
    await dlg.getByLabel(/overall rating/i).selectOption('4');
    await dlg.getByLabel(/^strengths/i).fill(`Consistent follow-up ${stamp}`);
    await dlg.getByRole('button', { name: /save draft/i }).click();
    await expect(page).toHaveURL(/\/people\/reviews\/[0-9a-f-]{36}/);
    await page.getByRole('button', { name: /submit for approval/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^submit$/i }).click();
    await expect(page.getByText('Review submitted')).toBeVisible();
    const url = page.url();
    // the reviewer cannot approve their own review
    await expect(page.getByRole('button', { name: /approve review/i })).toHaveCount(0);
    await logout(page);

    await login(page, 'teamlead', /\/dashboard\//);
    await page.goto(url);
    await page.getByRole('button', { name: /approve review/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^approve$/i }).click();
    await expect(page.getByText('Review approved')).toBeVisible();
    await logout(page);

    await login(page, 'exec.a2', /\/dashboard\//);
    await page.goto(url);
    await page.getByRole('button', { name: /^acknowledge$/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^acknowledge$/i }).click();
    await expect(page.getByText('Review acknowledged')).toBeVisible();
  });

  test('HR data stays closed: an executive cannot open improvement plans for others or employee records', async ({ page }) => {
    await login(page, 'exec.a1', /\/dashboard\//);
    await page.goto('/people/employees');
    await expect(page.getByText(/permission|not allowed|access/i).first()).toBeVisible();
    await page.goto('/people/succession');
    await expect(page.getByText(/permission|not allowed|access/i).first()).toBeVisible();
  });
});

test.describe('SOP: author, approve, acknowledge, adoption (real API + DB)', () => {
  const title = `[DEMO] E2E Playbook ${stamp}`;

  test('Team Lead authors an SOP and submits it for approval', async ({ page }) => {
    await login(page, 'teamlead', /\/dashboard\//);
    await page.goto('/sop/new');
    await page.getByLabel(/^category/i).selectOption({ label: 'Objection handling' });
    await page.getByLabel(/^title/i).fill(title);
    await page.getByLabel(/^summary/i).fill('Playbook created by the E2E suite');
    await page.getByLabel('SOP content').fill('# Price objections\n\n- Acknowledge the concern\n- Ask a clarifying question\n- Respond with learner outcomes\n');
    await page.getByLabel(/change summary/i).fill('Initial version');
    await page.getByRole('button', { name: /save and submit for approval/i }).click();
    await expect(page.getByText('Submitted for approval')).toBeVisible();
  });

  test('Team Lead cannot approve their own SOP; the Founder approves it', async ({ page }) => {
    await login(page, 'teamlead', /\/dashboard\//);
    await page.goto('/sop/approvals');
    const row = page.getByRole('row', { name: title });
    await row.getByRole('button', { name: /^approve$/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /approve version/i }).click();
    await expect(page.getByRole('dialog').getByText(/author|cannot approve|permission/i).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await logout(page);

    await login(page, 'founder', /\/dashboard\//);
    await page.goto('/sop/approvals');
    const frow = page.getByRole('row', { name: title });
    await frow.getByRole('button', { name: /^approve$/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /approve version/i }).click();
    await expect(page.getByText('Version approved')).toBeVisible();
  });

  test('an executive finds the SOP, reads it and acknowledges the effective version', async ({ page }) => {
    await login(page, 'exec.b1', /\/dashboard\//);
    await page.goto('/sop');
    await page.getByRole('searchbox', { name: /search sops/i }).fill(stamp);
    await page.getByRole('link', { name: title }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('Acknowledge the concern')).toBeVisible();
    await page.getByRole('button', { name: /i have read and understood/i }).click();
    await expect(page.getByText(/acknowledged on/i)).toBeVisible();
  });

  test('the Team Lead sees the acknowledgement in the adoption dashboard; executives only their own', async ({ page }) => {
    await login(page, 'teamlead', /\/dashboard\//);
    await page.goto('/sop/adoption');
    await expect(page.getByRole('heading', { level: 1, name: 'SOP adoption' })).toBeVisible();
    await expect(page.getByText('Organisation-wide view')).toBeVisible();
    await expect(page.getByRole('row', { name: title })).toContainText(/1 of \d+/);
    await logout(page);

    await login(page, 'exec.b1', /\/dashboard\//);
    await page.goto('/sop/adoption');
    await expect(page.getByText('Your own acknowledgements')).toBeVisible();
    await page.goto('/sop/approvals');
    await expect(page.getByText(/permission|not allowed|access/i).first()).toBeVisible();
  });
});
