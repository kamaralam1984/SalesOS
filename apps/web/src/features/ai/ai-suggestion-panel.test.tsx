import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { setCsrfToken } from '@/lib/api/client';
import { AiSuggestionPanel } from './ai-suggestion-panel';

let canUse = true;
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ can: (k: string) => (k === 'ai:use' ? canUse : true) }) }));

const sugg = (over: object = {}) => ({
  id: 's1', feature: 'summarize', status: 'DRAFT', output: { summary: 'Client wants evening batches.', keyPoints: ['Evening batch', 'Budget 50000'] }, editedOutput: null,
  sources: { origin: 'REP_ENTERED_TEXT', period: { from: null, to: null }, noteCount: 1, redactions: 2, warnings: ['1 instruction-like passage(s) in the notes were removed and treated as data'] },
  provider: 'fake', model: 'local', createdAt: new Date().toISOString(), label: 'AI suggestion - review and edit before use. Not a verified record.', ...over,
});

describe('AiSuggestionPanel', () => {
  let enabled: boolean;
  let runResponse: () => Response;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  beforeEach(() => {
    enabled = true;
    canUse = true;
    calls.length = 0;
    setCsrfToken('tok');
    runResponse = () => env({ insufficientData: false, label: sugg().label, suggestion: sugg() });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      calls.push({ url: u.pathname, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.pathname.endsWith('/ai/status')) return env({ enabled, label: 'x' });
      if (u.pathname.endsWith('/ai/summarize')) return runResponse();
      if (u.pathname.includes('/ai/suggestions/')) return env(sugg({ status: JSON.parse(String(init?.body)).action === 'REJECT' ? 'REJECTED' : JSON.parse(String(init?.body)).action === 'EDIT' ? 'EDITED' : 'ACCEPTED' }));
      return env({});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());
  const env = (data: unknown, status = 200, error: unknown = null) => new Response(JSON.stringify({ data: error ? null : data, meta: {}, error }), { status });

  it('renders nothing when the flag is off or the user lacks ai:use (CRM unchanged without AI)', async () => {
    enabled = false;
    renderWithProviders(<AiSuggestionPanel feature="summarize" />);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/ai/status'))).toBe(true));
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument();
    canUse = false;
    enabled = true;
    renderWithProviders(<AiSuggestionPanel feature="summarize" />);
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument();
  });

  it('labels output as an AI suggestion, shows sources + warnings, is editable, and accepting sends nothing else', async () => {
    renderWithProviders(<AiSuggestionPanel feature="summarize" />);
    await userEvent.type(await screen.findByLabelText('Notes'), 'Client wants evening batch and has 50000 budget.');
    await userEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    expect(await screen.findByText(/AI suggestion - review and edit before use/)).toBeInTheDocument();
    expect(screen.getAllByText('AI suggestion').length).toBeGreaterThan(0);
    expect(screen.getByText(/Based on: text you entered, 1 note\(s\). 2 detail\(s\) masked./)).toBeInTheDocument();
    expect(screen.getByText(/instruction-like passage/)).toBeInTheDocument();
    const summary = screen.getByLabelText('Summary');
    expect(summary).toHaveValue('Client wants evening batches.');
    await userEvent.clear(summary);
    await userEvent.type(summary, 'My own wording');
    await userEvent.click(screen.getByRole('button', { name: 'Save my edits' }));
    await waitFor(() => expect(screen.getAllByText('Saved with edits').length).toBeGreaterThan(0));
    const review = calls.find((c) => c.method === 'PATCH')!;
    expect(review.body).toMatchObject({ action: 'EDIT', editedOutput: { summary: 'My own wording', keyPoints: ['Evening batch', 'Budget 50000'] } });
    expect(calls.filter((c) => c.method === 'POST' || c.method === 'PATCH').map((c) => c.url.split('/api/v1')[1])).toEqual(['/ai/summarize', '/ai/suggestions/s1']);
    expect(screen.getByText(/never sends messages/)).toBeInTheDocument();
  });

  it('explicit insufficient-data message; provider failure tells the user to continue manually', async () => {
    runResponse = () => env({ insufficientData: true, message: 'Insufficient data: not enough notes.', label: 'x', suggestion: null });
    renderWithProviders(<AiSuggestionPanel feature="summarize" />);
    await userEvent.type(await screen.findByLabelText('Notes'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    expect(await screen.findByText('Insufficient data: not enough notes.')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-output')).not.toBeInTheDocument();

    runResponse = () => env(null, 503, { code: 'AI_UNAVAILABLE', message: 'The AI provider is unavailable right now.' });
    await userEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    expect(await screen.findByText('AI is unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Continue manually; nothing was changed/)).toBeInTheDocument();
  });

  it('has no axe violations with output shown', async () => {
    const { baseElement } = renderWithProviders(<AiSuggestionPanel feature="summarize" />);
    await userEvent.type(await screen.findByLabelText('Notes'), 'Client wants evening batch and has 50000 budget.');
    await userEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    await screen.findByTestId('ai-output');
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
