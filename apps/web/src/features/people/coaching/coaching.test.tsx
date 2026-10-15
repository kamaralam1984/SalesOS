import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/utils';
import { makeAuth, one, page } from '../test-support';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });
const h = vi.hoisted(() => ({ auth: {} as unknown, get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/api/client', async (orig) => {
  const a = await orig<typeof import('@/lib/api/client')>();
  return { ...a, api: { get: h.get, post: h.post, patch: h.patch, put: vi.fn(), delete: vi.fn() } };
});

import { ApiError } from '@/lib/api/client';
import { CoachingPage } from './coaching-page';
import { HoursCard } from './hours-card';
import { OneOnOneCard } from './one-on-one-card';
import { SessionForm } from './session-form';
import { buildSessionPayload, periodRange, sessionFormSchema } from './schemas';
import type { CoachingSession, OneOnOne } from './api';

const people = [
  { id: 'p1', name: 'Asha Rao', managerId: 'me', roles: ['SALES_EXECUTIVE'] },
  { id: 'p2', name: 'Vikram Shah', managerId: 'me', roles: ['SALES_EXECUTIVE'] },
];
const emptyHours = { from: '', to: '', totalMinutes: 0, totalHours: 0, coaches: [], minutesByTopic: {} };
const manager = () => makeAuth({ 'coaching:view': 'team', 'coaching:create': 'team', 'coaching:update': 'team' }, ['SALES_MANAGER']);

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.patch.mockReset();
  h.auth = manager();
  h.get.mockImplementation(async (path: string) => {
    if (path === '/people/team-members') return one(people);
    if (path === '/coaching/hours') return one({ from: '', to: '', totalMinutes: 0, totalHours: 0, coaches: [], minutesByTopic: {} });
    return page([]);
  });
});

describe('session schema and payload', () => {
  const base = { kind: 'COACHING' as const, sessionDate: '2026-10-14T10:00', durationMin: 45, topics: ['CLOSING'], participantIds: ['p1'], noteVisibility: 'PARTICIPANTS' as const, actions: [] };
  it('requires participants, topics and a sensible duration', () => {
    expect(sessionFormSchema.safeParse(base).success).toBe(true);
    const no = sessionFormSchema.safeParse({ ...base, participantIds: [], topics: [], durationMin: 2 });
    expect(no.success).toBe(false);
    const msgs = no.success ? [] : no.error.issues.map((i) => i.message).sort();
    expect(msgs).toEqual(['min5', 'participantsRequired', 'topicsRequired']);
    expect(sessionFormSchema.safeParse({ ...base, durationMin: 600 }).success).toBe(false);
    expect(sessionFormSchema.safeParse({ ...base, durationMin: 30.5 }).success).toBe(false);
  });
  it('builds an API payload with facts only (no score fields)', () => {
    const p = buildSessionPayload({ ...base, notes: ' Practised ', callRef: '', actions: [{ title: ' Redo call ', ownerId: 'p1', dueDate: '2026-10-20' }, { title: 'No date here', ownerId: 'me', dueDate: '' }] });
    expect(p).toMatchObject({ kind: 'COACHING', durationMin: 45, topics: ['CLOSING'], participantIds: ['p1'], notes: 'Practised', noteVisibility: 'PARTICIPANTS' });
    expect(p.callRef).toBeUndefined();
    expect(p.actions).toEqual([{ title: 'Redo call', ownerId: 'p1', dueDate: '2026-10-20' }, { title: 'No date here', ownerId: 'me' }]);
    expect(p.sessionDate).toBe(new Date('2026-10-14T10:00').toISOString());
    expect(Object.keys(p).join()).not.toMatch(/score|rating|ai/i);
  });
  it('computes period ranges', () => {
    const r = periodRange('month', new Date('2026-10-15T08:00:00Z'));
    expect(r.from).toBe('2026-10-01T00:00:00.000Z');
    expect(periodRange('week', new Date('2026-10-15T08:00:00Z')).from).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('SessionForm', () => {
  it('blocks submit with field errors when nothing is chosen, then submits the right payload', async () => {
    h.post.mockResolvedValue(one({ id: 's1' }));
    const done = vi.fn();
    renderWithProviders(<SessionForm onDone={done} />);
    await screen.findByRole('checkbox', { name: 'Asha Rao' });
    await userEvent.click(screen.getByRole('button', { name: /save session/i }));
    expect(await screen.findByText('Choose at least one participant')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one topic')).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Asha Rao' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Call quality' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Closing' }));
    await userEvent.type(screen.getByLabelText(/^notes/i), 'Reviewed two calls');
    await userEvent.click(screen.getByRole('button', { name: /save session/i }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    const [path, body] = h.post.mock.calls[0]!;
    expect(path).toBe('/coaching/sessions');
    expect(body).toMatchObject({ participantIds: ['p1'], topics: ['CALL_QUALITY', 'CLOSING'], durationMin: 30, notes: 'Reviewed two calls', noteVisibility: 'PARTICIPANTS' });
    await waitFor(() => expect(done).toHaveBeenCalled());
  });

  it('explains who can read the notes for each visibility choice', async () => {
    renderWithProviders(<SessionForm onDone={vi.fn()} />);
    const select = await screen.findByLabelText(/who can read the notes/i);
    expect(screen.getByText(/you and the people in the session can read/i)).toBeInTheDocument();
    await userEvent.selectOptions(select, 'COACH_ONLY');
    expect(screen.getByText('Only you can read these notes.')).toBeInTheDocument();
    await userEvent.selectOptions(select, 'MANAGEMENT');
    expect(screen.getByText(/team lead and hr/i)).toBeInTheDocument();
  });

  it('offers action items only for the coach or chosen participants and shows API failures without claiming success', async () => {
    h.post.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Participant not found' }));
    const done = vi.fn();
    renderWithProviders(<SessionForm onDone={done} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Vikram Shah' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Negotiation' }));
    await userEvent.click(screen.getByRole('button', { name: /add action item/i }));
    const owner = screen.getByLabelText(/^owner/i);
    expect(within(owner).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Me', 'Vikram Shah']);
    await userEvent.type(screen.getByLabelText(/^action\b/i), 'Practise price script');
    await userEvent.selectOptions(owner, 'p2');
    await userEvent.click(screen.getByRole('button', { name: /save session/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not find that record/i);
    expect(done).not.toHaveBeenCalled();
  });
});

describe('HoursCard', () => {
  it('shows recorded hours, counts and the facts-only note', async () => {
    h.get.mockImplementation(async (path: string) =>
      path === '/coaching/hours'
        ? one({ from: '', to: '', totalMinutes: 750, totalHours: 12.5, minutesByTopic: {}, coaches: [{ coachId: 'c', coachName: 'Meera Joshi', sessionMinutes: 600, oneOnOneMinutes: 150, sessions: 8, oneOnOnes: 5, totalMinutes: 750, totalHours: 12.5 }] })
        : page([]),
    );
    renderWithProviders(<HoursCard />);
    expect(await screen.findByText('12.5 h')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Meera Joshi')).toBeInTheDocument();
    expect(screen.getByText(/no scores|actually recorded/i)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/period/i), 'week');
    await waitFor(() => expect(h.get.mock.calls.filter((c) => c[0] === '/coaching/hours').length).toBeGreaterThan(1));
  });
  it('shows an honest empty line when nothing was recorded', async () => {
    renderWithProviders(<HoursCard />);
    expect(await screen.findByText(/no coaching recorded in this period/i)).toBeInTheDocument();
  });
});

const session = (over: Partial<CoachingSession> = {}): CoachingSession => ({
  id: 's1', kind: 'COACHING', sessionDate: '2026-10-14T10:00:00Z', durationMin: 45, topics: ['CALL_QUALITY'], callRef: null, noteVisibility: 'PARTICIPANTS', coachId: 'c', coachName: 'Meera Joshi',
  participants: [{ userId: 'p1', name: 'Asha Rao' }], notes: 'Worked on openers', notesHidden: false, actions: [], createdAt: '2026-10-14T10:00:00Z', ...over,
});

describe('CoachingPage states', () => {
  it('loading, then rows with a hidden-notes indicator and a detail view', async () => {
    h.get.mockImplementation(async (path: string) => {
      if (path === '/coaching/sessions') return page([session(), session({ id: 's2', notes: null, notesHidden: true, noteVisibility: 'COACH_ONLY' })]);
      if (path === '/coaching/hours') return one({ from: '', to: '', totalMinutes: 0, totalHours: 0, coaches: [], minutesByTopic: {} });
      if (path === '/people/team-members') return one(people);
      return page([]);
    });
    renderWithProviders(<CoachingPage />);
    expect(await screen.findAllByText('Asha Rao')).not.toHaveLength(0);
    expect(screen.getAllByText('Hidden').length).toBeGreaterThan(0);
    await userEvent.click(within(screen.getByRole('table')).getAllByText('Asha Rao')[0]!);
    expect(await screen.findByText('Worked on openers')).toBeInTheDocument();
  });
  it('shows the hidden-notes explanation in the detail dialog', async () => {
    h.get.mockImplementation(async (path: string) => (path === '/coaching/sessions' ? page([session({ notes: null, notesHidden: true, noteVisibility: 'COACH_ONLY' })]) : path === '/people/team-members' ? one(people) : one({ from: '', to: '', totalMinutes: 0, totalHours: 0, coaches: [], minutesByTopic: {} })));
    renderWithProviders(<CoachingPage />);
    await screen.findAllByText('Asha Rao');
    await userEvent.click(within(screen.getByRole('table')).getAllByText('Asha Rao')[0]!);
    expect(await screen.findByText(/notes are not shared with you/i)).toBeInTheDocument();
  });
  it('empty state', async () => {
    renderWithProviders(<CoachingPage />);
    expect(await screen.findByText('No coaching sessions yet')).toBeInTheDocument();
  });
  it('error state with retry', async () => {
    h.get.mockImplementation(async (path: string) => {
      if (path === '/coaching/sessions') throw new ApiError({ status: 500, code: 'X', message: 'boom' });
      return path === '/people/team-members' ? one(people) : one({ from: '', to: '', totalMinutes: 0, totalHours: 0, coaches: [], minutesByTopic: {} });
    });
    renderWithProviders(<CoachingPage />);
    expect(await screen.findByText(/something went wrong on our side/i)).toBeInTheDocument();
  });
  it('permission-denied state for roles without coaching access', () => {
    h.auth = makeAuth({ 'resources:view': 'org' }, ['ADMIN']);
    renderWithProviders(<CoachingPage />);
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
    expect(h.get).not.toHaveBeenCalled();
  });
  it('hides "record session" without coaching:create', async () => {
    h.auth = makeAuth({ 'coaching:view': 'own' }, ['SALES_EXECUTIVE']);
    renderWithProviders(<CoachingPage />);
    await screen.findByText('No coaching sessions yet');
    expect(screen.queryByRole('button', { name: /record session/i })).not.toBeInTheDocument();
  });
  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<CoachingPage />);
    await screen.findByText('No coaching sessions yet');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Action items', () => {
  it('lets owners change only their own item status', async () => {
    h.auth = makeAuth({ 'coaching:view': 'own' }, ['SALES_EXECUTIVE'], 'p1');
    h.get.mockImplementation(async (path: string) => {
      if (path === '/coaching/actions')
        return page([
          { id: 'a1', title: 'Mine', ownerId: 'p1', ownerName: 'Asha Rao', dueDate: '2026-10-20', status: 'OPEN' },
          { id: 'a2', title: 'Theirs', ownerId: 'p2', ownerName: 'Vikram Shah', dueDate: null, status: 'OPEN' },
        ]);
      if (path === '/coaching/hours') return one(emptyHours);
      return path === '/people/team-members' ? one(people) : page([]);
    });
    h.patch.mockResolvedValue(one({}));
    renderWithProviders(<CoachingPage />);
    await userEvent.click(screen.getByRole('tab', { name: /action items/i }));
    expect(await screen.findByText('Mine')).toBeInTheDocument();
    const selects = screen.getAllByRole('combobox', { name: /my status/i });
    expect(selects).toHaveLength(1);
    await userEvent.selectOptions(selects[0]!, 'DONE');
    await waitFor(() => expect(h.patch).toHaveBeenCalledWith('/coaching/actions/a1', { status: 'DONE' }));
  });
});

describe('OneOnOneCard', () => {
  const item: OneOnOne = {
    id: 'o1', managerId: 'm1', managerName: 'Meera Joshi', employeeId: 'e1', employeeName: 'Asha Rao', status: 'HELD', scheduledFor: '2026-10-14T10:00:00Z', durationMin: 30,
    agenda: 'Weekly goals', sharedNotes: 'Agreed targets', privateNotes: 'Watch engagement', actions: [],
  };
  it('labels private notes clearly for the manager who wrote them', () => {
    renderWithProviders(<OneOnOneCard item={item} meId="m1" />);
    const box = screen.getByTestId('private-notes');
    expect(within(box).getByText(/private manager notes/i)).toBeInTheDocument();
    expect(within(box).getByText('Watch engagement')).toBeInTheDocument();
    expect(screen.getByText('Agreed targets')).toBeInTheDocument();
  });
  it('never renders private notes in the employee view, even if present in the data', () => {
    renderWithProviders(<OneOnOneCard item={item} meId="e1" />);
    expect(screen.queryByTestId('private-notes')).not.toBeInTheDocument();
    expect(screen.queryByText('Watch engagement')).not.toBeInTheDocument();
    expect(screen.getByText('Agreed targets')).toBeInTheDocument();
    expect(screen.getByText(/1:1 with Meera Joshi/)).toBeInTheDocument();
  });
});
