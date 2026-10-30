import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { ProfilePage } from '../src/pages/profile/ProfilePage';
import { lastActive } from '../src/pages/profile/SecuritySection';
import { clerk, makeEmail, makeSession, resetAccount } from './clerk';
import { renderRoutes, stubApi, Where } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

const magic = { id: 'org_1', name: 'Magic Center', slug: 'magic' };
const harmony = { id: 'org_2', name: 'Harmony Music', slug: 'harmony' };

function inOrg(role: Role = 'teacher') {
  const memberships = [
    { id: 'mem_1', role, branchIds: null, org: magic },
    { id: 'mem_2', role: 'parent' as Role, branchIds: ['brn_alb'], org: harmony },
  ];
  return (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: { id: 'usr_1', email: 'ethan@example.com', name: null, memberships },
        membership: memberships[0]!,
        org: undefined,
      }}
    >
      <ToastProvider>{tree}</ToastProvider>
    </OrgContext.Provider>
  );
}

const routes = [
  { path: '/o/magic/profile', element: <ProfilePage /> },
  { path: '*', element: <Where /> },
];
const open = (role?: Role, section = '') => {
  stubApi({
    'GET /api/v1/orgs/org_2/branches?limit=200': {
      body: { data: [{ id: 'brn_alb', name: 'Albany', address: null }], nextCursor: null },
    },
  });
  return renderRoutes(routes, `/o/magic/profile${section}`, inOrg(role));
};
const section = (name: string) => screen.getByRole('region', { name }) as HTMLElement;

beforeEach(() => resetAccount());

describe('profile', () => {
  it('saves the name in Clerk, then a fresh token so the API stores it', async () => {
    open();
    const profile = section('Profile');
    expect(within(profile).getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.type(within(profile).getByLabelText(/First name/), ' Ethan ');
    await userEvent.type(within(profile).getByLabelText(/Last name/), 'Nojan');
    await userEvent.click(within(profile).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Your name is saved.')).toBeVisible();
    expect(clerk.updateUser).toHaveBeenCalledWith({ firstName: 'Ethan', lastName: 'Nojan' });
    expect(clerk.getToken).toHaveBeenCalledWith({ skipCache: true });
  });

  it('asks for a first name before saving', async () => {
    open();
    const profile = section('Profile');
    await userEvent.type(within(profile).getByLabelText(/Last name/), 'Nojan');
    await userEvent.click(within(profile).getByRole('button', { name: 'Save' }));
    expect(within(profile).getByText('Enter your first name.')).toBeVisible();
    expect(clerk.updateUser).not.toHaveBeenCalled();
  });

  it('uploads a JPG or PNG photo, and refuses one over 10 MB', async () => {
    open();
    const input = within(section('Profile')).getByLabelText('Change photo', {
      selector: 'input',
    });
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await userEvent.upload(input, big);
    expect(screen.getByText(/That file is too big/)).toBeVisible();
    expect(clerk.setProfileImage).not.toHaveBeenCalled();

    const photo = new File(['x'], 'me.png', { type: 'image/png' });
    await userEvent.upload(input, photo);
    expect(await screen.findByText('Your photo is saved.')).toBeVisible();
    expect(clerk.setProfileImage).toHaveBeenCalledWith({ file: photo });
  });

  it('switches sections from the menu and remembers it in the address', async () => {
    const { router } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Sign-in and security' }));
    expect(router.state.location.search).toBe('?section=security');
    expect(screen.getByRole('button', { name: 'Sign-in and security' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('email addresses', () => {
  it('adds an address with the code sent to it', async () => {
    open();
    const security = section('Sign-in and security');
    expect(within(security).getByText('ethan@example.com')).toBeVisible();
    expect(within(security).getByText('Primary')).toBeVisible();
    // Everyone signs in with an emailed code: there's no password to set (D-192).
    expect(within(security).queryByText(/password/i)).toBeNull();

    await userEvent.click(within(security).getByRole('button', { name: 'Add email address' }));
    const dialog = screen.getByRole('dialog', { name: 'Add email address' });
    await userEvent.type(within(dialog).getByLabelText(/Email address/), 'new@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send code' }));

    const check = await screen.findByRole('dialog', { name: 'Check your email' });
    expect(within(check).getByText(/sent to new@example.com/)).toBeVisible();
    expect(within(check).getByRole('button', { name: /Resend code in/ })).toBeDisabled();
    const created = clerk.emails[1]!;
    expect(created.prepareVerification).toHaveBeenCalledWith({ strategy: 'email_code' });

    await userEvent.type(within(check).getByLabelText('Digit 1'), '123456');
    await userEvent.click(within(check).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Email address added.')).toBeVisible();
    expect(created.attemptVerification).toHaveBeenCalledWith({ code: '123456' });
  });

  it('asks "Confirm it’s you" when Clerk wants proof, then carries on', async () => {
    clerk.requireReverify = true;
    open();
    await userEvent.click(
      within(section('Sign-in and security')).getByRole('button', { name: 'Add email address' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Add email address' });
    await userEvent.type(within(dialog).getByLabelText(/Email address/), 'new@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send code' }));

    const confirm = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    expect(
      await within(confirm).findByText(/enter the code we sent to e\*\*\*@example.com/),
    ).toBeVisible();
    expect(clerk.session.prepareFirstFactorVerification).toHaveBeenCalledWith({
      strategy: 'email_code',
      emailAddressId: 'em_1',
    });
    expect(clerk.createEmailAddress).not.toHaveBeenCalled();

    await userEvent.type(within(confirm).getByLabelText('Digit 1'), '654321');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('dialog', { name: 'Check your email' })).toBeVisible();
    expect(clerk.session.attemptFirstFactorVerification).toHaveBeenCalledWith({
      strategy: 'email_code',
      code: '654321',
    });
    expect(clerk.createEmailAddress).toHaveBeenCalledWith({ email: 'new@example.com' });
  });

  it('verifies, makes primary and removes another address', async () => {
    clerk.emails.push(makeEmail('em_2', 'old@example.com', false));
    clerk.emails.push(makeEmail('em_3', 'work@example.com', true));
    open();
    const security = section('Sign-in and security');
    expect(within(security).getByText('Not verified')).toBeVisible();

    await userEvent.click(within(security).getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('dialog', { name: 'Check your email' })).toBeVisible();
    expect(clerk.emails[1]!.prepareVerification).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click(
      within(security).getByRole('button', { name: 'Options for work@example.com' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make primary' }));
    expect(await screen.findByText('Primary email address changed.')).toBeVisible();
    expect(clerk.updateUser).toHaveBeenCalledWith({ primaryEmailAddressId: 'em_3' });
    expect(clerk.getToken).toHaveBeenCalledWith({ skipCache: true });

    await userEvent.click(
      within(security).getByRole('button', { name: 'Options for old@example.com' }),
    );
    expect(screen.queryByRole('menuitem', { name: 'Make primary' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const remove = screen.getByRole('dialog', { name: 'Remove this email address?' });
    await userEvent.click(within(remove).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Email address removed.')).toBeVisible();
  });
});

describe('signed-in devices', () => {
  it('lists devices with this one first, and signs out of others', async () => {
    const phone = makeSession(
      'sess_phone',
      {
        browserName: 'Safari',
        deviceType: 'iPhone',
        city: 'Auckland',
        country: 'NZ',
        isMobile: true,
      },
      new Date(Date.now() - 2 * 86_400_000),
    );
    const laptop = makeSession('sess_laptop', { browserName: 'Firefox', deviceType: 'Macintosh' });
    clerk.sessions.push(phone, laptop);
    open();
    const security = section('Sign-in and security');

    expect(await within(security).findByText('Chrome on Windows')).toBeVisible();
    expect(within(security).getByText('This device')).toBeVisible();
    expect(within(security).getByText('Auckland, NZ · Last active 2 days ago')).toBeVisible();

    const row = within(security).getByText('Safari on iPhone').closest('div')!.parentElement!;
    await userEvent.click(within(row).getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Signed out of that device.')).toBeVisible();
    expect(phone.revoke).toHaveBeenCalled();

    await userEvent.click(
      within(security).getByRole('button', { name: 'Sign out of all other devices' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Sign out of all other devices?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out devices' }));
    await waitFor(() => expect(laptop.revoke).toHaveBeenCalled());
  });

  it('says when a device was last active', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    expect(lastActive(new Date('2026-10-22T11:58:00Z'), now)).toBe('Active now');
    expect(lastActive(new Date('2026-10-22T09:00:00Z'), now)).toBe('Last active 3 hours ago');
    expect(lastActive(new Date('2026-10-21T12:00:00Z'), now)).toBe('Last active yesterday');
  });
});

describe('deleting the account', () => {
  it('is not offered to an owner, who must keep the centre running', () => {
    open('owner');
    const security = section('Sign-in and security');
    expect(
      within(security).getByText(/You own Magic Center, so your account can’t be deleted here/),
    ).toBeVisible();
    expect(within(security).queryByRole('button', { name: 'Delete account' })).toBeNull();
  });

  it('needs the email typed to confirm, then deletes and signs out', async () => {
    open('teacher');
    await userEvent.click(
      within(section('Sign-in and security')).getByRole('button', { name: 'Delete account' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText(/Type ethan@example.com to confirm/),
      'ethan@example.com',
    );
    await userEvent.click(confirm);
    await waitFor(() => expect(clerk.deleteUser).toHaveBeenCalled());
    expect(clerk.signOut).toHaveBeenCalled();
    expect(await screen.findByTestId('where')).toHaveTextContent('/sign-in');
  });

  it('is hidden where Clerk doesn’t allow deleting yourself', () => {
    clerk.deleteSelfEnabled = false;
    open('teacher');
    expect(screen.queryByText('Delete your account')).toBeNull();
  });
});

describe('organisations', () => {
  it('lists each centre with the role and branches, and opens another', async () => {
    open('owner');
    const orgs = section('Organisations');
    expect(within(orgs).getByText('Magic Center')).toBeVisible();
    expect(within(orgs).getByText('Owner')).toBeVisible();
    expect(within(orgs).getByText('All branches')).toBeVisible();
    expect(within(orgs).getByText('Current')).toBeVisible();
    expect(within(orgs).getByText('Parent')).toBeVisible();
    expect(await within(orgs).findByText('Albany')).toBeVisible();

    await userEvent.click(within(orgs).getByRole('button', { name: 'Open' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(
      '/o/harmony/profile?section=organisations',
    );
    expect(localStorage.getItem('edustrux.lastOrg')).toBe('harmony');
  });
});
