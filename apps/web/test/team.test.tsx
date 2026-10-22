import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgContext } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { TeamPage } from '../src/pages/TeamPage';
import { signInAs } from './clerk';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

const org = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg =
  (role: Role, branchIds: string[] | null = null) =>
  (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: { id: 'usr_1', email: 'olivia@example.com', name: 'Olivia Hart', memberships: [] },
        membership: { id: 'mem_me', role, branchIds, org },
        org: undefined,
      }}
    >
      {tree}
    </OrgContext.Provider>
  );
const routes = [{ path: '*', element: <TeamPage /> }];
const STAFF = 'GET /api/v1/orgs/org_1/staff?limit=50';
const BRANCHES = 'GET /api/v1/orgs/org_1/branches?limit=200';
const INVITE = 'POST /api/v1/orgs/org_1/staff/invitations';
const staff = {
  data: [
    {
      id: 'mem_me',
      userId: 'usr_1',
      name: 'Olivia Hart',
      email: 'olivia@example.com',
      role: 'owner',
      branchIds: null,
      status: 'active',
    },
    {
      id: 'mem_2',
      userId: 'usr_2',
      name: null,
      email: 'sam@example.com',
      role: 'teacher',
      branchIds: ['brn_main'],
      status: 'suspended',
    },
  ],
  nextCursor: null,
};
const branches = (names: [string, string][]) => ({
  data: names.map(([id, name]) => ({ id, name, address: null })),
  nextCursor: null,
});
const created = {
  invitation: { id: 'ivt_1', email: 'new@example.com', role: 'teacher', branchIds: null },
  token: 'secret-token',
};

beforeEach(() => signInAs());

describe('the team page', () => {
  it('lists the staff with their role, branches and status', async () => {
    stubApi({ [STAFF]: { body: staff }, [BRANCHES]: { body: branches([['brn_main', 'Main']]) } });
    renderRoutes(routes, '/', inOrg('owner'));

    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]!).getByText(/Olivia Hart/)).toBeVisible();
    expect(within(rows[0]!).getByText('(you)')).toBeVisible();
    expect(within(rows[0]!).getByText(/All branches/)).toBeVisible();
    expect(within(rows[1]!).getByText('sam@example.com')).toBeVisible();
    expect(within(rows[1]!).getByText('Main')).toBeVisible();
    expect(within(rows[1]!).getByText('Suspended')).toBeVisible();
  });

  it('lets the owner invite a teacher and shows the link to share', async () => {
    const calls = stubApi({
      [STAFF]: { body: staff },
      [BRANCHES]: { body: branches([['brn_main', 'Main']]) },
      [INVITE]: { status: 201, body: created },
    });
    renderRoutes(routes, '/', inOrg('owner'));

    await userEvent.click(await screen.findByRole('button', { name: 'Invite someone' }));
    expect(screen.getByLabelText(/Role/)).toHaveDisplayValue('Teacher');
    // One branch: nothing to choose, so the branch list isn't asked.
    expect(screen.queryByText('Branches')).toBeNull();
    await userEvent.type(screen.getByLabelText(/Email/), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText('Invitation sent to new@example.com')).toBeVisible();
    expect(screen.getByLabelText('Invitation link')).toHaveValue(
      `${window.location.origin}/invitations/secret-token`,
    );
    expect(calls.find((c) => c.key === INVITE)!.body).toEqual({
      email: 'new@example.com',
      role: 'teacher',
    });
  });

  it('has a branch-limited manager pick from their own branches and roles', async () => {
    const calls = stubApi({
      [STAFF]: { body: staff },
      [BRANCHES]: {
        body: branches([
          ['brn_main', 'Main'],
          ['brn_alb', 'Albany'],
          ['brn_city', 'City'],
        ]),
      },
      [INVITE]: { status: 201, body: created },
    });
    renderRoutes(routes, '/', inOrg('branch_manager', ['brn_alb']));

    await userEvent.click(await screen.findByRole('button', { name: 'Invite someone' }));
    const roles = within(screen.getByLabelText(/Role/)).getAllByRole('option');
    expect(roles.map((o) => o.textContent)).toEqual(['Branch manager', 'Front desk', 'Teacher']);
    expect(screen.queryByLabelText('Main')).toBeNull();
    await userEvent.click(screen.getByLabelText('Albany'));
    await userEvent.type(screen.getByLabelText(/Email/), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await screen.findByText('Invitation sent to new@example.com');
    expect(calls.find((c) => c.key === INVITE)!.body).toEqual({
      email: 'new@example.com',
      role: 'teacher',
      branchIds: ['brn_alb'],
    });
  });

  it('shows the API’s field error for the email', async () => {
    stubApi({
      [STAFF]: { body: staff },
      [BRANCHES]: { body: branches([['brn_main', 'Main']]) },
      [INVITE]: {
        status: 400,
        body: {
          error: {
            code: 'validation_failed',
            message: 'x',
            fields: { email: ['Invalid email address'] },
          },
        },
      },
    });
    renderRoutes(routes, '/', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Invite someone' }));
    await userEvent.type(screen.getByLabelText(/Email/), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Invalid email address')).toBeVisible();
  });

  it('is refused to the roles that can’t see the team', () => {
    for (const role of ['front_desk', 'teacher', 'parent', 'accountant'] as const) {
      const view = renderRoutes(routes, '/', inOrg(role));
      expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Invite someone' })).toBeNull();
      view.unmount();
    }
  });
});
