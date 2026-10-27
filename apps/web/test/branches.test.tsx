import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext, type OrgContextValue } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { BranchesPage } from '../src/pages/settings/BranchesPage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// Settings › Branches & rooms (TUI-124): the owner sets up branches and rooms; staff see them.

const ref = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const inOrg =
  (role: Role = 'owner', org?: Partial<NonNullable<OrgContextValue['org']>>) =>
  (tree: ReactNode) => (
    <OrgContext.Provider
      value={{
        me: {
          id: 'usr_1',
          email: 'olivia@example.com',
          name: 'Olivia Hart',
          memberships: [{ id: 'mem_me', role, branchIds: null, org: ref }],
        },
        membership: { id: 'mem_me', role, branchIds: null, org: ref },
        org: org as OrgContextValue['org'],
      }}
    >
      <ToastProvider>{tree}</ToastProvider>
    </OrgContext.Provider>
  );

const API = 'GET /api/v1/orgs/org_1';
const ORG = '/api/v1/orgs/org_1';
const at = '2026-10-01T00:00:00.000Z';
const routes = [{ path: '/o/:orgSlug/settings/branches', element: <BranchesPage /> }];
const page = <T,>(data: T[]) => ({ body: { data, nextCursor: null } });

const albany = {
  id: 'brn_a',
  name: 'Albany',
  address: '12 Main Road',
  createdAt: at,
  updatedAt: at,
};
const city = { id: 'brn_c', name: 'City', address: null, createdAt: at, updatedAt: at };
const room = (id: string, name: string, capacity: number | null) => ({
  id,
  branchId: 'brn_a',
  name,
  capacity,
  createdAt: at,
  updatedAt: at,
});
const lookups = {
  [`${API}/branches?limit=200`]: page([albany, city]),
  [`${API}/branches/brn_a/rooms?limit=200`]: page([
    room('rm_1', 'Room 1', 12),
    room('rm_h', 'Study Hall', null),
  ]),
  [`${API}/branches/brn_c/rooms?limit=200`]: page([]),
  [`${API}/classes?limit=200`]: page([
    { id: 'cls_1', name: 'Year 9 Maths', branchId: 'brn_a', roomId: 'rm_1' },
    { id: 'cls_2', name: 'Year 7 English', branchId: 'brn_a', roomId: 'rm_1' },
  ]),
};

describe('the branches and rooms', () => {
  it('lists each branch with its rooms, seats and classes', async () => {
    stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/settings/branches', inOrg('owner'));

    expect(await screen.findByText('2 branches · 2 rooms')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Albany' })).toBeVisible();
    expect(screen.getByText('2 rooms · 2 classes')).toBeVisible();
    expect(screen.getByText('Seats 12')).toBeVisible();
    expect(screen.getAllByText('No limit')[0]).toBeVisible();
    expect(screen.getByText('No rooms yet')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add address' })).toBeVisible();
  });

  it('is read-only for other staff', async () => {
    const calls = stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/settings/branches', inOrg('branch_manager'));
    expect(await screen.findByText('Only the owner can change branches and rooms.')).toBeVisible();
    await screen.findByText('Seats 12');
    expect(screen.queryByRole('button', { name: 'Add branch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add room' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Albany' })).toBeNull();
    expect(calls.some((c) => !c.key.startsWith('GET'))).toBe(false);
  });

  it("doesn't add branches in single-tutor mode", async () => {
    stubApi(lookups);
    renderRoutes(
      routes,
      '/o/bright-minds/settings/branches',
      inOrg('owner', { singleTutorMode: true }),
    );
    expect(
      await screen.findByText('This centre is set up for one tutor, so it has one branch.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add branch' })).toBeNull();
  });

  it('is not for parents', () => {
    stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/settings/branches', inOrg('parent'));
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});

describe('adding and changing', () => {
  it('adds a room with its capacity, and says when the name is taken', async () => {
    let taken = true;
    const calls = stubApi({
      ...lookups,
      [`POST ${ORG}/branches/brn_a/rooms`]: () =>
        taken
          ? { status: 409, body: { error: { code: 'conflict', message: 'Taken' } } }
          : { status: 201, body: room('rm_new', 'Room 2', 12) },
    });
    renderRoutes(routes, '/o/bright-minds/settings/branches', inOrg('owner'));
    await screen.findByText('Seats 12');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add room' })[0]!);

    const dialog = await screen.findByRole('dialog', { name: 'Add room' });
    expect(within(dialog).getByText('Albany')).toBeVisible();
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Room 1');
    await userEvent.type(within(dialog).getByLabelText(/^Capacity/), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add room' }));
    expect(
      await within(dialog).findByText('Albany already has a room called Room 1.'),
    ).toBeVisible();

    taken = false;
    await userEvent.clear(within(dialog).getByLabelText(/^Name/));
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Room 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add room' }));
    expect(await screen.findByText('Room added')).toBeVisible();
    expect(calls.filter((c) => c.key === `POST ${ORG}/branches/brn_a/rooms`).at(-1)?.body).toEqual({
      name: 'Room 2',
      capacity: 12,
    });
  });

  it('checks the capacity before sending', async () => {
    const calls = stubApi(lookups);
    renderRoutes(routes, '/o/bright-minds/settings/branches', inOrg('owner'));
    await screen.findByText('Seats 12');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add room' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add room' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Room 2');
    await userEvent.type(within(dialog).getByLabelText(/^Capacity/), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add room' }));

    expect(within(dialog).getByText('Enter a whole number from 1 to 1000.')).toBeVisible();
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it("adds a branch's address", async () => {
    const calls = stubApi({
      ...lookups,
      [`PATCH ${ORG}/branches/brn_c`]: { body: { ...city, address: '1 Queen St' } },
    });
    renderRoutes(routes, '/o/bright-minds/settings/branches', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add address' }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit branch' });
    await userEvent.type(within(dialog).getByLabelText('Address'), '1 Queen St');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH ${ORG}/branches/brn_c`)?.body).toEqual({
        updatedAt: at,
        name: 'City',
        address: '1 Queen St',
      }),
    );
  });
});

describe('deleting', () => {
  const branchChecks = {
    [`${API}/families?branchId=brn_a&limit=200`]: page([{ id: 'fam_1' }]),
    [`${API}/families?branchId=brn_c&limit=200`]: page([]),
    [`${API}/holidays?limit=200`]: page([]),
    [`${API}/staff?limit=200`]: page([{ id: 'mem_t', branchIds: ['brn_a'] }]),
  };

  it('says everything that still uses a branch, with Delete off', async () => {
    stubApi({ ...lookups, ...branchChecks });
    renderRoutes(routes, '/o/bright-minds/settings/branches', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Albany' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete branch' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete Albany branch?' });
    expect(await within(dialog).findByText('Still has 2 rooms')).toBeVisible();
    expect(within(dialog).getByRole('link', { name: '2 classes' })).toBeVisible();
    expect(
      within(dialog).getByRole('link', { name: '1 family has it as their home branch' }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('link', { name: '1 member of staff only works at this branch' }),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Delete branch' })).toBeDisabled();
  });

  it('deletes a branch nothing uses', async () => {
    const calls = stubApi({
      ...lookups,
      ...branchChecks,
      [`DELETE ${ORG}/branches/brn_c`]: { status: 204 },
    });
    renderRoutes(routes, '/o/bright-minds/settings/branches', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for City' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete branch' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete City branch?' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Delete branch' })).toBeEnabled(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete branch' }));

    expect(await screen.findByText('City deleted')).toBeVisible();
    expect(calls.some((c) => c.key === `DELETE ${ORG}/branches/brn_c`)).toBe(true);
  });

  it('names the classes held in a room before it can go', async () => {
    const calls = stubApi({ ...lookups, [`DELETE ${ORG}/rooms/rm_h`]: { status: 204 } });
    renderRoutes(routes, '/o/bright-minds/settings/branches', inOrg('owner'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Room 1' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete room' }));
    let dialog = await screen.findByRole('dialog', { name: 'Delete Room 1?' });
    expect(within(dialog).getByRole('link', { name: 'Year 9 Maths' })).toHaveAttribute(
      'href',
      '/o/bright-minds/classes/cls_1',
    );
    expect(within(dialog).getByRole('button', { name: 'Delete room' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Study Hall' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete room' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete Study Hall?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete room' }));
    expect(await screen.findByText('Study Hall deleted')).toBeVisible();
    expect(calls.some((c) => c.key === `DELETE ${ORG}/rooms/rm_h`)).toBe(true);
  });
});
