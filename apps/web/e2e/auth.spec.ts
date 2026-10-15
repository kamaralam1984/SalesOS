import { expect, test } from '@playwright/test';
import { demoEmail, login, logout } from './helpers';

test.describe('authentication and route guards', () => {
  test('unauthenticated visit to a protected route redirects to login with next', async ({
    page,
  }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('wrong password shows an error and does not sign in', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/work email/i).fill(demoEmail('admin'));
    await page.getByLabel(/^password/i).fill('definitely-wrong-Password1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: /incorrect/i })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('client-side validation blocks empty submit', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByText('This field is required').first()).toBeVisible();
  });

  test('admin signs in, lands on the system-health dashboard (operational signals only, no business data), then signs out', async ({
    page,
  }) => {
    await login(page, 'admin', /\/dashboard\/admin/);
    await expect(
      page.getByRole('heading', { level: 1, name: /system health/i }),
    ).toBeVisible();
    await expect(page.getByText(/operational signals only/i)).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Users' }),
    ).toBeVisible();
    await logout(page);
    await expect(page.getByText(/signed out/i).first()).toBeVisible();
    // Session really ended server-side: protected page now bounces.
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login/);
  });

  test('founder lands on founder dashboard; executive is denied admin pages', async ({ page }) => {
    await login(page, 'founder', /\/dashboard\/founder/);
    await logout(page);
    await login(page, 'exec.a1', /\/dashboard\/executive/);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Users' }),
    ).toHaveCount(0);
  });

  test('module pages are real: no placeholder text on the revenue module', async ({ page }) => {
    await login(page, 'founder');
    await page.goto('/revenue');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(/arrives in Phase/i)).toHaveCount(0);
  });

  test('language switch translates the shell and persists', async ({ page }) => {
    await login(page, 'founder');
    await page.getByRole('button', { name: /language/i }).click();
    await page.getByRole('menuitemradio', { name: 'हिन्दी' }).click();
    await expect(page.getByRole('navigation', { name: 'मुख्य नेविगेशन' }).first()).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  });

  test('session revoked server-side mid-session: next API call sends the user to login with a notice', async ({
    page,
    playwright,
  }) => {
    await login(page, 'admin');
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === 'salesos_session')!;
    // Revoke the session on the server using a separate client, leaving the browser's cookie in place.
    const api = await playwright.request.newContext({
      baseURL: `http://localhost:${process.env.E2E_API_PORT ?? 4103}`,
      extraHTTPHeaders: { cookie: `salesos_session=${session.value}` },
    });
    const me = await (await api.get('/api/v1/auth/me')).json();
    const out = await api.post('/api/v1/auth/logout', {
      headers: { 'x-csrf-token': me.data.csrfToken, origin: new URL(page.url()).origin },
      data: {},
    });
    expect(out.ok()).toBeTruthy();
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Teams' })
      .click();
    await expect(page).toHaveURL(/\/login\?.*reason=expired/);
    await expect(page.getByText(/session has ended/i)).toBeVisible();
  });

  test('offline: login does not pretend to succeed and sends nothing', async ({
    page,
    context,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/work email/i).fill(demoEmail('admin'));
    await page.getByLabel(/^password/i).fill('whatever-Password1');
    await context.setOffline(true);
    await expect(page.getByText(/you are offline/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
    await context.setOffline(false);
  });
});
