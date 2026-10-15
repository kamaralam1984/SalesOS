import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { envelope } from './test-harness';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('@/lib/api/client', async (orig) => ({ ...(await orig<typeof import('@/lib/api/client')>()), api: apiMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useParams: () => ({ id: 'd1' }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/features/auth/auth-provider', () => {
  const can = (p: string | string[]) => (Array.isArray(p) ? p : [p]).some((k) => perms.set.has(k));
  return { useAuth: () => ({ can }), usePermission: (p: string | string[]) => can(p), Can: ({ permission, children }: { permission: string | string[]; children: React.ReactNode }) => (can(permission) ? <>{children}</> : null) };
});

import { GapsPage, updateGapSchema } from './gaps-page';

const gap = { id: 'g1', kind: 'AUTOMATION', title: 'Automate no-show follow-up', description: null, ownerId: null, ownerName: null, status: 'OPEN', priority: 2, resolution: null, linkedSopId: null, reportedByName: 'TL', resolvedAt: null };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  perms.set = new Set(['sop:gaps:view', 'sop:gaps:manage']);
  apiMock.get.mockImplementation(async (path: string) => (path === '/sop/gaps' ? envelope([gap], { mode: 'page', limit: 20, hasMore: false, page: 1 }) : envelope([])));
});

describe('updateGapSchema', () => {
  it('requires a resolution to resolve', () => {
    expect(updateGapSchema.safeParse({ status: 'RESOLVED', resolution: '  ', priority: 2 }).success).toBe(false);
    expect(updateGapSchema.safeParse({ status: 'RESOLVED', resolution: 'Rule added', priority: 2 }).success).toBe(true);
    expect(updateGapSchema.safeParse({ status: 'IN_PROGRESS', priority: 2 }).success).toBe(true);
  });
});

describe('process gap backlog', () => {
  it('lists items with status text and blocks resolving without a resolution', async () => {
    renderWithProviders(<GapsPage />);
    expect((await screen.findAllByText('Automate no-show follow-up')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'RESOLVED');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('This field is required')).toBeInTheDocument();
    expect(apiMock.patch).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Resolution/), 'Workflow rule added');
    apiMock.patch.mockResolvedValue(envelope({ ...gap, status: 'RESOLVED' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/sop/gaps/g1', expect.objectContaining({ status: 'RESOLVED', resolution: 'Workflow rule added' })));
  });

  it('creates an item and validates the title', async () => {
    renderWithProviders(<GapsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('This field is required')).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
    apiMock.post.mockResolvedValue(envelope(gap));
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'No refund-risk script');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/sop/gaps', expect.objectContaining({ title: 'No refund-risk script', kind: 'PROCESS_GAP', priority: 3 })));
  });

  it('hides management actions for view-only users and shows empty state', async () => {
    perms.set = new Set(['sop:gaps:view']);
    apiMock.get.mockImplementation(async () => envelope([], { mode: 'page', limit: 20, hasMore: false, page: 1 }));
    renderWithProviders(<GapsPage />);
    expect(await screen.findByText('The backlog is empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
  });
});
