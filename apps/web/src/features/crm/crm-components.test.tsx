import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/utils';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  apiRequest: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  can: vi.fn((_p?: string) => true),
  preview: vi.fn(),
}));

vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: h.post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiRequest: h.apiRequest,
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ can: h.can, user: { id: 'u1' } }),
  Can: ({ children, permission, fallback = null }: { children: React.ReactNode; permission: string; fallback?: React.ReactNode }) => (h.can(permission) ? <>{children}</> : <>{fallback}</>),
  usePermission: () => true,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/crm/leads' }));

import { DispositionBody } from './disposition-dialog';
import { StatusBody } from './lead-dialogs';
import { DuplicateCompare } from './queue-pages';
import { LeadsPage } from './leads-page';
import { ImportWizard } from './imports-page';
import { Dialog } from '@salesos/ui';
import { useCrmStream } from '@/lib/api/hooks/crm-admin';
import { PendingCallPrompt } from './pending-call-prompt';
import { clearPendingCall, markPendingCall, readPendingCall } from './pending-call';
import { CallButton } from './common';

// fragments are rendered outside page landmarks in unit tests; landmark coverage is checked in the Playwright axe run
const AXE = { rules: { region: { enabled: false } } };

const META = {
  stages: [
    { key: 'NEW', label: 'New', category: 'OPEN', sortOrder: 10 },
    { key: 'QUALIFIED', label: 'Qualified', category: 'OPEN', sortOrder: 40 },
    { key: 'WON', label: 'Won', category: 'WON', sortOrder: 110 },
    { key: 'LOST', label: 'Lost', category: 'LOST', sortOrder: 120 },
  ],
  lostReasons: [{ key: 'PRICE', label: 'Price', requiresNote: false }, { key: 'OTHER', label: 'Other', requiresNote: true }],
  sources: [{ id: 's1', name: 'Referral', type: 'REFERRAL' }],
  programs: [{ id: 'p1', code: 'CBAX', name: 'CBAX', kind: 'PROGRAM' }],
  callOutcomes: ['CONNECTED', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'CALLBACK', 'FAILED', 'WON', 'LOST'].map((key) => ({ key, label: key })),
  objectionCategories: [{ key: 'PRICE', label: 'Price' }],
  taskTypes: [{ key: 'FOLLOW_UP', label: 'Follow up' }, { key: 'DEMO', label: 'Demo' }, { key: 'CALL', label: 'Call' }],
};
const lead = (o: Record<string, unknown> = {}) => ({ id: 'l1', fullName: 'Asha Rao', phone: '+919876543210', status: 'NEW', stageCategory: 'OPEN', source: null, program: null, createdAt: '2026-10-01T00:00:00Z', assignedTo: { id: 'u2', name: 'Exec A1' }, interestLevel: 'HIGH', ...o });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  h.can.mockImplementation(() => true);
  h.get.mockImplementation(async (path: string) => {
    if (path === '/leads/meta') return { data: META, meta: {} };
    if (path === '/leads/views') return { data: [], meta: {} };
    if (path === '/leads') return { data: [lead(), lead({ id: 'l2', fullName: 'Ben Iyer', assignedTo: null })], meta: { pagination: { hasMore: false } } };
    return { data: [], meta: {} };
  });
});

const wrap = (ui: React.ReactElement) => renderWithProviders(<Dialog open>{ui}</Dialog>);

describe('DispositionBody', () => {
  it('is labelled MANUAL and blocks a CONNECTED call without interest and next action', async () => {
    const user = userEvent.setup();
    wrap(<DispositionBody lead={{ id: 'l1', fullName: 'Asha Rao', phone: '+919876543210' }} onOpenChange={() => undefined} />);
    expect(await screen.findByText('MANUAL')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save call/i }));
    expect(await screen.findByText(/choose the lead's interest level/i)).toBeInTheDocument();
    expect(screen.getByText(/choose when to follow up next/i)).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });

  it('requires a callback time for CALLBACK, a reason for LOST (+note when configured) and a value for WON', async () => {
    const user = userEvent.setup();
    wrap(<DispositionBody lead={{ id: 'l1', fullName: 'Asha Rao' }} onOpenChange={() => undefined} />);
    await screen.findByText('MANUAL');
    await user.click(screen.getByLabelText('Callback'));
    await user.click(screen.getByRole('button', { name: /save call/i }));
    expect(await screen.findByText(/choose the callback date and time/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Lost'));
    await user.click(screen.getByRole('button', { name: /save call/i }));
    expect(await screen.findByText(/a lost reason is required/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/lost reason/i), 'OTHER');
    await user.click(screen.getByRole('button', { name: /save call/i }));
    expect(await screen.findByText(/a note is required for this reason/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Won'));
    await user.click(screen.getByRole('button', { name: /save call/i }));
    expect(await screen.findByText(/enter the won value/i)).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });

  it('quick picks fill the next action and a valid NO_ANSWER submits once with an idempotency key and shows created tasks', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({
      data: { call: { id: 'c1', source: 'MANUAL', outcome: 'NO_ANSWER' }, lead: null, tasksCreated: [{ id: 't1', type: 'CALL', dueAt: '2026-10-16T05:00:00Z', title: 'Retry call: Asha Rao (no answer)' }], statusChanges: [{ from: 'NEW', to: 'CONTACT_ATTEMPTED' }] },
      meta: { warnings: ['Maximum no-answer attempts reached: sent to manager review (the lead is NOT marked lost)'] },
    });
    wrap(<DispositionBody lead={{ id: 'l1', fullName: 'Asha Rao' }} onOpenChange={() => undefined} />);
    await screen.findByText('MANUAL');
    await user.click(screen.getByLabelText('No answer'));
    await user.click(screen.getByRole('button', { name: 'Tomorrow 10:00' }));
    expect((screen.getByLabelText(/next follow-up/i) as HTMLInputElement).value).toMatch(/T10:00$/);
    await user.click(screen.getByRole('button', { name: /save call/i }));
    expect(await screen.findByRole('heading', { name: /call saved/i })).toBeInTheDocument();
    expect(screen.getByText(/retry call: asha rao/i)).toBeInTheDocument();
    expect(screen.getByText('NEW → CONTACT_ATTEMPTED')).toBeInTheDocument();
    expect(screen.getByText(/NOT marked lost/)).toBeInTheDocument();
    expect(h.post).toHaveBeenCalledTimes(1);
    const [path, body, opts] = h.post.mock.calls[0]!;
    expect(path).toBe('/leads/l1/calls');
    expect(body).toMatchObject({ outcome: 'NO_ANSWER' });
    expect(body).not.toHaveProperty('source');
    expect(opts.headers['Idempotency-Key']).toMatch(/^ui-call-/);
  });

  it('has no axe violations', async () => {
    const { container } = wrap(<DispositionBody lead={{ id: 'l1', fullName: 'Asha Rao' }} onOpenChange={() => undefined} />);
    await screen.findByText('MANUAL');
    expect(await axe(document.body, AXE)).toHaveNoViolations();
    void container;
  });
});

describe('StatusBody', () => {
  it('requires a lost reason (and note when the reason demands it) before calling the API', async () => {
    const user = userEvent.setup();
    wrap(<StatusBody lead={{ id: 'l1', fullName: 'Asha Rao', status: 'NEW', version: 1 }} onOpenChange={() => undefined} />);
    await screen.findByRole('option', { name: 'Lost' });
    await user.selectOptions(screen.getByLabelText(/new stage/i), 'LOST');
    await user.click(screen.getByRole('button', { name: /change stage/i }));
    expect(await screen.findByText(/a lost reason is required/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/lost reason/i), 'OTHER');
    await user.click(screen.getByRole('button', { name: /change stage/i }));
    expect(await screen.findByText(/a note is required for this reason/i)).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });
  it('shows the API refusal for an illegal transition', async () => {
    const { ApiError } = await import('@/lib/api/client');
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'INVALID_TRANSITION', message: 'Cannot move lead from NEW to QUALIFIED (NOT_ALLOWED)' }));
    const user = userEvent.setup();
    wrap(<StatusBody lead={{ id: 'l1', fullName: 'Asha Rao', status: 'NEW', version: 1 }} onOpenChange={() => undefined} />);
    await screen.findByRole('option', { name: 'Qualified' });
    await user.selectOptions(screen.getByLabelText(/new stage/i), 'QUALIFIED');
    await user.click(screen.getByRole('button', { name: /change stage/i }));
    expect(await screen.findByText(/cannot move lead from NEW to QUALIFIED/i)).toBeInTheDocument();
  });
});

describe('DuplicateCompare', () => {
  const row = { id: 'd1', matchType: 'PHONE_EXACT', status: 'OPEN', leadA: lead({ id: 'a', fullName: 'Priya Verma', email: 'p@x.in' }), leadB: lead({ id: 'b', fullName: 'Priya V', email: null }) } as never;
  it('shows both leads side by side, highlights differences and only merges after a reason and a confirmation', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({ data: { status: 'MERGED' }, meta: {} });
    renderWithProviders(<DuplicateCompare row={row} />);
    expect(screen.getByRole('table', { name: /side-by-side/i })).toBeInTheDocument();
    expect(screen.getByText('Priya Verma', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('Priya V', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText(/same phone number/i)).toBeInTheDocument();
    const merge = screen.getByRole('button', { name: /^merge/i });
    expect(merge).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /keep lead b/i }));
    await user.click(screen.getAllByRole('checkbox', { name: /use the other's value/i })[0]!);
    await user.type(screen.getByLabelText(/reason for your decision/i), 'Same person, B is complete');
    await user.click(merge);
    expect(h.post).not.toHaveBeenCalled(); // confirmation first: never merges silently
    await user.click(await screen.findByRole('button', { name: /merge leads/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![0]).toBe('/leads/duplicates/d1/merge');
    expect(h.post.mock.calls[0]![1]).toMatchObject({ winnerLeadId: 'b', reason: 'Same person, B is complete' });
  });
  it('has no axe violations', async () => {
    renderWithProviders(<DuplicateCompare row={row} />);
    expect(await axe(document.body, AXE)).toHaveNoViolations();
  });
});

describe('LeadsPage five states', () => {
  it('loading, success, empty, error with retry, permission denied', async () => {
    let resolve!: (v: unknown) => void;
    h.get.mockImplementation((path: string) => {
      if (path === '/leads') return new Promise((r) => { resolve = r; });
      return Promise.resolve({ data: path === '/leads/meta' ? META : [], meta: {} });
    });
    const { unmount } = renderWithProviders(<LeadsPage />);
    expect(await screen.findAllByText(/loading/i)).not.toHaveLength(0);
    await act(async () => resolve({ data: [lead(), lead({ id: 'l2', fullName: 'Ben Iyer', assignedTo: null })], meta: { pagination: { hasMore: false } } }));
    expect(await screen.findAllByText('Asha Rao')).not.toHaveLength(0);
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(await axe(document.body, AXE)).toHaveNoViolations();
    unmount();

    h.get.mockImplementation(async (path: string) => ({ data: path === '/leads/meta' ? META : [], meta: { pagination: { hasMore: false } } }));
    const empty = renderWithProviders(<LeadsPage />);
    expect(await screen.findByText(/no leads yet/i)).toBeInTheDocument();
    empty.unmount();

    const { ApiError } = await import('@/lib/api/client');
    h.get.mockImplementation(async (path: string) => {
      if (path === '/leads') throw new ApiError({ status: 500, code: 'X', message: 'boom' });
      return { data: path === '/leads/meta' ? META : [], meta: {} };
    });
    const err = renderWithProviders(<LeadsPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    err.unmount();

    h.can.mockImplementation(() => false);
    renderWithProviders(<LeadsPage />);
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
  });
});

describe('ImportWizard', () => {
  it('walks upload -> map -> options -> submit, validates mapping and sends options with an idempotency key', async () => {
    const user = userEvent.setup();
    const csv = 'Name,Phone\nAsha,9876543210\nBen,12ab\n';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/leads/import/preview')) {
        return new Response(JSON.stringify({ data: { header: ['Name', 'Phone'], totalRows: 2, mapping: { fullName: 0, phone: 1 }, sample: [['Asha', '9876543210']], problems: [] }, meta: {}, error: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { id: 'job1', status: 'QUEUED' }, meta: {}, error: null }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSubmitted = vi.fn();
    renderWithProviders(<ImportWizard onSubmitted={onSubmitted} />);
    const file = new File([csv], 'leads.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText(/csv file/i), file);
    expect(await screen.findByText(/leads\.csv: 2 data rows found/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/full name/i) as HTMLSelectElement).value).toBe('Name');
    await user.selectOptions(screen.getByLabelText(/full name/i), '');
    expect(screen.getByText(/map a column to full name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText(/full name/i), 'Name');
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.selectOptions(screen.getByLabelText(/^assignment/i), 'round_robin');
    await user.click(screen.getByRole('button', { name: /import 2 rows/i }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith('job1'));
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/leads/import') || String(u).includes('/leads/import?'))!;
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('text/csv');
    expect(headers['Idempotency-Key']).toMatch(/^ui-import-/);
    expect(JSON.parse(new URL(String(call[0])).searchParams.get('options')!)).toMatchObject({ assignment: 'round_robin', mapping: { fullName: 'Name', phone: 'Phone' } });
    vi.unstubAllGlobals();
  });
  it('rejects non-CSV files before any request', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ImportWizard onSubmitted={() => undefined} />);
    await user.upload(screen.getByLabelText(/csv file/i), new File(['x'], 'leads.txt', { type: 'text/plain' }));
    expect(await screen.findByText(/please choose a \.csv file/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('useCrmStream (SSE with polling fallback)', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
  class FakeES {
    static last: FakeES | null = null;
    listeners = new Map<string, (e: MessageEvent) => void>();
    onerror: (() => void) | null = null;
    closed = false;
    constructor(public url: string, public init?: EventSourceInit) { FakeES.last = this; }
    addEventListener(t: string, fn: (e: MessageEvent) => void) { this.listeners.set(t, fn); }
    close() { this.closed = true; }
    emit(t: string, data: unknown) { this.listeners.get(t)?.({ data: JSON.stringify(data) } as MessageEvent); }
  }
  it('goes live on the ready event, using credentials against /stream', async () => {
    const { result } = renderHook(() => useCrmStream(true, { EventSourceCtor: FakeES as never, pollMs: 50 }), { wrapper });
    expect(FakeES.last!.url).toMatch(/\/stream$/);
    expect(FakeES.last!.init).toEqual({ withCredentials: true });
    act(() => FakeES.last!.emit('ready', { cursor: 'c' }));
    await waitFor(() => expect(result.current.mode).toBe('live'));
    act(() => FakeES.last!.emit('task', { id: 't' }));
    await waitFor(() => expect(result.current.lastEventAt).not.toBeNull());
  });
  it('falls back to polling GET /stream/poll when the stream errors', async () => {
    h.apiRequest.mockResolvedValue({ data: { cursor: 'c2', events: [{ type: 'task' }] }, meta: {} });
    const { result } = renderHook(() => useCrmStream(true, { EventSourceCtor: FakeES as never, pollMs: 30 }), { wrapper });
    act(() => FakeES.last!.onerror?.());
    await waitFor(() => expect(result.current.mode).toBe('polling'));
    await waitFor(() => expect(h.apiRequest).toHaveBeenCalled());
    expect(h.apiRequest.mock.calls[0]![0]).toBe('/stream/poll');
    expect(FakeES.last!.closed).toBe(true);
  });
  it('polls straight away when EventSource does not exist', async () => {
    h.apiRequest.mockResolvedValue({ data: { cursor: 'c', events: [] }, meta: {} });
    const orig = (globalThis as { EventSource?: unknown }).EventSource;
    delete (globalThis as { EventSource?: unknown }).EventSource;
    const { result } = renderHook(() => useCrmStream(true, { pollMs: 30 }), { wrapper });
    await waitFor(() => expect(result.current.mode).toBe('polling'));
    (globalThis as { EventSource?: unknown }).EventSource = orig;
  });
});

describe('pending call (tel: tap -> disposition on return)', () => {
  it('tapping the dial button remembers the call; storage failures never break dialling', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CallButton leadId="l1" phone="+919876543210" name="Asha Rao" />);
    const link = screen.getByRole('link', { name: /call asha rao/i });
    expect(link).toHaveAttribute('href', 'tel:+919876543210');
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(readPendingCall()).toMatchObject({ leadId: 'l1', name: 'Asha Rao' });
    clearPendingCall();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await user.click(link);
    expect(readPendingCall()).toBeNull();
    spy.mockRestore();
  });
  it('expires after 30 minutes', () => {
    markPendingCall({ leadId: 'l1', name: 'A' }, Date.now() - 31 * 60_000);
    expect(readPendingCall()).toBeNull();
  });
  it('shows an Unlogged call banner and opens the disposition sheet when the tab becomes visible again', async () => {
    const user = userEvent.setup();
    markPendingCall({ leadId: 'l1', name: 'Asha Rao', phone: '+919876543210' });
    renderWithProviders(<PendingCallPrompt />);
    expect(await screen.findByTestId('unlogged-call')).toHaveTextContent(/did you speak to asha rao/i);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const dlg = await screen.findByRole('dialog', { name: /log call: asha rao/i });
    expect(dlg).toHaveTextContent(/did you speak to asha rao/i);
    await user.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.getByTestId('unlogged-call')).toBeInTheDocument(); // still unlogged until saved or dismissed
    await user.click(screen.getByRole('button', { name: /dismiss unlogged call/i }));
    await waitFor(() => expect(screen.queryByTestId('unlogged-call')).toBeNull());
    expect(readPendingCall()).toBeNull();
  });
  it('saving the call clears the pending marker', async () => {
    const user = userEvent.setup();
    h.post.mockResolvedValue({ data: { call: { id: 'c', source: 'MANUAL', outcome: 'NO_ANSWER' }, lead: null, tasksCreated: [], statusChanges: [] }, meta: {} });
    markPendingCall({ leadId: 'l1', name: 'Asha Rao' });
    renderWithProviders(<PendingCallPrompt />);
    await user.click(await screen.findByRole('button', { name: /log the call/i }));
    await user.click(await screen.findByLabelText('No answer'));
    await user.click(screen.getByRole('button', { name: /save call/i }));
    expect(await screen.findByRole('heading', { name: /call saved/i })).toBeInTheDocument();
    expect(readPendingCall()).toBeNull();
  });
});
