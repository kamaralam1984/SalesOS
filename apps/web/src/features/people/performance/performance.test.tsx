import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { makeAuth, one, page } from '../test-support';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post, patch: h.patch, put: vi.fn(), delete: vi.fn() } };
});

import { ApiError } from '@/lib/api/client';
import { KpisPage } from './kpis-page';
import { ReviewDetailPage } from './review-detail';
import { ReviewForm } from './review-form';
import { ReviewsPage } from './reviews-page';
import { buildAssignmentItems, buildScorecardInputs, mondayOf } from './kpi-logic';
import { buildReviewPayload, previousMonth, reviewActions, reviewFormSchema } from './review-logic';
import type { KpiDefinition, Review } from './api';

const comps = [
  { id: 'c1', key: 'ownership', name: 'Ownership mindset and accountability', description: 'Owns outcomes', indicators: { '1': 'Needs reminders', '5': 'Owns beyond remit' }, isActive: true },
  { id: 'c2', key: 'communication', name: 'Communication skills', description: null, indicators: {}, isActive: true },
];
const people = [{ id: 'e1', name: 'Asha Rao', managerId: 'me', roles: ['SALES_EXECUTIVE'] }];
const defs: KpiDefinition[] = [
  { id: 'd1', key: 'calls', name: 'Calls completed', kind: 'KPI', description: null, unit: 'count', dictionaryKey: null, roleKeys: [] },
  { id: 'd2', key: 'hygiene', name: 'Pipeline hygiene', kind: 'KRA', description: null, unit: null, dictionaryKey: null, roleKeys: [] },
];
const review = (over: Partial<Review> = {}): Review => ({
  id: 'r1', employeeId: 'e1', employeeName: 'Asha Rao', reviewerId: 'rev', reviewerName: 'Meera Joshi', periodStart: '2026-09-01', periodEnd: '2026-09-30', status: 'SUBMITTED', kpiSummary: [],
  competencyScores: { ownership: 4 }, rating: 4, strengths: 'Reliable', improvements: null, goals: null, employeeComment: null, approvedByName: null, approvedAt: null, acknowledgedAt: null, canEdit: false, ...over,
});
beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.patch.mockReset();
  h.auth = makeAuth({ 'reviews:view': 'team', 'reviews:create': 'team', 'kpi-assignments:view': 'team', 'kpi-assignments:manage': 'team', 'scorecards:view': 'team' }, ['SALES_MANAGER'], 'rev');
  h.get.mockImplementation(async (path: string) => {
    if (path === '/people/team-members') return one(people);
    if (path === '/people/competencies') return one(comps);
    if (path === '/people/kpi-definitions') return one(defs);
    return page([]);
  });
});

describe('reviewActions (pure)', () => {
  const can = (...k: string[]) => (p: string) => k.includes(p);
  it('the reviewer edits and submits drafts; nobody else does', () => {
    const r = { status: 'DRAFT' as const, reviewerId: 'rev', employeeId: 'e1' };
    expect(reviewActions(r, 'rev', can('reviews:create'))).toMatchObject({ canEdit: true, canSubmit: true, canApprove: false, canAcknowledge: false });
    expect(reviewActions(r, 'other', can('reviews:create'))).toMatchObject({ canEdit: false, canSubmit: false });
    expect(reviewActions(r, 'rev', can())).toMatchObject({ canEdit: false });
  });
  it('approval is disabled for the reviewer and for the employee being reviewed', () => {
    const r = { status: 'SUBMITTED' as const, reviewerId: 'rev', employeeId: 'e1' };
    expect(reviewActions(r, 'rev', can('reviews:approve')).canApprove).toBe(false);
    expect(reviewActions(r, 'e1', can('reviews:approve')).canApprove).toBe(false);
    expect(reviewActions(r, 'tl', can('reviews:approve')).canApprove).toBe(true);
    expect(reviewActions(r, 'tl', can('reviews:create')).canApprove).toBe(false);
    expect(reviewActions({ ...r, status: 'DRAFT' }, 'tl', can('reviews:approve')).canApprove).toBe(false);
  });
  it('only the employee acknowledges, and only after approval', () => {
    const r = { status: 'APPROVED' as const, reviewerId: 'rev', employeeId: 'e1' };
    expect(reviewActions(r, 'e1', can()).canAcknowledge).toBe(true);
    expect(reviewActions(r, 'rev', can('reviews:approve')).canAcknowledge).toBe(false);
    expect(reviewActions({ ...r, status: 'ACKNOWLEDGED' }, 'e1', can()).canAcknowledge).toBe(false);
    expect(reviewActions({ ...r, status: 'SUBMITTED' }, 'e1', can()).canAcknowledge).toBe(false);
  });
  it('computes the previous month and builds payloads', () => {
    expect(previousMonth(new Date('2026-10-15T00:00:00Z'))).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(previousMonth(new Date('2026-01-05T00:00:00Z'))).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    const v = { employeeId: 'e1', periodStart: '2026-09-01', periodEnd: '2026-09-30', competencyScores: { ownership: 4 }, rating: 4, strengths: ' x ', improvements: '', goals: undefined, actions: [] };
    expect(buildReviewPayload(v, 'create')).toEqual({ employeeId: 'e1', periodStart: '2026-09-01', periodEnd: '2026-09-30', competencyScores: { ownership: 4 }, rating: 4, strengths: 'x', actions: [] });
    expect(buildReviewPayload(v, 'edit')).toEqual({ competencyScores: { ownership: 4 }, rating: 4, strengths: 'x' });
    expect(reviewFormSchema.safeParse({ ...v, competencyScores: { ownership: 6 } }).success).toBe(false);
    expect(reviewFormSchema.safeParse({ ...v, rating: 0 }).success).toBe(false);
  });
});

describe('ReviewForm', () => {
  it('requires an employee, scores every chosen competency 1-5 and submits the payload', async () => {
    h.post.mockResolvedValue(one(review({ id: 'new1', status: 'DRAFT' })));
    const done = vi.fn();
    renderWithProviders(<ReviewForm onDone={done} />);
    await screen.findByRole('radiogroup', { name: /ownership mindset and accountability/i });
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));
    expect(await screen.findByText('This field is required')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText(/^employee/i), 'e1');
    await userEvent.click(screen.getByRole('radio', { name: /ownership mindset and accountability: score 4/i }));
    await userEvent.click(screen.getByRole('radio', { name: /communication skills: score 3/i }));
    await userEvent.selectOptions(screen.getByLabelText(/overall rating/i), '4');
    await userEvent.type(screen.getByLabelText(/strengths/i), 'Reliable follow-through');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    const [path, body] = h.post.mock.calls[0]!;
    expect(path).toBe('/people/reviews');
    expect(body).toMatchObject({ employeeId: 'e1', competencyScores: { ownership: 4, communication: 3 }, rating: 4, strengths: 'Reliable follow-through' });
    await waitFor(() => expect(done).toHaveBeenCalledWith('new1'));
  });
  it('shows behavioural indicators as help for each competency', async () => {
    renderWithProviders(<ReviewForm onDone={vi.fn()} />);
    await screen.findByRole('radiogroup', { name: /ownership mindset and accountability/i });
    expect(screen.getAllByText(/what each level looks like/i).length).toBe(1);
    expect(screen.getByText('Owns beyond remit')).toBeInTheDocument();
  });
  it('surfaces a duplicate-review conflict from the API', async () => {
    h.post.mockRejectedValue(new ApiError({ status: 409, code: 'REVIEW_EXISTS', message: 'A review for this employee and period already exists' }));
    renderWithProviders(<ReviewForm onDone={vi.fn()} />);
    await screen.findByRole('radiogroup', { name: /communication skills/i });
    await userEvent.selectOptions(screen.getByLabelText(/^employee/i), 'e1');
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
  });
});

describe('ReviewDetailPage', () => {
  it('hides approve from the reviewer but shows a waiting note', async () => {
    h.auth = makeAuth({ 'reviews:view': 'team', 'reviews:create': 'team', 'reviews:approve': 'org' }, ['SALES_TEAM_LEAD'], 'rev');
    h.get.mockImplementation(async (path: string) => (path === '/people/competencies' ? one(comps) : one(review())));
    renderWithProviders(<ReviewDetailPage id="r1" />);
    expect(await screen.findByRole('heading', { level: 1, name: /review: asha rao/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve review/i })).not.toBeInTheDocument();
    expect(screen.getByText(/waiting for approval by someone other than the reviewer/i)).toBeInTheDocument();
    expect(screen.getByText('Ownership mindset and accountability')).toBeInTheDocument();
  });
  it('lets a different approver approve, with a consequence dialog and audit note', async () => {
    h.auth = makeAuth({ 'reviews:view': 'org', 'reviews:approve': 'org' }, ['FOUNDER_CEO'], 'founder');
    h.get.mockImplementation(async (path: string) => (path === '/people/competencies' ? one(comps) : one(review())));
    h.post.mockResolvedValue(one(review({ status: 'APPROVED' })));
    renderWithProviders(<ReviewDetailPage id="r1" />);
    await userEvent.click(await screen.findByRole('button', { name: /approve review/i }));
    expect(screen.getByText(/visible to the employee/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/people/reviews/r1/approve', {}));
  });
  it('lets the employee acknowledge with a comment', async () => {
    h.auth = makeAuth({ 'reviews:view': 'own' }, ['SALES_EXECUTIVE'], 'e1');
    h.get.mockImplementation(async (path: string) => (path === '/people/competencies' ? one(comps) : one(review({ status: 'APPROVED' }))));
    h.post.mockResolvedValue(one(review({ status: 'ACKNOWLEDGED' })));
    renderWithProviders(<ReviewDetailPage id="r1" />);
    await userEvent.click(await screen.findByRole('button', { name: /^acknowledge$/i }));
    await userEvent.type(screen.getByLabelText(/employee comment/i), 'Thanks');
    await userEvent.click(screen.getAllByRole('button', { name: /^acknowledge$/i }).at(-1)!);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/people/reviews/r1/acknowledge', { comment: 'Thanks' }));
  });
  it('denied without reviews:view; not-found for hidden records', async () => {
    h.auth = makeAuth({ 'resources:view': 'org' }, ['ADMIN']);
    const { unmount } = renderWithProviders(<ReviewDetailPage id="r1" />);
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
    unmount();
    h.auth = makeAuth({ 'reviews:view': 'own' }, ['SALES_EXECUTIVE'], 'e1');
    h.get.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'x' }));
    renderWithProviders(<ReviewDetailPage id="r1" />);
    expect(await screen.findByText(/could not find that record/i)).toBeInTheDocument();
  });
  it('has no axe violations', async () => {
    h.get.mockImplementation(async (path: string) => (path === '/people/competencies' ? one(comps) : one(review())));
    const { container } = renderWithProviders(<ReviewDetailPage id="r1" />);
    await screen.findByRole('heading', { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ReviewsPage', () => {
  it('lists, empties and hides "New review" without reviews:create', async () => {
    h.auth = makeAuth({ 'reviews:view': 'own' }, ['SALES_EXECUTIVE'], 'e1');
    renderWithProviders(<ReviewsPage />);
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new review/i })).not.toBeInTheDocument();
    expect(screen.getByText(/restricted hr data/i)).toBeInTheDocument();
  });
  it('links to review detail', async () => {
    h.get.mockResolvedValue(page([review()]));
    renderWithProviders(<ReviewsPage />);
    expect(await screen.findByRole('link', { name: /asha rao/i })).toHaveAttribute('href', '/people/reviews/r1');
  });
});

describe('KPI logic and page', () => {
  it('snaps dates to Monday and builds assignment/scorecard inputs', () => {
    expect(mondayOf('2026-10-15')).toBe('2026-10-12');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(buildAssignmentItems(defs, { d1: { selected: true, target: '120' }, d2: { selected: true, target: '' } })).toEqual([
      { definitionId: 'd1', key: 'calls', name: 'Calls completed', kind: 'KPI', target: 120, unit: 'count' },
      { definitionId: 'd2', key: 'hygiene', name: 'Pipeline hygiene', kind: 'KRA' },
    ]);
    expect(buildAssignmentItems(defs, { d1: { selected: false, target: '5' } })).toEqual([]);
    expect(buildScorecardInputs(defs, { d1: { target: '120', actual: '' }, d2: { target: '', actual: '' } })).toEqual([{ key: 'calls', name: 'Calls completed', target: 120, unit: 'count', source: 'MANUAL' }]);
  });
  it('assigns KPIs for the selected week through the API', async () => {
    h.post.mockResolvedValue(one({}));
    renderWithProviders(<KpisPage />);
    await userEvent.click(await screen.findByRole('button', { name: /assign kpis\/kras/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/assign to/i), 'e1');
    await userEvent.click(await screen.findByRole('checkbox', { name: /calls completed/i }));
    await userEvent.type(screen.getByLabelText(/target: calls completed/i), '120');
    await userEvent.click(screen.getByRole('button', { name: /save assignment/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    const [path, body] = h.post.mock.calls[0]!;
    expect(path).toBe('/people/kpi-assignments');
    expect(body).toMatchObject({ assigneeId: 'e1', items: [{ key: 'calls', target: 120 }] });
    expect(body.weekStart).toBe(mondayOf(new Date().toISOString().slice(0, 10)));
  });
  it('validates that a person and at least one item are chosen', async () => {
    renderWithProviders(<KpisPage />);
    await userEvent.click(await screen.findByRole('button', { name: /assign kpis\/kras/i }));
    await userEvent.click(await screen.findByRole('button', { name: /save assignment/i }));
    expect(await screen.findByText('Choose a person')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });
  it('states honestly that scorecards hold inputs only', async () => {
    renderWithProviders(<KpisPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /scorecards/i }));
    expect(await screen.findByText(/scorecards hold inputs only/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing on this page is calculated/i)).toBeInTheDocument();
  });
  it('executives see their assignment read-only', async () => {
    h.auth = makeAuth({ 'kpi-assignments:view': 'own' }, ['SALES_EXECUTIVE'], 'e1');
    h.get.mockImplementation(async (path: string) =>
      path === '/people/kpi-assignments'
        ? page([{ id: 'a1', assigneeId: 'e1', assigneeName: 'Asha Rao', weekStart: '2026-10-12', items: [{ key: 'calls', name: 'Calls completed', kind: 'KPI', target: 120 }], setByName: 'Meera Joshi', updatedAt: '' }])
        : page([]),
    );
    renderWithProviders(<KpisPage />);
    expect(await screen.findByText('Calls completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign kpis\/kras/i })).not.toBeInTheDocument();
  });
});
