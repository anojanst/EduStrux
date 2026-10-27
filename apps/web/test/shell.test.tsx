import { screen } from '@testing-library/react';
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
    expect(sidebar()).toHaveClass('w-[248px]');
    expect(screen.getByText('Ethan Nojan')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(sidebar()).toHaveClass('w-[72px]');
    expect(screen.queryByText('Ethan Nojan')).toBeNull();
    expect(screen.getByRole('link', { name: 'Home' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Team' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Your profile' })).toBeVisible();
    expect(localStorage.getItem('edustrux.sidebarCollapsed')).toBe('1');
    first.unmount();

    renderRoutes(routes, '/o/magic', inOrg);
    expect(sidebar()).toHaveClass('w-[72px]');
    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(sidebar()).toHaveClass('w-[248px]');
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
      const view = renderRoutes(routes, '/o/magic', as(role));
      expect(screen.getByText('Your free trial ends in 5 days.')).toBeVisible();
      view.unmount();
    }
    for (const role of ['front_desk', 'teacher', 'accountant', 'parent'] as const) {
      const view = renderRoutes(routes, '/o/magic', as(role));
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
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Payment' }));
    expect(await screen.findByRole('dialog', { name: 'Record payment' })).toBeVisible();
    expect(await screen.findByText('No family has an issued invoice to pay.')).toBeVisible();
  });

  it('isn’t there for roles that create nothing', () => {
    for (const role of ['teacher', 'accountant'] as const) {
      const view = renderRoutes(routes, '/o/magic', as(role));
      expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
      view.unmount();
    }
  });
});
