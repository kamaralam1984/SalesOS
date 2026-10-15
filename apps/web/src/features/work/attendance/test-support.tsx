import * as React from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { ThemeProvider } from '@/components/theme/theme-provider';
import en from '../../../../messages/en.json';
import enAttendance from '../../../../messages/en.work-attendance.json';
import enLeave from '../../../../messages/en.work-leave.json';
import { mergeMessages } from '@/i18n/merge';

export { makeAuth, one, page } from '../../people/test-support';

/** English messages exactly as the runtime merges them: base + this area's files. */
export const areaAMessages = mergeMessages(en as never, enAttendance as never, enLeave as never);

/** i18n errors (missing keys, bad ICU) seen while rendering; tests assert this stays empty. */
export const i18nErrors: string[] = [];

export function renderAreaA(ui: React.ReactElement) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    const client = React.useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), []);
    return (
      <NextIntlClientProvider locale="en" messages={areaAMessages as never} timeZone="Asia/Kolkata" onError={(e) => { i18nErrors.push(`${e.code}: ${e.message}`); }}>
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
