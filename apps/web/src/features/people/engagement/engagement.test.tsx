import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';

vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
import { ResultsView } from './results-view';

describe('ResultsView', () => {
  it('explains suppression below the anonymity floor and shows no numbers', () => {
    renderWithProviders(<ResultsView result={{ surveyId: 's', title: 'Pulse', status: 'OPEN', responseCount: 2, suppressed: true, minResponses: 5, questions: null }} />);
    expect(screen.getByText(/not enough responses to protect anonymity \(minimum 5\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/average/i)).not.toBeInTheDocument();
  });
  it('shows averages when enough people responded', () => {
    renderWithProviders(<ResultsView result={{ surveyId: 's', title: 'Pulse', status: 'OPEN', responseCount: 5, suppressed: false, minResponses: 5, questions: [{ questionId: 'q1', text: 'I know my goals', responses: 5, average: 4, distribution: { '1': 0, '2': 0, '3': 1, '4': 3, '5': 1 } }] }} />);
    expect(screen.getByText('Average 4 out of 5')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /distribution: 1: 0, 2: 0, 3: 1, 4: 3, 5: 1/i })).toBeInTheDocument();
  });
});
