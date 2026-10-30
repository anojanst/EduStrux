import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/ui/Toast';
import { OrgContext, type OrgContextValue } from '../src/lib/org';
import type { Role } from '../src/lib/roles';
import { SetupPage } from '../src/pages/setup/SetupPage';
import { renderRoutes, stubApi, Where } from './render';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// The setup wizard (TUI-64): terms, grade levels, subjects, tax and a first class, one step a
// page, each saved with the settings screens' own calls.

const API = '/api/v1/orgs/org_1';
const ref = { id: 'org_1', name: 'Bright Minds Tuition', slug: 'bright-minds' };
const at = '2026-10-01T00:00:00.000Z';
const page = (data: unknown[]) => ({ data, nextCursor: null });
const inOrg = (role: Role) => (tree: ReactNode) => (
  <OrgContext.Provider
    value={{
      me: { id: 'usr_1', email: 'o@example.com', name: 'Olivia', memberships: [] },
      membership: { id: 'mem_me', role, branchIds: null, org: ref },
      org: {
        ...ref,
        country: 'NZ',
        currency: 'NZD',
        timezone: 'Pacific/Auckland',
        locale: 'en-NZ',
        dateFormat: 'DD/MM/YYYY',
        taxNumber: null,
        updatedAt: at,
      } as OrgContextValue['org'],
    }}
  >
    <ToastProvider>{tree}</ToastProvider>
  </OrgContext.Provider>
);

/** A new centre: every list empty, plus any replies the test adds. */
function stubSetup(
  extra: Parameters<typeof stubApi>[0] = {},
  lists: Record<string, unknown[]> = {},
) {
  const list = (name: string) => ({ body: page(lists[name] ?? []) });
  return stubApi({
    [`GET ${API}/academic-years?limit=200`]: list('academic-years'),
    [`GET ${API}/terms?limit=200`]: list('terms'),
    [`GET ${API}/grade-levels`]: list('grade-levels'),
    [`GET ${API}/subjects?limit=200`]: list('subjects'),
    [`GET ${API}/tax-rates?limit=200`]: list('tax-rates'),
    [`GET ${API}/classes?limit=200`]: list('classes'),
    [`GET ${API}/courses?limit=200`]: list('courses'),
    ...extra,
  });
}

const routes = [
  { path: '/o/bright-minds/setup', element: <SetupPage /> },
  { path: '*', element: <Where /> },
];
const open = (step = '', role: Role = 'owner') =>
  renderRoutes(routes, `/o/bright-minds/setup${step ? `?step=${step}` : ''}`, inOrg(role));
const posts = (calls: { key: string; body: unknown }[], path: string) =>
  calls.filter((c) => c.key === `POST ${API}${path}`).map((c) => c.body);

describe('the setup wizard', () => {
  it('saves the year and the terms with dates, then moves to grade levels', async () => {
    const calls = stubSetup({
      [`POST ${API}/academic-years`]: { status: 201, body: { id: 'acy_1' } },
      [`POST ${API}/terms`]: { status: 201, body: { id: 'trm_1' } },
    });
    open();
    expect(await screen.findByText('Set up · Step 1 of 5')).toBeVisible();
    expect(screen.getByLabelText(/Year name/)).toHaveValue(String(new Date().getFullYear()));

    await userEvent.clear(screen.getByLabelText(/Year name/));
    await userEvent.type(screen.getByLabelText(/Year name/), '2027');
    await userEvent.clear(screen.getByLabelText(/Year starts/));
    await userEvent.type(screen.getByLabelText(/Year starts/), '2027-01-25');
    await userEvent.clear(screen.getByLabelText(/Year ends/));
    await userEvent.type(screen.getByLabelText(/Year ends/), '2027-12-17');
    await userEvent.type(screen.getByLabelText('Term 1 starts'), '2027-02-01');
    await userEvent.type(screen.getByLabelText('Term 1 ends'), '2027-04-16');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Term 4' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(await screen.findByText('Set up · Step 2 of 5')).toBeVisible();
    expect(posts(calls, '/academic-years')).toEqual([
      { name: '2027', startDate: '2027-01-25', endDate: '2027-12-17' },
    ]);
    // Terms without dates are skipped.
    expect(posts(calls, '/terms')).toEqual([
      { academicYearId: 'acy_1', name: 'Term 1', startDate: '2027-02-01', endDate: '2027-04-16' },
    ]);
  });

  it('moves on without saving for rolling monthly', async () => {
    const calls = stubSetup();
    open();
    await userEvent.click(await screen.findByLabelText(/Rolling monthly/));
    expect(screen.queryByLabelText(/Year name/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Set up · Step 2 of 5')).toBeVisible();
    expect(calls.filter((c) => c.key.startsWith('POST'))).toEqual([]);
  });

  it('starts grade levels from the country’s names and saves them in order', async () => {
    const calls = stubSetup({
      [`POST ${API}/grade-levels`]: { status: 201, body: {} },
    });
    open('grades');
    const list = await screen.findByText('Your grade levels');
    expect(screen.getByRole('button', { name: 'Year 1–13' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Year 13')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Grade 1–12' }));
    expect(screen.queryByText('Year 1')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Grade 12' }));
    await userEvent.type(screen.getByLabelText('Add a grade level'), 'Adult{Enter}');
    expect(list).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(await screen.findByText('Set up · Step 3 of 5')).toBeVisible();
    expect(posts(calls, '/grade-levels').map((b) => (b as { name: string }).name)).toEqual([
      ...Array.from({ length: 11 }, (_, i) => `Grade ${i + 1}`),
      'Adult',
    ]);
  });

  it('says which names didn’t save and stays on the step', async () => {
    stubSetup({
      [`POST ${API}/subjects`]: ({ body }) =>
        (body as { name: string }).name === 'English'
          ? {
              status: 409,
              body: { error: { code: 'conflict', message: 'A subject with that name exists' } },
            }
          : { status: 201, body: {} },
    });
    open('subjects');
    await userEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText(/These didn’t save: English/)).toBeVisible();
    expect(screen.getByText('Set up · Step 3 of 5')).toBeVisible();
  });

  it('picks subjects from the suggestions and adds one of the centre’s own', async () => {
    const calls = stubSetup({ [`POST ${API}/subjects`]: { status: 201, body: {} } });
    open('subjects');
    await userEvent.click(await screen.findByRole('button', { name: 'English' }));
    await userEvent.click(screen.getByRole('button', { name: 'Physics' }));
    await userEvent.type(screen.getByLabelText('Add a subject'), 'Te Reo Māori');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText('Set up · Step 4 of 5')).toBeVisible();
    expect(posts(calls, '/subjects')).toEqual([
      { name: 'Mathematics' },
      { name: 'Science' },
      { name: 'Physics' },
      { name: 'Te Reo Māori' },
    ]);
  });

  it('adds the default tax rate and the tax number', async () => {
    const calls = stubSetup({
      [`POST ${API}/tax-rates`]: { status: 201, body: {} },
      [`PATCH ${API}`]: ({ body }) => ({ body: { ...ref, ...(body as object) } }),
    });
    open('tax');
    await userEvent.click(await screen.findByLabelText(/We charge tax/));
    expect(screen.getByLabelText(/Tax name/)).toHaveValue('GST');

    await userEvent.type(screen.getByLabelText(/Rate/), 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getByText('Enter a percentage from 0 to 100.')).toBeVisible();
    expect(posts(calls, '/tax-rates')).toEqual([]);

    await userEvent.clear(screen.getByLabelText(/Rate/));
    await userEvent.type(screen.getByLabelText(/Rate/), '15');
    await userEvent.type(screen.getByLabelText(/Tax number/), '123-456-789');
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(await screen.findByText('Set up · Step 5 of 5')).toBeVisible();
    expect(posts(calls, '/tax-rates')).toEqual([
      { name: 'GST', rateBps: 1500, inclusive: true, isDefault: true },
    ]);
    expect(calls.find((c) => c.key === `PATCH ${API}`)?.body).toEqual({
      updatedAt: at,
      taxNumber: '123-456-789',
    });
  });

  it('shows what a step already has, and ends at Home once there’s a class', async () => {
    stubSetup(
      {},
      {
        'academic-years': [{ id: 'acy_1', name: '2027' }],
        terms: [
          { id: 'trm_1', academicYearId: 'acy_1' },
          { id: 'trm_2', academicYearId: 'acy_1' },
        ],
        classes: [{ id: 'cls_1' }],
      },
    );
    open();
    expect(await screen.findByText('2027: 2 terms')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Change on Terms & holidays' })).toHaveAttribute(
      'href',
      '/o/bright-minds/settings/terms',
    );
    const steps = screen.getByRole('navigation', { name: 'Setup steps' });
    expect(within(steps).getAllByLabelText('Done')).toHaveLength(2);

    await userEvent.click(within(steps).getByRole('button', { name: /First class/ }));
    expect(screen.getByText('You have 1 class.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Go to Home' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/o/bright-minds');
  });

  it('is for the owner only', () => {
    stubSetup();
    open('', 'branch_manager');
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});
