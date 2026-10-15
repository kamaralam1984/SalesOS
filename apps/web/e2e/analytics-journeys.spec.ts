import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Phase 5 journeys against the REAL API + database (no mocks):
 *  UJ-01 Founder logs in and views company-level performance (numbers equal the KPI endpoint, definitions and freshness shown, export works)
 *  UJ-02 Team Lead reviews targets and manager scorecards (scorecards equal the team-performance report; filters cannot widen scope)
 * plus role scoping, admin = system health only, reconciliation evidence, accessibility and mobile layout.
 */
const API = `http://localhost:${process.env.E2E_API_PORT ?? 4103}/api/v1`;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function apiGet<T>(page: Page, path: string): Promise<T> {
  const r = await page.request.get(`${API}${path}`);
  expect(r.status(), path).toBe(200);
  return ((await r.json()) as { data: T }).data;
}


test.describe('UJ-01 Founder views company-level performance', () => {
  test('dashboard numbers equal the KPI endpoint; every tile carries range, currency and freshness', async ({ page }) => {
    await login(page, 'founder', /\/dashboard\/founder/);
    await expect(page.getByRole('heading', { level: 1, name: 'Company performance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Revenue vs target' })).toBeVisible();
    await expect(page.getByTestId('dashboard-meta')).toContainText('(IST)');

    const rev = await apiGet<{ value: string | null; numerator: string; denominator: string | null }>(page, '/kpis/KPI-REV-001');
    const tile = page.locator('[data-kpi="KPI-REV-001"]').first();
    await expect(tile).toBeVisible();
    if (rev.value !== null) await expect(tile).toContainText(`${rev.value}%`);
    await expect(tile).toContainText('INR');
    await expect(tile).toContainText(/Live, computed/);
    await expect(tile).toContainText(/\d{4}/); // the date range

    const conv = await apiGet<{ value: string | null }>(page, '/kpis/KPI-SAL-001');
    const convTile = page.locator('[data-kpi="KPI-SAL-001"]').first();
    await expect(convTile).toContainText(conv.value === null ? '—' : `${conv.value}%`);

    // the KPIs that have no data say so instead of showing a fake zero
    const dash = await apiGet<{ kpis: Record<string, { value: string | null; nullReason: string | null }> }>(page, '/dashboard/ceo');
    const empty = Object.entries(dash.kpis).find(([, k]) => k.value === null && k.nullReason === 'ZERO_DENOMINATOR');
    if (empty) {
      const t = page.locator(`[data-kpi="${empty[0]}"]`).first();
      await expect(t).toContainText('—');
      await expect(t).toContainText(/Not defined|nothing to divide/i);
      await expect(t).not.toContainText(/NaN|Infinity/);
    }
  });

  test('definition tooltip, chart text summary and table toggle', async ({ page }) => {
    await login(page, 'founder', /\/dashboard\/founder/);
    const tile = page.locator('[data-kpi="KPI-REV-001"]').first();
    await tile.getByRole('button', { name: /^Definition of/ }).click();
    await expect(page.getByText('Proposed default, awaiting owner approval')).toBeVisible();
    await page.keyboard.press('Escape');
    const chart = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Net revenue by month' }) }).last();
    await expect(chart.getByText(/Latest month/)).toBeVisible();
    await chart.getByRole('button', { name: /Table/ }).click();
    await expect(chart.getByRole('table')).toBeVisible();
  });

  test('team filter narrows via the URL and the server still decides the scope', async ({ page }) => {
    await login(page, 'founder', /\/dashboard\/founder/);
    const teams = await apiGet<{ teams: Array<{ id: string; name: string }> }>(page, '/kpis/filter-options');
    test.skip(teams.teams.length === 0, 'no teams in the seed');
    await page.getByRole('combobox', { name: 'Team', exact: true }).selectOption(teams.teams[0]!.id);
    await expect(page).toHaveURL(new RegExp(`teamId=${teams.teams[0]!.id}`));
    await expect(page.getByRole('heading', { name: 'Revenue vs target' })).toBeVisible();
    // a hand-edited URL with a foreign team id yields an empty scope, not other people's data
    await page.goto('/dashboard/founder?teamId=00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: 'Revenue vs target' })).toBeVisible();
    const calls = page.locator('[data-kpi="KPI-PRD-006"]').first();
    if (await calls.count()) await expect(calls).toContainText('0');
  });

  test('exports a CSV through the server (permission, scope, audit) and the file matches the report', async ({ page }) => {
    await login(page, 'founder', /\/dashboard\/founder/);
    const downloadP = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const dl = await downloadP;
    expect(dl.suggestedFilename()).toMatch(/monthly-founder_.*\.csv$/);
    const path = await dl.path();
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(path!, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('KPI-REV-001');
    expect(text).not.toMatch(/NaN|Infinity/);
    await page.goto('/reporting/exports');
    await expect(page.getByRole('heading', { level: 1, name: 'My exports' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'My exports' })).toContainText('Ready');
  });

  test('reconciliation page proves dashboard totals equal the database', async ({ page }) => {
    await login(page, 'founder', /\/dashboard\/founder/);
    await page.goto('/reporting/reconciliation');
    await expect(page.getByRole('heading', { level: 1, name: 'Data reconciliation' })).toBeVisible();
    await expect(page.getByText(/checks passed: dashboard totals equal the raw database totals/)).toBeVisible();
    await expect(page.getByText('Mismatch')).toHaveCount(0);
  });
});

test.describe('UJ-02 Team Lead reviews targets and manager scorecards', () => {
  test('target breakdown, scorecards equal the report, exceptions and people status', async ({ page }) => {
    await login(page, 'teamlead', /\/dashboard\/team-lead/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sales operations' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Target breakdown' })).toBeVisible();
    await expect(page.locator('[data-kpi="KPI-REV-001"]').first()).toBeVisible();
    await expect(page.locator('[data-kpi="KPI-TEA-001"]').first()).toBeVisible();

    const report = await apiGet<{ rows: Array<{ name: string; achievementPct: string | null; revenueTarget: string | null }> }>(page, '/reports/team-performance');
    const table = page.getByRole('table', { name: 'Manager scorecards' });
    await expect(table).toBeVisible();
    const managers = report.rows.filter((r) => /manager/i.test(r.name));
    expect(managers.length).toBeGreaterThan(0);
    for (const m of managers.slice(0, 4)) {
      const row = table.getByRole('row').filter({ hasText: m.name }).first();
      await expect(row).toBeVisible();
      if (m.achievementPct !== null) await expect(row).toContainText(`${m.achievementPct}%`);
      else await expect(row).toContainText('No target set');
    }
    await expect(page.getByRole('heading', { name: 'Exceptions, ageing and reactivation' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Exception summary' }).or(page.getByRole('list', { name: 'Risks and exceptions' }))).toBeVisible();
    await expect(page.getByRole('heading', { name: 'People status' })).toBeVisible();
  });

  test('the team lead cannot open the Founder dashboard; the manager sees only their own team', async ({ page }) => {
    await login(page, 'teamlead', /\/dashboard\/team-lead/);
    await page.goto('/dashboard/founder');
    await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
    await page.context().clearCookies();
    await login(page, 'manager.a', /\/dashboard\/manager/);
    await expect(page.getByRole('heading', { level: 1, name: 'My team' })).toBeVisible();
    const roster = page.getByRole('table', { name: 'Team members' });
    await expect(roster).toBeVisible();
    await expect(roster).not.toContainText('Manager B');
    await expect(roster).not.toContainText('Executive B1');
    await page.goto('/dashboard/team-lead');
    await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
  });

  test('executive workspace shows only their own numbers; admin sees system health and no business data', async ({ page }) => {
    await login(page, 'exec.a1', /\/dashboard\/executive/);
    await expect(page.getByRole('heading', { level: 1, name: 'My performance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My activity' })).toBeVisible();
    await page.goto('/dashboard/founder');
    await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
    await page.context().clearCookies();
    await login(page, 'admin', /\/dashboard\/admin/);
    await expect(page.getByRole('heading', { level: 1, name: 'System health' })).toBeVisible();
    await expect(page.getByText(/operational signals only/i)).toBeVisible();
    await expect(page.getByText(/₹/)).toHaveCount(0);
    const r = await page.request.get(`${API}/kpis/KPI-REV-001`);
    expect(r.status()).toBe(403);
  });
});

test.describe('reports, dictionary and accessibility', () => {
  test('follow-up report shows attempts and unique clients separately; KPI dictionary lists the definitions', async ({ page }) => {
    await login(page, 'teamlead', /\/dashboard\/team-lead/);
    await page.goto('/reporting/follow-ups');
    await expect(page.getByRole('heading', { level: 1, name: 'Follow-up discipline' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Call attempts' }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Unique clients called' }).first()).toBeVisible();
    await page.goto('/reporting/kpis');
    await expect(page.getByRole('heading', { level: 1, name: 'KPI dictionary' })).toBeVisible();
    await expect(page.locator('article#KPI-SAL-005')).toContainText('1 - |F - A| / A');
    await expect(page.locator('article').first()).toContainText('Proposed default');
  });

  test('axe: dashboards and reporting pages have no WCAG A/AA violations (desktop and 390px)', async ({ page }) => {
    test.setTimeout(240_000);
    const plan: Array<[string, string[]]> = [
      ['founder', ['/dashboard/founder', '/reporting', '/reporting/revenue', '/reporting/reconciliation', '/reporting/kpis', '/reporting/exports']],
      ['teamlead', ['/dashboard/team-lead', '/reporting/team-performance', '/reporting/follow-ups']],
      ['manager.a', ['/dashboard/manager']],
      ['exec.a1', ['/dashboard/executive']],
      ['admin', ['/dashboard/admin']],
    ];
    for (const [who, urls] of plan) {
      await page.context().clearCookies();
      await login(page, who);
      for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 800 }]) {
        await page.setViewportSize(size);
        for (const url of urls) {
          await page.goto(url);
          await page.waitForLoadState('networkidle');
          await expect(page.locator('main h1')).toBeVisible();
          if (size.width === 390) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${url} overflows horizontally`).toBe(true);
          const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
          expect(res.violations.map((v) => `${url}@${size.width} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
        }
      }
    }
  });
});
