import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { SettingsPage } from '../src/pages/settings/SettingsPage';
import { renderRoutes } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// Settings (TUI-130): the settings screens the role can open, behind the sidebar's one link.

const org = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg = (role: Role) => (tree: ReactNode) => (
  <OrgContext.Provider
    value={{
      me: { id: 'usr_1', email: 'o@example.com', name: 'Olivia', memberships: [] },
      membership: { id: 'mem_me', role, branchIds: null, org },
      org: undefined,
    }}
  >
    {tree}
  </OrgContext.Provider>
);
const routes = [{ path: '/o/bright-minds/settings', element: <SettingsPage /> }];
const titles = () =>
  screen.getAllByRole('link').map((link) => link.querySelector('b')?.textContent);

describe('settings', () => {
  it('lists every settings screen for the owner, with the setup wizard first', () => {
    renderRoutes(routes, '/o/bright-minds/settings', inOrg('owner'));
    expect(titles()).toEqual([
      'Set up your centre',
      'Organisation',
      'Branches',
      'Terms & holidays',
      'Courses',
      'Pricing',
      'Team',
      'Theme',
      'Privacy & data',
    ]);
    expect(screen.getByRole('link', { name: /Set up your centre/ })).toHaveAttribute(
      'href',
      '/o/bright-minds/setup',
    );
  });

  it('shows an accountant only what they can open', () => {
    renderRoutes(routes, '/o/bright-minds/settings', inOrg('accountant'));
    expect(titles()).not.toContain('Organisation');
    expect(titles()).not.toContain('Set up your centre');
    expect(titles()).toContain('Pricing');
  });

  it('isn’t there for parents', () => {
    renderRoutes(routes, '/o/bright-minds/settings', inOrg('parent'));
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});
