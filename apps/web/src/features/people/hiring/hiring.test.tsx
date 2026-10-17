import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import type { AuthState } from '../hrkit/auth-mock';

const auth = vi.hoisted(() => ({ userId: 'me', perms: {} as AuthState['perms'] }));
vi.mock('@/features/auth/auth-provider', async () => (await import('../hrkit/auth-mock')).makeAuthModule(auth));
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  api: { get, post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { RestrictedNotes, HiringPage, customRoleKey } from './hiring-page';
import { ProfileMatchList } from './profile-match';

beforeEach(() => { get.mockReset(); post.mockReset(); auth.perms = { 'hiring:view': 'org' }; });

describe('profile match facts', () => {
  it('shows UNKNOWN as unknown (never as not met) and states it is not a score', () => {
    renderWithProviders(<ProfileMatchList match={{ experience: 'UNKNOWN', teamManagement: 'MET', industry: 'NOT_MET', education: 'NOT_REQUIRED', matchedIndustries: [] }} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Experience');
    expect(rows[0]).toHaveTextContent('Unknown');
    expect(rows[0]).not.toHaveTextContent('Not met');
    expect(rows[1]).toHaveTextContent('Met');
    expect(rows[2]).toHaveTextContent('Not met');
    expect(screen.getByText(/facts only, not a score/i)).toBeInTheDocument();
  });
  it('explains when there is no role profile', () => {
    renderWithProviders(<ProfileMatchList match={null} />);
    expect(screen.getByText(/no role profile/i)).toBeInTheDocument();
  });
});

describe('interview notes', () => {
  it('shows a restriction message instead of notes when the server withheld them', () => {
    renderWithProviders(<RestrictedNotes notes={null} restricted />);
    expect(screen.getByText(/restricted to hr and the hiring manager/i)).toBeInTheDocument();
  });
  it('shows the notes when allowed and nothing when there are none', () => {
    const { rerender } = renderWithProviders(<RestrictedNotes notes="Strong ownership" restricted={false} />);
    expect(screen.getByText('Strong ownership')).toBeInTheDocument();
    rerender(<RestrictedNotes notes={null} restricted={false} />);
    expect(screen.queryByText(/restricted/i)).not.toBeInTheDocument();
  });
});

describe('pipeline', () => {
  it('lists openings with stage counts and the restricted-data notice', async () => {
    get.mockResolvedValue({ data: [{ id: 'r', title: 'Sales Executive - Team A', roleKey: 'SALES_EXECUTIVE', profileId: null, hiringManagerId: 'm', hiringManagerName: 'Manager A', headcount: 2, status: 'OPEN', targetDate: null, notes: null, candidateCount: 3, stages: { APPLIED: 2, INTERVIEW: 1 } }], meta: { pagination: { hasMore: false, limit: 50, mode: 'cursor' } } });
    renderWithProviders(<HiringPage />);
    expect(await screen.findByText('Sales Executive - Team A')).toBeInTheDocument();
    expect(screen.getByText('Applied 2')).toBeInTheDocument();
    expect(screen.getByText(/interview notes are limited to hr/i)).toBeInTheDocument();
  });
  it('shows permission denied without hiring:view', () => {
    auth.perms = {};
    renderWithProviders(<HiringPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/do not have access/i);
  });
});

describe('new opening form', () => {
  it('turns a typed custom post into a role key', () => {
    expect(customRoleKey('Content Writer')).toBe('CONTENT_WRITER');
    expect(customRoleKey('  Sr. Sales-Head (North) ')).toBe('SR_SALES_HEAD_NORTH');
    expect(customRoleKey('!!')).toBe('');
  });
  it('picks a role from the list, takes positions with +, and sends a custom role as its own key', async () => {
    auth.perms = { 'hiring:view': 'org', 'hiring:manage': 'org' };
    get.mockResolvedValue({ data: [], meta: { pagination: { total: 0, hasMore: false, nextCursor: null } } });
    post.mockResolvedValue({ data: { id: 'new' } });
    renderWithProviders(<HiringPage />);
    fireEvent.click(await screen.findByRole('button', { name: /New opening/ }));
    const dlg = within(await screen.findByRole('dialog'));
    const select = dlg.getByLabelText(/^Role/);
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.text)).toEqual(expect.arrayContaining(['Sales Executive (Telecaller)', 'HR', 'Custom role (type your own)']));
    fireEvent.change(select, { target: { value: '__CUSTOM__' } });
    fireEvent.change(await dlg.findByLabelText(/Custom role name/), { target: { value: 'Content Writer' } });
    fireEvent.change(dlg.getByLabelText(/^Title/), { target: { value: 'Content Writer - Hindi' } });
    fireEvent.click(dlg.getByRole('button', { name: 'More positions' }));
    fireEvent.click(dlg.getByRole('button', { name: 'More positions' }));
    expect(dlg.getByText(/90-day training plan/)).toBeInTheDocument();
    fireEvent.click(dlg.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toMatchObject({ title: 'Content Writer - Hindi', roleKey: 'CONTENT_WRITER', headcount: 3 });
  });
});
