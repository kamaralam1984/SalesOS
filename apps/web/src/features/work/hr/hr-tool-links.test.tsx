import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { mergeMessages } from '@/i18n/merge';
import en from '../../../../messages/en.json';
import enHr from '../../../../messages/en.work-hr.json';
import { makeAuth } from '../../people/test-support';

const h = vi.hoisted(() => ({ auth: {} as unknown }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { HrToolLinks } from './hr-hub-page';

const messages = mergeMessages(en as never, enHr as never);
const renderIt = () => render(<NextIntlClientProvider locale="en" messages={messages as never}><HrToolLinks /></NextIntlClientProvider>);

describe('HrToolLinks (My Work, reachable on phones)', () => {
  beforeEach(() => { h.auth = makeAuth({}, ['SALES_EXECUTIVE'], 'me'); });
  it('shows nothing without any HR permission', () => {
    const { container } = renderIt();
    expect(container.querySelector('nav')).toBeNull();
  });
  it('shows Policy (Zoom link) and the other tools the person may open', () => {
    h.auth = makeAuth({ 'workforce:settings:view': 'org', 'joiners:manage': 'org', 'announcements:manage': 'org' }, ['HR'], 'me');
    renderIt();
    expect(screen.getByRole('link', { name: /Workforce policy/ }).getAttribute('href')).toBe('/work/hr/policy');
    expect(screen.getByRole('link', { name: /joiners/i }).getAttribute('href')).toBe('/work/hr/joiners');
    expect(screen.queryByRole('link', { name: /Balances/i })).toBeNull();
  });
});
