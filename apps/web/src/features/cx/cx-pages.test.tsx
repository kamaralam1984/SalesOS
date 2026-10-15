import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/lib/api/client';
import { envelope, page, routeApi } from './test-harness';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('@/lib/api/client', async (orig) => ({ ...(await orig<typeof import('@/lib/api/client')>()), api: apiMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useParams: () => ({}), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/features/auth/auth-provider', () => {
  const can = (p: string | string[]) => (Array.isArray(p) ? p : [p]).some((k) => perms.set.has(k));
  return { useAuth: () => ({ can, user: { id: 'me' } }), usePermission: (p: string | string[]) => can(p), Can: ({ permission, children }: { permission: string | string[]; children: React.ReactNode }) => (can(permission) ? <>{children}</> : null) };
});

import { ComplaintsPage } from './complaints-page';
import { ComplaintDetailPage } from './complaint-detail';
import { HandoversPage } from './handovers-page';
import { HandoverDetailPage } from './handover-detail';
import { FounderReportDetailPage, completeness } from './founder-report-detail';
import { FounderReportsPage } from './founder-reports-page';
import { SatisfactionPage } from './satisfaction-page';
import { ActionItemsPage } from './action-items-page';
import { CxHubPage } from './hub-page';
import { EscalationsPage } from './escalations-page';
import { RefundsPage } from './refunds-page';
import { RisksPage } from './risks-page';
import { formatRemaining } from './shared';

// axe + dialogs are slow on a loaded CI box: give each test room (the default 5 s flaked under load)
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  for (const m of Object.values(apiMock)) m.mockReset();
  perms.set = new Set();
});

const iso = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const complaint = (over: Record<string, unknown> = {}) => ({
  id: 'c1', title: 'Class link not received', description: 'No link for week 2', category: 'DELIVERY_ACCESS', priority: 'P1', status: 'OPEN', learner: { id: 'l1', name: 'Asha Verma' }, leadId: 'l1', dealId: null, refundId: null,
  ownerId: 'u1', ownerName: 'Ravi Manager', createdByName: 'Exec', autoAssigned: true, isHighValue: false,
  sla: { startedAt: iso(-1), firstResponseDueAt: iso(3), resolutionDueAt: iso(30), firstResponseBreachedAt: null, resolutionBreachedAt: null, breachLevel: 0, firstResponseRemainingMs: 3 * 3_600_000, resolutionRemainingMs: 30 * 3_600_000, resolvedWithinSla: null },
  acknowledgedAt: null, firstResponseNote: null, escalatedAt: null, escalatedToName: null, escalationReason: null, resolvedAt: null, resolution: null, rootCauseCategory: null, closedAt: null, closeReason: null, closedAsInvalid: false, reopenCount: 0,
  version: 1, createdAt: iso(-1), updatedAt: iso(-1), history: [{ from: null, to: 'OPEN', actorName: 'Exec', note: null, at: iso(-1) }], ...over,
});

describe('formatRemaining', () => {
  const t = (k: 'min' | 'hours' | 'days', v: { n: number }) => `${v.n}${k}`;
  it('uses minutes, hours then days and ignores the sign', () => {
    expect(formatRemaining(5 * 60_000, t)).toBe('5min');
    expect(formatRemaining(-90 * 60_000, t)).toBe('90min');
    expect(formatRemaining(5 * 3_600_000, t)).toBe('5hours');
    expect(formatRemaining(-3 * 86_400_000, t)).toBe('3days');
  });
});

describe('complaints list', () => {
  it('shows loading, then complaints with SLA countdown (icon + text, never colour alone), and is accessible', async () => {
    perms.set = new Set(['complaints:view']);
    let resolve!: (v: unknown) => void;
    apiMock.get.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = renderWithProviders(<ComplaintsPage />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    resolve(envelope([complaint(), complaint({ id: 'c2', title: 'Refund delay', priority: 'P3', sla: { ...complaint().sla, firstResponseDueAt: iso(-5), firstResponseBreachedAt: iso(-5) } })], page));
    expect(await screen.findByText('Class link not received')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Class link not received/ })).toHaveAttribute('href', '/cx/complaints/c1');
    expect(screen.getByText(/Due in 3 h/)).toBeInTheDocument();
    const breached = screen.getByText(/Breached 5 h ago/);
    expect(breached.closest('[data-breached]')).toHaveAttribute('data-breached', 'true');
    expect(screen.getAllByText('P1 Critical').length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows empty, filter-aware empty, error with retry and permission-denied states', async () => {
    perms.set = new Set(['complaints:view']);
    apiMock.get.mockResolvedValue(envelope([], page));
    const { unmount } = renderWithProviders(<ComplaintsPage />);
    expect(await screen.findByText('No complaints logged')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'P1');
    expect(await screen.findByText('No complaints match')).toBeInTheDocument();
    await waitFor(() => expect(apiMock.get).toHaveBeenLastCalledWith('/cx/complaints', expect.objectContaining({ priority: 'P1' })));
    unmount();
    apiMock.get.mockReset();
    apiMock.get.mockRejectedValueOnce(new ApiError({ status: 500, code: 'X', message: 'boom' }));
    apiMock.get.mockResolvedValueOnce(envelope([complaint()], page));
    renderWithProviders(<ComplaintsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Class link not received')).toBeInTheDocument();
  });

  it('denies without permission and never calls the API', () => {
    renderWithProviders(<ComplaintsPage />);
    expect(screen.getByText(/permission/i)).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('log complaint needs title + description and posts the owner/priority chosen', async () => {
    perms.set = new Set(['complaints:view', 'complaints:create']);
    apiMock.get.mockImplementation(routeApi({ '/cx/complaints': envelope([], page), '/cx/assignable-users': envelope([{ id: 'u9', name: 'Meera' }]) }));
    apiMock.post.mockResolvedValue(envelope(complaint()));
    renderWithProviders(<ComplaintsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Log complaint/ }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Log complaint' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Wrong invoice');
    await userEvent.type(within(dialog).getByLabelText(/What happened/), 'Invoice shows the wrong amount');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Priority/), 'P2');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/cx/complaints', expect.objectContaining({ title: 'Wrong invoice', priority: 'P2', category: 'OTHER' })));
  });
});

describe('complaint detail', () => {
  it('offers only legal next steps, requires root cause to resolve, and surfaces API conflicts', async () => {
    perms.set = new Set(['complaints:view', 'complaints:update']);
    apiMock.get.mockResolvedValue(envelope(complaint({ status: 'IN_PROGRESS', acknowledgedAt: iso(-1) })));
    renderWithProviders(<ComplaintDetailPage id="c1" />);
    expect(await screen.findByRole('heading', { name: 'Class link not received' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escalate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const dialog = await screen.findByRole('dialog');
    const go = within(dialog).getByRole('button', { name: 'Resolve' });
    expect(go).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Resolution/), 'Access re-issued');
    expect(go).toBeDisabled(); // root cause still missing
    await userEvent.selectOptions(within(dialog).getByLabelText(/Root cause/), 'TECHNICAL_ISSUE');
    apiMock.post.mockRejectedValueOnce(new ApiError({ status: 409, code: 'CONFLICT', message: 'Changed by someone else' }));
    await userEvent.click(go);
    expect(await within(dialog).findByText('Changed by someone else')).toBeInTheDocument();
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/cx/complaints/c1/transition', expect.objectContaining({ to: 'RESOLVED', rootCauseCategory: 'TECHNICAL_ISSUE', resolution: 'Access re-issued' })));
  });

  it('closed complaints have no actions; no update permission hides them', async () => {
    perms.set = new Set(['complaints:view']);
    apiMock.get.mockResolvedValue(envelope(complaint({ status: 'OPEN' })));
    const { unmount } = renderWithProviders(<ComplaintDetailPage id="c1" />);
    await screen.findByRole('heading', { name: 'Class link not received' });
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    unmount();
    perms.set = new Set(['complaints:view', 'complaints:update']);
    apiMock.get.mockResolvedValue(envelope(complaint({ status: 'CLOSED', closedAt: iso(-1) })));
    renderWithProviders(<ComplaintDetailPage id="c1" />);
    await screen.findByRole('heading', { name: 'Class link not received' });
    expect(screen.queryByRole('button', { name: /Acknowledge|Resolve|Reopen|Escalate/ })).toBeNull();
  });
});

const handover = (over: Record<string, unknown> = {}) => ({
  id: 'h1', status: 'DRAFT', programName: 'AI Sprint', ownerName: 'Exec A', submittedAt: null, ackDueAt: null, overdueAt: null, acknowledgedAt: null, completedAt: null, createdAt: iso(-2), pending: false, minimumData: false,
  dealId: 'd1', leadId: 'l1', learnerName: 'Asha Verma', learnerContact: '+919800000001', languagePreference: 'HI', amountPaid: '5000', amountDue: '15000', currency: 'INR', paymentVerified: true,
  promisesMade: null, goals: null, objections: null, specialNotes: null, consents: null, version: 1,
  checklist: [{ key: 'learnerName', done: true }, { key: 'promisesMade', done: false }, { key: 'goals', done: false }, { key: 'consents', done: false }], missing: ['promisesMade', 'goals', 'consents'], complete: false, history: [], ...over,
});

describe('handover checklist (journey 10)', () => {
  it('shows required fields and progress, and surfaces the server-side block listing missing fields', async () => {
    perms.set = new Set(['handover:view', 'handover:create']);
    apiMock.get.mockResolvedValue(envelope(handover()));
    apiMock.patch.mockResolvedValue(envelope(handover()));
    apiMock.post.mockRejectedValue(new ApiError({ status: 422, code: 'HANDOVER_INCOMPLETE', message: 'Checklist incomplete', details: [{ path: 'promisesMade', message: 'required' }, { path: 'consents', message: 'required' }] }));
    const { container } = renderWithProviders(<HandoverDetailPage id="h1" />);
    expect(await screen.findByRole('heading', { name: 'Asha Verma' })).toBeInTheDocument();
    const progress = screen.getByRole('list', { name: 'Checklist' });
    expect(within(progress).getByText('Promises made')).toBeInTheDocument();
    expect(within(progress).getAllByText('missing').length).toBe(3);
    expect(screen.getByLabelText(/Language preference/)).toHaveValue('HI');
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Submit to Student Success' }));
    const alert = await screen.findByText('Checklist incomplete');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Still missing: Promises made, Consent/)).toBeInTheDocument();
    expect(apiMock.patch).toHaveBeenCalledWith('/handovers/h1', expect.objectContaining({ consents: expect.objectContaining({ dataSharing: false }), learnerName: 'Asha Verma' }));
  });

  it('read-only for Student Success with acknowledge action, and the status-only projection for Operations', async () => {
    perms.set = new Set(['handover:view', 'handover:acknowledge']);
    apiMock.get.mockResolvedValue(envelope(handover({ status: 'SUBMITTED', pending: true, ackDueAt: iso(10), promisesMade: 'Weekly mentor call', goals: 'Launch', objections: 'None', specialNotes: 'Evenings', consents: { dataSharing: true }, missing: [], complete: true, checklist: [{ key: 'goals', done: true }] })));
    apiMock.post.mockResolvedValue(envelope(handover({ status: 'ACKNOWLEDGED' })));
    const { unmount } = renderWithProviders(<HandoverDetailPage id="h1" />);
    expect(await screen.findByText('Weekly mentor call')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit to Student Success' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask for more information' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/handovers/h1/acknowledge', {}));
    unmount();
    perms.set = new Set(['handover:view']);
    apiMock.get.mockResolvedValue(envelope({ id: 'h1', status: 'SUBMITTED', programName: 'AI Sprint', ownerName: 'Exec A', minimumData: true, pending: true, createdAt: iso(-1), submittedAt: iso(-1), ackDueAt: iso(5) }));
    renderWithProviders(<HandoverDetailPage id="h1" />);
    expect(await screen.findByText('Status only')).toBeInTheDocument();
    expect(screen.queryByText('Weekly mentor call')).toBeNull();
    expect(screen.queryByText(/919800000001/)).toBeNull();
  });

  it('inbox lists pending handovers with an acknowledgement countdown and the empty state', async () => {
    perms.set = new Set(['handover:view', 'handover:acknowledge']);
    apiMock.get.mockResolvedValueOnce(envelope([handover({ id: 'h2', status: 'OVERDUE', pending: true, ackDueAt: iso(-3), overdueAt: iso(-3) })], page));
    const { unmount } = renderWithProviders(<HandoversPage />);
    expect(await screen.findByRole('heading', { name: 'Handover inbox' })).toBeInTheDocument();
    expect(await screen.findByText(/Breached 3 h ago/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Asha Verma/ })).toHaveAttribute('href', '/cx/handovers/h2');
    unmount();
    apiMock.get.mockResolvedValue(envelope([], page));
    renderWithProviders(<HandoversPage />);
    expect(await screen.findByText('Nothing waiting')).toBeInTheDocument();
  });
});

describe('Founder report builder and published view (journey 12)', () => {
  const draft = (sections: object = {}) => ({
    id: 'r1', type: 'WEEKLY', periodStart: '2026-10-05', periodEnd: '2026-10-11', versionNumber: 1, supersedesId: null, status: 'DRAFT', title: 'Weekly Founder report', sections, authorName: 'TL', dueAt: iso(20), publishedAt: null, publishedByName: null,
    contentHash: null, onTime: null, completenessPct: 0, rating: null, reviewNote: null, reviewedByName: null, overdue: false, version: 3,
    dataSections: [{ key: 'revenue', label: 'Revenue and collections vs target', status: 'DATA_PENDING_PHASE_5', metrics: [], note: 'x' }], actionItems: [{ id: 'a1', title: 'Fix demo follow-up', ownerId: 'u', dueAt: iso(10), status: 'OPEN' }], versions: [{ id: 'r1', versionNumber: 1, status: 'DRAFT', publishedAt: null }],
  });

  it('completeness mirrors the server rules', () => {
    expect(completeness({}).pct).toBe(0);
    expect(completeness({ performance: { narrative: 'x' }, risks: { noneConfirmed: true }, opportunities: { noneConfirmed: true }, actionItems: { reviewed: true } }).pct).toBe(100);
    expect(completeness({ performance: { narrative: 'x' }, risks: { items: [{ title: 'r' }] } }).pct).toBe(25);
  });

  it('shows data placeholders (no numbers), blocks publish until the narrative and every risk solution exist, then publishes after confirmation', async () => {
    perms.set = new Set(['founder-reports:view', 'founder-reports:create']);
    apiMock.get.mockImplementation(routeApi({ '/founder-reports/r1': envelope(draft({ risks: { items: [{ title: 'Demo no-shows', severity: 3, proposedSolution: '' }] } })), '/risk-register': envelope([], page) }));
    apiMock.patch.mockResolvedValue(envelope(draft()));
    apiMock.post.mockResolvedValue(envelope({ ...draft(), status: 'PUBLISHED' }));
    const { container } = renderWithProviders(<FounderReportDetailPage id="r1" />);
    expect(await screen.findByText('Revenue and collections vs target')).toBeInTheDocument();
    expect(screen.getByText(/Data pending \(analytics phase\)/)).toBeInTheDocument();
    const publish = screen.getByRole('button', { name: 'Publish report' });
    expect(publish).toBeDisabled();
    expect(screen.getByText(/1 risk still needs a proposed solution/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Proposed solution/), 'Add reminders');
    expect(publish).toBeDisabled();
    expect(screen.getByText('Add the performance narrative to publish')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Narrative/), 'Steady week');
    expect(publish).toBeEnabled();
    expect(within(screen.getByRole('progressbar', { name: 'Completeness' })).queryByText(/./)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(publish);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be edited afterwards/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish and lock' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/founder-reports/r1/submit', {}));
    expect(apiMock.patch).toHaveBeenCalledWith('/founder-reports/r1', expect.objectContaining({ version: 3 }));
  });

  it('a published report is a locked read-only snapshot with integrity status, versions and a correction action', async () => {
    perms.set = new Set(['founder-reports:view', 'founder-reports:create', 'founder-reports:review']);
    const published = { ...draft({ performance: { narrative: 'Locked narrative' }, risks: { items: [{ title: 'R1', severity: 2, proposedSolution: 'S1' }] } }), status: 'PUBLISHED', publishedAt: iso(-2), publishedByName: 'TL', contentHash: 'a'.repeat(64), onTime: true, completenessPct: 75, versions: [{ id: 'r1', versionNumber: 1, status: 'PUBLISHED', publishedAt: iso(-2) }, { id: 'r2', versionNumber: 2, status: 'DRAFT', publishedAt: null }] };
    apiMock.get.mockImplementation(routeApi({ '/founder-reports/r1/snapshot': envelope({ id: 's1', reportId: 'r1', versionNumber: 1, content: { sections: published.sections, dataSections: published.dataSections, actionItems: [] }, contentHash: 'a'.repeat(64), integrityVerified: true, dueAt: iso(-5), publishedAt: iso(-2), onTime: true }), '/founder-reports/r1': envelope(published) }));
    renderWithProviders(<FounderReportDetailPage id="r1" />);
    expect(await screen.findByText('Locked narrative')).toBeInTheDocument();
    expect(screen.getByText('Locked snapshot')).toBeInTheDocument();
    expect(await screen.findByText('Fingerprint matches the stored content')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Narrative/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish report' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create a corrected version' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Version 2' })).toHaveAttribute('href', '/cx/founder-reports/r2');
    expect(screen.getByRole('button', { name: 'Save review' })).toBeDisabled();
  });

  it('history list shows timeliness maths and an honest empty state', async () => {
    perms.set = new Set(['founder-reports:view', 'founder-reports:create']);
    apiMock.get.mockImplementation(routeApi({ '/founder-reports/metrics': envelope({ timeliness: { due: 4, onTime: 3, late: 1, missing: 0, pct: 75 }, quality: { published: 3, meanCompletenessPct: 83, meanRating: null, rated: 0 } }), '/founder-reports': envelope([], page) }));
    renderWithProviders(<FounderReportsPage />);
    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('3 of 4 due in the last 90 days')).toBeInTheDocument();
    expect(screen.getByText('Not rated yet')).toBeInTheDocument();
    expect(await screen.findByText('No reports yet')).toBeInTheDocument();
  });
});

describe('satisfaction capture', () => {
  it('requires consent and every required answer before saving; saves with the chosen template questions', async () => {
    perms.set = new Set(['satisfaction:view', 'satisfaction:create']);
    apiMock.get.mockImplementation(routeApi({
      '/cx/satisfaction/stats': envelope({ from: '', to: '', summaries: [{ kind: 'CSAT', n: 0, mean: null, lowSample: false, excludedOutsideWindow: 0, satisfiedPct: null }], series: [], note: 'n' }),
      '/cx/survey-templates': envelope([{ id: null, key: 'builtin-csat', name: 'Learner satisfaction (CSAT)', kind: 'CSAT', questions: [{ id: 'overall', text: 'How satisfied are you?', type: 'RATING_1_5', required: true }], version: 0, isActive: true, builtin: true }]),
      '/cx/satisfaction': envelope([], page),
      '/leads': envelope([], page),
    }));
    apiMock.post.mockResolvedValue(envelope({ id: 's1' }));
    renderWithProviders(<SatisfactionPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Capture' }));
    const save = await screen.findByRole('button', { name: 'Save response' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Respondent reference/), 'survey-77');
    await userEvent.click(screen.getByRole('button', { name: '4' }));
    expect(save).toBeDisabled(); // consent missing
    await userEvent.click(screen.getByRole('checkbox', { name: /agreed that this feedback may be stored/ }));
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/cx/satisfaction', expect.objectContaining({ kind: 'CSAT', respondentRef: 'survey-77', consentGiven: true, answers: [{ questionId: 'overall', value: 4 }] })));
  });
});

describe('action items tracker', () => {
  const item = (over: Record<string, unknown> = {}) => ({ id: 'a1', reportId: null, source: 'MANUAL', title: 'Document the objection SOP', description: null, ownerId: 'u1', ownerName: 'Priya TL', createdByName: 'Founder', dueAt: iso(40), status: 'OPEN', overdue: false, completedAt: null, completionNote: null, evidence: null, completedOnTime: null, cancelReason: null, escalatedAt: null, version: 1, ...over });
  it('completing needs a note AND evidence; late and on-time completions are labelled; metrics show the maths', async () => {
    perms.set = new Set(['action-items:view', 'action-items:update']);
    apiMock.get.mockImplementation(routeApi({ '/action-items/metrics': envelope({ due: 5, onTime: 2, pct: 40, open: 3, overdue: 1, byOwner: [] }), '/action-items': envelope([item(), item({ id: 'a2', title: 'Done late', status: 'COMPLETED', completedOnTime: false, evidence: 'link', completionNote: 'ok' })], page) }));
    apiMock.patch.mockResolvedValue(envelope(item({ status: 'COMPLETED' })));
    renderWithProviders(<ActionItemsPage />);
    expect(await screen.findByText('40%')).toBeInTheDocument();
    expect(screen.getByText('2 of 5 due in the last 90 days')).toBeInTheDocument();
    expect((await screen.findAllByText('Done late')).length).toBe(2); // title + "Done late" badge (completed after its due date)
    await userEvent.click(screen.getAllByRole('button', { name: 'Mark complete' })[0]!);
    const dialog = await screen.findByRole('dialog');
    const go = within(dialog).getByRole('button', { name: 'Mark complete' });
    await userEvent.type(within(dialog).getByLabelText(/What was done/), 'Published SOP');
    expect(go).toBeEnabled(); // note typed, evidence still empty: submit handler guards
    await userEvent.click(go);
    expect(apiMock.patch).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/^Evidence/), 'SOP-12');
    await userEvent.click(go);
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/action-items/a1', expect.objectContaining({ status: 'COMPLETED', completionNote: 'Published SOP', evidence: 'SOP-12' })));
  });
});

describe('hub, escalation board, refunds, risks', () => {
  it('hub shows only tiles the role may open, with honest counts', async () => {
    perms.set = new Set(['handover:view', 'handover:acknowledge', 'action-items:view']);
    apiMock.get.mockImplementation(routeApi({ '/handovers': envelope([handover(), handover({ id: 'h2' })], page), '/action-items': envelope([], page) }));
    renderWithProviders(<CxHubPage />);
    expect(await screen.findByText('2 pending')).toBeInTheDocument();
    expect(screen.getByText('0 open for you')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Handovers/ })).toHaveAttribute('href', '/cx/handovers');
    expect(screen.queryByRole('link', { name: /Complaints/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Founder reports/ })).toBeNull();
  });

  it('escalation board groups by status and shows owner, blocker and Team Lead involvement', async () => {
    perms.set = new Set(['complaints:view', 'complaints:update', 'complaints:create']);
    const e = (o: object) => ({ id: 'e1', leadId: 'l1', learnerName: 'Asha Verma', type: 'HIGH_VALUE', title: 'Corporate batch', context: '12 seats', blocker: 'Needs discount approval', requestedHelp: null, status: 'OPEN', ownerId: 'u', ownerName: 'Exec A', createdByName: 'Exec A', teamLeadName: 'Ravi', founderInvolved: true, resolution: null, resolvedAt: null, version: 1, createdAt: iso(-3), ...o });
    apiMock.get.mockResolvedValue(envelope([e({}), e({ id: 'e2', title: 'Custom plan', status: 'RESOLVED', resolution: 'Approved 5 instalments' })], page));
    renderWithProviders(<EscalationsPage />);
    const open = (await screen.findByRole('heading', { name: /^Open/ })).closest('section')!;
    expect(within(open).getByText('Corporate batch')).toBeInTheDocument();
    expect(within(open).getByText('Needs discount approval')).toBeInTheDocument();
    expect(within(open).getByText('Founder involved')).toBeInTheDocument();
    const done = screen.getByRole('heading', { name: /^Resolved/ }).closest('section')!;
    expect(within(done).getByText('Approved 5 instalments')).toBeInTheDocument();
    expect(within(done).queryByRole('button', { name: 'Resolve' })).toBeNull(); // finished escalations have no actions
  });

  it('refund tracking shows requested, approved and processed as separate facts and a status-only view for restricted groups', async () => {
    perms.set = new Set(['refunds:view', 'complaints:update']);
    const row = { id: 'rf1', dealId: 'd', status: 'PROCESSED', reasonCategory: 'MISSELLING', learnerName: 'Asha Verma', programName: 'AI Sprint', minimumData: false, currency: 'INR', rootCause: null,
      requested: { at: iso(-72), amount: '10000', byName: 'Exec A' }, approved: { at: iso(-48), amount: '8000', byName: 'Founder' }, processed: { at: iso(-24), amount: '8000', byName: 'Finance' } };
    apiMock.get.mockResolvedValue(envelope([row, { ...row, id: 'rf2', status: 'REQUESTED', approved: { at: null }, processed: { at: null } }], page));
    const { unmount } = renderWithProviders(<RefundsPage />);
    expect(await screen.findAllByText('Asha Verma', { exact: false })).not.toHaveLength(0);
    expect(screen.getAllByText('INR 10,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('INR 8,000').length).toBe(2);
    expect(screen.getByText('Not approved')).toBeInTheDocument();
    expect(screen.getByText('Not processed')).toBeInTheDocument();
    expect(screen.getAllByText('No root cause tagged yet').length).toBe(2);
    unmount();
    apiMock.get.mockResolvedValue(envelope([{ ...row, minimumData: true, requested: { at: row.requested.at }, approved: { at: row.approved.at }, processed: { at: row.processed.at } }], page));
    renderWithProviders(<RefundsPage />);
    expect(await screen.findByText('Amounts and reasons are not shared with your group.')).toBeInTheDocument();
    expect(screen.queryByText(/INR/)).toBeNull();
  });

  it('risk register flags risks without a proposed solution', async () => {
    perms.set = new Set(['founder-reports:view', 'founder-reports:create']);
    const r = (o: object) => ({ id: 'k1', title: 'Collections slipping', description: 'EMI misses', severity: 3, status: 'OPEN', proposedSolution: null, hasSolution: false, earlyWarning: true, ownerName: 'TL', raisedByName: 'TL', raisedAt: iso(-24), resolvedAt: null, resolutionNote: null, ...o });
    apiMock.get.mockResolvedValue(envelope([r({}), r({ id: 'k2', title: 'Hiring gap', proposedSolution: 'Start sourcing', hasSolution: true, earlyWarning: false })], page));
    renderWithProviders(<RisksPage />);
    expect(await screen.findByText('Collections slipping')).toBeInTheDocument();
    expect(screen.getByText('No solution yet')).toBeInTheDocument();
    expect(screen.getByText('Not yet proposed')).toBeInTheDocument();
    expect(screen.getByText('Early warning')).toBeInTheDocument();
    expect(screen.getByText('Start sourcing')).toBeInTheDocument();
  });
});
