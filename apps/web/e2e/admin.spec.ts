import { expect, test } from '@playwright/test';
import { login } from './helpers';

const stamp = Date.now().toString(36);

test.describe.configure({ mode: 'serial' });

test.describe('admin: users, teams, settings, audit (real API + DB)', () => {
  const email = `e2e.${stamp}@demo.salesos.local`;
  const name = `[DEMO] E2E User ${stamp}`;

  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', /\/dashboard\/admin/);
  });

  test('invite, edit, change roles, deactivate and reactivate a user', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await page.getByRole('button', { name: /invite user/i }).click();
    const sheet = page.getByRole('dialog', { name: /invite a user/i });
    await sheet.getByLabel(/full name/i).fill(name);
    await sheet.getByLabel(/work email/i).fill(email);
    await sheet.getByRole('button', { name: /send invite/i }).click();
    await expect(page.getByText(`Invite sent to ${name}`)).toBeVisible();

    await page.getByRole('searchbox', { name: /search users/i }).fill(stamp);
    const row = () => page.getByRole('row', { name: new RegExp(email) });
    await expect(row()).toBeVisible();

    await row().getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: /edit user/i });
    await edit.getByLabel(/full name/i).fill(`${name} Edited`);
    await edit.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText('User updated')).toBeVisible();
    await expect(row()).toContainText('Edited');

    await row().getByRole('button', { name: 'Roles' }).click();
    const roles = page.getByRole('dialog', { name: /roles for/i });
    await roles.getByRole('checkbox', { name: 'Marketing' }).click();
    await roles.getByRole('button', { name: /save roles/i }).click();
    await expect(page.getByText(/roles updated for/i)).toBeVisible();
    await expect(row()).toContainText('Marketing');

    await row().getByRole('button', { name: 'Deactivate' }).click();
    const dlg = page.getByRole('dialog', { name: /deactivate/i });
    await dlg.getByLabel(/reason/i).fill('E2E test');
    await dlg.getByRole('button', { name: /deactivate user/i }).click();
    await expect(page.getByText(/was deactivated/i)).toBeVisible();
    await expect(row()).toContainText('Inactive');

    await row().getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByText(/was reactivated/i)).toBeVisible();
    await expect(row()).toContainText('Active');
  });

  test('teams: create a team, add a member, soft-limit guidance is shown', async ({ page }) => {
    await page.goto('/admin/teams');
    await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
    await page
      .getByRole('button', { name: /create team/i })
      .first()
      .click();
    const dlg = page.getByRole('dialog', { name: /create a team/i });
    await dlg.getByLabel(/team name/i).fill(`[DEMO] E2E Team ${stamp}`);
    await dlg.getByRole('button', { name: /create team/i }).click();
    await expect(page).toHaveURL(/\/admin\/teams\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(stamp) })).toBeVisible();
    await expect(page.getByText(/guidance is \d+ executives per manager/i)).toBeVisible();

    await page.getByRole('combobox').click();
    await page.getByRole('combobox').fill('Executive A1');
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.getByText('Member added')).toBeVisible();
    await expect(page.getByRole('row', { name: /Executive A1/ })).toBeVisible();
  });

  test('org settings: change and persist the soft limit', async ({ page }) => {
    await page.goto('/admin/settings');
    const input = page.getByLabel(/executives per manager/i);
    await expect(input).toBeVisible();
    await input.fill('6');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/executives per manager/i)).toHaveValue('6');
    await page.getByLabel(/executives per manager/i).fill('5');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();
  });

  test('audit log lists entries and filters', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    await page.getByLabel('Action').fill('NO_SUCH_ACTION_EVER');
    await page.getByRole('button', { name: /apply filters/i }).click();
    await expect(page.getByText('No audit entries')).toBeVisible();
  });

  test('roles catalogue renders', async ({ page }) => {
    await page.goto('/admin/roles');
    await expect(
      page.getByRole('heading', { level: 1, name: /roles and permissions/i }),
    ).toBeVisible();
    await expect(page.getByText('users:view').first()).toBeVisible();
  });
});
