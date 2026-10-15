import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/lib/api/client';
import { envelope, page } from './test-harness';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('@/lib/api/client', async (orig) => ({ ...(await orig<typeof import('@/lib/api/client')>()), api: apiMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useParams: () => ({}), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/features/auth/auth-provider', () => {
  const can = (p: string | string[]) => (Array.isArray(p) ? p : [p]).some((k) => perms.set.has(k));
  return { useAuth: () => ({ can }), usePermission: (p: string | string[]) => can(p), Can: ({ permission, children }: { permission: string | string[]; children: React.ReactNode }) => (can(permission) ? <>{children}</> : null) };
});

import { LibraryPage } from './library-page';

const doc = (over: object = {}) => ({
  id: 'd1', category: 'OBJECTION_HANDLING', title: 'Objection handling', summary: 'How to answer price objections', ownerId: 'u', ownerName: 'Priya', isMandatory: true, audienceRoles: [], tags: [], status: 'ACTIVE',
  effectiveVersion: { id: 'v1', versionNumber: 2, effectiveDate: '2026-10-01', acknowledgedByMe: false }, ...over,
});

beforeEach(() => {
  apiMock.get.mockReset();
  perms.set = new Set(['sop:view']);
});

describe('SOP library page', () => {
  it('shows a loading state then the documents with effective version and acknowledgement badge', async () => {
    let resolve!: (v: unknown) => void;
    apiMock.get.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = renderWithProviders(<LibraryPage />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    resolve(envelope([doc(), doc({ id: 'd2', title: 'Closing', summary: 'Closing playbook', isMandatory: false, effectiveVersion: { id: 'v9', versionNumber: 1, effectiveDate: '2026-09-01', acknowledgedByMe: true } })], page));
    expect(await screen.findByRole('heading', { name: 'Objection handling' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Needs your acknowledgement')).toBeInTheDocument();
    expect(screen.getByText(/Effective v2 from/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /How to answer price objections/ })).toHaveAttribute('href', '/sop/d1');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the empty state, and a filter-aware empty state after searching', async () => {
    apiMock.get.mockResolvedValue(envelope([], page));
    renderWithProviders(<LibraryPage />);
    expect(await screen.findByText('No SOPs yet')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(await screen.findByText('No SOPs match your search')).toBeInTheDocument();
    await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith('/sop', expect.objectContaining({ q: 'zzz' })));
  });

  it('shows an error state with retry', async () => {
    apiMock.get.mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL', message: 'boom' }));
    apiMock.get.mockResolvedValueOnce(envelope([doc()], page));
    renderWithProviders(<LibraryPage />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await userEvent.click(retry);
    expect(await screen.findByRole('heading', { name: 'Objection handling' })).toBeInTheDocument();
  });

  it('shows permission denied without calling the API', () => {
    perms.set = new Set();
    renderWithProviders(<LibraryPage />);
    expect(screen.getByText(/permission/i)).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('shows authoring links only to people who may create or approve', async () => {
    apiMock.get.mockResolvedValue(envelope([doc()], page));
    perms.set = new Set(['sop:view', 'sop:create', 'sop:approve']);
    renderWithProviders(<LibraryPage />);
    expect(await screen.findByRole('link', { name: /New SOP/ })).toHaveAttribute('href', '/sop/new');
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Adoption' })).toBeNull();
  });
});
