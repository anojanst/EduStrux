import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/layouts/AppShell';
import { OrgContext } from '../src/lib/org';
import { resetAccount } from './clerk';
import { renderRoutes } from './render';

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
