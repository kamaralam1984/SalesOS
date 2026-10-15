import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { makeAuth, one, page } from '../test-support';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { RecognitionPage, buildGrantPayload } from './recognition-page';

const wallItem = { id: 'w1', programId: 'g1', programName: 'Top performer', programKind: 'TOP_PERFORMER', recipientId: 'e1', recipientName: 'Asha Rao', reason: 'Closed three hard deals', periodLabel: 'October 2026', competencyKey: null, isPublic: true, createdAt: '2026-10-10T00:00:00Z' };

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.auth = makeAuth({ 'recognition:view': 'team', 'recognition:create': 'team', 'reviews:view': 'team' }, ['SALES_MANAGER'], 'me');
  h.get.mockImplementation(async (path: string, q?: Record<string, string>) => {
    if (path === '/people/recognitions') return q?.wall === 'true' ? page([wallItem]) : page([]);
    if (path === '/people/recognition-programs') return one([{ id: 'g1', key: 'top', name: 'Top performer', description: null, kind: 'TOP_PERFORMER', criteria: 'Highest collections' }]);
    if (path === '/people/team-members') return one([{ id: 'e1', name: 'Asha Rao', managerId: 'me', roles: [] }]);
    if (path === '/people/competencies') return one([]);
    return page([]);
  });
});

describe('RecognitionPage', () => {
  it('shows the public wall with a minimum-data projection', async () => {
    renderWithProviders(<RecognitionPage />);
    expect(await screen.findByText('Closed three hard deals')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith('/people/recognitions', expect.objectContaining({ wall: 'true' }));
  });
  it('grant form validates and posts with the wall switch', async () => {
    h.post.mockResolvedValue(one({ id: 'x' }));
    renderWithProviders(<RecognitionPage />);
    await userEvent.click(await screen.findByRole('button', { name: /^give recognition$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^give recognition$/i, hidden: false }));
    expect(await screen.findAllByText('This field is required')).not.toHaveLength(0);
    expect(h.post).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^program/i }), 'g1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^recipient/i }), 'e1');
    await userEvent.type(screen.getByRole('textbox', { name: /^reason/i }), 'Closed three hard deals');
    await userEvent.click(screen.getByRole('switch', { name: /share on the recognition wall/i }));
    await userEvent.click(screen.getAllByRole('button', { name: /^give recognition$/i }).at(-1)!);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/people/recognitions', { programId: 'g1', recipientId: 'e1', reason: 'Closed three hard deals', isPublic: true }));
  });
  it('only org-level recognisers can create programs', async () => {
    renderWithProviders(<RecognitionPage />);
    await screen.findByText('Closed three hard deals');
    expect(screen.queryByRole('button', { name: /new program/i })).not.toBeInTheDocument();
  });
  it('payload builder trims and drops empties', () => {
    expect(buildGrantPayload({ programId: 'p', recipientId: 'r', reason: ' Great ', periodLabel: ' ', competencyKey: '', isPublic: false })).toEqual({ programId: 'p', recipientId: 'r', reason: 'Great', isPublic: false });
  });
  it('empty wall and denied states', async () => {
    h.get.mockResolvedValue(page([]));
    const { unmount } = renderWithProviders(<RecognitionPage />);
    expect(await screen.findByText('The wall is empty')).toBeInTheDocument();
    unmount();
    h.auth = makeAuth({ 'resources:view': 'org' }, ['ADMIN']);
    renderWithProviders(<RecognitionPage />);
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
  });
  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<RecognitionPage />);
    await screen.findByText('Closed three hard deals');
    expect(await axe(container)).toHaveNoViolations();
  });
});
