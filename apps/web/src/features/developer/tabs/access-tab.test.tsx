import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { renderWithProviders as renderWithProviders0 } from '@/test/utils';
import en from '../../../../messages/en.json';
import devAccess from '../../../../messages/en.dev-access.json';

const messages = { ...en, developer: { ...(en as unknown as { developer: object }).developer, ...devAccess.developer } };
const renderWithProviders = (ui: React.ReactElement) =>
  renderWithProviders0(<NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Kolkata">{ui}</NextIntlClientProvider>);

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')),
  api: { get: h.get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { AccessTab } from './access-tab';

const matrix = {
  roles: ['DEVELOPER', 'ADMIN'],
  domains: ['devpanel', 'crm'],
  totalPermissions: 2,
  totals: { DEVELOPER: 1, ADMIN: 1 },
  permissions: [
    { key: 'devpanel:access', domain: 'devpanel', description: 'Open the Developer Panel', sensitive: true, grants: { DEVELOPER: 'org' } },
    { key: 'lead:view', domain: 'crm', description: 'View leads', sensitive: false, grants: { ADMIN: 'team' } },
  ],
};

beforeEach(() => {
  h.get.mockReset();
  h.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/matrix')) return { data: matrix };
    if (path.endsWith('/flags')) return { data: { environment: 'test', flags: [{ key: 'AI_OPENAI', group: 'ai', status: 'not configured' }] } };
    if (path.endsWith('/runbook'))
      return { data: { executesCommands: false, sections: [{ id: 'deploy', title: 'Deploy', source: 'docs', steps: [{ title: 'Verify', command: 'curl -fsS http://127.0.0.1:4100/api/v1/ready' }] }] } };
    return { data: [] };
  });
});

describe('AccessTab', () => {
  it('renders matrix, flags and the run-on-the-server warning', async () => {
    renderWithProviders(<AccessTab />);
    expect((await screen.findAllByText('devpanel:access')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Not configured')).toBeInTheDocument();
    expect(await screen.findByText(/Run on the server, not from this panel/)).toBeInTheDocument();
    expect(await screen.findByText(/curl -fsS/)).toBeInTheDocument();
  });

  it('filters by search and shows an empty state', async () => {
    renderWithProviders(<AccessTab />);
    await screen.findAllByText('devpanel:access');
    await userEvent.type(screen.getByLabelText('Search permissions'), 'zzz');
    await waitFor(() => expect(screen.getByText('No permissions match these filters')).toBeInTheDocument());
  });
});
