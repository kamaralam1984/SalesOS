import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import type { AuthState } from '../hrkit/auth-mock';

const auth = vi.hoisted(() => ({ userId: 'me', perms: { 'resources:view': 'org' } as AuthState['perms'] }));
vi.mock('@/features/auth/auth-provider', async () => (await import('../hrkit/auth-mock')).makeAuthModule(auth));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  api: { get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
import { SkillsPage } from './skills-page';

const res = (title: string, tag: string) => ({ id: title, title, description: 'About it', type: 'ARTICLE', url: null, fileId: null, skillTags: [tag], myAssignment: null });
beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (_p: string, q?: Record<string, string>) => ({ data: [res('Closing techniques', 'closing'), res('Excel for reports', 'excel')].filter((r) => !q?.tag || r.skillTags.includes(q.tag)), meta: { pagination: { hasMore: false, limit: 24, mode: 'page', page: 1 } } }));
});

describe('skills library', () => {
  it('lists resources, filters by skill tag and has no axe violations', async () => {
    const { container } = renderWithProviders(<SkillsPage />);
    expect(await screen.findByText('Closing techniques')).toBeInTheDocument();
    expect(screen.getByText('Excel for reports')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(screen.queryByText('Closing techniques')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Excel' })).toHaveAttribute('aria-pressed', 'true');
    expect(await axe(container)).toHaveNoViolations();
  });
  it('hides management controls for learners', async () => {
    renderWithProviders(<SkillsPage />);
    await screen.findByText('Closing techniques');
    expect(screen.queryByRole('button', { name: 'Add resource' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Completion tracking' })).not.toBeInTheDocument();
  });
  it('shows an empty state', async () => {
    get.mockResolvedValue({ data: [], meta: { pagination: { hasMore: false, limit: 24, mode: 'page', page: 1 } } });
    renderWithProviders(<SkillsPage />);
    expect(await screen.findByText('No resources found')).toBeInTheDocument();
  });
});
