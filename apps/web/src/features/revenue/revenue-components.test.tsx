import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  can: vi.fn((...args: Array<string | string[] | undefined>) => args.length >= 0),
  roles: new Set<string>(['FOUNDER_CEO']),
  search: new URLSearchParams(),
}));

vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: h.post, patch: h.patch, put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/features/auth/auth-provider', () => {
  const can = (p: string | string[] | null) => (p === null ? true : h.can(p as string));
  return {
    useAuth: () => ({ can, hasRole: (r: string) => h.roles.has(r), user: { id: 'u1' } }),
    usePermission: (p: string | string[]) => h.can(p as string),
    Can: ({ children, permission, fallback = null }: { children: React.ReactNode; permission: string | string[]; fallback?: React.ReactNode }) => (h.can(permission as string) ? <>{children}</> : <>{fallback}</>),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/revenue', useSearchParams: () => h.search }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { DealDetailPage } from './deal-detail';
import { CloseDealDialog, RecordPaymentDialog, RequestRefundDialog } from './deal-dialogs';
import { RefundsPage } from './refunds-page';
import { TargetDialog } from './targets-page';
import { DataState, MoneyFacts } from './common';

const AXE = { rules: { region: { enabled: false } } };

const dealMoney = (o: Record<string, string | null> = {}) => ({
  currency: 'INR', saleValue: '100000.00', originalSaleValue: '100000.00', adjustmentsTotal: '0.00', collected: '40000.00', pendingVerification: '10000.00', amountDue: '60000.00', overCollected: '0.00',
  refunded: '5000.00', refundApprovedNotProcessed: '0.00', refundOpenRequests: '0.00', netCollections: '35000.00', refundable: '35000.00', collectionPct: '40.0', ...o,
});
const dealDetail = (o: Record<string, unknown> = {}) => ({
  id: 'd1', leadId: 'l1', leadName: 'Asha Rao', leadStatus: 'WON', programId: 'p1', programName: 'CBAX', programCode: 'CBAX', fromProgramId: null, fromProgramName: null, ownerId: 'u2', ownerName: 'Exec A1', teamId: null,
  stage: 'WON', dealType: 'NEW', amount: '100000.00', currency: 'INR', enrolments: 1, expectedCloseOn: null, isHighValue: false, highValueThreshold: null, escalationLevel: 0, closedAt: '2026-10-10T05:00:00Z', lostReason: null, note: null,
  money: dealMoney(), version: 3, createdAt: '2026-10-01T05:00:00Z', updatedAt: '2026-10-10T05:00:00Z', history: [{ id: 'h1', oldStage: null, newStage: 'OPEN', reason: null, changedByName: 'Exec A1', at: '2026-10-01T05:00:00Z' }, { id: 'h2', oldStage: 'OPEN', newStage: 'WON', reason: null, changedByName: 'Exec A1', at: '2026-10-10T05:00:00Z' }], blockers: [],
  salesRecord: { id: 's1', saleValue: '100000.00', currency: 'INR', closedAt: '2026-10-10T05:00:00Z', credits: [{ userId: 'u2', userName: 'Exec A1', sharePct: '100.00', amount: '100000.00' }], adjustments: [] },
  payments: [
    { id: 'p1', status: 'VERIFIED', amount: '40000.00', expectedAmount: null, dueDate: null, method: 'UPI', provider: 'MANUAL', externalTransactionRef: 'UTR1', paidAt: null, verifiedAt: '2026-10-11T05:00:00Z', createdAt: '2026-10-11T05:00:00Z' },
    { id: 'p2', status: 'EXPECTED', amount: '60000.00', expectedAmount: '60000.00', dueDate: '2026-11-10', method: null, provider: 'MANUAL', externalTransactionRef: null, paidAt: null, verifiedAt: null, createdAt: '2026-10-10T05:00:00Z' },
  ],
  refunds: [],
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.can.mockImplementation(() => true);
  h.roles = new Set(['FOUNDER_CEO']);
  h.search = new URLSearchParams();
  h.get.mockImplementation(async (path: string) => {
    if (path === '/deals/d1') return { data: dealDetail(), meta: {} };
    if (path === '/leads/meta') return { data: { stages: [], lostReasons: [{ key: 'PRICE', label: 'Price', requiresNote: false }, { key: 'OTHER', label: 'Other', requiresNote: true }], sources: [], programs: [], callOutcomes: [], objectionCategories: [], taskTypes: [] }, meta: {} };
    if (path === '/revenue/programs') return { data: [{ id: 'p1', code: 'CBAX', name: 'CBAX', kind: 'PROGRAM' }], meta: {} };
    return { data: [], meta: { pagination: { hasMore: false } } };
  });
});

describe('deal detail: sale, due, collected, refunded and net are never conflated', () => {
  it('shows all five numbers separately with INR and warns that closed-won is not paid', async () => {
    renderWithProviders(<DealDetailPage id="d1" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeInTheDocument();
    const facts = within(screen.getByRole('region', { name: /sale value and money/i }));
    const pairs: Array<[string, string]> = [['Sale value', 'INR 1,00,000.00'], ['Amount due', 'INR 60,000.00'], ['Collected', 'INR 40,000.00'], ['Refunded', 'INR 5,000.00'], ['Net collections', 'INR 35,000.00']];
    for (const [label, value] of pairs) {
      const dt = facts.getByText(label, { selector: 'dt' });
      expect(dt.nextElementSibling).toHaveTextContent(value);
    }
    expect(screen.getByText(/closed won but not fully paid\. INR 60,000\.00 is still due/i)).toBeInTheDocument();
    expect(screen.getByText(/recorded but not yet verified: INR 10,000\.00/i)).toBeInTheDocument();
    expect(await axe(document.body, AXE)).toHaveNoViolations();
  });

  it('shows no unpaid warning once the sale is fully collected', async () => {
    h.get.mockImplementation(async () => ({ data: dealDetail({ money: dealMoney({ collected: '100000.00', amountDue: '0.00', refunded: '0.00', netCollections: '100000.00', pendingVerification: '0.00', collectionPct: '100.0' }) }), meta: {} }));
    renderWithProviders(<DealDetailPage id="d1" />);
    await screen.findByRole('heading', { level: 1, name: 'Asha Rao' });
    expect(screen.queryByText(/not fully paid/i)).not.toBeInTheDocument();
  });

  it('a summary-only role sees the stage but no amounts or money block', async () => {
    h.get.mockImplementation(async () => ({ data: dealDetail({ amount: null, money: null, leadName: null, payments: undefined, refunds: undefined, salesRecord: undefined, blockers: [], history: [] }), meta: {} }));
    renderWithProviders(<DealDetailPage id="d1" />);
    expect(await screen.findByText(/summary level only/i)).toBeInTheDocument();
    expect(screen.queryByText('Amount due')).not.toBeInTheDocument();
    expect(screen.queryByText('Net collections')).not.toBeInTheDocument();
  });

  it('hides actions the role lacks and shows a load error with retry', async () => {
    h.can.mockImplementation((p) => !['collections:create', 'refunds:request', 'sales-adjustments:create'].includes(String(p)));
    renderWithProviders(<DealDetailPage id="d1" />);
    await screen.findByRole('heading', { level: 1, name: 'Asha Rao' });
    expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request refund/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adjust sale/i })).not.toBeInTheDocument();
  });

  it('shows an error state when the deal cannot be loaded', async () => {
    h.get.mockRejectedValue(new Error('boom'));
    renderWithProviders(<DealDetailPage id="d1" />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('close deal dialog', () => {
  const deal = { id: 'd1', amount: '50000.00', ownerId: 'u2', ownerName: 'Exec A1', leadName: 'Asha Rao' };

  it('blocks a payment plan that does not add up to the final amount, then submits once with an Idempotency-Key', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({ data: { id: 'd1', stage: 'WON' }, meta: {} });
    renderWithProviders(<CloseDealDialog open onOpenChange={() => undefined} deal={deal} />);
    expect(await screen.findByText(/does not mean the money has arrived/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add installment/i }));
    await user.type(screen.getByLabelText(/installment 1 amount/i), '20000');
    await user.type(screen.getByLabelText(/due date/i), '2026-11-10');
    expect(screen.getByText(/must match the final amount \(difference INR 30,000\.00\)/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close as won/i }));
    expect(h.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /add installment/i }));
    await user.type(screen.getByLabelText(/installment 2 amount/i), '30000');
    const dues = screen.getAllByLabelText(/due date/i);
    await user.type(dues[1]!, '2026-12-10');
    expect(screen.getByText(/the plan adds up to INR 50,000\.00$/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close as won/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    const [path, body, opts] = h.post.mock.calls[0]!;
    expect(path).toBe('/deals/d1/close');
    expect(body).toEqual({ outcome: 'WON', finalAmount: '50000.00', paymentPlan: [{ amount: '20000.00', dueDate: '2026-11-10' }, { amount: '30000.00', dueDate: '2026-12-10' }] });
    expect(opts.headers['Idempotency-Key']).toMatch(/.{8,}/);
  });

  it('closing lost needs a reason, and a note when the reason requires one', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({ data: {}, meta: {} });
    renderWithProviders(<CloseDealDialog open onOpenChange={() => undefined} deal={deal} />);
    await user.click(screen.getByRole('tab', { name: /closed lost/i }));
    await user.click(screen.getByRole('button', { name: /close as lost/i }));
    expect(await screen.findByText('Choose a reason')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await user.selectOptions(await screen.findByLabelText(/lost reason/i), 'OTHER');
    await user.click(screen.getByRole('button', { name: /close as lost/i }));
    expect(await screen.findByText(/a note is required for this reason/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^note/i), 'Chose another course');
    await user.click(screen.getByRole('button', { name: /close as lost/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![1]).toEqual({ outcome: 'LOST', lostReason: 'OTHER', lostNote: 'Chose another course' });
  });

  it('shows the server error inside the dialog and does not claim success', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api/client');
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'INVALID_TRANSITION', message: 'Cannot move lead from NEW to WON' }));
    renderWithProviders(<CloseDealDialog open onOpenChange={() => undefined} deal={deal} />);
    await user.click(await screen.findByRole('button', { name: /close as won/i }));
    expect(await screen.findByText(/cannot move lead from new to won/i)).toBeInTheDocument();
    expect(screen.queryByText(/deal closed/i)).not.toBeInTheDocument();
  });
});

describe('record payment dialog', () => {
  const deal = { id: 'd1', leadName: 'Asha Rao', money: dealMoney(), payments: dealDetail().payments as never };

  it('validates, links to a planned installment and posts the payment as awaiting verification', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({ data: { id: 'pay1', status: 'RECORDED' }, meta: {} });
    renderWithProviders(<RecordPaymentDialog open onOpenChange={() => undefined} deal={deal} />);
    expect(await screen.findByText(/does not credit the sale/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^record payment$/i }));
    expect(await screen.findByText(/enter an amount above zero/i)).toBeInTheDocument();
    expect(screen.getByText(/enter at least 3 characters/i)).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText(/planned installment/i), 'p2');
    expect((screen.getByLabelText(/amount received/i) as HTMLInputElement).value).toBe('60000.00');
    await user.type(screen.getByLabelText(/transaction reference/i), 'UTR998877');
    await user.click(screen.getByRole('button', { name: /^record payment$/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    const [path, body, opts] = h.post.mock.calls[0]!;
    expect(path).toBe('/collections');
    expect(body).toMatchObject({ dealId: 'd1', amount: '60000.00', method: 'UPI', externalTransactionRef: 'UTR998877', expectedPaymentId: 'p2', currency: 'INR', provider: 'MANUAL' });
    expect(body.paidAt).toMatch(/Z$/);
    expect(opts.headers['Idempotency-Key']).toBeTruthy();
  });

  it('only digits and a decimal point can be typed into the amount', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecordPaymentDialog open onOpenChange={() => undefined} deal={deal} />);
    const input = await screen.findByLabelText(/amount received/i);
    await user.type(input, '12abc.5-0e');
    expect((input as HTMLInputElement).value).toBe('12.50');
  });
});

describe('request refund dialog', () => {
  const deal = { id: 'd1', leadName: 'Asha Rao', money: dealMoney({ refundable: '35000.00' }), payments: dealDetail().payments as never };
  it('refuses an amount above what is refundable and states that nothing is paid automatically', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({ data: { id: 'r1' }, meta: {} });
    renderWithProviders(<RequestRefundDialog open onOpenChange={() => undefined} deal={deal} />);
    expect(await screen.findByText(/no automatic refund/i)).toBeInTheDocument();
    expect(screen.getByText(/refundable now: INR 35,000\.00/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/refund amount/i), '35000.01');
    await user.type(screen.getByLabelText(/explain the request/i), 'Learner asked to cancel');
    await user.click(screen.getByRole('button', { name: /^request refund$/i }));
    expect(await screen.findByText(/enter an amount above zero, up to INR 35,000\.00/i)).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText(/refund amount/i));
    await user.type(screen.getByLabelText(/refund amount/i), '35000');
    await user.click(screen.getByRole('button', { name: /^request refund$/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![1]).toEqual({ dealId: 'd1', amount: '35000.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Learner asked to cancel' });
  });
});

describe('refund workflow shows only the authorised next step', () => {
  const refund = (status: string) => ({ id: 'r1', dealId: 'd1', leadName: 'Asha Rao', status, amount: '5000.00', approvedAmount: null, processedAmount: null, currency: 'INR', reasonCategory: 'LEARNER_REQUEST', reason: 'Learner asked', requested: { id: 'u2', name: 'Exec A1', role: 'SALES_EXECUTIVE', at: '2026-10-10T05:00:00Z' }, requestedAt: '2026-10-10T05:00:00Z', events: [{ id: 'e1', fromStatus: null, toStatus: 'REQUESTED', actorId: 'u2', actorName: 'Exec A1', actorRole: 'SALES_EXECUTIVE', reason: 'Learner asked', at: '2026-10-10T05:00:00Z' }, { id: 'e2', fromStatus: 'REQUESTED', toStatus: 'REVIEWED', actorId: 'u3', actorName: 'Manager A', actorRole: 'SALES_MANAGER', reason: 'Checked', at: '2026-10-11T05:00:00Z' }] });
  const setup = (status: string) => {
    h.search = new URLSearchParams('open=r1');
    h.get.mockImplementation(async (path: string) => {
      if (path === '/refunds/r1') return { data: refund(status), meta: {} };
      if (path === '/refunds') return { data: [refund(status)], meta: { pagination: { hasMore: false } } };
      return { data: [], meta: {} };
    });
  };

  it('REVIEWED with approve authority: Approve and Reject only, never Record payout; the trail shows actor and role', async () => {
    setup('REVIEWED');
    h.can.mockImplementation((p) => ['refunds:view', 'refunds:approve'].includes(String(p)));
    renderWithProviders(<RefundsPage />);
    const dlg = await screen.findByRole('dialog', { name: /refund/i });
    const actions = await within(dlg).findByRole('group', { name: /next step/i });
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual(['Approve', 'Reject']);
    expect(await within(dlg).findByText(/Manager A/)).toBeInTheDocument();
    expect(within(dlg).getByText(/as sales manager/i)).toBeInTheDocument();
  });

  it('APPROVED: only Finance (refunds:process) sees Record payout; others see no action', async () => {
    setup('APPROVED');
    h.can.mockImplementation((p) => ['refunds:view', 'refunds:review'].includes(String(p)));
    const { unmount } = renderWithProviders(<RefundsPage />);
    const dlg = await screen.findByRole('dialog', { name: /refund/i });
    await within(dlg).findByText('Decision trail');
    expect(within(dlg).queryByRole('group', { name: /next step/i })).not.toBeInTheDocument();
    unmount();
    h.can.mockImplementation((p) => ['refunds:view', 'refunds:process'].includes(String(p)));
    renderWithProviders(<RefundsPage />);
    const dlg2 = await screen.findByRole('dialog', { name: /refund/i });
    expect(await within(dlg2).findByRole('button', { name: /record payout/i })).toBeInTheDocument();
  });

  it('approving posts the reason to the approve endpoint and warns that nothing is paid', async () => {
    const user = userEvent.setup();
    setup('REVIEWED');
    h.can.mockImplementation((p) => ['refunds:view', 'refunds:approve'].includes(String(p)));
    h.post.mockResolvedValue({ data: refund('APPROVED'), meta: {} });
    renderWithProviders(<RefundsPage />);
    const dlg = await screen.findByRole('dialog', { name: /^refund$/i });
    await user.click(await within(dlg).findByRole('button', { name: 'Approve' }));
    const form = await screen.findByRole('dialog', { name: /approve this refund/i });
    expect(within(form).getByText(/does not pay anything/i)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Approve' }));
    expect(await within(form).findByText(/write at least 3 characters/i)).toBeInTheDocument();
    await user.type(within(form).getByLabelText(/reason/i), 'Within policy');
    await user.click(within(form).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/refunds/r1/approve', { reason: 'Within policy' }));
  });

  it('terminal refunds offer no actions', async () => {
    setup('REJECTED');
    renderWithProviders(<RefundsPage />);
    const dlg = await screen.findByRole('dialog', { name: /refund/i });
    await within(dlg).findByText('Decision trail');
    expect(within(dlg).queryByRole('group', { name: /next step/i })).not.toBeInTheDocument();
  });
});

describe('target planner live sum validation', () => {
  const parent = { id: 't1', level: 'MANAGER' as const, ownerUserId: 'u3', ownerName: 'Manager A', amount: '600000.00', originalAmount: '600000.00', childrenSum: '350000.00', unallocated: '250000.00', hasChildren: true, hiddenChildren: 0, consistency: 'UNDER_ALLOCATED' as const, children: [] };
  beforeEach(() => {
    h.get.mockImplementation(async (path: string) => {
      if (path === '/users') return { data: [{ id: 'e1', name: 'Exec A1', isActive: true, roles: ['SALES_EXECUTIVE'] }, { id: 'e2', name: 'Exec A2', isActive: true, roles: ['SALES_EXECUTIVE'] }, { id: 'm1', name: 'Manager B', isActive: true, roles: ['SALES_MANAGER'] }], meta: {} };
      return { data: [], meta: {} };
    });
  });

  it('tells the user how much is left, rejects an over-allocation before sending, and accepts a fitting one', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({ data: { id: 'new' }, meta: {} });
    renderWithProviders(<TargetDialog open onOpenChange={() => undefined} periodId="per1" metric="REVENUE" parent={parent} />);
    expect(await screen.findByText(/still unallocated: INR 2,50,000\.00/i)).toBeInTheDocument();
    const owner = await screen.findByLabelText(/^owner/i);
    await waitFor(() => expect(within(owner).getByRole('option', { name: 'Exec A1' })).toBeInTheDocument());
    expect(within(owner).queryByRole('option', { name: 'Manager B' })).not.toBeInTheDocument(); // only executives can be children of a manager
    await user.selectOptions(owner, 'e1');
    await user.type(screen.getByLabelText(/target amount/i), '300000');
    expect(screen.getByText(/more than the INR 2,50,000\.00 still unallocated/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create target/i }));
    expect(h.post).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText(/target amount/i));
    await user.type(screen.getByLabelText(/target amount/i), '200000');
    expect(await screen.findByText(/after this, INR 50,000\.00 stays unallocated/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create target/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]).toEqual(['/targets', { periodId: 'per1', metric: 'REVENUE', level: 'EXECUTIVE', ownerUserId: 'e1', amount: '200000.00', parentId: 't1' }]);
  });

  it('enrolment targets take whole numbers only', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TargetDialog open onOpenChange={() => undefined} periodId="per1" metric="ENROLMENT" parent={{ ...parent, amount: '10', childrenSum: '4', unallocated: '6' }} />);
    const input = await screen.findByLabelText(/number of enrolments/i);
    await user.type(input, '7.5');
    expect((input as HTMLInputElement).value).toBe('75');
    expect(screen.getByText(/more than the 6 still unallocated/i)).toBeInTheDocument();
  });
});

describe('shared building blocks', () => {
  it('DataState renders loading, error, empty and data states', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    const q = (over: Record<string, unknown>) => ({ isPending: false, isError: false, error: null, data: undefined as unknown, refetch, ...over }) as never;
    const { rerender } = renderWithProviders(<DataState q={q({ isPending: true })} empty={{ title: 'Nothing' }}>{() => <p>data</p>}</DataState>);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    rerender(<DataState q={q({ isError: true, error: new Error('x') })} empty={{ title: 'Nothing' }}>{() => <p>data</p>}</DataState>);
    await user.click(await screen.findByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
    rerender(<DataState q={q({ data: [] })} isEmpty={(d: unknown[]) => d.length === 0} empty={{ title: 'Nothing here' }}>{() => <p>data</p>}</DataState>);
    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
    rerender(<DataState q={q({ data: [1] })} isEmpty={(d: number[]) => d.length === 0} empty={{ title: 'Nothing here' }}>{() => <p>data</p>}</DataState>);
    expect(await screen.findByText('data')).toBeInTheDocument();
  });

  it('MoneyFacts is an accessible description list', async () => {
    renderWithProviders(<MoneyFacts items={[{ label: 'Sale value', value: '1000.00' }, { label: 'Collected', value: '0.00', hint: 'verified only' }]} columns={3} />);
    expect(screen.getByText('Sale value').nextElementSibling).toHaveTextContent('INR 1,000.00');
    expect(await axe(document.body, AXE)).toHaveNoViolations();
  });
});
