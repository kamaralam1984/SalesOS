import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { mergeMessages } from '@/i18n/merge';
import en from '../../../messages/en.json';
import enSearch from '../../../messages/en.search.json';
import enWorkNav from '../../../messages/en.work-nav.json';
import { makeAuth } from '../people/test-support';

const h = vi.hoisted(() => ({ auth: {} as unknown, push: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }), usePathname: () => '/' }));

import { FeatureSearch } from './feature-search';

const messages = mergeMessages(en as never, enSearch as never, enWorkNav as never);
function open() {
  render(
    <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Kolkata">
      <ThemeProvider><TooltipProvider><ToastProvider><FeatureSearch /></ToastProvider></TooltipProvider></ThemeProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  return screen.getByRole('combobox');
}

beforeEach(() => { h.push.mockReset(); h.auth = makeAuth({ 'hr:records:view': 'org', 'attendance:self': 'own', 'workforce:settings:view': 'org' }, ['HR'], 'me'); });

describe('FeatureSearch', () => {
  it('shows the section for "joining date" and opens it on Enter', async () => {
    const box = open();
    fireEvent.change(box, { target: { value: 'joining date' } });
    const first = await screen.findAllByRole('option');
    expect(first[0]).toHaveTextContent('Joining date and HR details');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(h.push).toHaveBeenCalledWith('/people/employees');
  });

  it('finds attendance and the Zoom link, and moves with the arrow keys', async () => {
    const box = open();
    fireEvent.change(box, { target: { value: 'attendance' } });
    expect((await screen.findAllByRole('option'))[0]).toHaveTextContent('Attendance');
    fireEvent.change(box, { target: { value: 'zoom' } });
    expect((await screen.findAllByRole('option'))[0]).toHaveTextContent('Zoom meeting link');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(h.push).toHaveBeenCalledTimes(1);
  });

  it('never offers a page the person has no permission for', async () => {
    h.auth = makeAuth({ 'attendance:self': 'own' }, ['SALES_EXECUTIVE'], 'me');
    const box = open();
    fireEvent.change(box, { target: { value: 'joining date' } });
    expect(await screen.findByText(/No match/)).toBeInTheDocument();
    expect(screen.queryByText('Joining date and HR details')).toBeNull();
  });

  it('opens with Ctrl+K', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Asia/Kolkata">
        <ThemeProvider><TooltipProvider><ToastProvider><FeatureSearch /></ToastProvider></TooltipProvider></ThemeProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
