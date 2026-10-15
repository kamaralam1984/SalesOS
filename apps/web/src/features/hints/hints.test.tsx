import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { NextIntlClientProvider } from 'next-intl';
import { HintTip, PageHeader, PageHint, TooltipProvider } from '@salesos/ui';
import en from '../../../messages/en.json';
import hi from '../../../messages/hi.json';
import mr from '../../../messages/mr.json';
import { PAGE_HINTS, TIP_HINTS, matchPageHint } from './catalogue';
import { HintsProvider, storageKeyFor, useHints } from './hints-provider';
import { Hint, HintsToggle, PageHintView, RouteHintProvider } from './hint-views';

let pathname = '/crm/leads';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const wrap = (ui: React.ReactElement, userId = 'u1') =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      <HintsProvider userId={userId}>
        <TooltipProvider>
          <RouteHintProvider>{ui}</RouteHintProvider>
        </TooltipProvider>
      </HintsProvider>
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  window.localStorage.clear();
  pathname = '/crm/leads';
});

describe('catalogue', () => {
  it('matches routes, preferring literal segments over dynamic ones', () => {
    expect(matchPageHint('/crm/leads')).toBe('crmLeads');
    expect(matchPageHint('/crm/leads/3f2a')).toBe('crmLeadDetail');
    expect(matchPageHint('/sop/new')).toBe('sopEditorNew');
    expect(matchPageHint('/sop/abc')).toBe('sopReader');
    expect(matchPageHint('/sop/abc/edit')).toBe('sopEditor');
    expect(matchPageHint('/reporting/kpis')).toBe('reportingKpis');
    expect(matchPageHint('/reporting/follow-ups')).toBe('reportingReport');
    expect(matchPageHint('/cx/handovers/new')).toBe('cxHandoverNew');
    expect(matchPageHint('/login')).toBeNull();
    expect(matchPageHint(null)).toBeNull();
  });

  const t = (m: unknown, path: string) =>
    path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], m);
  for (const [name, msgs] of [
    ['en', en],
    ['hi', hi],
    ['mr', mr],
  ] as const) {
    it(`has ${name} text for every page and tip hint`, () => {
      for (const [id, def] of Object.entries(PAGE_HINTS)) {
        expect(t(msgs, `hints.page.${id}.what`), `${name}:${id}.what`).toEqual(expect.any(String));
        expect(t(msgs, `hints.page.${id}.first`), `${name}:${id}.first`).toEqual(
          expect.any(String),
        );
        const hasTip = 'tip' in def && def.tip === true;
        expect(typeof t(msgs, `hints.page.${id}.tip`) === 'string', `${name}:${id}.tip`).toBe(
          hasTip,
        );
      }
      for (const id of Object.keys(TIP_HINTS)) {
        expect(t(msgs, `hints.tip.${id}.title`), `${name}:${id}.title`).toEqual(expect.any(String));
        expect(t(msgs, `hints.tip.${id}.body`), `${name}:${id}.body`).toEqual(expect.any(String));
      }
    });
  }
  it('hi and mr are translated, not copied English', () => {
    for (const id of Object.keys(PAGE_HINTS)) {
      expect(t(hi, `hints.page.${id}.what`)).not.toBe(t(en, `hints.page.${id}.what`));
      expect(t(mr, `hints.page.${id}.what`)).not.toBe(t(en, `hints.page.${id}.what`));
    }
  });
});

describe('HintsProvider', () => {
  function Probe() {
    const h = useHints();
    return (
      <div>
        <span data-testid="state">{`${h.ready}|${h.enabled}|${h.isDismissed('a')}`}</span>
        <button onClick={() => h.dismiss('a')}>dismiss</button>
        <button onClick={() => h.restore('a')}>restore</button>
        <button onClick={h.toggle}>toggle</button>
        <button onClick={h.reset}>reset</button>
      </div>
    );
  }
  const renderProbe = (userId = 'u1') =>
    render(
      <HintsProvider userId={userId}>
        <Probe />
      </HintsProvider>,
    );

  it('dismisses, restores, toggles and resets, persisting per user', async () => {
    const user = userEvent.setup();
    const { unmount } = renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('true|true|false');
    await user.click(screen.getByText('dismiss'));
    await user.click(screen.getByText('toggle'));
    expect(screen.getByTestId('state')).toHaveTextContent('true|false|true');
    expect(JSON.parse(window.localStorage.getItem(storageKeyFor('u1'))!)).toEqual({
      enabled: false,
      dismissed: ['a'],
    });
    unmount();
    // a new mount for the same user reads the saved choice; another user does not see it
    const second = renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('true|false|true');
    second.unmount();
    renderProbe('u2');
    expect(screen.getByTestId('state')).toHaveTextContent('true|true|false');
    await user.click(screen.getByText('dismiss'));
    await user.click(screen.getByText('restore'));
    expect(screen.getByTestId('state')).toHaveTextContent('true|true|false');
    await user.click(screen.getByText('dismiss'));
    await user.click(screen.getByText('reset'));
    expect(screen.getByTestId('state')).toHaveTextContent('true|true|false');
  });

  it('renders and works in memory when localStorage throws', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('true|true|false');
    await user.click(screen.getByText('dismiss'));
    expect(screen.getByTestId('state')).toHaveTextContent('true|true|true');
    get.mockRestore();
    set.mockRestore();
  });

  it('ignores corrupted stored data', () => {
    window.localStorage.setItem(storageKeyFor('u1'), '{not json');
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('true|true|false');
  });

  it('stores nothing but a boolean and hint ids', async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByText('dismiss'));
    const saved = JSON.parse(window.localStorage.getItem(storageKeyFor('u1'))!);
    expect(Object.keys(saved).sort()).toEqual(['dismissed', 'enabled']);
  });
});

describe('route-aware page hint', () => {
  it('shows the hint for the current route inside PageHeader, can be dismissed, restored and switched off', async () => {
    const user = userEvent.setup();
    wrap(
      <>
        <HintsToggle />
        <PageHeader title="Leads" />
      </>,
    );
    expect(await screen.findByRole('region', { name: 'About this page' })).toBeInTheDocument();
    expect(screen.getByText(/Search, filter and work every lead/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide these tips for this page' }));
    expect(screen.queryByRole('region', { name: 'About this page' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show page tips' }));
    expect(screen.getByRole('region', { name: 'About this page' })).toBeInTheDocument();

    const sw = screen.getByRole('switch', { name: 'Show hints' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('region', { name: 'About this page' })).not.toBeInTheDocument();
    expect(screen.queryByText('Show page tips')).not.toBeInTheDocument();
  });

  it('shows no card on routes without a hint', () => {
    pathname = '/something-else';
    wrap(<PageHeader title="X" />);
    expect(screen.queryByRole('region', { name: 'About this page' })).not.toBeInTheDocument();
  });

  it('PageHintView honours an explicit id and hides when disabled', async () => {
    window.localStorage.setItem(
      storageKeyFor('u1'),
      JSON.stringify({ enabled: false, dismissed: [] }),
    );
    wrap(<PageHintView id="crmExceptions" />);
    await act(async () => {});
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});

describe('Hint / HintTip accessibility', () => {
  it('is a labelled button that opens a labelled dialog by keyboard and closes with Escape', async () => {
    const user = userEvent.setup();
    wrap(<Hint id="dealClosedWon" />);
    const btn = await screen.findByRole('button', {
      name: /Help: Closed-Won is not money received/,
    });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    btn.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Closed-Won is not money received' });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toHaveAccessibleDescription(/Money only counts as collected/);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });

  it('renders nothing when hints are off', async () => {
    window.localStorage.setItem(
      storageKeyFor('u1'),
      JSON.stringify({ enabled: false, dismissed: [] }),
    );
    wrap(<Hint id="callWon" />);
    await act(async () => {});
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows an optional learn-more link and a close button', async () => {
    const user = userEvent.setup();
    render(
      <HintTip title="T" learnMoreHref="/x" learnMoreLabel="More" closeLabel="Shut">
        <p>Body</p>
      </HintTip>,
    );
    await user.click(screen.getByRole('button', { name: 'Help: T' }));
    expect(screen.getByRole('link', { name: 'More' })).toHaveAttribute('href', '/x');
    await user.click(screen.getByRole('button', { name: 'Shut' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('PageHint collapses with aria-expanded and has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PageHint
        labels={{
          title: 'About',
          whatLabel: 'What',
          firstLabel: 'First',
          tipLabel: 'Tip',
          collapse: 'Collapse',
          expand: 'Expand',
          dismiss: 'Hide',
          restore: 'Show',
        }}
        what="What it is"
        first="Do this"
        tip="Know this"
        onDismiss={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
    const toggle = screen.getByRole('button', { name: 'Collapse' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    const expand = screen.getByRole('button', { name: 'Expand' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('What it is')).not.toBeVisible();
  });
});
