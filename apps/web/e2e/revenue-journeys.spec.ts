import { expect, test, type Browser, type Page } from '@playwright/test';
import { login, sql } from './helpers';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 4103}/api/v1`;
const WEB = `http://localhost:${process.env.E2E_WEB_PORT ?? 3103}`;
const stamp = Date.now().toString(36);
const phone = () => `9${String(800_000_000 + Math.floor(Math.random() * 99_999_999)).padStart(9, '0')}`;

async function call(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const me = await page.request.get(`${API}/auth/me`);
  const csrf = ((await me.json()) as { data: { csrfToken: string } }).data.csrfToken;
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: { 'x-csrf-token': csrf, Origin: WEB } });
  return { status: res.status(), body: (await res.json().catch(() => null)) as { data: { lead: { id: string } }; error: unknown } | null };
}
async function as(browser: Browser, local: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, local, /\/dashboard\//);
  return page;
}

test.describe.configure({ mode: 'serial' });

const learner = `[E2E] Learner ${stamp}`;
const ref = `E2E-UTR-${stamp}`;
let dealId = '';

test.describe('UJ-07 closed-won sale and verified collection stay distinct', () => {
  test('executive books a sale; it stays unpaid until Finance verifies the payment', async ({ browser }) => {
    const exec = await as(browser, 'exec.a1');
    const lead = await call(exec, 'POST', '/leads', { fullName: learner, phone: phone() });
    expect(lead.status).toBe(201);
    const leadId = lead.body!.data.lead.id as string;
    sql(`UPDATE leads SET status='PROPOSAL_NEGOTIATION', stage_category='OPEN', assigned_to_id=(SELECT id FROM users WHERE email='exec.a1@demo.salesos.local') WHERE id='${leadId}'`);

    await exec.goto('/revenue/deals');
    await expect(exec.getByRole('heading', { level: 1, name: 'Deals' })).toBeVisible();
    await exec.getByRole('button', { name: /new deal/i }).click();
    const dlg = exec.getByRole('dialog', { name: /new deal/i });
    const combo = dlg.getByRole('combobox', { name: /lead/i });
    await combo.click();
    await combo.fill(learner.slice(0, 18));
    await dlg.getByRole('option', { name: new RegExp(learner.replace(/[[\]]/g, '\\$&')) }).click();
    await dlg.getByLabel(/^program/i).selectOption({ label: '[DEMO] CBAX' });
    await dlg.getByLabel(/expected amount/i).fill('75000');
    await dlg.getByRole('button', { name: /create deal/i }).click();
    await expect(exec.getByText('Deal created')).toBeVisible();

    dealId = sql(`SELECT id FROM deals WHERE lead_id='${leadId}'`);
    await exec.goto(`/revenue/deals/${dealId}`);
    await exec.getByRole('button', { name: /close deal/i }).click();
    const close = exec.getByRole('dialog', { name: /close deal/i });
    await expect(close.getByText(/does not mean the money has arrived/i)).toBeVisible();
    await close.getByRole('button', { name: /close as won/i }).click();
    const facts = exec.getByRole('region', { name: /sale value and money/i });
    await expect(facts.getByText('Sale value').locator('xpath=following-sibling::dd')).toContainText('INR 75,000.00');
    await expect(facts.getByText('Collected', { exact: true }).locator('xpath=following-sibling::dd')).toContainText('INR 0.00');
    await expect(facts.getByText('Amount due').locator('xpath=following-sibling::dd')).toContainText('INR 75,000.00');
    await expect(exec.getByText(/closed won but not fully paid/i)).toBeVisible();

    // the manager records the payment: still not collected
    const mgr = await as(browser, 'manager.a');
    await mgr.goto(`/revenue/deals/${dealId}`);
    await mgr.getByRole('button', { name: /record payment/i }).click();
    const rec = mgr.getByRole('dialog', { name: /record a payment/i });
    await rec.getByLabel(/planned installment/i).selectOption({ index: 1 });
    await rec.getByLabel(/transaction reference/i).fill(ref);
    await rec.getByRole('button', { name: /^record payment$/i }).click();
    await expect(mgr.getByText(/payment recorded, waiting for finance/i)).toBeVisible();
    await expect(mgr.getByText(/recorded but not yet verified: INR 75,000\.00/i)).toBeVisible();
    await expect(mgr.getByText('Collected', { exact: true }).locator('xpath=following-sibling::dd')).toContainText('INR 0.00');

    // Finance verifies: now it is collected, the sale value is unchanged
    const fin = await as(browser, 'finance');
    await fin.goto('/revenue/collections');
    const row = fin.getByRole('row', { name: new RegExp(learner.replace(/[[\]]/g, '\\$&')) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /^verify$/i }).click();
    await expect(fin.getByText('Payment verified')).toBeVisible();
    await fin.goto(`/revenue/deals/${dealId}`);
    const f2 = fin.getByRole('region', { name: /sale value and money/i });
    await expect(f2.getByText('Sale value').locator('xpath=following-sibling::dd')).toContainText('INR 75,000.00');
    await expect(f2.getByText('Collected', { exact: true }).locator('xpath=following-sibling::dd')).toContainText('INR 75,000.00');
    await expect(f2.getByText('Amount due').locator('xpath=following-sibling::dd')).toContainText('INR 0.00');
    await expect(f2.getByText('Net collections').locator('xpath=following-sibling::dd')).toContainText('INR 75,000.00');
    await expect(fin.getByText(/not fully paid/i)).toHaveCount(0);
  });
});

test.describe('UJ-08 reconciliation avoids duplicate credit', () => {
  test('a duplicate reference is refused and statement reconciliation locks the payment once', async ({ browser }) => {
    const mgr = await as(browser, 'manager.a');
    await mgr.goto(`/revenue/deals/${dealId}`);
    await mgr.getByRole('button', { name: /record payment/i }).click();
    const rec = mgr.getByRole('dialog', { name: /record a payment/i });
    await rec.getByLabel(/amount received/i).fill('75000');
    await rec.getByLabel(/transaction reference/i).fill(ref);
    await rec.getByRole('button', { name: /^record payment$/i }).click();
    await expect(rec.getByText(/already recorded\. no credit was given/i)).toBeVisible();
    expect(sql(`SELECT count(*) FROM payments WHERE external_transaction_ref='${ref}'`)).toBe('1');

    const fin = await as(browser, 'finance');
    await fin.goto('/revenue/collections');
    await fin.getByRole('tab', { name: /reconciliation/i }).click();
    await fin.getByRole('button', { name: /reconcile with statement/i }).click();
    const dlg = fin.getByRole('dialog', { name: /reconcile with a statement/i });
    await dlg.getByLabel(/statement reference/i).fill(`HDFC-${stamp}`);
    await dlg.getByLabel(/statement lines/i).fill(`${ref}, 75000.00\nNO-SUCH-REF, 10.00`);
    await dlg.getByRole('button', { name: /^reconcile$/i }).click();
    await expect(fin.getByText(/1 matched, 1 not matched/i)).toBeVisible();
    await expect(fin.getByText(/no payment with this reference/i)).toBeVisible();
    expect(sql(`SELECT status FROM payments WHERE external_transaction_ref='${ref}'`)).toBe('RECONCILED');

    // running it again matches nothing new and nothing is credited twice
    await fin.getByRole('button', { name: /reconcile with statement/i }).click();
    const again = fin.getByRole('dialog', { name: /reconcile with a statement/i });
    await again.getByLabel(/statement reference/i).fill(`HDFC-${stamp}`);
    await again.getByLabel(/statement lines/i).fill(`${ref}, 75000.00`);
    await again.getByRole('button', { name: /^reconcile$/i }).click();
    await expect(fin.getByText(/0 matched, 1 not matched/i)).toBeVisible();
    await expect(fin.getByText(/already reconciled/i)).toBeVisible();
    await fin.goto(`/revenue/deals/${dealId}`);
    await expect(fin.getByText('Collected', { exact: true }).locator('xpath=following-sibling::dd')).toContainText('INR 75,000.00');
  });
});

test.describe('UJ-09 refund follows authorised states', () => {
  test('requested, reviewed, approved, processed and reconciled by different actors; nothing is automatic', async ({ browser }) => {
    const exec = await as(browser, 'exec.a1');
    await exec.goto(`/revenue/deals/${dealId}`);
    await exec.getByRole('button', { name: /request refund/i }).click();
    const req = exec.getByRole('dialog', { name: /request a refund/i });
    await expect(req.getByText(/no automatic refund/i)).toBeVisible();
    await req.getByLabel(/refund amount/i).fill('5000');
    await req.getByLabel(/explain the request/i).fill('Learner asked to cancel enrolment');
    await req.getByRole('button', { name: /^request refund$/i }).click();
    await expect(exec.getByText('Refund requested')).toBeVisible();
    const refundId = sql(`SELECT id FROM refunds WHERE deal_id='${dealId}'`);
    // money did not move
    await expect(exec.getByText('Refunded', { exact: true }).locator('xpath=following-sibling::dd')).toContainText('INR 0.00');
    // the executive cannot approve it, even by calling the API
    expect((await call(exec, 'POST', `/refunds/${refundId}/approve`, { reason: 'self service' })).status).toBe(403);

    const mgr = await as(browser, 'manager.a');
    await mgr.goto(`/revenue/refunds?open=${refundId}`);
    const m = mgr.getByRole('dialog', { name: /^refund$/i });
    await expect(m.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await m.getByRole('button', { name: 'Review' }).click();
    const rv = mgr.getByRole('dialog', { name: /review this refund/i });
    await rv.getByLabel(/review note/i).fill('Confirmed with the learner by phone');
    await rv.getByRole('button', { name: 'Review' }).click();
    await expect(mgr.getByText('Review recorded')).toBeVisible();

    const founder = await as(browser, 'founder');
    await founder.goto(`/revenue/refunds?open=${refundId}`);
    const f = founder.getByRole('dialog', { name: /^refund$/i });
    await expect(f.getByRole('button', { name: /record payout/i })).toHaveCount(0);
    await f.getByRole('button', { name: 'Approve' }).click();
    const ap = founder.getByRole('dialog', { name: /approve this refund/i });
    await ap.getByLabel(/reason/i).fill('Within the refund policy');
    await ap.getByRole('button', { name: 'Approve' }).click();
    await expect(founder.getByText('Refund approved')).toBeVisible();
    // approved is not paid: net collections unchanged
    await founder.goto(`/revenue/deals/${dealId}`);
    await expect(founder.getByText('Net collections').locator('xpath=following-sibling::dd')).toContainText('INR 75,000.00');

    const fin = await as(browser, 'finance');
    await fin.goto(`/revenue/refunds?open=${refundId}`);
    const p = fin.getByRole('dialog', { name: /^refund$/i });
    await p.getByRole('button', { name: /record payout/i }).click();
    const pd = fin.getByRole('dialog', { name: /record the payout/i });
    await pd.getByLabel(/payout reference/i).fill(`E2E-RFND-${stamp}`);
    await pd.getByRole('button', { name: /record payout/i }).click();
    await expect(fin.getByText('Payout recorded')).toBeVisible();
    await p.getByRole('button', { name: 'Reconcile' }).click();
    const rc = fin.getByRole('dialog', { name: /reconcile the payout/i });
    await rc.getByLabel(/statement reference/i).fill(`HDFC-RF-${stamp}`);
    await rc.getByRole('button', { name: 'Reconcile' }).click();
    await expect(fin.getByText('Refund reconciled')).toBeVisible();

    await fin.goto(`/revenue/deals/${dealId}`);
    const facts = fin.getByRole('region', { name: /sale value and money/i });
    await expect(facts.getByText('Refunded', { exact: true }).locator('xpath=following-sibling::dd')).toContainText('INR 5,000.00');
    await expect(facts.getByText('Net collections').locator('xpath=following-sibling::dd')).toContainText('INR 70,000.00');
    expect(sql(`SELECT string_agg(to_status::text, '>' ORDER BY created_at) FROM refund_events WHERE refund_id='${refundId}'`)).toBe('REQUESTED>REVIEWED>APPROVED>PROCESSED>RECONCILED');
    expect(sql(`SELECT count(DISTINCT actor_id) FROM refund_events WHERE refund_id='${refundId}'`)).toBe('4');
  });
});
