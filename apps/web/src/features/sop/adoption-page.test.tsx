import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

import { AdoptionPage } from './adoption-page';

const data = (over: object = {}) => ({
  scope: 'org',
  overall: { required: 6, acknowledged: 3, ratePct: 50 },
  byDocument: [
    { documentId: 'd1', documentTitle: 'Objection handling', versionId: 'v1', versionNumber: 2, required: 4, acknowledged: 3, ratePct: 75, pending: [{ userId: 'u1', name: 'Asha' }] },
    { documentId: 'd2', documentTitle: 'Payment SOP', versionId: 'v2', versionNumber: 1, required: 0, acknowledged: 0, ratePct: null, pending: [] },
  ],
  byUser: [{ userId: 'u1', name: 'Asha', required: 2, acknowledged: 1, ratePct: 50, pendingDocumentIds: ['d1'] }],
  ...over,
});

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  perms.set = new Set(['sop:adoption:view', 'sop:create']);
});

describe('adoption dashboard', () => {
  it('renders overall, per-document rates and the null-rate wording (never 0% or 100%)', async () => {
    apiMock.get.mockResolvedValue(envelope(data()));
    renderWithProviders(<AdoptionPage />);
    expect((await screen.findAllByText('50%')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No required users').length).toBeGreaterThan(0);
    expect(screen.getByText('Organisation-wide view')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: /Adoption progress for Objection handling/ }).length).toBeGreaterThan(0);
  });

  it('handles an entirely null overall rate and the empty state', async () => {
    apiMock.get.mockResolvedValue(envelope(data({ overall: { required: 0, acknowledged: 0, ratePct: null }, byDocument: [], byUser: [] })));
    renderWithProviders(<AdoptionPage />);
    expect(await screen.findByText('No mandatory SOP is in effect')).toBeInTheDocument();
    expect(screen.getAllByText('No required users').length).toBeGreaterThan(0);
  });

  it('queues reminders for a document through POST /sop/versions/:id/remind', async () => {
    apiMock.get.mockResolvedValue(envelope(data()));
    apiMock.post.mockResolvedValue(envelope({ versionId: 'v1', queued: 1 }));
    renderWithProviders(<AdoptionPage />);
    const buttons = await screen.findAllByRole('button', { name: /Send reminder/ });
    await userEvent.click(buttons[0]!);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/sop/versions/v1/remind', {}));
    expect(await screen.findByText('1 reminder queued')).toBeInTheDocument();
  });

  it('shows permission denied for people without adoption access', () => {
    perms.set = new Set(['sop:view']);
    renderWithProviders(<AdoptionPage />);
    expect(screen.getByText(/permission/i)).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
  });
});
