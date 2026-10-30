import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext, type OrgContextValue } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { OrganisationPage } from '../src/pages/settings/OrganisationPage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// Settings › Organisation (TUI-64): the centre's name, region, single-tutor mode and tax number.

const ref = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const at = '2026-10-01T00:00:00.000Z';
const org = {
  ...ref,
  country: 'NZ',
  currency: 'NZD',
  timezone: 'Pacific/Auckland',
  locale: 'en-NZ',
  dateFormat: 'DD/MM/YYYY',
  singleTutorMode: false,
  taxNumber: null,
  updatedAt: at,
};
const inOrg = (role: Role) => (tree: ReactNode) => (
  <OrgContext.Provider
    value={{
      me: { id: 'usr_1', email: 'o@example.com', name: 'Olivia', memberships: [] },
      membership: { id: 'mem_me', role, branchIds: null, org: ref },
      org: org as OrgContextValue['org'],
    }}
  >
    <ToastProvider>{tree}</ToastProvider>
  </OrgContext.Provider>
);
const routes = [{ path: '/o/bright-minds/settings/organisation', element: <OrganisationPage /> }];
const open = (role: Role = 'owner') =>
  renderRoutes(routes, '/o/bright-minds/settings/organisation', inOrg(role));

describe('organisation settings', () => {
  it('saves only what changed, with the locale for a new country', async () => {
    const calls = stubApi({
      'PATCH /api/v1/orgs/org_1': ({ body }) => ({
        body: { ...org, ...(body as object), updatedAt: '2026-10-02T00:00:00.000Z' },
      }),
    });
    open();
    expect(screen.getByLabelText(/Centre name/)).toHaveValue('Bright Minds Tuition');
    expect(screen.getByText('NZD')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/Centre name/));
    await userEvent.type(screen.getByLabelText(/Centre name/), 'Bright Minds Academy');
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'AU');
    await userEvent.type(screen.getByLabelText(/Tax number/), '51 824 753 556');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Organisation saved')).toBeVisible();
    expect(calls.at(-1)?.body).toEqual({
      updatedAt: at,
      name: 'Bright Minds Academy',
      country: 'AU',
      locale: 'en-AU',
      taxNumber: '51 824 753 556',
    });
  });

  it('shows why single-tutor mode was refused', async () => {
    stubApi({
      'PATCH /api/v1/orgs/org_1': {
        status: 422,
        body: {
          error: {
            code: 'unprocessable',
            message: 'Single-tutor mode allows one branch. Delete the other branches first.',
            fields: { singleTutorMode: ['More than one branch'] },
          },
        },
      },
    });
    open();
    await userEvent.click(screen.getByRole('switch', { name: /Single-tutor mode/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('More than one branch')).toBeVisible();
  });

  it('is for the owner only', () => {
    stubApi({});
    open('branch_manager');
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});
