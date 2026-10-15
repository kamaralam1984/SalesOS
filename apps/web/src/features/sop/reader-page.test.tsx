import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
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

import { ReaderPage } from './reader-page';

const version = (n: number, status = 'APPROVED') => ({ id: `v${n}`, documentId: 'd1', versionNumber: n, title: 'Objection handling', status, changeSummary: `change ${n}`, effectiveDate: '2026-10-01', attachmentFileIds: [], createdById: 'u', createdByName: 'Priya', createdAt: '2026-09-30T00:00:00Z', submittedAt: null, approvedByName: 'Founder', approvedAt: '2026-10-01T00:00:00Z', rejectionReason: null });
const detail = (over: object = {}) => ({
  id: 'd1', category: 'OBJECTION_HANDLING', title: 'Objection handling', summary: null, ownerId: 'u', ownerName: 'Priya', isMandatory: true, audienceRoles: ['SALES_EXECUTIVE'], tags: ['price'], status: 'ACTIVE',
  effectiveVersionId: 'v2', effectiveVersion: { ...version(2), body: '# Price objections\n- Acknowledge\n- <script>alert(1)</script>' }, acknowledgedByMe: false, acknowledgedAt: null,
  versions: [version(2), version(1, 'SUPERSEDED')], ...over,
});

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  perms.set = new Set(['sop:view', 'sop:acknowledge']);
});

describe('SOP reader', () => {
  it('renders the effective version safely, lists history and passes axe', async () => {
    apiMock.get.mockResolvedValue(envelope(detail()));
    const { container } = renderWithProviders(<ReaderPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Objection handling' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Price objections' })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compare with previous' })).toHaveAttribute('href', '/sop/d1/diff?from=v1&to=v2');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('acknowledges the effective version: POST, then the acknowledged state', async () => {
    apiMock.get.mockResolvedValueOnce(envelope(detail()));
    apiMock.post.mockResolvedValue(envelope({ acknowledgedAt: '2026-10-15T05:00:00Z', alreadyAcknowledged: false }));
    renderWithProviders(<ReaderPage />);
    const btn = await screen.findByRole('button', { name: /I have read and understood/ });
    apiMock.get.mockResolvedValue(envelope(detail({ acknowledgedByMe: true, acknowledgedAt: '2026-10-15T05:00:00Z' })));
    await userEvent.click(btn);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/sop/versions/v2/acknowledge', {}));
    expect(await screen.findByText(/Acknowledged on/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I have read and understood/ })).toBeNull();
  });

  it('shows the failure and keeps the button when the acknowledgement fails', async () => {
    const { ApiError } = await import('@/lib/api/client');
    apiMock.get.mockResolvedValue(envelope(detail()));
    apiMock.post.mockRejectedValue(new ApiError({ status: 409, code: 'SOP_NOT_EFFECTIVE', message: 'Not effective' }));
    renderWithProviders(<ReaderPage />);
    await userEvent.click(await screen.findByRole('button', { name: /I have read and understood/ }));
    expect(await screen.findByText('Could not record your acknowledgement')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I have read and understood/ })).toBeInTheDocument();
  });

  it('hides acknowledgement history and authoring actions without the permissions; shows them with', async () => {
    apiMock.get.mockResolvedValue(envelope(detail()));
    const first = renderWithProviders(<ReaderPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('Acknowledgement history')).toBeNull();
    expect(screen.queryByRole('link', { name: /New version/ })).toBeNull();
    first.unmount();
    perms.set = new Set(['sop:view', 'sop:adoption:view', 'sop:create', 'sop:approve']);
    apiMock.get.mockImplementation(async (path: string) => (path.endsWith('/acknowledgements') ? envelope([{ id: 'a', versionId: 'v2', versionNumber: 2, userId: 'x', userName: 'Asha', acknowledgedAt: '2026-10-02T00:00:00Z' }]) : envelope(detail())));
    renderWithProviders(<ReaderPage />);
    expect(await screen.findByText('Acknowledgement history')).toBeInTheDocument();
    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New version/ })).toHaveAttribute('href', '/sop/d1/edit');
    expect(screen.getByRole('button', { name: /Retire/ })).toBeInTheDocument();
  });

  it('shows a not-found style error state', async () => {
    const { ApiError } = await import('@/lib/api/client');
    apiMock.get.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'SOP not found' }));
    renderWithProviders(<ReaderPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(within(document.body).getByText(/could not find that record/i)).toBeInTheDocument();
  });
});
