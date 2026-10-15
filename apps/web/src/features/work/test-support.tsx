import * as React from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { ThemeProvider } from '@/components/theme/theme-provider';
import en from '../../../messages/en.json';
import enGoals from '../../../messages/en.work-goals.json';
import enTasks from '../../../messages/en.work-tasks.json';
import { mergeMessages } from '@/i18n/merge';

export { makeAuth, one, page } from '../people/test-support';

/** English messages exactly as the runtime merges them (base + the workforce area files). */
export const workMessages = mergeMessages(en as never, enGoals as never, enTasks as never);

/** Like renderWithProviders, but with the work-* message areas loaded. */
export function renderWork(ui: React.ReactElement) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    const client = React.useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), []);
    return (
      <NextIntlClientProvider locale="en" messages={workMessages as never} timeZone="Asia/Kolkata">
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <TooltipProvider>
              <ToastProvider>{children}</ToastProvider>
            </TooltipProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}
