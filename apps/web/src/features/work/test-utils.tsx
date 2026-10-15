import * as React from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, TooltipProvider } from '@salesos/ui';
import { ThemeProvider } from '@/components/theme/theme-provider';
import enBase from '../../../messages/en.json';
import { MESSAGE_AREAS, mergeMessages } from '@/i18n/merge';

type Tree = { [k: string]: string | Tree };
const areaFiles = import.meta.glob('../../../messages/en.*.json', { eager: true, import: 'default' }) as Record<string, Tree>;
/** English messages merged exactly like the runtime (base + every area file). */
export const messages = mergeMessages(enBase as Tree, ...MESSAGE_AREAS.map((a) => areaFiles[`../../../messages/en.${a}.json`] ?? {}));

/** Providers like the app, but a MISSING TRANSLATION FAILS THE TEST instead of rendering a key. */
export function renderWork(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onError = (e: unknown) => { throw e instanceof Error ? e : new Error(String(e)); };
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Kolkata" onError={onError}>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <TooltipProvider>
              <ToastProvider>{children}</ToastProvider>
            </TooltipProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    ),
  });
}
