import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

/** Dev-only demo credentials seeded by the API seed script (documented in the API README). */
export const demoPassword = (local: string) => `Demo!${local.replace(/\./g, '')}#2026`;
export const demoEmail = (local: string) => `${local}@demo.salesos.local`;

export async function login(page: Page, local: string, expectedPath?: RegExp) {
  await page.goto('/login');
  await page.getByLabel(/work email/i).fill(demoEmail(local));
  await page.getByLabel(/^password/i).fill(demoPassword(local));
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(expectedPath ?? /\/dashboard\//);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
}

/**
 * Direct SQL for assertions / time travel that the API deliberately does not offer (e.g. making a task overdue).
 * The database comes from E2E_DB or the DATABASE_URL the API under test uses; the psql client runs inside the local
 * `salesos-postgres` container (override with E2E_PSQL_CONTAINER). Never point this at a database you care about.
 */
export function e2eDatabase(): string {
  if (process.env.E2E_DB) return process.env.E2E_DB;
  const fromUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : '';
  if (!fromUrl) throw new Error('Set E2E_DB (or DATABASE_URL) to the database the API under test uses');
  return fromUrl;
}
export function sql(query: string): string {
  // CI (or E2E_PSQL=local): the psql client on the runner talks to Postgres via PG* env; otherwise the local dev container.
  if (process.env.CI || process.env.E2E_PSQL === 'local') {
    return execFileSync('psql', ['-d', e2eDatabase(), '-tAc', query], { encoding: 'utf8' }).trim();
  }
  const container = process.env.E2E_PSQL_CONTAINER ?? 'salesos-postgres';
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'salesos', '-d', e2eDatabase(), '-tAc', query], { encoding: 'utf8' }).trim();
}
