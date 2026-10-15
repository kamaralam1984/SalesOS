import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { makeAuth } from '../test-support';

const h = vi.hoisted(() => ({ auth: {} as unknown }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { PeopleHubPage } from './hub-page';
import { visibleSections } from './sections';

describe('People hub', () => {
  it('shows only the sections the role may open (executive)', async () => {
    h.auth = makeAuth({ 'coaching:view': 'own', 'reviews:view': 'own', 'pip:view': 'own', 'resources:view': 'org', 'engagement:respond': 'own', 'recognition:view': 'own' }, ['SALES_EXECUTIVE']);
    renderWithProviders(<PeopleHubPage />);
    expect(screen.getByRole('heading', { level: 1, name: /people and performance/i })).toBeInTheDocument();
    for (const name of [/coaching log/i, /performance reviews/i, /improvement plans/i, /skills library/i, /engagement pulse/i, /recognition/i]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    for (const name of [/employee records/i, /hiring/i, /incentives/i, /succession/i, /onboarding and probation/i]) {
      expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /skills library/i })).toHaveAttribute('href', '/people/skills');
  });

  it('Admin sees the skills library and engagement survey only, never sensitive HR sections', () => {
    const admin = makeAuth({ 'resources:view': 'org', 'engagement:respond': 'own', 'sop:view': 'org' }, ['ADMIN']);
    expect(visibleSections(admin.can).map((s) => s.id)).toEqual(['skills', 'engagement']);
  });

  it('HR sees hiring, onboarding, succession and employee records', () => {
    const hr = makeAuth({ 'coaching:view': 'org', 'reviews:view': 'org', 'pip:view': 'org', 'hiring:view': 'org', 'onboarding:view': 'org', 'succession:view': 'org', 'hr:records:view': 'org', 'resources:view': 'org' }, ['HR']);
    const ids = visibleSections(hr.can).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['hiring', 'onboarding', 'succession', 'employees']));
    expect(ids).not.toContain('incentives');
  });

  it('shows an empty state when nothing is permitted', () => {
    h.auth = makeAuth({}, []);
    renderWithProviders(<PeopleHubPage />);
    expect(screen.getByText(/nothing available for your role/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    h.auth = makeAuth({ 'coaching:view': 'team', 'reviews:view': 'team', 'resources:view': 'org' }, ['SALES_MANAGER']);
    const { container } = renderWithProviders(<PeopleHubPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
