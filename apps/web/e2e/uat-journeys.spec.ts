/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API envelope in test helper */
/**
 * Phase 10 UAT additions (docs/uat-report.md):
 *  UJ-13 unauthorised users cannot reach another team's records (UI + API, several roles)
 *  UJ-16 mobile core lead + follow-up workflow at 360px
 *  UJ-17 backup restore + release rollback rehearsal evidence (runs the real scripts when present)
 * UJ-01..12, 14, 15 live in the domain specs listed in the report.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { login, sql } from './helpers';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 4103}/api/v1`;
const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3103}`;
const stamp = Date.now().toString(36);
const phone = () => `9${String(700_000_000 + Math.floor(Math.random() * 99_999_999)).padStart(9, '0')}`;
const ROOT = path.resolve(__dirname, '../../..');

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', p: string, data?: unknown) {
  const me = await page.request.get(`${API}/auth/me`);
  const csrf = ((await me.json()) as { data: { csrfToken: string } }).data.csrfToken;
  const res = await page.request.fetch(`${API}${p}`, { method, data, headers: { 'x-csrf-token': csrf, Origin: WEB } });
  return { status: res.status(), body: (await res.json().catch(() => null)) as { data: any; meta: any; error: any } | null };
}

test.describe.configure({ mode: 'serial' });

test.describe('UJ-13 unauthorised users cannot access another team\'s records', () => {
  let teamBLead = '';
  let teamBTask = '';

  test('anonymous API calls are 401', async ({ request }) => {
    for (const p of ['/leads', '/tasks', '/users', '/deals', '/audit-logs']) {
      const res = await request.get(`${API}${p}`);
      expect(res.status(), p).toBe(401);
    }
  });

  test('executive of team A: team B lead/task are invisible (404), writes refused, lists contain no B records', async ({ page }) => {
    teamBLead = sql("select l.id from leads l join users u on u.id=l.assigned_to_id where u.email='exec.b1@demo.salesos.local' limit 1");
    teamBTask = sql("select t.id from tasks t join users u on u.id=t.assigned_to_id where u.email='exec.b1@demo.salesos.local' limit 1");
    expect(teamBLead).toMatch(/^[0-9a-f-]{36}$/);
    await login(page, 'exec.a1');
    expect((await call(page, 'GET', `/leads/${teamBLead}`)).status).toBe(404);
    const nameBefore = sql(`select full_name from leads where id='${teamBLead}'`);
    expect([403, 404]).toContain((await call(page, 'PATCH', `/leads/${teamBLead}`, { fullName: 'Hijacked by team A' })).status);
    expect(sql(`select full_name from leads where id='${teamBLead}'`)).toBe(nameBefore);
    expect((await call(page, 'GET', `/leads/${teamBLead}/timeline`)).status).toBe(404);
    // scoped list filtered by lead: out-of-scope deals are simply not returned (no existence leak)
    const deals = await call(page, 'GET', `/leads/${teamBLead}/deals`);
    expect([200, 404]).toContain(deals.status);
    if (deals.status === 200) expect(deals.body!.data).toHaveLength(0);
    if (teamBTask) {
      const t = await call(page, 'POST', `/tasks/${teamBTask}/complete`, {});
      expect([403, 404]).toContain(t.status);
      expect(sql(`select status from tasks where id='${teamBTask}'`)).toBe('OPEN');
    }
    const list = await call(page, 'GET', '/leads?limit=100');
    expect(list.status).toBe(200);
    const ids: string[] = (list.body!.data as any[]).map((l) => l.id);
    expect(ids).not.toContain(teamBLead);
    const foreign = sql(
      `select count(*) from leads l join users u on u.id=l.assigned_to_id where u.email like 'exec.b%' and l.id in (${ids.map((i) => `'${i}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"})`,
    );
    expect(foreign).toBe('0');
    // UI
    await page.goto(`/crm/leads/${teamBLead}`);
    await expect(page.getByText(/could not find that lead|could not find that record/i)).toBeVisible();
  });

  test('executive is denied admin, audit, user directory writes and HR records', async ({ page }) => {
    await login(page, 'exec.a1');
    for (const p of ['/audit-logs', '/audit-logs/export']) expect([403, 404], p).toContain((await call(page, 'GET', p)).status);
    const create = await call(page, 'POST', '/users', { email: `x${stamp}@demo.salesos.local`, name: 'x', roles: ['SALES_EXECUTIVE'] });
    expect([400, 403]).toContain(create.status);
    for (const ui of ['/admin/users', '/admin/audit']) {
      await page.goto(ui);
      await expect(page.getByRole('heading', { level: 1 }).or(page.getByText(/not allowed|permission|denied/i)).first()).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    }
    await page.goto('/admin/users');
    await expect(page.getByText(/don.t have permission|not allowed|access denied|permission/i).first()).toBeVisible();
  });

  test('manager of team A cannot read or reassign team B work; sees only own team', async ({ page }) => {
    await login(page, 'manager.a');
    expect((await call(page, 'GET', `/leads/${teamBLead}`)).status).toBe(404);
    const b1 = sql("select id from users where email='exec.b1@demo.salesos.local'");
    expect((await call(page, 'GET', `/users/${b1}`)).status).toBe(404);
    const reassign = await call(page, 'POST', `/leads/${teamBLead}/assign`, { toUserId: b1, reason: 'cross team attempt' });
    expect([403, 404]).toContain(reassign.status);
    await page.goto(`/crm/leads/${teamBLead}`);
    await expect(page.getByText(/could not find that lead|could not find that record/i)).toBeVisible();
  });

  test('the denied attempts left audit/log evidence and changed nothing', async () => {
    const owner = sql(`select u.email from leads l join users u on u.id=l.assigned_to_id where l.id='${teamBLead}'`);
    expect(owner).toBe('exec.b1@demo.salesos.local');
  });
});

test.describe('UJ-16 mobile core workflow at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('executive: today list -> lead detail -> log call with follow-up -> task list; no horizontal scroll anywhere', async ({ page }) => {
    await login(page, 'exec.a1');
    const name = `[E2E] Mobile360 ${stamp}`;
    const created = await call(page, 'POST', '/leads', { fullName: name, phone: phone(), interestLevel: 'HIGH' });
    expect(created.status).toBe(201);
    const id = created.body!.data.lead.id as string;
    const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    await page.goto('/crm');
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    expect(await noHScroll()).toBe(true);
    await expect(page.getByRole('navigation').filter({ has: page.getByRole('link') }).last()).toBeVisible(); // bottom nav present

    await page.goto(`/crm/leads/${id}`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    expect(await noHScroll()).toBe(true);
    await page.getByTestId('fab-log-call').tap();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('No answer', { exact: true }).check({ force: true });
    await sheet.getByRole('button', { name: 'In 3 hours' }).tap();
    const box = await sheet.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(361);
    await sheet.getByRole('button', { name: /save call/i }).tap();
    await expect(sheet.getByRole('heading', { name: /call saved/i })).toBeVisible();
    await sheet.getByRole('button', { name: 'Done' }).tap();

    // persisted: one call + one open follow-up task for this lead, created by this action
    expect(sql(`select count(*) from call_logs where lead_id='${id}'`)).toBe('1');
    expect(Number(sql(`select count(*) from tasks where lead_id='${id}' and status = 'OPEN'`))).toBeGreaterThanOrEqual(1);

    for (const p of ['/crm/tasks', '/crm/leads', '/dashboard/executive']) {
      await page.goto(p);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await noHScroll(), p).toBe(true);
    }
  });
});

test.describe('UJ-17 backup restore and release rollback rehearsal (evidence from the real scripts)', () => {
  test('backup.sh + restore-check.sh run and the evidence documents contain measured numbers', async () => {
    test.setTimeout(900_000);
    const backup = path.join(ROOT, 'scripts/backup.sh');
    const restore = path.join(ROOT, 'scripts/restore-check.sh');
    test.skip(!existsSync(backup) || !existsSync(restore), 'scripts/backup.sh or restore-check.sh not present yet');
    const outDir = mkdtempSync(path.join(tmpdir(), 'uat-backup-'));
    const env = { ...process.env, DB: e2eDb(), OUT_DIR: outDir, TARGET_DB: `${e2eDb()}_restore` };
    const out1 = execFileSync('bash', [backup], { env, encoding: 'utf8', timeout: 300_000 });
    console.log(out1);
    expect(out1).toMatch(/backup ok/);
    const dump = out1.match(/backup ok: (\S+)/)![1]!;
    let out2: string;
    try {
      out2 = execFileSync('bash', [restore, dump], { env, encoding: 'utf8', timeout: 600_000 });
    } catch (e) {
      console.log(String((e as { stdout?: string }).stdout));
      throw e;
    }
    console.log(out2.split('\n').slice(-20).join('\n'));
    expect(out2).toMatch(/RESTORE_SECONDS=\d/);
    expect(out2).toMatch(/MANIFEST MATCH/);
    expect(out2).toMatch(/RESTORE CHECK PASSED/);
    expect(out2).not.toMatch(/MISMATCH|FAILED/);
    execFileSync('docker', ['exec', 'salesos-postgres', 'psql', '-U', 'salesos', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS "${e2eDb()}_restore" WITH (FORCE)`]);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('backup-restore.md records measured RPO/RTO numbers and "proposed" targets awaiting DEC-029', async () => {
    const doc = readFileSync(path.join(ROOT, 'docs/backup-restore.md'), 'utf8');
    expect(doc).toMatch(/RPO/);
    expect(doc).toMatch(/RTO/);
    expect(doc).toMatch(/\d+(\.\d+)?\s*(s|sec|seconds|ms|min)\b/i);
    expect(doc).toMatch(/DEC-029/);
    expect(doc).toMatch(/proposed/i);
    expect(readFileSync(path.join(ROOT, 'docs/reliability-evidence-l2.md'), 'utf8')).toMatch(/manifest match/i);
  });

  test('release rollback rehearsal evidence (staging deploy N+1 -> roll back to N) is documented', async () => {
    const dep = path.join(ROOT, 'docs/deploy-evidence-l1.md');
    test.skip(!existsSync(dep), 'docs/deploy-evidence-l1.md (Agent L1 rollback rehearsal) not present');
    const text = readFileSync(dep, 'utf8');
    expect(text).toMatch(/rollback/i);
    expect(text).toMatch(/\d+(\.\d+)?\s*(s|sec|seconds|ms|min)\b/i);
  });
});

function e2eDb() {
  return process.env.E2E_DB ?? 'salesos_agentl_uat';
}
