import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { demoEmail, demoPassword } from './helpers';

/**
 * Journey 14: an upload is validated, optimised if supported, and downloaded.
 * Journey 15: a failed notification/import is visible and recoverable.
 * Real API + worker + MinIO + Postgres (no mocks). Needs the stack from docs/platform-report.md "Running the E2E".
 */
const API = `http://localhost:${process.env.E2E_API_PORT ?? 4103}/api/v1`;
const stamp = Date.now().toString(36);

/** Same as helpers.login but tolerant of cold Next dev-server compiles (first navigation can take > 8 s). */
async function login(page: Page, local: string, expectedPath: RegExp = /\/dashboard\//) {
  await page.goto('/login');
  await page.getByLabel(/work email/i).fill(demoEmail(local));
  await page.getByLabel(/^password/i).fill(demoPassword(local));
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(expectedPath, { timeout: 90_000 });
}
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function crc(buf: Buffer) {
  return zlib.crc32(buf);
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td) >>> 0);
  return Buffer.concat([len, td, c]);
}
/** Valid RGB PNG built without dependencies (gradient so WebP re-encoding is meaningful). */
function makePng(w: number, h: number) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    raw[o] = 0;
    for (let x = 0; x < w; x++) {
      raw[o + 1 + x * 3] = (x * 255) / w;
      raw[o + 2 + x * 3] = (y * 255) / h;
      raw[o + 3 + x * 3] = 120;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

async function expectNoAxeViolations(page: Page, url: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((v) => `${url} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test.describe('journey 14: upload is validated, optimised and downloaded', () => {
  test('image is processed to WebP, downloadable; abuse is rejected visibly; malware is rejected', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, 'exec.a1');
    await page.goto('/files');
    await expect(page.getByRole('heading', { level: 1, name: 'My files' })).toBeVisible();
    await expectNoAxeViolations(page, '/files');

    const name = `e2e-photo-${stamp}.png`;
    await page.getByTestId('file-input').setInputFiles({ name, mimeType: 'image/png', buffer: makePng(2600, 1800) });
    const row = page.getByTestId('file-row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-status', 'READY', { timeout: 45_000 });
    await expect(row.getByText('Ready', { exact: true })).toBeVisible();
    await expect(row.getByText('Not scanned by an antivirus engine')).toBeVisible(); // honest: no AV engine configured
    await expect(row.getByText(/re-encoded to WebP/)).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe(`e2e-photo-${stamp}.webp`);
    const file = await download.path();
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP');
    expect(bytes.length).toBeLessThan(makePng(2600, 1800).length * 2);

    // abuse: executable, disguised content, double extension, spoofed type
    const input = page.getByTestId('file-input');
    await input.setInputFiles({ name: `setup-${stamp}.exe`, mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]) });
    await expect(page.getByTestId('upload-row').filter({ hasText: `setup-${stamp}.exe` }).getByRole('alert')).toContainText(/not accepted/i);
    await input.setInputFiles({ name: `invoice-${stamp}.pdf`, mimeType: 'application/pdf', buffer: makePng(8, 8) });
    await expect(page.getByTestId('upload-row').filter({ hasText: `invoice-${stamp}.pdf` }).getByRole('alert')).toContainText(/does not match/i);
    await input.setInputFiles({ name: `evil.php.png`, mimeType: 'image/png', buffer: makePng(8, 8) });
    await expect(page.getByTestId('upload-row').filter({ hasText: 'evil.php.png' }).getByRole('alert')).toContainText(/double extension/i);
    const failed = page.getByTestId('upload-row').filter({ hasText: `setup-${stamp}.exe` });
    await expect(failed.getByRole('button', { name: 'Retry upload' })).toBeVisible();
    await failed.getByRole('button', { name: 'Dismiss' }).click();
    await expect(failed).toHaveCount(0);

    // malware test string: accepted as text, then rejected by the scan hook, never downloadable
    const virus = `eicar-${stamp}.csv`;
    await input.setInputFiles({ name: virus, mimeType: 'text/csv', buffer: Buffer.from(`a,b\n${EICAR}\n`) });
    const vrow = page.getByTestId('file-row').filter({ hasText: virus });
    await expect(vrow).toHaveAttribute('data-status', 'REJECTED', { timeout: 45_000 });
    await expect(vrow.getByText('Malware detected')).toBeVisible();
    await expect(vrow.getByRole('button', { name: 'Download' })).toHaveCount(0);

    // the worker told the uploader
    await page.goto('/notifications');
    await expect(page.getByText(`File ready: ${name}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`File rejected: ${virus}`)).toBeVisible();
  });

  test('another team cannot see the file', async ({ page, request }) => {
    await login(page, 'exec.b1');
    await page.goto('/files');
    await expect(page.getByTestId('file-row').filter({ hasText: `e2e-photo-${stamp}.png` })).toHaveCount(0);
    void request;
  });
});

test.describe('journey 15: a failed notification is visible and recoverable', () => {
  test('outage -> dead letter -> alert -> retry -> sent (not delivered) -> provider callback -> delivered', async ({ page, request }) => {
    test.setTimeout(180_000);
    const secret = `whsec_e2e_${stamp}_0123456789`;
    const to = `qa-${stamp}@example.com`;
    await login(page, 'admin', /\/dashboard\/admin/);
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations and delivery' })).toBeVisible();
    await expect(page.getByTestId('provider-resend')).toContainText('Blocked');
    await expect(page.getByTestId('provider-resend').getByRole('button', { name: 'Check health' })).toBeVisible();

    const card = page.getByTestId('provider-sandbox-email');
    await card.getByRole('button', { name: 'Configure' }).click();
    const dlg = page.getByRole('dialog', { name: /sandbox/i });
    const enabled = dlg.getByRole('switch', { name: 'Enabled' });
    if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click();
    const outage = dlg.getByRole('switch', { name: 'Simulate provider outage' });
    if ((await outage.getAttribute('aria-checked')) !== 'true') await outage.click();
    await dlg.getByLabel('Webhook signing secret').fill(secret);
    await dlg.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Integration saved')).toBeVisible();

    await card.getByRole('button', { name: 'Send test message' }).click();
    const tdlg = page.getByRole('dialog', { name: 'Send test message' });
    await tdlg.getByLabel(/Recipient/).fill(to);
    await tdlg.getByRole('button', { name: 'Queue test message' }).click();
    await expect(page.getByText('Test message queued')).toBeVisible();

    // visible: dead-lettered in "Needs attention" (retries with backoff happen in the worker)
    await page.getByRole('tab', { name: 'Needs attention' }).click();
    const failedRow = page.getByTestId('delivery-row').filter({ hasText: 'q***' });
    await expect(failedRow.first()).toHaveAttribute('data-status', 'DEAD_LETTER', { timeout: 90_000 });
    await expect(failedRow.first()).toContainText('SANDBOX_SIMULATED_OUTAGE');
    await expectNoAxeViolations(page, '/admin/integrations');

    // visible: the admin got an in-app alert, reachable from the bell
    await page.goto('/notifications');
    await expect(page.getByText(/email message could not be delivered/).first()).toBeVisible({ timeout: 20_000 });

    // recoverable: end the outage, retry
    await page.goto('/admin/integrations');
    await page.getByTestId('provider-sandbox-email').getByRole('button', { name: 'Configure' }).click();
    const dlg2 = page.getByRole('dialog', { name: /sandbox/i });
    await dlg2.getByRole('switch', { name: 'Simulate provider outage' }).click();
    await dlg2.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Integration saved')).toBeVisible();
    await page.getByRole('tab', { name: 'Needs attention' }).click();
    await page.getByTestId('delivery-row').filter({ hasText: 'q***' }).first().getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Queued for retry')).toBeVisible();

    // honest: accepted by the provider, NOT shown as delivered
    await page.getByRole('tab', { name: 'Delivery log' }).click();
    const rows = page.getByTestId('delivery-row').filter({ hasText: 'q***' });
    const sent = rows.first();
    await expect(sent).toHaveAttribute('data-status', 'SENT', { timeout: 60_000 });
    await expect(sent).toContainText('not confirmed delivered');
    await expect(sent.getByText('Delivered', { exact: true })).toHaveCount(0);

    // provider callback (the `request` fixture has no cookies, like a real provider): forged signature is rejected; the genuine one confirms delivery
    const list = await page.request.get(`${API}/integrations/deliveries?status=SENT&limit=50`);
    const ref = ((await list.json()).data as Array<{ providerReference: string; provider: string; to: string }>).find((d) => d.provider === 'sandbox-email' && d.to.startsWith('q***'))!.providerReference;
    const body = JSON.stringify({ id: `evt-${stamp}`, type: 'delivery.status', data: { reference: ref, status: 'delivered' } });
    const t = Math.floor(Date.now() / 1000);
    const sig = (s: string) => `t=${t},v1=${createHmac('sha256', s).update(`${t}.${body}`).digest('hex')}`;
    const forged = await request.post(`${API}/integrations/webhooks/sandbox-email`, { data: body, headers: { 'content-type': 'application/json', 'x-signature': sig('attacker-secret') } });
    expect(forged.status()).toBe(401);
    const real = await request.post(`${API}/integrations/webhooks/sandbox-email`, { data: body, headers: { 'content-type': 'application/json', 'x-signature': sig(secret) } });
    expect(real.status()).toBe(200);
    expect((await real.json()).data.outcome).toBe('APPLIED');
    const replay = await request.post(`${API}/integrations/webhooks/sandbox-email`, { data: body, headers: { 'content-type': 'application/json', 'x-signature': sig(secret) } });
    expect((await replay.json()).data.duplicate).toBe(true);

    await page.reload();
    await page.getByRole('tab', { name: 'Delivery log' }).click();
    await expect(page.getByTestId('delivery-row').filter({ hasText: 'q***' }).first()).toHaveAttribute('data-status', 'DELIVERED', { timeout: 30_000 });
  });

  test('notification centre: bell, page, preferences; axe', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, 'exec.a1');
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    await expect(page.getByTestId('notification-item').first()).toBeVisible();
    await expectNoAxeViolations(page, '/notifications');
    const bell = page.getByTestId('notification-bell');
    await bell.click();
    await expect(page.getByTestId('stream-mode')).toHaveText('Live updates on', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Mark all as read' }).first().click();
    await expect(page.getByTestId('notification-badge')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'My preferences' }).click();
    await expect(page.getByText(/not sent/i).first()).toBeVisible();
    const sw = page.getByRole('switch', { name: 'Follow-up due - Email' });
    const before = (await sw.getAttribute('aria-checked')) === 'true';
    await sw.click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Preferences saved')).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'My preferences' }).click();
    await expect(page.getByRole('switch', { name: 'Follow-up due - Email' })).toHaveAttribute('aria-checked', String(!before));
  });
});
