import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext, type OrgContextValue } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { PrivacyPage } from '../src/pages/settings/PrivacyPage';
import { renderRoutes, stubApi } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// Settings › Privacy & data (TUI-118): the owner sets how long an erased family's invoices and
// payments are kept.

const ref = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const at = '2026-10-01T00:00:00.000Z';
const inOrg =
  (role: Role, org: Partial<NonNullable<OrgContextValue['org']>> = {}) =>
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
        org: {
          ...ref,
          updatedAt: at,
          financialRetentionYears: null,
          ...org,
        } as OrgContextValue['org'],
      }}
    >
      <ToastProvider>{tree}</ToastProvider>
    </OrgContext.Provider>
  );
const routes = [{ path: '/o/:orgSlug/settings/privacy', element: <PrivacyPage /> }];
const open = (role: Role, org?: Partial<NonNullable<OrgContextValue['org']>>) =>
  renderRoutes(routes, '/o/bright-minds/settings/privacy', inOrg(role, org));

describe('privacy settings', () => {
  it('shows the retention as not set, then saves the years the owner picks', async () => {
    const calls = stubApi({
      'PATCH /api/v1/orgs/org_1': ({ body }) => ({
        body: { ...ref, updatedAt: '2026-10-02T00:00:00.000Z', ...(body as object) },
      }),
    });
    open('owner');
    const select = screen.getByLabelText(/Keep an erased family’s invoices and payments for/);
    expect(select).toHaveValue('');
    expect(screen.getByText(/no invoice or payment is ever deleted/)).toBeVisible();
    expect(screen.getByText(/depends on your local tax law/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.selectOptions(select, '7 years');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Privacy settings saved')).toBeVisible();
    expect(calls.at(-1)).toMatchObject({
      key: 'PATCH /api/v1/orgs/org_1',
      body: { updatedAt: at, financialRetentionYears: 7 },
    });
  });

  it('can be set back to not set', async () => {
    const calls = stubApi({
      'PATCH /api/v1/orgs/org_1': ({ body }) => ({ body: { ...ref, ...(body as object) } }),
    });
    open('owner', { financialRetentionYears: 1 });
    const select = screen.getByLabelText(/Keep an erased family’s invoices and payments for/);
    expect(select).toHaveValue('1');
    expect(screen.getByRole('option', { name: '1 year' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'Not set');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Privacy settings saved')).toBeVisible();
    expect(calls.at(-1)?.body).toMatchObject({ financialRetentionYears: null });
  });

  it('is for the owner only', () => {
    stubApi({});
    open('branch_manager');
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});
