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

// The setup wizard inside a centre (TUI-130): eight steps on a screen of their own, each saved
// with the settings screens' own calls.

const API = '/api/v1/orgs/org_1';
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
const page = (data: unknown[]) => ({ data, nextCursor: null });
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

/** A new centre: its Main branch and the owner, nothing else, plus any replies the test adds. */
function stubSetup(
  extra: Parameters<typeof stubApi>[0] = {},
  lists: Record<string, unknown[]> = {},
) {
  const list = (name: string, fallback: unknown[] = []) => ({
    body: page(lists[name] ?? fallback),
  });
  return stubApi({
    [`GET ${API}/tax-rates?limit=200`]: list('tax-rates'),
    [`GET ${API}/branches?limit=200`]: list('branches', [
      { id: 'brn_main', name: 'Main', address: null, updatedAt: at },
    ]),
    [`GET ${API}/branches/brn_main/rooms?limit=200`]: list('rooms'),
    [`GET ${API}/academic-years?limit=200`]: list('academic-years'),
    [`GET ${API}/terms?limit=200`]: list('terms'),
    [`GET ${API}/grade-levels`]: list('grade-levels'),
    [`GET ${API}/subjects?limit=200`]: list('subjects'),
    [`GET ${API}/staff?limit=2`]: list('staff', [{ id: 'mem_me' }]),
    [`GET ${API}/classes?limit=200`]: list('classes'),
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
const onStep = (title: string) => screen.findByRole('heading', { name: title });

describe('the setup wizard', () => {
  it('changes the centre’s details with only what changed, then asks how it runs', async () => {
    const calls = stubSetup({
      [`PATCH ${API}`]: ({ body }) => ({ body: { ...org, ...(body as object) } }),
    });
    open();
    await onStep('Tell us about your centre');
    expect(screen.getByLabelText('Web address')).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Centre name/));
    await userEvent.type(screen.getByLabelText(/Centre name/), 'Bright Minds Academy');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await onStep('How do you run your centre?')).toBeVisible();
    expect(calls.find((c) => c.key === `PATCH ${API}`)?.body).toEqual({
      updatedAt: at,
      name: 'Bright Minds Academy',
    });
  });

  it('says why single-tutor mode was refused', async () => {
    stubSetup({
      [`PATCH ${API}`]: {
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
    open('type');
    await userEvent.click(await screen.findByLabelText(/Just me/));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/allows one branch/)).toBeVisible();
  });

  it('adds the default tax rate and the tax number', async () => {
    const calls = stubSetup({
      [`POST ${API}/tax-rates`]: { status: 201, body: {} },
      [`PATCH ${API}`]: ({ body }) => ({ body: { ...org, ...(body as object) } }),
    });
    open('tax');
    await onStep('Set up tax');
    expect(screen.getByLabelText(/Tax name/)).toHaveValue('GST');

    await userEvent.type(screen.getByLabelText(/^Rate/), 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter a percentage from 0 to 100.')).toBeVisible();
    expect(posts(calls, '/tax-rates')).toEqual([]);

    await userEvent.clear(screen.getByLabelText(/^Rate/));
    await userEvent.type(screen.getByLabelText(/^Rate/), '15%');
    await userEvent.type(screen.getByLabelText(/Tax number/), '123-456-789');
    await userEvent.selectOptions(screen.getByLabelText('Prices are'), 'Plus tax');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await onStep('Add your first branch')).toBeVisible();
    expect(posts(calls, '/tax-rates')).toEqual([
      { name: 'GST', rateBps: 1500, inclusive: false, isDefault: true },
    ]);
    expect(calls.find((c) => c.key === `PATCH ${API}`)?.body).toEqual({
      updatedAt: at,
      taxNumber: '123-456-789',
    });
  });

  it('moves on from tax without saving for no tax', async () => {
    const calls = stubSetup();
    open('tax');
    await userEvent.click(await screen.findByLabelText(/No tax/));
    expect(screen.queryByLabelText(/Tax name/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await onStep('Add your first branch')).toBeVisible();
    expect(calls.filter((c) => !c.key.startsWith('GET'))).toEqual([]);
  });

  it('renames the Main branch and adds its rooms', async () => {
    const calls = stubSetup({
      [`PATCH ${API}/branches/brn_main`]: { body: {} },
      [`POST ${API}/branches/brn_main/rooms`]: { status: 201, body: {} },
    });
    open('branch');
    await onStep('Add your first branch');
    await userEvent.clear(screen.getByLabelText(/Branch name/));
    await userEvent.type(screen.getByLabelText(/Branch name/), 'Mt Albert');
    await userEvent.type(screen.getByLabelText('Seats'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await onStep('Plan your academic year')).toBeVisible();
    expect(calls.find((c) => c.key === `PATCH ${API}/branches/brn_main`)?.body).toEqual({
      updatedAt: at,
      name: 'Mt Albert',
    });
    expect(posts(calls, '/branches/brn_main/rooms')).toEqual([
      { name: 'Room 1', capacity: 12 },
      { name: 'Room 2' },
    ]);
  });

  it('saves the year and the terms with dates, then moves to grade levels', async () => {
    const calls = stubSetup({
      [`POST ${API}/academic-years`]: { status: 201, body: { id: 'acy_1' } },
      [`POST ${API}/terms`]: { status: 201, body: { id: 'trm_1' } },
    });
    open('calendar');
    await onStep('Plan your academic year');
    await userEvent.clear(screen.getByLabelText(/Year name/));
    await userEvent.type(screen.getByLabelText(/Year name/), '2027');
    await userEvent.clear(screen.getByLabelText(/Year starts/));
    await userEvent.type(screen.getByLabelText(/Year starts/), '2027-01-25');
    await userEvent.clear(screen.getByLabelText(/Year ends/));
    await userEvent.type(screen.getByLabelText(/Year ends/), '2027-12-17');
    await userEvent.type(screen.getByLabelText('Term 1 starts'), '2027-02-01');
    await userEvent.type(screen.getByLabelText('Term 1 ends'), '2027-04-16');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Term 4' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await onStep('Choose your grade levels')).toBeVisible();
    expect(posts(calls, '/academic-years')).toEqual([
      { name: '2027', startDate: '2027-01-25', endDate: '2027-12-17' },
    ]);
    // Terms without dates are skipped.
    expect(posts(calls, '/terms')).toEqual([
      { academicYearId: 'acy_1', name: 'Term 1', startDate: '2027-02-01', endDate: '2027-04-16' },
    ]);
  });

  it('moves on without saving for monthly billing', async () => {
    const calls = stubSetup();
    open('calendar');
    await userEvent.click(await screen.findByLabelText(/I bill monthly/));
    expect(screen.queryByLabelText(/Year name/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await onStep('Choose your grade levels')).toBeVisible();
    expect(calls.filter((c) => !c.key.startsWith('GET'))).toEqual([]);
  });

  it('starts grade levels from the country’s names and saves them in order', async () => {
    const calls = stubSetup({ [`POST ${API}/grade-levels`]: { status: 201, body: {} } });
    open('grades');
    await onStep('Choose your grade levels');
    expect(screen.getByRole('button', { name: 'Year 1–13' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Year 13')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Grade K–12' }));
    expect(screen.queryByText('Year 1')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Grade 12' }));
    await userEvent.type(screen.getByLabelText('Add a grade level'), 'Adult{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await onStep('What do you teach?')).toBeVisible();
    expect(posts(calls, '/grade-levels').map((b) => (b as { name: string }).name)).toEqual([
      'Kindergarten',
      ...Array.from({ length: 11 }, (_, i) => `Grade ${i + 1}`),
      'Adult',
    ]);
  });

  it('picks subjects, adds the centre’s own, and says which didn’t save', async () => {
    const calls = stubSetup({
      [`POST ${API}/subjects`]: ({ body }) =>
        (body as { name: string }).name === 'Physics'
          ? {
              status: 409,
              body: { error: { code: 'conflict', message: 'A subject with that name exists' } },
            }
          : { status: 201, body: {} },
    });
    open('subjects');
    await userEvent.click(await screen.findByRole('button', { name: 'English' }));
    await userEvent.click(screen.getByRole('button', { name: 'Physics' }));
    await userEvent.type(screen.getByLabelText('Add a subject'), 'Te Reo Māori');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Te Reo Māori' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText('These didn’t save: Physics. A subject with that name exists'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'What do you teach?' })).toBeVisible();
    expect(posts(calls, '/subjects')).toEqual([
      { name: 'Mathematics' },
      { name: 'Science' },
      { name: 'Physics' },
      { name: 'Te Reo Māori' },
    ]);
  });

  it('invites the team, then finishes at Home', async () => {
    const calls = stubSetup({
      [`POST ${API}/staff/invitations`]: { status: 201, body: {} },
      [`PATCH ${API}`]: ({ body }) => ({
        body: { ...org, setupCompletedAt: at, ...(body as object) },
      }),
    });
    open('team');
    await onStep('Invite your team');
    await userEvent.type(screen.getByLabelText('Email'), 'jason@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Invite another' }));
    const second = screen.getAllByLabelText('Email')[1]!;
    await userEvent.type(second, 'amy@example.com');
    await userEvent.selectOptions(screen.getAllByLabelText('Role')[1]!, 'Front desk');
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByTestId('where')).toHaveTextContent('/o/bright-minds');
    expect(posts(calls, '/staff/invitations')).toEqual([
      { email: 'jason@example.com', role: 'teacher' },
      { email: 'amy@example.com', role: 'front_desk' },
    ]);
  });

  it('marks the setup finished with nobody invited, so monthly billing and no staff still count', async () => {
    const calls = stubSetup({
      [`PATCH ${API}`]: ({ body }) => ({
        body: { ...org, setupCompletedAt: at, ...(body as object) },
      }),
    });
    open('team');
    await userEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/o/bright-minds');
    expect(posts(calls, '/staff/invitations')).toEqual([]);
    // Finishing marks it done (D-195), so Home stops offering the setup.
    expect(calls.find((c) => c.key === `PATCH ${API}`)?.body).toEqual({
      updatedAt: at,
      setupCompleted: true,
    });
  });

  it('shows the steps done so far, and what a done step already has', async () => {
    stubSetup(
      {},
      {
        'academic-years': [{ id: 'acy_1', name: '2027' }],
        terms: [
          { id: 'trm_1', academicYearId: 'acy_1' },
          { id: 'trm_2', academicYearId: 'acy_1' },
        ],
        'grade-levels': [{ id: 'grd_1', name: 'Year 1' }],
      },
    );
    open('calendar');
    expect(await screen.findByText('2027: 2 terms')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Change on Terms & holidays' })).toHaveAttribute(
      'href',
      '/o/bright-minds/settings/terms',
    );
    const steps = within(screen.getByRole('navigation', { name: 'Setup steps' }));
    // Centre details, setup type and grade levels; the year is the step in progress.
    expect(steps.getAllByLabelText('Done')).toHaveLength(3);
    expect(steps.getByRole('button', { name: /Academic year/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('is for the owner only', () => {
    stubSetup();
    open('', 'branch_manager');
    expect(screen.getByText('You don’t have permission to see this.')).toBeVisible();
  });
});
