import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgContext } from '../src/lib/org';
import { ProfilePage } from '../src/pages/ProfilePage';
import { clerk, signInAs } from './clerk';
import { renderRoutes } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

const inOrg = (tree: ReactNode) => (
  <OrgContext.Provider
    value={{
      me: {
        id: 'usr_1',
        email: 'ethan@example.com',
        name: null,
        memberships: [
          {
            id: 'mem_1',
            role: 'owner',
            branchIds: null,
            org: { id: 'org_1', name: 'Magic Center', slug: 'magic' },
          },
          {
            id: 'mem_2',
            role: 'teacher',
            branchIds: null,
            org: { id: 'org_2', name: 'Harmony Music', slug: 'harmony' },
          },
        ],
      },
      membership: {
        id: 'mem_1',
        role: 'owner',
        branchIds: null,
        org: { id: 'org_1', name: 'Magic Center', slug: 'magic' },
      },
      org: undefined,
    }}
  >
    {tree}
  </OrgContext.Provider>
);
const routes = [{ path: '*', element: <ProfilePage /> }];

beforeEach(() => {
  signInAs('ethan@example.com');
  clerk.firstName = null;
  clerk.lastName = null;
  clerk.updateUser.mockClear();
  clerk.getToken.mockClear();
});

describe('the profile page', () => {
  it('shows the sign-in address and every org with its role', () => {
    renderRoutes(routes, '/', inOrg);
    expect(screen.getByText('No name yet')).toBeVisible();
    expect(screen.getAllByText('ethan@example.com')[0]).toBeVisible();
    expect(screen.getByText('Magic Center')).toBeVisible();
    expect(screen.getByText('Owner')).toBeVisible();
    expect(screen.getByText('Harmony Music')).toBeVisible();
    expect(screen.getByText('Teacher')).toBeVisible();
  });

  it('saves the name in Clerk, then fetches a fresh token so the API stores it', async () => {
    renderRoutes(routes, '/', inOrg);
    const save = screen.getByRole('button', { name: 'Save name' });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/First name/), ' Ethan ');
    await userEvent.type(screen.getByLabelText(/Last name/), 'Nojan');
    await userEvent.click(save);

    expect(await screen.findByText('Your name is saved.')).toBeVisible();
    expect(clerk.updateUser).toHaveBeenCalledWith({ firstName: 'Ethan', lastName: 'Nojan' });
    expect(clerk.getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(screen.getByText('Ethan Nojan')).toBeVisible();
  });

  it('asks for a first name, and shows what Clerk refuses', async () => {
    renderRoutes(routes, '/', inOrg);
    await userEvent.type(screen.getByLabelText(/Last name/), 'Nojan');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByText('Enter your first name.')).toBeVisible();
    expect(clerk.updateUser).not.toHaveBeenCalled();

    clerk.updateUser.mockRejectedValueOnce(new Error('offline'));
    await userEvent.type(screen.getByLabelText(/First name/), 'Ethan');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('Something went wrong. Try again in a moment.')).toBeVisible();
  });

  it('fills the form with the name Clerk already has', () => {
    clerk.firstName = 'Ethan';
    clerk.lastName = 'Nojan';
    renderRoutes(routes, '/', inOrg);
    expect(screen.getByLabelText(/First name/)).toHaveValue('Ethan');
    expect(screen.getByLabelText(/Last name/)).toHaveValue('Nojan');
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
  });
});
