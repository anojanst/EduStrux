import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/layouts/AppShell';
import type { Org } from '@edustrux/shared';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { resetAccount } from './clerk';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

const org = { id: 'org_1', name: 'Magic Center', slug: 'magic' };
const inOrg = (tree: ReactNode) => (
  <OrgContext.Provider
    value={{
      me: {
        id: 'usr_1',
        email: 'ethan@example.com',
        name: 'Ethan Nojan',
        memberships: [{ id: 'mem_1', role: 'owner', branchIds: null, org }],
      },
      membership: { id: 'mem_1', role: 'owner', branchIds: null, org },
      org: undefined,
    }}
  >
    {tree}
  </OrgContext.Provider>
);
const routes = [{ path: '*', element: <AppShell>page</AppShell> }];
const sidebar = () => screen.getByRole('navigation', { name: 'Main' }).parentElement!;

beforeEach(() => resetAccount());

describe('the sidebar', () => {
  it('collapses to an icon rail that keeps every link named, and remembers it', async () => {
    const first = renderRoutes(routes, '/o/magic', inOrg);
    expect(sidebar()).toHaveClass('lg:w-[248px]');

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(sidebar()).not.toHaveClass('lg:w-[248px]');
    expect(sidebar()).toHaveClass('w-[72px]');
    const nav = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(nav.getByRole('link', { name: 'Home' })).toBeVisible();
    // The settings screens sit behind one Settings link at the foot (TUI-130).
    expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/o/magic/settings',
    );
    expect(nav.queryByRole('link', { name: 'Team' })).toBeNull();
    expect(localStorage.getItem('edustrux.sidebarCollapsed')).toBe('1');
    first.unmount();

    renderRoutes(routes, '/o/magic', inOrg);
    expect(sidebar()).not.toHaveClass('lg:w-[248px]');
    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(sidebar()).toHaveClass('lg:w-[248px]');
    expect(localStorage.getItem('edustrux.sidebarCollapsed')).toBe('0');
  });
});

describe('the trial banner', () => {
  const trialing = {
    status: 'trialing',
    trialEndsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  } as unknown as Org;
  const as = (role: Role) => (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: { id: 'usr_1', email: 'ethan@example.com', name: 'Ethan Nojan', memberships: [] },
        membership: { id: 'mem_1', role, branchIds: null, org },
        org: trialing,
      }}
    >
      {tree}
    </OrgContext.Provider>
  );

  it('tells the owner and branch managers the trial is running out, and nobody else', () => {
    for (const role of ['owner', 'branch_manager'] as const) {
      const view = renderRoutes(routes, '/o/magic/classes', as(role));
      expect(screen.getByText('Your free trial ends in 5 days.')).toBeVisible();
      view.unmount();
    }
    // Home has its own trial card (TUI-130).
    const home = renderRoutes(routes, '/o/magic', as('owner'));
    expect(screen.queryByText('Your free trial ends in 5 days.')).toBeNull();
    home.unmount();
    for (const role of ['front_desk', 'teacher', 'accountant', 'parent'] as const) {
      const view = renderRoutes(routes, '/o/magic/classes', as(role));
      expect(screen.queryByText(/free trial/)).toBeNull();
      view.unmount();
    }
  });

  it('still tells everyone when the centre is read-only', () => {
    const ended = { status: 'suspended', trialEndsAt: null } as unknown as Org;
    renderRoutes(routes, '/o/magic', (tree) => (
      <OrgContext.Provider
        value={{
          me: { id: 'usr_1', email: 'ethan@example.com', name: 'Ethan Nojan', memberships: [] },
          membership: { id: 'mem_1', role: 'teacher', branchIds: null, org },
          org: ended,
        }}
      >
        {tree}
      </OrgContext.Provider>
    ));
    expect(screen.getByRole('alert')).toHaveTextContent('read-only');
  });
});

describe('the + New menu', () => {
  const as = (role: Role) => (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: { id: 'usr_1', email: 'ethan@example.com', name: 'Ethan Nojan', memberships: [] },
        membership: { id: 'mem_1', role, branchIds: null, org },
        org: undefined,
      }}
    >
      {tree}
    </OrgContext.Provider>
  );

  it('offers what the role may create, and opens its dialog', async () => {
    stubApi({
      'GET /api/v1/orgs/org_1/invoices?status=issued&limit=200': {
        body: { data: [], nextCursor: null },
      },
      'GET /api/v1/orgs/org_1/invoices?status=part_paid&limit=200': {
        body: { data: [], nextCursor: null },
      },
      'GET /api/v1/orgs/org_1/terms?limit=200': { body: { data: [], nextCursor: null } },
    });
    renderRoutes(routes, '/o/magic', as('front_desk'));
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Family',
      'Class',
      'Payment',
      'Announcement',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Payment' }));
    expect(await screen.findByRole('dialog', { name: 'Record payment' })).toBeVisible();
    expect(await screen.findByText('No family has an issued invoice to pay.')).toBeVisible();
  });

  it('offers a teacher only an announcement', async () => {
    renderRoutes(routes, '/o/magic', as('teacher'));
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Announcement',
    ]);
  });

  it('isn’t there for roles that create nothing', () => {
    renderRoutes(routes, '/o/magic', as('accountant'));
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
  });
});

describe('the tab bar on phones', () => {
  const as = (role: Role) => (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: { id: 'usr_1', email: 'ethan@example.com', name: 'Ethan Nojan', memberships: [] },
        membership: { id: 'mem_1', role, branchIds: null, org },
        org: undefined,
      }}
    >
      {tree}
    </OrgContext.Provider>
  );
  const tabs = () => within(screen.getByRole('navigation', { name: 'Sections' }));
  const names = () =>
    [...screen.getByRole('navigation', { name: 'Sections' }).children].map((el) => el.textContent);

  it('gives staff four areas, then More, which opens the full menu', async () => {
    renderRoutes(routes, '/o/magic/settings/team', as('owner'));
    expect(names()).toEqual(['Home', 'Timetable', 'Families', 'Invoices', 'More']);
    expect(tabs().getByRole('link', { name: 'Families' })).toHaveAttribute(
      'href',
      '/o/magic/families',
    );
    // Team is a settings screen, not a tab, so More is lit.
    const more = tabs().getByRole('button', { name: 'More' });
    expect(more).toHaveClass('text-brand');

    await userEvent.click(more);
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('link', { name: 'Settings' })).toBeVisible();
    expect(more).toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves More unlit on a tab’s page', () => {
    renderRoutes(routes, '/o/magic/invoices', as('owner'));
    expect(tabs().getByRole('button', { name: 'More' })).not.toHaveClass('text-brand');
    expect(tabs().getByRole('link', { name: 'Invoices' })).toHaveClass('text-brand');
  });

  it('gives a teacher Today, Timetable and Messages', () => {
    renderRoutes(routes, '/o/magic', as('teacher'));
    expect(names()).toEqual(['Today', 'Timetable', 'Messages', 'More']);
    expect(tabs().getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/o/magic');
  });

  it('fills in from the menu for a role without some of the areas', () => {
    renderRoutes(routes, '/o/magic', as('accountant'));
    expect(names()).toEqual(['Home', 'Invoices', 'Payments', 'More']);
  });

  it('keeps the parent portal’s own More page', () => {
    renderRoutes(routes, '/o/magic', as('parent'));
    expect(names()).toEqual(['Home', 'Timetable', 'Invoices', 'Messages', 'More']);
    expect(tabs().getByRole('link', { name: 'More' })).toHaveAttribute('href', '/o/magic/more');
  });
});

describe('the offline banner', () => {
  it('shows while the browser is offline', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderRoutes(routes, '/o/magic', inOrg);
    expect(screen.getByText(/You’re offline/)).toBeVisible();

    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByText(/You’re offline/)).toBeNull();
    online.mockRestore();
  });
});

describe('the sidebar on a tablet', () => {
  it('stays a rail whose button opens the full menu as a drawer', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 1023px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderRoutes(routes, '/o/magic', inOrg);
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Families & students')).toBeVisible();
    expect(within(drawer).getByRole('link', { name: 'Settings' })).toBeVisible();
  });
});

describe('the header', () => {
  const two = {
    id: 'usr_1',
    email: 'ethan@example.com',
    name: 'Ethan Nojan',
    memberships: [
      { id: 'mem_1', role: 'owner' as const, branchIds: null, org },
      {
        id: 'mem_2',
        role: 'teacher' as const,
        branchIds: null,
        org: { id: 'org_2', name: 'Harmony Music', slug: 'harmony' },
      },
    ],
  };
  const withTwo = (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: two,
        membership: { id: 'mem_1', role: 'owner', branchIds: null, org },
        org: undefined,
      }}
    >
      {tree}
    </OrgContext.Provider>
  );

  it('shows the centre, and lists the others to switch to', async () => {
    renderRoutes(routes, '/o/magic', withTwo);
    await userEvent.click(
      screen.getByRole('button', { name: 'Magic Center: switch organisation' }),
    );
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'MCMagic CenterOwner',
      'HMHarmony MusicTeacher',
      'Start another centre',
    ]);
    expect(items[1]).toHaveAttribute('href', '/o/harmony');
  });

  it('opens the profile, switches centre and signs out from the user menu', async () => {
    renderRoutes(routes, '/o/magic', withTwo);
    await userEvent.click(screen.getByRole('button', { name: 'Account: Ethan Nojan' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Your profile',
      'Switch centre',
      'Sign out',
    ]);
  });

  it('shows a single centre without a menu', () => {
    renderRoutes(routes, '/o/magic', inOrg);
    expect(screen.queryByRole('button', { name: /switch organisation/ })).toBeNull();
    expect(screen.getByText('Magic Center')).toBeVisible();
  });
});
