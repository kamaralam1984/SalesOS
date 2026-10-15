import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), can: vi.fn<(p?: string) => boolean>(() => true) }));

vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: h.post, patch: h.patch, put: vi.fn(), delete: vi.fn() },
  apiRequest: vi.fn(),
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ can: h.can, user: { id: 'u1' } }),
  Can: ({ children, permission }: { children: React.ReactNode; permission: string }) => (h.can(permission) ? <>{children}</> : null),
  usePermission: () => true,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/crm/leads/l1' }));

import { EditLeadDialog, EditTaskDialog, leadPatch } from './lead-dialogs';
import { ReassignmentHistory } from './queue-pages';

const AXE = { rules: { region: { enabled: false } } };
const META = {
  stages: [], lostReasons: [],
  sources: [{ id: 's1', name: 'Referral', type: 'REFERRAL' }],
  programs: [{ id: 'p1', code: 'CBAX', name: 'CBAX', kind: 'PROGRAM' }],
  callOutcomes: [], objectionCategories: [], taskTypes: [],
};
const LEAD = {
  id: 'l1', fullName: 'Asha Rao', phone: '+919876543210', email: 'asha@example.com', source: null, program: null, interestLevel: 'MEDIUM' as const,
  estimatedValue: '50000.00', consent: { status: 'GRANTED', at: null, source: null }, isKeyProspect: false, version: 4, preferredLanguage: 'Hindi',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.can.mockImplementation(() => true);
  h.get.mockImplementation(async (path: string) => {
    if (path === '/leads/meta') return { data: META, meta: {} };
    if (path === '/reassignment-queue') {
      return {
        data: [
          { id: 'q1', reason: 'USER_DEACTIVATED', status: 'RESOLVED', createdAt: '2026-10-10T08:00:00Z', resolvedAt: '2026-10-11T09:30:00Z', resolutionNote: 'Moved to the Pune team', resolvedBy: { id: 'm1', name: 'Manager A' }, previousOwner: { id: 'u1', name: 'Rahul' }, newOwner: { id: 'u2', name: 'Priya' }, lead: { id: 'l9', fullName: 'Kiran Shah', status: 'NEW', nextActionAt: null }, task: null },
        ],
        meta: {},
      };
    }
    return { data: [], meta: {} };
  });
  h.patch.mockResolvedValue({ data: { id: 'l1' }, meta: {} });
});

describe('leadPatch: only changed fields are sent', () => {
  const base = { fullName: 'Asha Rao', phone: '+919876543210', email: 'asha@example.com', sourceId: '', programId: '', interestLevel: 'MEDIUM', estimatedValue: '50000', preferredLanguage: 'Hindi', consentStatus: 'GRANTED' as const, isKeyProspect: false };
  it('is empty when nothing changed (including 50000.00 vs 50000)', () => {
    expect(leadPatch(LEAD, base)).toEqual({});
  });
  it('contains exactly the edited fields; cleared optional fields become null', () => {
    expect(leadPatch(LEAD, { ...base, fullName: 'Asha R. Rao', email: '', estimatedValue: '60000.50', consentStatus: 'WITHDRAWN', isKeyProspect: true })).toEqual({
      fullName: 'Asha R. Rao', email: null, estimatedValue: '60000.50', consentStatus: 'WITHDRAWN', isKeyProspect: true,
    });
  });
});

describe('EditLeadDialog', () => {
  it('saves a single changed field with the lead version (optimistic concurrency) and is accessible', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { container } = renderWithProviders(<EditLeadDialog open onOpenChange={onOpenChange} lead={LEAD} />);
    const name = await screen.findByLabelText(/full name/i);
    expect(name).toHaveValue('Asha Rao');
    expect(await axe(document.body, AXE)).toHaveNoViolations();
    void container;
    await user.clear(screen.getByLabelText(/^phone/i));
    await user.type(screen.getByLabelText(/^phone/i), '9812345678');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch).toHaveBeenCalledWith('/leads/l1', { version: 4, phone: '9812345678' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('refuses to remove both phone and email and rejects a malformed amount', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EditLeadDialog open onOpenChange={() => undefined} lead={LEAD} />);
    await screen.findByLabelText(/full name/i);
    await user.clear(screen.getByLabelText(/^phone/i));
    await user.clear(screen.getByLabelText(/^email/i));
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/a phone number or an email is required/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^phone/i), '9812345678');
    await user.clear(screen.getByLabelText(/estimated value/i));
    await user.type(screen.getByLabelText(/estimated value/i), '5,000');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/enter an amount like/i)).toBeInTheDocument();
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('closes without a request when nothing changed; a stale-version conflict is shown, not swallowed', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const first = renderWithProviders(<EditLeadDialog open onOpenChange={onOpenChange} lead={LEAD} />);
    await screen.findByLabelText(/full name/i);
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(h.patch).not.toHaveBeenCalled();
    first.unmount();

    const { ApiError } = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
    h.patch.mockRejectedValueOnce(new ApiError({ status: 409, code: 'VERSION_CONFLICT', message: 'The lead was changed by someone else', requestId: 'r1' } as never));
    renderWithProviders(<EditLeadDialog open onOpenChange={() => undefined} lead={LEAD} />);
    await screen.findByLabelText(/full name/i);
    await user.type(screen.getByLabelText(/full name/i), ' Jr');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('EditTaskDialog (edit + reschedule)', () => {
  const TASK = { id: 't1', title: 'Call Asha', dueAt: new Date(Date.now() + 3600_000).toISOString(), priority: 'NORMAL' as const, version: 2, description: null };

  it('changing only the title sends only the title and the version', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EditTaskDialog open onOpenChange={() => undefined} task={TASK} />);
    const title = await screen.findByLabelText(/^title/i);
    await user.clear(title);
    await user.type(title, 'Call Asha about EMI');
    await user.click(screen.getByRole('button', { name: /save task/i }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch).toHaveBeenCalledWith('/tasks/t1', { title: 'Call Asha about EMI', version: 2 });
  });

  it('a quick pick reschedules to a future time and sends dueAt; the dialog is accessible', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EditTaskDialog open onOpenChange={() => undefined} task={TASK} />);
    await screen.findByLabelText(/^title/i);
    expect(await axe(document.body, AXE)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Tomorrow 10:00' }));
    await user.click(screen.getByRole('button', { name: /save task/i }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    const body = h.patch.mock.calls[0]![1] as { dueAt?: string; version: number };
    expect(body.version).toBe(2);
    expect(new Date(body.dueAt!).getTime()).toBeGreaterThan(Date.now());
    expect(Object.keys(body).sort()).toEqual(['dueAt', 'version']);
  });

  it('does nothing (no request) when nothing was changed', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<EditTaskDialog open onOpenChange={onOpenChange} task={TASK} />);
    await screen.findByLabelText(/^title/i);
    await user.click(screen.getByRole('button', { name: /save task/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(h.patch).not.toHaveBeenCalled();
  });
});

describe('ReassignmentHistory', () => {
  it('lists resolved reassignments: who moved what from whom to whom, when and why', async () => {
    renderWithProviders(<ReassignmentHistory />);
    const list = await screen.findByTestId('reassignment-history');
    expect(list).toHaveTextContent('Kiran Shah');
    expect(list).toHaveTextContent('Moved from Rahul to Priya');
    expect(list).toHaveTextContent('by Manager A');
    expect(list).toHaveTextContent('Moved to the Pune team');
    expect(h.get).toHaveBeenCalledWith('/reassignment-queue', expect.objectContaining({ status: 'RESOLVED' }));
    expect(await axe(document.body, AXE)).toHaveNoViolations();
  });
});
